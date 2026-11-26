import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { approveVersionSchema } from '../../../../schemas'
import { approveAndSendQuote } from '../../../../services/quote.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:approve'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing quote ID')
    const body = approveVersionSchema.parse(await readBody(event))
    const approved = await approveAndSendQuote(ctx, id, body.version)
    return { data: approved }
  })
)
