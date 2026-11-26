import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { paginatedResponse, parsePagination } from '../../../utils/pagination'
import { listAuditLogs } from '../../../services/audit.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['audit:read'])
    const pagination = parsePagination(event, 50)
    const query = getQuery(event)
    const { items, total } = await listAuditLogs(ctx, {
      entityType: typeof query.entityType === 'string' ? query.entityType : undefined,
      entityId: typeof query.entityId === 'string' ? query.entityId : undefined,
      actorType: typeof query.actorType === 'string' ? query.actorType : undefined,
      action: typeof query.action === 'string' ? query.action : undefined,
      limit: pagination.limit,
      offset: pagination.offset
    })
    return paginatedResponse(items, total, pagination)
  })
)
