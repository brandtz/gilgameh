import { defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { getAttachmentWithBytes } from '../../../services/attachment.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event)
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing attachment ID')
    const { attachment, bytes } = await getAttachmentWithBytes(ctx.tenantId, id)
    setResponseHeader(event, 'Content-Type', attachment.mimeType)
    setResponseHeader(event, 'Content-Disposition', `inline; filename="${attachment.filename}"`)
    return bytes
  })
)
