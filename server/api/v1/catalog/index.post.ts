import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { withIdempotency } from '../../../utils/idempotency'
import { createCatalogItemSchema } from '../../../schemas'
import { createCatalogItem } from '../../../services/catalog.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['catalog:write'])
    const body = createCatalogItemSchema.parse(await readBody(event))
    return withIdempotency(event, ctx, body, async () => {
      const created = await createCatalogItem(ctx, body)
      return { statusCode: 201, body: { data: created } }
    })
  })
)
