import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { withIdempotency } from '../../../utils/idempotency'
import { createInteractionSchema } from '../../../schemas'
import { logInteraction } from '../../../services/customer.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:write'])
    const body = createInteractionSchema.parse(await readBody(event))
    return withIdempotency(event, ctx, body, async () => {
      const created = await logInteraction(ctx, body)
      return { statusCode: 201, body: { data: created } }
    })
  })
)
