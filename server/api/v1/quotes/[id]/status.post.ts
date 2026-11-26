import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { transitionQuoteStatus } from '../../../../services/quote.service'

const statusSchema = z.object({
  version: z.number().int().min(1),
  status: z.enum(['accepted', 'declined', 'expired'])
})

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:approve'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing quote ID')
    const body = statusSchema.parse(await readBody(event))
    const updated = await transitionQuoteStatus(ctx, id, body.status, body.version)
    return { data: updated }
  })
)
