import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { listStockMovements } from '../../../../services/inventory.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['inventory:read'])
    const query = getQuery(event)
    const items = await listStockMovements(
      ctx,
      typeof query.catalogItemId === 'string' ? query.catalogItemId : undefined
    )
    return { data: items }
  })
)
