import { defineEventHandler } from 'h3'
import { defineApiHandler } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { syncFinalizedToAccounting } from '../../../../services/integration.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['integrations:manage'])
    const res = await syncFinalizedToAccounting(ctx)
    return { data: res }
  })
)
