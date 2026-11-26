import { defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { renderInvoicePdfBytes } from '../../../../services/invoice.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['invoices:read'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing invoice ID')
    const { filename, bytes } = await renderInvoicePdfBytes(ctx, id)
    setResponseHeader(event, 'Content-Type', 'application/pdf')
    setResponseHeader(event, 'Content-Disposition', `inline; filename="${filename}"`)
    return Buffer.from(bytes)
  })
)
