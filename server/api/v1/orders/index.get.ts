import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { paginatedResponse, parsePagination } from '../../../utils/pagination'
import { listOrders } from '../../../services/order.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['orders:read'])
    const pagination = parsePagination(event)
    const query = getQuery(event)
    const { items, total } = await listOrders(ctx, {
      status: typeof query.status === 'string' ? query.status : undefined,
      customerId: typeof query.customerId === 'string' ? query.customerId : undefined,
      channel: typeof query.channel === 'string' ? query.channel : undefined,
      externalOrderId: typeof query.externalOrderId === 'string' ? query.externalOrderId : undefined,
      limit: pagination.limit,
      offset: pagination.offset
    })
    return paginatedResponse(items, total, pagination)
  })
)
