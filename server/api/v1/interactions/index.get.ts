import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { paginatedResponse, parsePagination } from '../../../utils/pagination'
import { listInteractions } from '../../../services/customer.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:read'])
    const pagination = parsePagination(event)
    const query = getQuery(event)
    const { items, total } = await listInteractions(ctx, {
      customerId: typeof query.customerId === 'string' ? query.customerId : undefined,
      limit: pagination.limit,
      offset: pagination.offset
    })
    return paginatedResponse(items, total, pagination)
  })
)
