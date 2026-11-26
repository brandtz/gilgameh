import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { deleteWebhookEndpoint } from '../../../services/webhook.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['webhooks:manage'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing webhook endpoint ID')
    const res = await deleteWebhookEndpoint(ctx, id)
    return { data: res }
  })
)
