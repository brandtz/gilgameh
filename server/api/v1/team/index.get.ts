import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { listTenantMembers } from '../../../services/user.service'
import { ALL_SCOPES } from '../../../utils/scopes'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const members = await listTenantMembers(ctx)
    return { data: { members, availableScopes: ALL_SCOPES } }
  })
)
