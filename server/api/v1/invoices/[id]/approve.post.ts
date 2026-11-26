import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { defineApiHandler, Errors } from '../../../../utils/errors'
import { requireAuth } from '../../../../utils/auth-context'
import { approveVersionSchema } from '../../../../schemas'
import { approveAndSendInvoice } from '../../../../services/invoice.service'
import { sendTransactionalEmail } from '../../../../services/integration.service'

export default defineEventHandler(
  defineApiHandler(async (event) => {
    const ctx = await requireAuth(event, ['invoices:approve'])
    const id = getRouterParam(event, 'id')
    if (!id) throw Errors.badRequest('Missing invoice ID')
    const body = approveVersionSchema.parse(await readBody(event))
    const approved = await approveAndSendInvoice(ctx, id, body.version)

    if (body.sendEmail && approved.customer?.email) {
      await sendTransactionalEmail({
        to: approved.customer.email,
        subject: `Invoice ${approved.invoiceNumber}`,
        text: `Invoice ${approved.invoiceNumber} is ready. Total due: $${(approved.balanceDueCents / 100).toFixed(2)}.`
      })
    }

    return { data: approved }
  })
)
