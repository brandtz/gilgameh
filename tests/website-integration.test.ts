import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHmac } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { createApp, toNodeListener } from 'h3'
import { getDb, resetTestDb, closeDb, schema } from '../server/db'
import { seedDatabase, type SeedResult } from '../server/db/seed'
import { resolveAuthFromToken, type ActorContext } from '../server/utils/auth-context'
import { loginWithPassword } from '../server/services/auth.service'
import { createCustomer, getCustomerById } from '../server/services/customer.service'
import { createOrder, listOrders } from '../server/services/order.service'
import {
  MAX_WEBHOOK_DELIVERY_ATTEMPTS,
  createWebhookEndpoint,
  emitWebhookEvent,
  retryDueWebhookDeliveries
} from '../server/services/webhook.service'
import { AppError } from '../server/utils/errors'
import websiteWebhookHandler from '../server/api/webhooks/website.post'
import webhookRetryHandler from '../server/api/internal/webhook-deliveries/retry.post'

// The retry route derives its bearer token from JWT_SECRET, which is read at call time.
process.env.JWT_SECRET = 'test-jwt-secret-for-website-integration-suite-0123456789'

interface ReceivedRequest {
  headers: IncomingHttpHeaders
  body: string
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    })
  })
}

describe('Website integration — inbound dedupe, strict customer matching & outbound retries', () => {
  let seed: SeedResult
  let ownerCtx: ActorContext
  let websiteSecret: string
  let appServer: Server
  let appUrl: string
  let receiver: Server
  let receiverUrl: string
  const received: ReceivedRequest[] = []
  const receiverStatuses: number[] = []
  const beforeRespond: Array<() => Promise<void>> = []

  async function postWebsiteEvent(payload: Record<string, unknown>) {
    const body = JSON.stringify(payload)
    const signature = createHmac('sha256', websiteSecret).update(body).digest('hex')
    const res = await fetch(`${appUrl}/api/webhooks/website`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Slug': 'studio-37',
        'X-Webhook-Signature': `v1=${signature}`
      },
      body
    })
    return { status: res.status, replayed: res.headers.get('x-idempotent-replayed'), json: (await res.json()) as any }
  }

  beforeAll(async () => {
    await resetTestDb()
    seed = await seedDatabase()
    ownerCtx = await resolveAuthFromToken(
      (await loginWithPassword('drew@studio37.local', 'Studio37Owner!2026')).token
    )
    const db = await getDb()
    const [websiteConfig] = await db
      .select()
      .from(schema.integrationConfigs)
      .where(
        and(
          eq(schema.integrationConfigs.tenantId, seed.tenantId),
          eq(schema.integrationConfigs.provider, 'website')
        )
      )
    websiteSecret = websiteConfig.webhookSecret!

    const app = createApp()
    app.use('/api/webhooks/website', websiteWebhookHandler)
    app.use('/api/internal/webhook-deliveries/retry', webhookRetryHandler)
    appServer = createServer(toNodeListener(app))
    appUrl = await listen(appServer)

    receiver = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', async () => {
        received.push({ headers: req.headers, body })
        await beforeRespond.shift()?.()
        res.statusCode = receiverStatuses.shift() ?? 200
        res.end('{}')
      })
    })
    receiverUrl = await listen(receiver)
  })

  afterAll(async () => {
    await new Promise((r) => appServer.close(r))
    await new Promise((r) => receiver.close(r))
    await closeDb()
  })

  it('replays a website order by externalOrderId instead of creating a duplicate', async () => {
    const event = {
      eventId: 'order_cs_test_dedupe_1',
      type: 'order',
      externalOrderId: 'cs_test_dedupe_1',
      customer: { name: 'Order Dedupe Buyer', email: 'order.dedupe@example.com' },
      lines: [{ description: 'Walnut cutting board', quantity: 1, unitPriceCents: 8500 }]
    }

    const first = await postWebsiteEvent(event)
    const second = await postWebsiteEvent(event)

    expect(first.status).toBe(200)
    expect(first.replayed).toBeNull()
    expect(second.status).toBe(200)
    expect(second.replayed).toBe('true')
    expect(second.json.data).toEqual(first.json.data)
    expect(first.json.data.orderNumber).toMatch(/^ORD-/)

    const listed = await listOrders(ownerCtx, { externalOrderId: 'cs_test_dedupe_1', limit: 10, offset: 0 })
    expect(listed.total).toBe(1)
    expect(listed.items[0].id).toBe(first.json.data.orderId)
    expect(listed.items[0].externalOrderId).toBe('cs_test_dedupe_1')

    const other = await listOrders(ownerCtx, { externalOrderId: 'cs_test_missing', limit: 10, offset: 0 })
    expect(other.total).toBe(0)
  })

  it('rejects a second website order with the same externalOrderId at the database level', async () => {
    const customer = await createCustomer(ownerCtx, { name: 'Index Backstop Buyer' })
    const input = {
      customerId: customer.id,
      channel: 'website' as const,
      externalOrderId: 'cs_test_unique_index',
      lines: [{ description: 'Maple tray', quantity: 1, unitPriceCents: 4200 }]
    }
    await createOrder(ownerCtx, input)

    const err = await createOrder(ownerCtx, input).catch((e) => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('CONFLICT')

    // Other channels may still reuse external IDs (e.g. POS imports)
    await createOrder(ownerCtx, { ...input, channel: 'pos' })
  })

  it('matches lead customers by exact email only and flags existing customers as waiting on owner', async () => {
    const existing = await createCustomer(ownerCtx, { name: 'Pat Rivers', email: 'pat@example.com' })
    const decoy = await createCustomer(ownerCtx, { name: 'Pat Riverside', email: 'spat@example.com' })
    expect(existing.waitingOnOwner).toBe(false)

    const lead = await postWebsiteEvent({
      eventId: 'lead_existing_1',
      type: 'lead',
      customer: { name: 'Pat R.', email: 'PAT@Example.com', utmSource: 'instagram' },
      message: 'Looking for a live-edge bench'
    })
    expect(lead.status).toBe(200)
    expect(lead.json.data.customerId).toBe(existing.id)
    expect((await getCustomerById(ownerCtx, existing.id)).waitingOnOwner).toBe(true)
    expect((await getCustomerById(ownerCtx, decoy.id)).waitingOnOwner).toBe(false)

    // A unique partial match on another customer's email must not attach to that customer
    const fresh = await postWebsiteEvent({
      eventId: 'lead_new_1',
      type: 'lead',
      customer: { name: 'Pat Riverside', email: 'spat@example.co' },
      message: 'Quote for shelves'
    })
    expect(fresh.status).toBe(200)
    expect([existing.id, decoy.id]).not.toContain(fresh.json.data.customerId)
    const created = await getCustomerById(ownerCtx, fresh.json.data.customerId)
    expect(created.email).toBe('spat@example.co')
    expect(created.waitingOnOwner).toBe(true)
    expect((await getCustomerById(ownerCtx, decoy.id)).waitingOnOwner).toBe(false)
  })

  it('replays a lead by eventId without logging a second interaction', async () => {
    const event = {
      eventId: 'lead_replay_1',
      type: 'lead',
      customer: { name: 'Replay Lead', email: 'replay.lead@example.com' },
      message: 'Custom sign'
    }
    const first = await postWebsiteEvent(event)
    const second = await postWebsiteEvent(event)

    expect(second.status).toBe(200)
    expect(second.replayed).toBe('true')
    expect(second.json.data).toEqual(first.json.data)

    const db = await getDb()
    const rows = await db
      .select()
      .from(schema.interactions)
      .where(and(eq(schema.interactions.tenantId, seed.tenantId), eq(schema.interactions.externalRef, 'lead_replay_1')))
    expect(rows).toHaveLength(1)
    expect(rows[0].channel).toBe('form')
    expect(rows[0].containsExternalInput).toBe(true)
  })

  it('rejects signed website events while the integration is disabled', async () => {
    const db = await getDb()
    const websiteConfig = and(
      eq(schema.integrationConfigs.tenantId, seed.tenantId),
      eq(schema.integrationConfigs.provider, 'website')
    )
    await db.update(schema.integrationConfigs).set({ isEnabled: false }).where(websiteConfig)
    try {
      const res = await postWebsiteEvent({
        eventId: 'lead_disabled_1',
        type: 'lead',
        customer: { name: 'Disabled Lead', email: 'disabled.lead@example.com' },
        message: 'Should be rejected'
      })
      expect(res.status).toBe(401)
    } finally {
      await db.update(schema.integrationConfigs).set({ isEnabled: true }).where(websiteConfig)
    }
  })

  it('retries failed outbound deliveries with a fresh signature until delivered or exhausted', async () => {
    const endpoint = await createWebhookEndpoint(ownerCtx, {
      url: `${receiverUrl}/api/webhooks/backoffice`,
      events: ['quote.accepted']
    })

    receiverStatuses.push(503)
    const db = await getDb()
    const readDelivery = async (id: string) =>
      (await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, id)))[0]
    const inFlight: Array<typeof schema.webhookDeliveries.$inferSelect> = []
    const captureInFlight = async () => {
      const [row] = await db
        .select()
        .from(schema.webhookDeliveries)
        .where(eq(schema.webhookDeliveries.endpointId, endpoint.id))
        .orderBy(desc(schema.webhookDeliveries.createdAt))
        .limit(1)
      inFlight.push(row)
    }

    // Attempts are counted before the request is sent, so a run killed mid-request still backs off
    beforeRespond.push(captureInFlight)
    const [initial] = await emitWebhookEvent(seed.tenantId, 'quote.accepted', { quoteId: 'q-retry-1' })
    expect(initial.status).toBe('failed')
    expect(inFlight[0]).toMatchObject({ id: initial.deliveryId, attempts: 1, status: 'pending' })
    expect(inFlight[0].nextRetryAt!.getTime()).toBeGreaterThan(Date.now())

    const failed = await readDelivery(initial.deliveryId)
    expect(failed.attempts).toBe(1)
    expect(failed.lastStatusCode).toBe(503)
    expect(failed.nextRetryAt!.getTime()).toBeGreaterThan(Date.now())

    // Not due yet
    expect((await retryDueWebhookDeliveries()).attempted).toBe(0)

    const later = new Date(Date.now() + 2 * 60_000)
    beforeRespond.push(captureInFlight)
    const summary = await retryDueWebhookDeliveries({ now: later })
    expect(summary).toMatchObject({ attempted: 1, delivered: 1, failed: 0 })
    expect(inFlight[1]).toMatchObject({ id: initial.deliveryId, attempts: 2, status: 'failed' })
    expect(inFlight[1].nextRetryAt!.getTime()).toBeGreaterThan(later.getTime())

    const delivered = await readDelivery(initial.deliveryId)
    expect(delivered.status).toBe('delivered')
    expect(delivered.attempts).toBe(2)
    expect(delivered.nextRetryAt).toBeNull()

    const retried = received[received.length - 1]
    const sig = String(retried.headers['x-backoffice-signature'])
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(sig)!
    expect(createHmac('sha256', endpoint.secret).update(`${t}.${retried.body}`).digest('hex')).toBe(v1)
    expect(Math.abs(Number(t) - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(5)
    expect(JSON.parse(retried.body)).toMatchObject({
      event: 'quote.accepted',
      timestamp: (failed.payload as any).timestamp,
      data: { quoteId: 'q-retry-1' }
    })

    // Delivered rows are never resent
    expect((await retryDueWebhookDeliveries({ now: new Date(Date.now() + 86_400_000) })).attempted).toBe(0)

    // The final failed attempt stops the schedule
    receiverStatuses.push(500, 500)
    const [doomed] = await emitWebhookEvent(seed.tenantId, 'quote.accepted', { quoteId: 'q-retry-2' })
    await db
      .update(schema.webhookDeliveries)
      .set({ attempts: MAX_WEBHOOK_DELIVERY_ATTEMPTS - 1 })
      .where(eq(schema.webhookDeliveries.id, doomed.deliveryId))
    const final = await retryDueWebhookDeliveries({ now: new Date(Date.now() + 86_400_000) })
    expect(final).toMatchObject({ attempted: 1, failed: 1, exhausted: 1 })
    const dead = await readDelivery(doomed.deliveryId)
    expect(dead.status).toBe('failed')
    expect(dead.attempts).toBe(MAX_WEBHOOK_DELIVERY_ATTEMPTS)
    expect(dead.nextRetryAt).toBeNull()
    expect((await retryDueWebhookDeliveries({ now: new Date(Date.now() + 7 * 86_400_000) })).attempted).toBe(0)
  })

  it('only lets the scheduled function trigger the retry route', async () => {
    const call = (authorization?: string) =>
      fetch(`${appUrl}/api/internal/webhook-deliveries/retry`, {
        method: 'POST',
        headers: authorization ? { Authorization: authorization } : {}
      })

    expect((await call()).status).toBe(401)
    expect((await call('Bearer not-the-token')).status).toBe(401)

    const token = createHmac('sha256', process.env.JWT_SECRET!).update('webhook-retry-cron').digest('hex')
    const ok = await call(`Bearer ${token}`)
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as any).data).toMatchObject({ attempted: 0 })
  })
})
