import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { listApiKeys } from '../../../../services/auth.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const keys = await listApiKeys(ctx)
    return { data: keys }
  })
)
