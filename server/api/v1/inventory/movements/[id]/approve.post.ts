import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../../../utils/errors'
import { requireAuth } from '../../../../../utils/auth-context'
import { approveVersionSchema } from '../../../../../schemas'
import { approveStockMovement } from '../../../../../services/inventory.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['inventory:adjust'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing stock movement ID')
    const body = approveVersionSchema.parse(await readBody(event))
    const result = await approveStockMovement(ctx, id, body.version)
    return { data: result }
  })
)
