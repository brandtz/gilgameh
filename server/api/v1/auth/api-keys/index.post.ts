import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { createApiKeySchema } from '../../../../schemas'
import { createApiKey } from '../../../../services/auth.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['tenant:manage'])
    const body = createApiKeySchema.parse(await readBody(event))
    const created = await createApiKey(ctx, body)
    return { data: created }
  })
)
