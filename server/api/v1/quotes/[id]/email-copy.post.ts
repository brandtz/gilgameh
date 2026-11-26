import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { sendQuoteEmailCopy } from '../../../../services/document-email.service'

// Strict empty body schema: rejects any attempt to pass `to`, `cc`, `bcc`, or arbitrary recipients.
// NOTE: Any future send-to-customer capability requires a separate `quotes:send` scope and confirmation flow.
const emptyStrictBodySchema = z.object({}).strict().optional()

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:read'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing quote ID')
    const rawBody = await readBody(event).catch(() => undefined)
    if (rawBody !== undefined && rawBody !== null && rawBody !== '') {
      emptyStrictBodySchema.parse(rawBody)
    }
    const emailCopy = await sendQuoteEmailCopy(ctx, id, 'manual')
    return { data: emailCopy }
  })
)
