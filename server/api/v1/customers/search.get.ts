import { defineEventHandler, getQuery } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { findCustomerCandidates } from '../../../services/customer.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:read'])
    const query = getQuery(event)
    const q = typeof query.q === 'string' ? query.q.trim() : ''
    if (!q) throw Errors.badRequest('Query parameter "q" is required')
    const result = await findCustomerCandidates(ctx, q)
    return { data: result }
  })
)
