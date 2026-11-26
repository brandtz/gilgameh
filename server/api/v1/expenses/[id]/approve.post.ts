import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { approveVersionSchema } from '../../../../schemas'
import { approveExpense } from '../../../../services/expense.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['expenses:approve'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing expense ID')
    const body = approveVersionSchema.parse(await readBody(event))
    const approved = await approveExpense(ctx, id, body.version)
    return { data: approved }
  })
)
