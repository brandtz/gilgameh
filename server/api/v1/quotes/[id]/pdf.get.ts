import { defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { renderQuotePdfBytes } from '../../../../services/quote.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:read'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing quote ID')
    const { filename, bytes } = await renderQuotePdfBytes(ctx, id)
    setResponseHeader(event, 'Content-Type', 'application/pdf')
    setResponseHeader(event, 'Content-Disposition', `inline; filename="${filename}"`)
    return Buffer.from(bytes)
  })
)
