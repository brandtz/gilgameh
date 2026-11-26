import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { paginatedResponse, parsePagination } from '../../../utils/pagination'
import { listExpenses } from '../../../services/expense.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['expenses:read'])
    const pagination = parsePagination(event)
    const query = getQuery(event)
    const { items, total } = await listExpenses(ctx, {
      status: typeof query.status === 'string' ? query.status : undefined,
      category: typeof query.category === 'string' ? query.category : undefined,
      limit: pagination.limit,
      offset: pagination.offset
    })
    return paginatedResponse(items, total, pagination)
  })
)
