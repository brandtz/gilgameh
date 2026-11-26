import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { listPayments } from '../../../services/payment.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['invoices:read'])
    const query = getQuery(event)
    const items = await listPayments(
      ctx,
      typeof query.invoiceId === 'string' ? query.invoiceId : undefined
    )
    return { data: items }
  })
)
