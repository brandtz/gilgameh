import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { createTenantMemberSchema } from '../../../schemas'
import { addTenantMember } from '../../../services/user.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const body = createTenantMemberSchema.parse(await readBody(event))
    const created = await addTenantMember(ctx, body)
    return { data: created }
  })
)
