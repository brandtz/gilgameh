import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { updateIntegrationConfigSchema } from '../../../schemas'
import { upsertIntegrationConfig } from '../../../services/integration.service'

const PROVIDERS = new Set(['website', 'stripe_connect', 'email', 'chatwoot', 'quickbooks'])

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['integrations:manage'])
    const provider = getRouterParam(event, 'provider')
    if (!provider || !PROVIDERS.has(provider)) {
      throw Errors.badRequest('Invalid integration provider')
    }
    const body = updateIntegrationConfigSchema.parse(await readBody(event))
    const saved = await upsertIntegrationConfig(
      ctx,
      provider as 'website' | 'stripe_connect' | 'email' | 'chatwoot' | 'quickbooks',
      body
    )
    return { data: saved }
  })
)
