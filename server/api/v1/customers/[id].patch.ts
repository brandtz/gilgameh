import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { updateCustomerSchema } from '../../../schemas'
import { updateCustomer } from '../../../services/customer.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:write'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing customer ID')
    const body = updateCustomerSchema.parse(await readBody(event))
    const updated = await updateCustomer(ctx, id, body)
    return { data: updated }
  })
)
