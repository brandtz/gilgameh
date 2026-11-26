import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import { computeDocumentTotals } from '../utils/money'
import { enforceAgentApprovalPolicy, type ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'
import { allocateDocumentNumber, getCurrentTenant } from './tenant.service'
import { getCustomerById } from './customer.service'
import { getOrderById } from './order.service'
import { generateBrandedDocumentPdf } from './pdf.service'
import { storeAttachment } from './attachment.service'

export async function listInvoices(
  ctx: ActorContext,
  filters: {
    status?: string
    unpaidOnly?: boolean
    customerId?: string
    limit: number
    offset: number
  }
) {
  const db = await getDb()
  const conditions = [
    eq(schema.invoices.tenantId, ctx.tenantId),
    isNull(schema.invoices.deletedAt)
  ]
  if (filters.status) {
    conditions.push(eq(schema.invoices.status, filters.status))
  } else if (filters.unpaidOnly) {
    conditions.push(inArray(schema.invoices.status, ['sent', 'partially_paid', 'overdue']))
  }
  if (filters.customerId) {
    conditions.push(eq(schema.invoices.customerId, filters.customerId))
  }

  const whereClause = and(...conditions)
  const [rows, countRows] = await Promise.all([
    db
      .select({
        invoice: schema.invoices,
        customerName: schema.customers.name
      })
      .from(schema.invoices)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
      .where(whereClause)
      .orderBy(desc(schema.invoices.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.invoices)
      .where(whereClause)
  ])

  return {
    items: rows.map((r) => ({
      ...r.invoice,
      customerName: r.customerName,
      pdfUrl: `/api/v1/invoices/${r.invoice.id}/pdf`
    })),
    total: countRows[0]?.count ?? 0
  }
}

export async function getInvoiceById(ctx: ActorContext, invoiceId: string) {
  const db = await getDb()
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.id, invoiceId),
        eq(schema.invoices.tenantId, ctx.tenantId),
        isNull(schema.invoices.deletedAt)
      )
    )
  if (!invoice) throw Errors.notFound('Invoice', invoiceId)

  const [lines, paymentsList, customer] = await Promise.all([
    db
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, invoice.id))
      .orderBy(asc(schema.invoiceLines.lineOrder)),
    db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.invoiceId, invoice.id), isNull(schema.payments.deletedAt)))
      .orderBy(desc(schema.payments.paidAt)),
    getCustomerById(ctx, invoice.customerId)
  ])

  return {
    ...invoice,
    customer: {
      id: customer.id,
      name: customer.name,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone
    },
    lines,
    payments: paymentsList,
    pdfUrl: `/api/v1/invoices/${invoice.id}/pdf`
  }
}

export async function createDraftInvoice(
  ctx: ActorContext,
  input: {
    customerId: string
    orderId?: string | null
    quoteId?: string | null
    dueAt?: string | null
    notes?: string | null
    taxRateBps?: number
    lines: Array<{
      catalogItemId?: string | null
      description: string
      quantity: number
      unit?: string
      unitPriceCents: number
      taxable?: boolean
      taxRateBps?: number | null
      lineSubtotalCents?: number
      lineTaxCents?: number
      lineTotalCents?: number
    }>
    subtotalCents?: number
    taxCents?: number
    totalCents?: number
  }
) {
  const db = await getDb()
  const customer = await getCustomerById(ctx, input.customerId)
  const tenant = await getCurrentTenant(ctx.tenantId)
  const effectiveTaxRateBps = input.taxRateBps ?? tenant.taxSettings.defaultTaxRateBps

  const math = computeDocumentTotals(input.lines, effectiveTaxRateBps, {
    subtotalCents: input.subtotalCents,
    taxCents: input.taxCents,
    totalCents: input.totalCents
  })

  const dueAt = input.dueAt
    ? new Date(input.dueAt)
    : new Date(Date.now() + (tenant.settings.defaultPaymentTermsDays || 30) * 86_400_000)

  return db.transaction(async (tx) => {
    const { formatted: invoiceNumber } = await allocateDocumentNumber(tx, ctx.tenantId, 'invoice')

    const [invoice] = await tx
      .insert(schema.invoices)
      .values({
        tenantId: ctx.tenantId,
        invoiceNumber,
        orderId: input.orderId ?? null,
        quoteId: input.quoteId ?? null,
        customerId: customer.id,
        status: 'draft',
        dueAt,
        taxRateBps: effectiveTaxRateBps,
        subtotalCents: math.subtotalCents,
        taxCents: math.taxCents,
        totalCents: math.totalCents,
        amountPaidCents: 0,
        balanceDueCents: math.totalCents,
        notes: input.notes ?? null
      })
      .returning()

    const insertedLines = await tx
      .insert(schema.invoiceLines)
      .values(
        input.lines.map((line, idx) => {
          const computed = math.lines[idx]
          return {
            tenantId: ctx.tenantId,
            invoiceId: invoice.id,
            lineOrder: idx + 1,
            catalogItemId: line.catalogItemId ?? null,
            description: line.description,
            quantity: computed.quantityStr,
            unit: line.unit || 'each',
            unitPriceCents: computed.unitPriceCents,
            taxable: computed.taxable,
            taxRateBps: line.taxRateBps ?? null,
            lineSubtotalCents: computed.lineSubtotalCents,
            lineTaxCents: computed.lineTaxCents,
            lineTotalCents: computed.lineTotalCents
          }
        })
      )
      .returning()

    await recordAudit(tx, ctx, {
      action: 'invoice.draft_created',
      entityType: 'invoice',
      entityId: invoice.id,
      afterState: { invoice, lines: insertedLines }
    })

    return {
      ...invoice,
      customer: { id: customer.id, name: customer.name },
      lines: insertedLines,
      pdfUrl: `/api/v1/invoices/${invoice.id}/pdf`
    }
  })
}

export async function createInvoiceFromOrder(ctx: ActorContext, orderId: string) {
  const order = await getOrderById(ctx, orderId)
  return createDraftInvoice(ctx, {
    customerId: order.customerId,
    orderId: order.id,
    quoteId: order.quoteId,
    notes: order.notes,
    lines: order.lines.map((l) => ({
      catalogItemId: l.catalogItemId,
      description: l.description,
      quantity: Number(l.quantity),
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
      taxable: l.taxable,
      taxRateBps: l.taxRateBps
    }))
  })
}

export async function approveAndSendInvoice(
  ctx: ActorContext,
  invoiceId: string,
  version: number
) {
  const tenant = await getCurrentTenant(ctx.tenantId)
  enforceAgentApprovalPolicy(ctx, tenant.settings, `/invoices?id=${invoiceId}`)

  const full = await getInvoiceById(ctx, invoiceId)
  if (full.status !== 'draft') {
    throw Errors.conflict(`Invoice ${full.invoiceNumber} cannot be approved from status "${full.status}"`)
  }
  if (full.version !== version) {
    throw Errors.versionConflict(version, full.version)
  }

  const pdfBytes = await generateBrandedDocumentPdf({
    docType: 'INVOICE',
    docNumber: full.invoiceNumber,
    status: 'sent',
    issuedDate: new Date().toISOString().slice(0, 10),
    dueOrValidLabel: 'Due Date',
    dueOrValidDate: full.dueAt ? full.dueAt.toISOString().slice(0, 10) : null,
    tenant: {
      name: tenant.name,
      legalName: tenant.legalName,
      email: tenant.email,
      phone: tenant.phone,
      address: tenant.address,
      branding: tenant.branding,
      currency: tenant.settings.currency,
      taxLabel: tenant.taxSettings.taxLabel
    },
    customer: full.customer,
    lines: full.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.lineTotalCents
    })),
    subtotalCents: full.subtotalCents,
    taxCents: full.taxCents,
    totalCents: full.totalCents,
    amountPaidCents: full.amountPaidCents,
    balanceDueCents: full.balanceDueCents,
    notes: full.notes
  })

  const attachment = await storeAttachment(ctx, {
    entityType: 'invoice',
    entityId: invoiceId,
    filename: `${full.invoiceNumber}.pdf`,
    mimeType: 'application/pdf',
    data: pdfBytes
  })

  const db = await getDb()
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, ctx.tenantId)))
    if (!current) throw Errors.notFound('Invoice', invoiceId)
    if (current.version !== version) throw Errors.versionConflict(version, current.version)

    const [updated] = await tx
      .update(schema.invoices)
      .set({
        status: 'sent',
        issuedAt: new Date(),
        pdfAttachmentId: attachment.id,
        version: current.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.invoices.id, invoiceId))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'invoice.approved',
      entityType: 'invoice',
      entityId: invoiceId,
      beforeState: { status: current.status, version: current.version },
      afterState: { status: updated.status, version: updated.version, pdfAttachmentId: attachment.id }
    })

    return { ...updated, lines: full.lines, customer: full.customer, pdfUrl: `/api/v1/invoices/${updated.id}/pdf` }
  })
}

export async function renderInvoicePdfBytes(ctx: ActorContext, invoiceId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const full = await getInvoiceById(ctx, invoiceId)
  const tenant = await getCurrentTenant(ctx.tenantId)
  const bytes = await generateBrandedDocumentPdf({
    docType: 'INVOICE',
    docNumber: full.invoiceNumber,
    status: full.status,
    issuedDate: (full.issuedAt || full.createdAt).toISOString().slice(0, 10),
    dueOrValidLabel: 'Due Date',
    dueOrValidDate: full.dueAt ? full.dueAt.toISOString().slice(0, 10) : null,
    tenant: {
      name: tenant.name,
      legalName: tenant.legalName,
      email: tenant.email,
      phone: tenant.phone,
      address: tenant.address,
      branding: tenant.branding,
      currency: tenant.settings.currency,
      taxLabel: tenant.taxSettings.taxLabel
    },
    customer: full.customer,
    lines: full.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.lineTotalCents
    })),
    subtotalCents: full.subtotalCents,
    taxCents: full.taxCents,
    totalCents: full.totalCents,
    amountPaidCents: full.amountPaidCents,
    balanceDueCents: full.balanceDueCents,
    notes: full.notes
  })
  return { filename: `${full.invoiceNumber}.pdf`, bytes }
}
