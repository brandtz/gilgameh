import { defineEventHandler, readBody } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { createAttributeSchemaSchema } from '../../../schemas'
import { createAttributeSchema } from '../../../services/catalog.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['catalog:write'])
    const body = createAttributeSchemaSchema.parse(await readBody(event))
    const created = await createAttributeSchema(ctx, body)
    return { data: created }
  })
)
