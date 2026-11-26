import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { getCatalogItemById } from '../../../services/catalog.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['catalog:read'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing catalog item ID')
    const item = await getCatalogItemById(ctx, id)
    return { data: item }
  })
)
