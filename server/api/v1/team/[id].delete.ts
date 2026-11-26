import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { removeTenantMember } from '../../../services/user.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing membership ID')
    const res = await removeTenantMember(ctx, id)
    return { data: res }
  })
)
