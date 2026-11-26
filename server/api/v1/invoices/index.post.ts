import { defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { defineApiHandler } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { withIdempotency } from '../../../utils/idempotency'
import { createInvoiceSchema } from '../../../schemas'
import { createDraftInvoice, createInvoiceFromOrder } from '../../../services/invoice.service'

const fromOrderSchema = z.object({ fromOrderId: z.string().uuid() })

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['invoices:draft'])
    const raw = await readBody(event)

    if (raw && typeof raw === 'object' && 'fromOrderId' in raw) {
      const parsed = fromOrderSchema.parse(raw)
      return withIdempotency(event, ctx, parsed, async () => {
        const created = await createInvoiceFromOrder(ctx, parsed.fromOrderId)
        return { statusCode: 201, body: { data: created } }
      })
    }

    const body = createInvoiceSchema.parse(raw)
    return withIdempotency(event, ctx, body, async () => {
      const created = await createDraftInvoice(ctx, body)
      return { statusCode: 201, body: { data: created } }
    })
  })
)
