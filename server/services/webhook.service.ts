import { and, asc, desc, eq, isNull, lt, lte, or } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { generateOpaqueToken, signHmacSha256, verifyHmacSha256 } from '../utils/crypto'
import { Errors } from '../utils/errors'
import { logger } from '../utils/logger'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'

export type OutboundWebhookEventType =
  | 'order.created'
  | 'order.status_changed'
  | 'quote.accepted'
  | 'invoice.paid'

export async function listWebhookEndpoints(ctx: ActorContext) {
  const db = await getDb()
  const rows = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.tenantId, ctx.tenantId), isNull(schema.webhookEndpoints.deletedAt)))
    .orderBy(desc(schema.webhookEndpoints.createdAt))
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    events: r.events,
    isActive: r.isActive,
    secretPreview: `${r.secret.slice(0, 10)}...`,
    createdAt: r.createdAt
  }))
}

export async function createWebhookEndpoint(
  ctx: ActorContext,
  input: { url: string; events: OutboundWebhookEventType[]; secret?: string }
) {
  const db = await getDb()
  const secret = input.secret || generateOpaqueToken('whsec', 24)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.webhookEndpoints)
      .values({
        tenantId: ctx.tenantId,
        url: input.url,
        secret,
        events: input.events,
        isActive: true
      })
      .returning()

    await recordAudit(tx, ctx, {
      action: 'webhook_endpoint.created',
      entityType: 'webhook_endpoint',
      entityId: row.id,
      afterState: { id: row.id, url: row.url, events: row.events }
    })

    return {
      id: row.id,
      url: row.url,
      events: row.events,
      isActive: row.isActive,
      secret,
      createdAt: row.createdAt
    }
  })
}

export async function deleteWebhookEndpoint(ctx: ActorContext, id: string) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.webhookEndpoints)
      .where(
        and(
          eq(schema.webhookEndpoints.id, id),
          eq(schema.webhookEndpoints.tenantId, ctx.tenantId),
          isNull(schema.webhookEndpoints.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('Webhook endpoint', id)

    await tx
      .update(schema.webhookEndpoints)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(schema.webhookEndpoints.id, id))

    await recordAudit(tx, ctx, {
      action: 'webhook_endpoint.deleted',
      entityType: 'webhook_endpoint',
      entityId: id
    })
    return { deleted: true }
  })
}

export async function listWebhookDeliveries(ctx: ActorContext, limit = 50) {
  const db = await getDb()
  return db
    .select()
    .from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.tenantId, ctx.tenantId))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(limit)
}

type WebhookEndpointRow = typeof schema.webhookEndpoints.$inferSelect
type WebhookDeliveryRow = typeof schema.webhookDeliveries.$inferSelect

export const MAX_WEBHOOK_DELIVERY_ATTEMPTS = 8
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000, 43_200_000]
const STALE_PENDING_MS = 120_000
const INLINE_DELIVERY_TIMEOUT_MS = 3_000
const RETRY_DELIVERY_TIMEOUT_MS = 5_000
// Keeps a retry run inside Netlify's ~10s synchronous function limit, including a cold start.
const RETRY_RUN_BUDGET_MS = 7_000
const MIN_RETRY_ATTEMPT_WINDOW_MS = 2_000

/** Next retry time after `attempts` started attempts, or null once the cap is reached. */
function nextRetryAfter(attempts: number): Date | null {
  if (attempts >= MAX_WEBHOOK_DELIVERY_ATTEMPTS) return null
  return new Date(Date.now() + RETRY_BACKOFF_MS[Math.min(Math.max(attempts, 1), RETRY_BACKOFF_MS.length) - 1])
}

// In test environments without external network targets, keep deliveries recorded cleanly
function skipsNetworkInTests(url: string): boolean {
  return process.env.VITEST === 'true' && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')
}

/**
 * Sends one delivery attempt that has already been counted in `delivery.attempts`, so an attempt
 * cut off by a function timeout still advances the backoff and the attempt cap. Each attempt is
 * signed with a fresh timestamp so receivers that reject old signatures accept retries; the body
 * keeps the original event timestamp.
 */
async function attemptWebhookDelivery(
  delivery: WebhookDeliveryRow,
  endpoint: WebhookEndpointRow,
  timeoutMs: number
) {
  const db = await getDb()
  const body = JSON.stringify(delivery.payload)
  const signedAt = Math.floor(Date.now() / 1000)
  const signature = `t=${signedAt},v1=${signHmacSha256(endpoint.secret, `${signedAt}.${body}`)}`
  const attempts = delivery.attempts

  let statusCode: number | null = null
  let error: string | null = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BackOffice-Event': delivery.eventType,
        'X-BackOffice-Delivery': delivery.id,
        'X-BackOffice-Signature': signature
      },
      body,
      signal: controller.signal
    })
    statusCode = res.status
    if (!res.ok) error = `HTTP ${res.status}`
    await res.body?.cancel().catch(() => {})
  } catch (err) {
    error = (err instanceof Error ? err.message : String(err)).slice(0, 500)
  } finally {
    clearTimeout(timer)
  }

  const ok = error === null
  const exhausted = !ok && attempts >= MAX_WEBHOOK_DELIVERY_ATTEMPTS
  await db
    .update(schema.webhookDeliveries)
    .set({
      lastStatusCode: statusCode,
      status: ok ? 'delivered' : 'failed',
      deliveredAt: ok ? new Date() : null,
      nextRetryAt: ok ? null : nextRetryAfter(attempts),
      lastError: error
    })
    .where(eq(schema.webhookDeliveries.id, delivery.id))

  if (!ok) {
    logger.warn('Outbound webhook delivery failed', {
      deliveryId: delivery.id,
      eventType: delivery.eventType,
      attempts,
      statusCode,
      exhausted
    })
  }

  return {
    deliveryId: delivery.id,
    status: ok ? ('delivered' as const) : ('failed' as const),
    statusCode,
    attempts,
    exhausted
  }
}

/**
 * Enqueues and attempts immediate signed delivery for all matching active webhook endpoints.
 * Failed deliveries get an exponential backoff `nextRetryAt` and are resent by
 * `retryDueWebhookDeliveries` until they succeed or reach MAX_WEBHOOK_DELIVERY_ATTEMPTS.
 */
export async function emitWebhookEvent(
  tenantId: string,
  eventType: OutboundWebhookEventType,
  data: Record<string, unknown>
) {
  const db = await getDb()
  const endpoints = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(
      and(
        eq(schema.webhookEndpoints.tenantId, tenantId),
        eq(schema.webhookEndpoints.isActive, true),
        isNull(schema.webhookEndpoints.deletedAt)
      )
    )

  const matching = endpoints.filter((ep) => ep.events.includes(eventType))
  if (matching.length === 0) return []

  const payload = {
    event: eventType,
    tenantId,
    timestamp: Math.floor(Date.now() / 1000),
    data
  }

  const results = []
  for (const ep of matching) {
    const skipNetwork = skipsNetworkInTests(ep.url)
    const [delivery] = await db
      .insert(schema.webhookDeliveries)
      .values({
        tenantId,
        endpointId: ep.id,
        eventType,
        payload,
        status: 'pending',
        attempts: skipNetwork ? 0 : 1,
        nextRetryAt: skipNetwork ? null : nextRetryAfter(1)
      })
      .returning()

    if (skipNetwork) {
      results.push({ deliveryId: delivery.id, status: 'pending' as const })
      continue
    }

    results.push(await attemptWebhookDelivery(delivery, ep, INLINE_DELIVERY_TIMEOUT_MS))
  }

  return results
}

/**
 * Resends failed deliveries whose backoff has elapsed, plus deliveries left pending by an
 * interrupted inline attempt. Runs across all tenants. Each row is claimed with a conditional
 * update that also counts the attempt, so overlapping workers never send the same attempt twice
 * and a run killed mid-request cannot bypass the backoff or the attempt cap.
 */
export async function retryDueWebhookDeliveries(options: { limit?: number; now?: Date } = {}) {
  const deadline = Date.now() + RETRY_RUN_BUDGET_MS
  const db = await getDb()
  const now = options.now ?? new Date()
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const dueCondition = or(
    and(eq(schema.webhookDeliveries.status, 'failed'), lte(schema.webhookDeliveries.nextRetryAt, now)),
    and(
      eq(schema.webhookDeliveries.status, 'pending'),
      lte(schema.webhookDeliveries.createdAt, new Date(now.getTime() - STALE_PENDING_MS)),
      or(isNull(schema.webhookDeliveries.nextRetryAt), lte(schema.webhookDeliveries.nextRetryAt, now))
    )
  )

  const candidates = await db
    .select({ delivery: schema.webhookDeliveries, endpoint: schema.webhookEndpoints })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId))
    .where(
      and(
        dueCondition,
        lt(schema.webhookDeliveries.attempts, MAX_WEBHOOK_DELIVERY_ATTEMPTS),
        eq(schema.webhookEndpoints.isActive, true),
        isNull(schema.webhookEndpoints.deletedAt)
      )
    )
    .orderBy(asc(schema.webhookDeliveries.createdAt))
    .limit(limit)

  const claimed: Array<{ delivery: WebhookDeliveryRow; endpoint: WebhookEndpointRow }> = []
  for (const { delivery, endpoint } of candidates) {
    if (deadline - Date.now() < MIN_RETRY_ATTEMPT_WINDOW_MS) break
    if (skipsNetworkInTests(endpoint.url)) continue
    const attempts = delivery.attempts + 1
    const [row] = await db
      .update(schema.webhookDeliveries)
      .set({
        attempts,
        status: 'failed',
        lastError: 'Delivery attempt started but did not complete',
        nextRetryAt: nextRetryAfter(attempts)
      })
      .where(
        and(
          eq(schema.webhookDeliveries.id, delivery.id),
          eq(schema.webhookDeliveries.attempts, delivery.attempts),
          dueCondition
        )
      )
      .returning()
    if (row) claimed.push({ delivery: row, endpoint })
  }

  const timeoutMs = Math.max(1_000, Math.min(RETRY_DELIVERY_TIMEOUT_MS, deadline - Date.now() - 500))
  const results = await Promise.all(
    claimed.map(({ delivery, endpoint }) => attemptWebhookDelivery(delivery, endpoint, timeoutMs))
  )

  return {
    due: candidates.length,
    attempted: results.length,
    delivered: results.filter((r) => r.status === 'delivered').length,
    failed: results.filter((r) => r.status === 'failed').length,
    exhausted: results.filter((r) => r.exhausted).length
  }
}

export async function verifyInboundWebhookSignature(
  tenantSlugOrId: string,
  provider: 'website' | 'chatwoot' | 'stripe_connect',
  rawBody: string,
  providedSignature: string | undefined
): Promise<{ tenantId: string; config: typeof schema.integrationConfigs.$inferSelect }> {
  const db = await getDb()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantSlugOrId)
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(
      and(
        isUuid ? eq(schema.tenants.id, tenantSlugOrId) : eq(schema.tenants.slug, tenantSlugOrId),
        isNull(schema.tenants.deletedAt)
      )
    )
  if (!tenant) throw Errors.notFound('Tenant', tenantSlugOrId)

  const [cfg] = await db
    .select()
    .from(schema.integrationConfigs)
    .where(
      and(
        eq(schema.integrationConfigs.tenantId, tenant.id),
        eq(schema.integrationConfigs.provider, provider)
      )
    )

  if (!cfg || !cfg.isEnabled || !cfg.webhookSecret) {
    throw Errors.unauthorized(`Inbound ${provider} webhook is not configured for this tenant`)
  }
  if (!providedSignature) {
    throw Errors.unauthorized('Missing webhook signature header')
  }

  // Support both raw hex HMAC and "v1=<hex>" format
  const sigHex = providedSignature.includes('v1=')
    ? providedSignature.split('v1=')[1].split(',')[0].trim()
    : providedSignature.trim()

  if (!verifyHmacSha256(cfg.webhookSecret, rawBody, sigHex)) {
    throw Errors.unauthorized('Invalid webhook signature')
  }

  return { tenantId: tenant.id, config: cfg }
}
