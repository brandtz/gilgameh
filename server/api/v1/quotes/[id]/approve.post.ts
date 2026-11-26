import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { approveVersionSchema } from '../../../../schemas'
import { approveAndSendQuote } from '../../../../services/quote.service'
import { sendTransactionalEmail } from '../../../../services/integration.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['quotes:approve'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing quote ID')
    const body = approveVersionSchema.parse(await readBody(event))
    const approved = await approveAndSendQuote(ctx, id, body.version)

    if (body.sendEmail && approved.customer?.email) {
      await sendTransactionalEmail({
        to: approved.customer.email,
        subject: `Quote ${approved.quoteNumber} from Back Office`,
        text: `Your quote ${approved.quoteNumber} is ready. Total: $${(approved.totalCents / 100).toFixed(2)}.`
      })
    }

    return { data: approved }
  })
)
