import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { getOrderById } from '../../../services/order.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['orders:read'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing order ID')
    const order = await getOrderById(ctx, id)
    return { data: order }
  })
)
