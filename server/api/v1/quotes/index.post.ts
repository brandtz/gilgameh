import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { withIdempotency } from '../../../utils/idempotency'
import { createQuoteSchema } from '../../../schemas'
import { createDraftQuote } from '../../../services/quote.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:draft'])
    const body = createQuoteSchema.parse(await readBody(event))
    return withIdempotency(event, ctx, body, async () => {
      const created = await createDraftQuote(ctx, body)
      return { statusCode: 201, body: { data: created } }
    })
  })
)
