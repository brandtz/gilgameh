import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { paginatedResponse, parsePagination } from '../../../utils/pagination'
import { listCustomers } from '../../../services/customer.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:read'])
    const pagination = parsePagination(event)
    const query = getQuery(event)
    const waitingRaw = query.waitingOnOwner
    const waitingOnOwner =
      waitingRaw === 'true' ? true : waitingRaw === 'false' ? false : undefined

    const { items, total } = await listCustomers(ctx, {
      q: typeof query.q === 'string' ? query.q : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
      waitingOnOwner,
      limit: pagination.limit,
      offset: pagination.offset
    })

    return paginatedResponse(items, total, pagination)
  })
)
