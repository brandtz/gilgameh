import { defineEventHandler, getHeader, readRawBody } from 'h3'
import { z } from 'zod'
import { defineApiHandler, Errors } from '../../utils/errors'
import { verifyInboundWebhookSignature } from '../../services/webhook.service'
import { createCustomer, findCustomerCandidates, logInteraction, updateCustomer } from '../../services/customer.service'
import { recordChatwootWebhookMessage } from '../../services/chatwoot.service'
import type { ActorContext } from '../../utils/auth-context'
import { ALL_SCOPES } from '../../utils/scopes'

const chatwootSchema = z.object({
  event: z.string(),
  contact: z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string().min(1),
    email: z.string().email().optional().nullable(),
    phone_number: z.string().optional().nullable()
  }),
  conversation_id: z.union([z.string(), z.number()]).optional(),
  message_type: z.enum(['incoming', 'outgoing']).default('incoming'),
  content: z.string().optional()
})

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const tenantRef = getHeader(event, 'x-tenant-slug') || getHeader(event, 'x-tenant-id')
    if (!tenantRef) throw Errors.badRequest('X-Tenant-Slug or X-Tenant-Id header required')

    const rawBody = (await readRawBody(event, 'utf8')) || ''
    const signature = getHeader(event, 'x-chatwoot-signature') || getHeader(event, 'x-webhook-signature')
    const { tenantId } = await verifyInboundWebhookSignature(tenantRef, 'chatwoot', rawBody, signature)

    const payload = chatwootSchema.parse(JSON.parse(rawBody))
    const ctx: ActorContext = {
      actorType: 'integration',
      actorId: 'chatwoot-webhook',
      actorLabel: 'Chatwoot Cloud',
      tenantId,
      scopes: [...ALL_SCOPES]
    }

    const search = await findCustomerCandidates(ctx, payload.contact.email || payload.contact.name)
    let customer = search.exactMatch
    if (!customer) {
      customer = await createCustomer(ctx, {
        name: payload.contact.name,
        email: payload.contact.email ?? undefined,
        phone: payload.contact.phone_number ?? undefined,
        leadSource: 'chatwoot',
        waitingOnOwner: payload.message_type === 'incoming',
        externalIds: { chatwootContactId: String(payload.contact.id) }
      })
    } else {
      await updateCustomer(ctx, customer.id, {
        waitingOnOwner: payload.message_type === 'incoming',
        externalIds: {
          ...customer.externalIds,
          chatwootContactId: String(payload.contact.id)
        }
      })
    }

    const interaction = await logInteraction(ctx, {
      customerId: customer.id,
      channel: 'message',
      direction: payload.message_type === 'incoming' ? 'inbound' : 'outbound',
      summary: `Chatwoot ${payload.message_type} message (${payload.event})`,
      rawContent: payload.content ?? null,
      containsExternalInput: payload.message_type === 'incoming',
      externalRef: payload.conversation_id ? `chatwoot:${payload.conversation_id}` : undefined
    })

    await recordChatwootWebhookMessage(tenantId, {
      externalContactId: String(payload.contact.id),
      name: payload.contact.name,
      email: payload.contact.email ?? null,
      phone: payload.contact.phone_number ?? null,
      customerId: customer.id,
      externalConversationId: String(payload.conversation_id || `contact-${payload.contact.id}`),
      direction: payload.message_type,
      content: payload.content || `(Event: ${payload.event})`
    })

    return { data: { customerId: customer.id, interactionId: interaction.id, waitingOnOwner: payload.message_type === 'incoming' } }
  })
)
