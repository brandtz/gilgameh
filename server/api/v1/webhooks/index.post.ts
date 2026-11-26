import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { createWebhookEndpointSchema } from '../../../schemas'
import { createWebhookEndpoint } from '../../../services/webhook.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['webhooks:manage'])
    const body = createWebhookEndpointSchema.parse(await readBody(event))
    const created = await createWebhookEndpoint(ctx, body)
    return { data: created }
  })
)
