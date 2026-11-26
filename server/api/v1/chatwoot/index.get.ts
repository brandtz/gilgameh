import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { listTenantChatwootData } from '../../../services/chatwoot.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:read'])
    const data = await listTenantChatwootData(ctx)
    return { data }
  })
)
