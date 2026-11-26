import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { paginatedResponse, parsePagination } from '../../../utils/pagination'
import { listInvoices } from '../../../services/invoice.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['invoices:read'])
    const pagination = parsePagination(event)
    const query = getQuery(event)
    const { items, total } = await listInvoices(ctx, {
      status: typeof query.status === 'string' ? query.status : undefined,
      unpaidOnly: query.unpaidOnly === 'true',
      customerId: typeof query.customerId === 'string' ? query.customerId : undefined,
      limit: pagination.limit,
      offset: pagination.offset
    })
    return paginatedResponse(items, total, pagination)
  })
)
