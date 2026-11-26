import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { updateTenantSchema } from '../../../schemas'
import { updateTenant } from '../../../services/tenant.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const body = updateTenantSchema.parse(await readBody(event))
    const updated = await updateTenant(ctx, body)
    return { data: updated }
  })
)
