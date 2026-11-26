import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { listIntegrationConfigs } from '../../../services/integration.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['integrations:manage'])
    const configs = await listIntegrationConfigs(ctx)
    return { data: configs }
  })
)
