import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../../../utils/errors'
import { requireAuth } from '../../../../../utils/auth-context'
import { linkChatwootContactToCustomer } from '../../../../../services/chatwoot.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:write'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing Chatwoot contact ID')
    const res = await linkChatwootContactToCustomer(ctx, id)
    return { data: res }
  })
)
