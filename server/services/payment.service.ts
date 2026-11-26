import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'
import { emitWebhookEvent } from './webhook.service'

export async function listPayments(ctx: ActorContext, invoiceId?: string) {
  const db = await getDb()
  const conditions = [
    eq(schema.payments.tenantId, ctx.tenantId),
    isNull(schema.payments.deletedAt)
  ]
  if (invoiceId) conditions.push(eq(schema.payments.invoiceId, invoiceId))

  return db
    .select()
    .from(schema.payments)
    .where(and(...conditions))
    .orderBy(desc(schema.payments.paidAt))
}

export async function recordPayment(
  ctx: ActorContext,
  input: {
    invoiceId: string
    method: 'check' | 'cash' | 'card' | 'stripe' | 'ach' | 'other'
    amountCents: number
    reference?: string | null
    paidAt?: string
    notes?: string | null
    externalPaymentId?: string | null
  }
) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw Errors.unprocessable('Payment amount must be a positive integer in cents')
  }

  const db = await getDb()
  const result = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.id, input.invoiceId),
          eq(schema.invoices.tenantId, ctx.tenantId),
          isNull(schema.invoices.deletedAt)
        )
      )
    if (!invoice) throw Errors.notFound('Invoice', input.invoiceId)
    if (invoice.status === 'void' || invoice.status === 'draft') {
      throw Errors.conflict(`Cannot record payment against invoice in status "${invoice.status}"`)
    }
    if (input.amountCents > invoice.balanceDueCents) {
      throw Errors.unprocessable(
        `Payment (${input.amountCents} cents) exceeds remaining balance due (${invoice.balanceDueCents} cents)`
      )
    }

    const [payment] = await tx
      .insert(schema.payments)
      .values({
        tenantId: ctx.tenantId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        method: input.method,
        amountCents: input.amountCents,
        reference: input.reference ?? null,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        notes: input.notes ?? null,
        externalPaymentId: input.externalPaymentId ?? null
      })
      .returning()

    const newPaid = invoice.amountPaidCents + input.amountCents
    const newBalance = Math.max(0, invoice.totalCents - newPaid)
    const newStatus = newBalance === 0 ? 'paid' : 'partially_paid'

    const [updatedInvoice] = await tx
      .update(schema.invoices)
      .set({
        amountPaidCents: newPaid,
        balanceDueCents: newBalance,
        status: newStatus,
        version: invoice.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.invoices.id, invoice.id))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'payment.recorded',
      entityType: 'payment',
      entityId: payment.id,
      afterState: {
        paymentId: payment.id,
        invoiceId: invoice.id,
        amountCents: payment.amountCents,
        method: payment.method,
        invoiceStatus: updatedInvoice.status,
        balanceDueCents: updatedInvoice.balanceDueCents
      }
    })

    return { payment, invoice: updatedInvoice }
  })

  if (result.invoice.status === 'paid') {
    await emitWebhookEvent(ctx.tenantId, 'invoice.paid', {
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      customerId: result.invoice.customerId,
      totalCents: result.invoice.totalCents,
      paymentId: result.payment.id
    })
  }

  return result
}
