import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { paginatedResponse, parsePagination } from '../../../utils/pagination'
import { listCatalogItems } from '../../../services/catalog.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['catalog:read'])
    const pagination = parsePagination(event)
    const query = getQuery(event)
    const verified =
      query.verified === 'true' ? true : query.verified === 'false' ? false : undefined
    const type =
      query.type === 'product' || query.type === 'service' ? query.type : undefined

    const { items, total } = await listCatalogItems(ctx, {
      q: typeof query.q === 'string' ? query.q : undefined,
      type,
      verified,
      limit: pagination.limit,
      offset: pagination.offset
    })
    return paginatedResponse(items, total, pagination)
  })
)
