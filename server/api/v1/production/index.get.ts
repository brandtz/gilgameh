import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { paginatedResponse, parsePagination } from '../../../utils/pagination'
import { listProductionQueue } from '../../../services/production.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['production:read'])
    const pagination = parsePagination(event)
    const query = getQuery(event)
    const { items, total } = await listProductionQueue(ctx, {
      state: typeof query.state === 'string' ? query.state : undefined,
      activeOnly: query.activeOnly === 'true',
      orderId: typeof query.orderId === 'string' ? query.orderId : undefined,
      limit: pagination.limit,
      offset: pagination.offset
    })
    return paginatedResponse(items, total, pagination)
  })
)
