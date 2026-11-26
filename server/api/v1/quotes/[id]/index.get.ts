import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { getQuoteById } from '../../../../services/quote.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:read'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing quote ID')
    const quote = await getQuoteById(ctx, id)
    return { data: quote }
  })
)
