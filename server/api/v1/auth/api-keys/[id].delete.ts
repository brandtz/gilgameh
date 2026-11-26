import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { revokeApiKey } from '../../../../services/auth.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing API key ID')
    const res = await revokeApiKey(ctx, id)
    return { data: res }
  })
)
