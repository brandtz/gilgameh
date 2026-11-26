import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { createTenantSchema } from '../../../schemas'
import { createTenant } from '../../../services/tenant.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const body = createTenantSchema.parse(await readBody(event))
    const created = await createTenant(ctx, body)
    return { data: created }
  })
)
