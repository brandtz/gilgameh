import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { chatwootConfigSchema } from '../../../schemas'
import { saveTenantChatwootConfig } from '../../../services/chatwoot.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['integrations:manage'])
    const body = chatwootConfigSchema.parse(await readBody(event))
    const saved = await saveTenantChatwootConfig(ctx, body)
    return { data: saved }
  })
)
