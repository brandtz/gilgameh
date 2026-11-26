import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { listInventory } from '../../../services/inventory.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['inventory:read'])
    const items = await listInventory(ctx)
    return { data: items }
  })
)
