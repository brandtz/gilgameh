import { defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { verifyDocumentPdfToken } from '../../../utils/pdf-share-token'
import { renderQuotePdfBytes } from '../../../services/quote.service'
import { renderInvoicePdfBytes } from '../../../services/invoice.service'
import type { ActorContext } from '../../../utils/auth-context'

/**
 * Signed, read-only, time-limited PDF download route (GET /api/v1/public/pdf?token=...).
 * Allows owners to open, view, or share a Quote or Invoice PDF directly from Claude/ChatGPT
 * or their mobile email without logging into the Back Office app.
 */
export default defineEventHandler(
  defineApiHandler(async (event) => {
    const query = getQuery(event)
    const token = typeof query.token === 'string' ? query.token.trim() : ''
    if (!token) throw Errors.unauthorized('Missing PDF download token')

    const parsed = await verifyDocumentPdfToken(token)
    const readOnlyCtx: ActorContext = {
      actorType: 'system',
      actorId: 'pdf-share-link',
      actorLabel: 'Signed PDF Link',
      tenantId: parsed.tenantId,
      scopes: ['quotes:read', 'invoices:read', 'customers:read']
    }

    const { filename, bytes } =
      parsed.docType === 'quote'
        ? await renderQuotePdfBytes(readOnlyCtx, parsed.docId)
        : await renderInvoicePdfBytes(readOnlyCtx, parsed.docId)

    setResponseHeader(event, 'Content-Type', 'application/pdf')
    setResponseHeader(event, 'Content-Disposition', `inline; filename="${filename}"`)
    setResponseHeader(event, 'Cache-Control', 'private, max-age=60')
    return Buffer.from(bytes)
  })
)
