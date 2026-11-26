import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { paginatedResponse, parsePagination } from '../../../utils/pagination'
import { listQuotes } from '../../../services/quote.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:read'])
    const pagination = parsePagination(event)
    const query = getQuery(event)
    const { items, total } = await listQuotes(ctx, {
      status: typeof query.status === 'string' ? query.status : undefined,
      openOnly: query.openOnly === 'true',
      customerId: typeof query.customerId === 'string' ? query.customerId : undefined,
      limit: pagination.limit,
      offset: pagination.offset
    })
    return paginatedResponse(items, total, pagination)
  })
)
