import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { updateOrderStatusSchema } from '../../../schemas'
import { updateOrderStatus } from '../../../services/order.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['orders:write'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing order ID')
    const body = updateOrderStatusSchema.parse(await readBody(event))
    const updated = await updateOrderStatus(ctx, id, body)
    return { data: updated }
  })
)
