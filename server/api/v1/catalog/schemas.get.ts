import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { listAttributeSchemas } from '../../../services/catalog.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['catalog:read'])
    const schemas = await listAttributeSchemas(ctx)
    return { data: schemas }
  })
)
