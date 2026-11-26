import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { defineApiHandler, Errors } from '../../../utils/errors'
import { requireAuth } from '../../../utils/auth-context'
import { getCustomerById, getCustomerFullDetails } from '../../../services/customer.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['customers:read'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing customer ID')
    const query = getQuery(event)
    if (query.include === 'details') {
      const details = await getCustomerFullDetails(ctx, id)
      return { data: details }
    }
    const customer = await getCustomerById(ctx, id)
    return { data: customer }
  })
)
