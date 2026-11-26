import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { updateQuoteSchema } from '../../../../schemas'
import { updateDraftQuote } from '../../../../services/quote.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:draft'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing quote ID')
    const body = updateQuoteSchema.parse(await readBody(event))
    const updated = await updateDraftQuote(ctx, id, body)
    return { data: updated }
  })
)
