import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { updateTenantMemberSchema } from '../../../schemas'
import { updateTenantMember } from '../../../services/user.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing membership ID')
    const body = updateTenantMemberSchema.parse(await readBody(event))
    const updated = await updateTenantMember(ctx, id, body)
    return { data: updated }
  })
)
