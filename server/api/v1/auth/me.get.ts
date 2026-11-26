import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { getCurrentTenant, listAccessibleTenants } from '../../../services/tenant.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event)
    const [tenant, tenants] = await Promise.all([
      getCurrentTenant(ctx.tenantId),
      listAccessibleTenants(ctx)
    ])
    return {
      data: {
        actor: {
          actorType: ctx.actorType,
          actorId: ctx.actorId,
          actorLabel: ctx.actorLabel,
          role: ctx.role,
          tenantId: ctx.tenantId,
          scopes: ctx.scopes
        },
        tenant,
        tenants: tenants.map((t) => ({ id: t.id, slug: t.slug, name: t.name }))
      }
    }
  })
)
