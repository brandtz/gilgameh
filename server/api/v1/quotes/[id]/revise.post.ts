import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { createQuoteRevision } from '../../../../services/quote.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:draft'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing quote ID')
    const revised = await createQuoteRevision(ctx, id)
    return { data: revised }
  })
)
