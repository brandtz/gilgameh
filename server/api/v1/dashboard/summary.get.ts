import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { getBusinessSummary } from '../../../services/integration.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event)
    const summary = await getBusinessSummary(ctx)
    return { data: summary }
  })
)
