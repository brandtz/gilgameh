import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { withIdempotency } from '../../../../utils/idempotency'
import { createStockAdjustmentSchema } from '../../../../schemas'
import { createDraftStockAdjustment } from '../../../../services/inventory.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['inventory:adjust'])
    const body = createStockAdjustmentSchema.parse(await readBody(event))
    return withIdempotency(event, ctx, body, async () => {
      const created = await createDraftStockAdjustment(ctx, body)
      return { statusCode: 201, body: { data: created } }
    })
  })
)
