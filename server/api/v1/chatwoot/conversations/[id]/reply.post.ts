import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../../../utils/errors'
import { requireAuth } from '../../../../../utils/auth-context'
import { chatwootReplySchema } from '../../../../../schemas'
import { replyToChatwootConversation } from '../../../../../services/chatwoot.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:write'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing conversation ID')
    const body = chatwootReplySchema.parse(await readBody(event))
    const res = await replyToChatwootConversation(ctx, id, body.content)
    return { data: res }
  })
)
