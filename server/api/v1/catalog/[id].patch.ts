import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { updateCatalogItemSchema } from '../../../schemas'
import { updateCatalogItem } from '../../../services/catalog.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['catalog:write'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing catalog item ID')
    const body = updateCatalogItemSchema.parse(await readBody(event))
    const updated = await updateCatalogItem(ctx, id, body)
    return { data: updated }
  })
)
