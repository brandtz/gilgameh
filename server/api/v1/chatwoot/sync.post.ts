import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { syncTenantChatwoot } from '../../../services/chatwoot.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:write'])
    const res = await syncTenantChatwoot(ctx)
    return { data: res }
  })
)
