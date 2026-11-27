import { timingSafeEqual } from 'node:crypto'
import { defineEventHandler, getHeader } from 'h3'
import { signHmacSha256 } from '../../../utils/crypto'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { retryDueWebhookDeliveries } from '../../../services/webhook.service'

// Must match the token derived by netlify/functions/webhook-retry.mts.
const WEBHOOK_RETRY_TOKEN_PURPOSE = 'webhook-retry-cron'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const secret = process.env.JWT_SECRET?.trim()
    if (!secret) throw Errors.unauthorized('Webhook retry is not configured')

    const provided = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
    const expected = Buffer.from(signHmacSha256(secret, WEBHOOK_RETRY_TOKEN_PURPOSE), 'utf8')
    const actual = Buffer.from(provided, 'utf8')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw Errors.unauthorized('Invalid webhook retry token')
    }

    return { data: await retryDueWebhookDeliveries() }
  })
)
