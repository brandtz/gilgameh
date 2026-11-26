import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { listOAuthTokens } from '../../../../services/auth.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const tokens = await listOAuthTokens(ctx)
    return { data: tokens }
  })
)
