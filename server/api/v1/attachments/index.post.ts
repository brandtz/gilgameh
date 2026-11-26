import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { storeAttachment } from '../../../services/attachment.service'

const uploadSchema = z.object({
  entityType: z.enum(['quote', 'invoice', 'expense', 'customer', 'order', 'general']).default('general'),
  entityId: z.string().uuid().optional().nullable(),
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  contentBase64: z.string().min(1)
})

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event)
    const body = uploadSchema.parse(await readBody(event))
    const data = Buffer.from(body.contentBase64, 'base64')
    const saved = await storeAttachment(ctx, {
      entityType: body.entityType,
      entityId: body.entityId,
      filename: body.filename,
      mimeType: body.mimeType,
      data
    })
    return { data: saved }
  })
)
