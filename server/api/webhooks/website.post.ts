import { defineEventHandler, getHeader, readRawBody, setHeader } from 'h3'
import { z } from 'zod'
import { AppError, defineApiHandler, Errors } from '../../utils/errors'
import { verifyInboundWebhookSignature } from '../../services/webhook.service'
import {
  createCustomer,
  findCustomerForInboundEvent,
  findInteractionByExternalRef,
  logInteraction,
  updateCustomer
} from '../../services/customer.service'
import { createOrder, findOrderByExternalId } from '../../services/order.service'
import type { ActorContext } from '../../utils/auth-context'
import { ALL_SCOPES } from '../../utils/scopes'

const websitePayloadSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(['lead', 'order']),
  customer: z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    utmSource: z.string().optional(),
    utmMedium: z.string().optional(),
    utmCampaign: z.string().optional()
  }),
  message: z.string().optional(),
  externalOrderId: z.string().optional(),
  lines: z
    .array(
      z.object({
        catalogItemId: z.string().uuid().optional(),
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitPriceCents: z.number().int().min(0)
      })
    )
    .optional()
})

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const tenantRef = getHeader(event, 'x-tenant-slug') || getHeader(event, 'x-tenant-id')
    if (!tenantRef) throw Errors.badRequest('X-Tenant-Slug or X-Tenant-Id header required')

    const rawBody = (await readRawBody(event, 'utf8')) || ''
    const signature = getHeader(event, 'x-webhook-signature') || getHeader(event, 'x-backoffice-signature')
    const { tenantId } = await verifyInboundWebhookSignature(tenantRef, 'website', rawBody, signature)

    const payload = websitePayloadSchema.parse(JSON.parse(rawBody))
    const ctx: ActorContext = {
      actorType: 'integration',
      actorId: 'website-webhook',
      actorLabel: 'Tenant Website Webhook',
      tenantId,
      scopes: [...ALL_SCOPES]
    }

    // Website events are retried by the storefront, so replays return the original records.
    if (payload.type === 'lead') {
      const existing = await findInteractionByExternalRef(ctx, payload.eventId)
      if (existing) {
        setHeader(event, 'X-Idempotent-Replayed', 'true')
        return { data: { customerId: existing.customerId, interactionId: existing.id } }
      }
    } else {
      if (!payload.lines || payload.lines.length === 0) {
        throw Errors.badRequest('Website order webhook requires lines')
      }
      const existing = await findOrderByExternalId(ctx, payload.externalOrderId || payload.eventId)
      if (existing) {
        setHeader(event, 'X-Idempotent-Replayed', 'true')
        return { data: { customerId: existing.customerId, orderId: existing.id, orderNumber: existing.orderNumber } }
      }
    }

    let customer = await findCustomerForInboundEvent(ctx, payload.customer)
    if (!customer) {
      customer = await createCustomer(ctx, {
        name: payload.customer.name,
        email: payload.customer.email,
        phone: payload.customer.phone,
        status: payload.type === 'order' ? 'active' : 'lead',
        leadSource: 'website',
        utmSource: payload.customer.utmSource,
        utmMedium: payload.customer.utmMedium,
        utmCampaign: payload.customer.utmCampaign,
        waitingOnOwner: payload.type === 'lead'
      })
    } else if (payload.type === 'lead' && !customer.waitingOnOwner) {
      customer = await updateCustomer(ctx, customer.id, { waitingOnOwner: true })
    }

    if (payload.type === 'lead') {
      const interaction = await logInteraction(ctx, {
        customerId: customer.id,
        channel: 'form',
        direction: 'inbound',
        summary: `Website inquiry from ${payload.customer.name}`,
        rawContent: payload.message || null,
        containsExternalInput: true,
        externalRef: payload.eventId
      })
      return { data: { customerId: customer.id, interactionId: interaction.id } }
    }

    const externalOrderId = payload.externalOrderId || payload.eventId
    try {
      const order = await createOrder(ctx, {
        customerId: customer.id,
        channel: 'website',
        externalOrderId,
        lines: payload.lines!
      })
      return { data: { customerId: customer.id, orderId: order.id, orderNumber: order.orderNumber } }
    } catch (err) {
      // A concurrent delivery of the same order won the unique index race.
      if (err instanceof AppError && err.code === 'CONFLICT') {
        const existing = await findOrderByExternalId(ctx, externalOrderId)
        if (existing) {
          setHeader(event, 'X-Idempotent-Replayed', 'true')
          return { data: { customerId: existing.customerId, orderId: existing.id, orderNumber: existing.orderNumber } }
        }
      }
      throw err
    }
  })
)
