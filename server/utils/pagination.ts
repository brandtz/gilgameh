import type { H3Event } from 'h3'
import { getQuery } from 'h3'

export interface PaginationParams {
  page: number
  limit: number
  offset: number
}

export function parsePagination(event: H3Event, defaultLimit = 25, maxLimit = 100): PaginationParams {
  const query = getQuery(event)
  const rawPage = Number(query.page ?? 1)
  const rawLimit = Number(query.limit ?? defaultLimit)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.floor(rawLimit), maxLimit) : defaultLimit
  return {
    page,
    limit,
    offset: (page - 1) * limit
  }
}

export function paginatedResponse<T>(items: T[], total: number, params: PaginationParams) {
  return {
    data: items,
    meta: {
      page: params.page,
      limit: params.limit,
      total,
      hasMore: params.offset + items.length < total
    }
  }
}
