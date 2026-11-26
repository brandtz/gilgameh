import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { withIdempotency } from '../../../utils/idempotency'
import { createExpenseSchema } from '../../../schemas'
import { createDraftExpense } from '../../../services/expense.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['expenses:draft'])
    const body = createExpenseSchema.parse(await readBody(event))
    return withIdempotency(event, ctx, body, async () => {
      const created = await createDraftExpense(ctx, body)
      return { statusCode: 201, body: { data: created } }
    })
  })
)
