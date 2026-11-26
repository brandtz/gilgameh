import { defineEventHandler, getHeader, readRawBody } from 'h3'
import { z } from 'zod'
import { defineApiHandler, Errors } from '../../utils/errors'
import { verifyInboundWebhookSignature } from '../../services/webhook.service'
import { recordPayment } from '../../services/payment.service'
import type { ActorContext } from '../../utils/auth-context'
import { ALL_SCOPES } from '../../utils/scopes'

const stripeEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({
    object: z.object({
      id: z.string(),
      amount_received: z.number().int().positive().optional(),
      amount: z.number().int().positive().optional(),
      metadata: z.object({
        invoiceId: z.string().uuid()
      })
    })
  })
})

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const tenantRef = getHeader(event, 'x-tenant-slug') || getHeader(event, 'x-tenant-id')
    if (!tenantRef) throw Errors.badRequest('X-Tenant-Slug or X-Tenant-Id header required')

    const rawBody = (await readRawBody(event, 'utf8')) || ''
    const signature = getHeader(event, 'stripe-signature') || getHeader(event, 'x-webhook-signature')
    const { tenantId } = await verifyInboundWebhookSignature(tenantRef, 'stripe_connect', rawBody, signature)

    const payload = stripeEventSchema.parse(JSON.parse(rawBody))
    if (payload.type !== 'payment_intent.succeeded') {
      return { data: { ignored: true, type: payload.type } }
    }

    const ctx: ActorContext = {
      actorType: 'integration',
      actorId: 'stripe-webhook',
      actorLabel: 'Stripe Connect',
      tenantId,
      scopes: [...ALL_SCOPES]
    }

    const amountCents = payload.data.object.amount_received ?? payload.data.object.amount ?? 0
    const res = await recordPayment(ctx, {
      invoiceId: payload.data.object.metadata.invoiceId,
      method: 'stripe',
      amountCents,
      reference: payload.data.object.id,
      externalPaymentId: payload.data.object.id,
      notes: `Stripe event ${payload.id}`
    })

    return { data: res }
  })
)
