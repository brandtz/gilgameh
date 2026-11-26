import { defineEventHandler, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { getInvoiceById } from '../../../../services/invoice.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['invoices:read'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing invoice ID')
    const invoice = await getInvoiceById(ctx, id)
    return { data: invoice }
  })
)
