import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { listWebhookDeliveries, listWebhookEndpoints } from '../../../services/webhook.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['webhooks:manage'])
    const [endpoints, deliveries] = await Promise.all([
      listWebhookEndpoints(ctx),
      listWebhookDeliveries(ctx)
    ])
    return { data: { endpoints, deliveries } }
  })
)
