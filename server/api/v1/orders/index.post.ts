import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { withIdempotency } from '../../../utils/idempotency'
import { createOrderSchema } from '../../../schemas'
import { createOrder, createOrderFromQuote } from '../../../services/order.service'

const fromQuoteSchema = z.object({
  fromQuoteId: z.string().uuid()
})

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['orders:write'])
    const raw = await readBody(event)

    if (raw && typeof raw === 'object' && 'fromQuoteId' in raw) {
      const parsed = fromQuoteSchema.parse(raw)
      return withIdempotency(event, ctx, parsed, async () => {
        const created = await createOrderFromQuote(ctx, parsed.fromQuoteId)
        return { statusCode: 201, body: { data: created } }
      })
    }

    const body = createOrderSchema.parse(raw)
    return withIdempotency(event, ctx, body, async () => {
      const created = await createOrder(ctx, body)
      return { statusCode: 201, body: { data: created } }
    })
  })
)
