import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { getCurrentTenant } from '../../../services/tenant.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event)
    const tenant = await getCurrentTenant(ctx.tenantId)
    return { data: tenant }
  })
)
