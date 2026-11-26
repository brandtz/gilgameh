import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { revokeOAuthToken } from '../../../../services/auth.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing token ID')
    const res = await revokeOAuthToken(ctx, id)
    return { data: res }
  })
)
