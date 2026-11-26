import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { updateWorkItemSchema } from '../../../schemas'
import { updateWorkItem } from '../../../services/production.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['production:write'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing work item ID')
    const body = updateWorkItemSchema.parse(await readBody(event))
    const updated = await updateWorkItem(ctx, id, body)
    return { data: updated }
  })
)
