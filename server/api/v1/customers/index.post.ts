import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { withIdempotency } from '../../../utils/idempotency'
import { createCustomerSchema } from '../../../schemas'
import { createCustomer } from '../../../services/customer.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:write'])
    const raw = await readBody(event)
    const body = createCustomerSchema.parse(raw)
    return withIdempotency(event, ctx, body, async () => {
      const created = await createCustomer(ctx, body)
      return { statusCode: 201, body: { data: created } }
    })
  })
)
