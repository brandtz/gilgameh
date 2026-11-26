import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { withIdempotency } from '../../../utils/idempotency'
import { createPaymentSchema } from '../../../schemas'
import { recordPayment } from '../../../services/payment.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['invoices:draft'])
    const body = createPaymentSchema.parse(await readBody(event))
    return withIdempotency(event, ctx, body, async () => {
      const result = await recordPayment(ctx, body)
      return { statusCode: 201, body: { data: result } }
    })
  })
)
