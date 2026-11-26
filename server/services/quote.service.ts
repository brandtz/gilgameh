import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import { computeDocumentTotals } from '../utils/money'
import { enforceAgentApprovalPolicy, type ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'
import { allocateDocumentNumber, getCurrentTenant } from './tenant.service'
import { getCustomerById } from './customer.service'
import { generateBrandedDocumentPdf } from './pdf.service'
import { storeAttachment } from './attachment.service'
import { emitWebhookEvent } from './webhook.service'

export interface QuoteLineInput {
  catalogItemId?: string | null
  description: string
  quantity: number
  unit?: string
  unitPriceCents: number
  taxable?: boolean
  taxRateBps?: number | null
  attributes?: Record<string, unknown>
  unverifiedItem?: boolean
  lineSubtotalCents?: number
  lineTaxCents?: number
  lineTotalCents?: number
}

export async function listQuotes(
  ctx: ActorContext,
  filters: {
    status?: string
    openOnly?: boolean
    customerId?: string
    limit: number
    offset: number
  }
) {
  const db = await getDb()
  const conditions = [
    eq(schema.quotes.tenantId, ctx.tenantId),
    isNull(schema.quotes.deletedAt)
  ]
  if (filters.status) {
    conditions.push(eq(schema.quotes.status, filters.status))
  } else if (filters.openOnly) {
    conditions.push(inArray(schema.quotes.status, ['draft', 'sent']))
  }
  if (filters.customerId) {
    conditions.push(eq(schema.quotes.customerId, filters.customerId))
  }

  const whereClause = and(...conditions)
  const [items, countRows] = await Promise.all([
    db
      .select({
        quote: schema.quotes,
        customerName: schema.customers.name
      })
      .from(schema.quotes)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.quotes.customerId))
      .where(whereClause)
      .orderBy(desc(schema.quotes.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.quotes)
      .where(whereClause)
  ])

  return {
    items: items.map((r) => ({
      ...r.quote,
      customerName: r.customerName,
      pdfUrl: `/api/v1/quotes/${r.quote.id}/pdf`
    })),
    total: countRows[0]?.count ?? 0
  }
}

export async function getQuoteById(ctx: ActorContext, quoteId: string) {
  const db = await getDb()
  const [quote] = await db
    .select()
    .from(schema.quotes)
    .where(
      and(
        eq(schema.quotes.id, quoteId),
        eq(schema.quotes.tenantId, ctx.tenantId),
        isNull(schema.quotes.deletedAt)
      )
    )
  if (!quote) throw Errors.notFound('Quote', quoteId)

  const [lines, customer] = await Promise.all([
    db
      .select()
      .from(schema.quoteLines)
      .where(eq(schema.quoteLines.quoteId, quote.id))
      .orderBy(asc(schema.quoteLines.lineOrder)),
    getCustomerById(ctx, quote.customerId)
  ])

  return {
    ...quote,
    customer: {
      id: customer.id,
      name: customer.name,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone
    },
    lines,
    pdfUrl: `/api/v1/quotes/${quote.id}/pdf`
  }
}

export async function createDraftQuote(
  ctx: ActorContext,
  input: {
    customerId: string
    customerPoNumber?: string | null
    validUntil?: string | null
    notes?: string | null
    internalNotes?: string | null
    taxRateBps?: number
    lines: QuoteLineInput[]
    subtotalCents?: number
    taxCents?: number
    totalCents?: number
  }
) {
  const db = await getDb()
  const customer = await getCustomerById(ctx, input.customerId)
  const tenant = await getCurrentTenant(ctx.tenantId)
  const effectiveTaxRateBps = input.taxRateBps ?? tenant.taxSettings.defaultTaxRateBps

  // Resolve catalog items to verify ownership and unverified flags
  const catalogIds = input.lines
    .map((l) => l.catalogItemId)
    .filter((id): id is string => Boolean(id))

  const catalogMap = new Map<string, typeof schema.catalogItems.$inferSelect>()
  if (catalogIds.length > 0) {
    const items = await db
      .select()
      .from(schema.catalogItems)
      .where(
        and(
          eq(schema.catalogItems.tenantId, ctx.tenantId),
          inArray(schema.catalogItems.id, catalogIds),
          isNull(schema.catalogItems.deletedAt)
        )
      )
    for (const item of items) catalogMap.set(item.id, item)
    for (const id of catalogIds) {
      if (!catalogMap.has(id)) {
        throw Errors.notFound('CatalogItem', id)
      }
    }
  }

  const math = computeDocumentTotals(
    input.lines.map((l) => {
      const cat = l.catalogItemId ? catalogMap.get(l.catalogItemId) : undefined
      return {
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        taxable: l.taxable ?? cat?.taxable ?? true,
        taxRateBps: l.taxRateBps ?? cat?.taxRateBps ?? null,
        lineSubtotalCents: l.lineSubtotalCents,
        lineTaxCents: l.lineTaxCents,
        lineTotalCents: l.lineTotalCents
      }
    }),
    effectiveTaxRateBps,
    {
      subtotalCents: input.subtotalCents,
      taxCents: input.taxCents,
      totalCents: input.totalCents
    }
  )

  const validUntil = input.validUntil
    ? new Date(input.validUntil)
    : new Date(Date.now() + (tenant.settings.defaultQuoteValidDays || 30) * 86_400_000)

  return db.transaction(async (tx) => {
    const { formatted: quoteNumber } = await allocateDocumentNumber(tx, ctx.tenantId, 'quote')

    const [quote] = await tx
      .insert(schema.quotes)
      .values({
        tenantId: ctx.tenantId,
        quoteNumber,
        baseQuoteNumber: quoteNumber,
        revisionNumber: 1,
        customerId: customer.id,
        customerPoNumber: input.customerPoNumber ?? null,
        status: 'draft',
        validUntil,
        notes: input.notes ?? null,
        internalNotes: input.internalNotes ?? null,
        taxRateBps: effectiveTaxRateBps,
        subtotalCents: math.subtotalCents,
        taxCents: math.taxCents,
        totalCents: math.totalCents
      })
      .returning()

    const insertedLines = await tx
      .insert(schema.quoteLines)
      .values(
        input.lines.map((line, idx) => {
          const cat = line.catalogItemId ? catalogMap.get(line.catalogItemId) : undefined
          const computed = math.lines[idx]
          return {
            tenantId: ctx.tenantId,
            quoteId: quote.id,
            lineOrder: idx + 1,
            catalogItemId: line.catalogItemId ?? null,
            description: line.description,
            quantity: computed.quantityStr,
            unit: line.unit || cat?.unit || 'each',
            unitPriceCents: computed.unitPriceCents,
            taxable: computed.taxable,
            taxRateBps: line.taxRateBps ?? cat?.taxRateBps ?? null,
            lineSubtotalCents: computed.lineSubtotalCents,
            lineTaxCents: computed.lineTaxCents,
            lineTotalCents: computed.lineTotalCents,
            attributes: line.attributes ?? {},
            unverifiedItem: line.unverifiedItem ?? (cat ? !cat.verified : ctx.actorType === 'agent')
          }
        })
      )
      .returning()

    await recordAudit(tx, ctx, {
      action: 'quote.draft_created',
      entityType: 'quote',
      entityId: quote.id,
      afterState: { quote, lines: insertedLines }
    })

    return {
      ...quote,
      customer: { id: customer.id, name: customer.name },
      lines: insertedLines,
      pdfUrl: `/api/v1/quotes/${quote.id}/pdf`
    }
  })
}

export async function updateDraftQuote(
  ctx: ActorContext,
  quoteId: string,
  input: {
    version: number
    customerPoNumber?: string | null
    validUntil?: string | null
    notes?: string | null
    internalNotes?: string | null
    taxRateBps?: number
    lines?: QuoteLineInput[]
    subtotalCents?: number
    taxCents?: number
    totalCents?: number
  }
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.quotes)
      .where(
        and(
          eq(schema.quotes.id, quoteId),
          eq(schema.quotes.tenantId, ctx.tenantId),
          isNull(schema.quotes.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('Quote', quoteId)
    if (existing.status !== 'draft') {
      throw Errors.conflict(
        `Quote ${existing.quoteNumber} is immutable in status "${existing.status}". Create a revision instead.`
      )
    }
    if (existing.version !== input.version) {
      throw Errors.versionConflict(input.version, existing.version)
    }

    const effectiveTaxRateBps = input.taxRateBps ?? existing.taxRateBps
    let subtotalCents = existing.subtotalCents
    let taxCents = existing.taxCents
    let totalCents = existing.totalCents
    let updatedLines = await tx
      .select()
      .from(schema.quoteLines)
      .where(eq(schema.quoteLines.quoteId, quoteId))
      .orderBy(asc(schema.quoteLines.lineOrder))

    if (input.lines) {
      const math = computeDocumentTotals(
        input.lines.map((l) => ({
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          taxable: l.taxable ?? true,
          taxRateBps: l.taxRateBps ?? null,
          lineSubtotalCents: l.lineSubtotalCents,
          lineTaxCents: l.lineTaxCents,
          lineTotalCents: l.lineTotalCents
        })),
        effectiveTaxRateBps,
        {
          subtotalCents: input.subtotalCents,
          taxCents: input.taxCents,
          totalCents: input.totalCents
        }
      )
      subtotalCents = math.subtotalCents
      taxCents = math.taxCents
      totalCents = math.totalCents

      await tx.delete(schema.quoteLines).where(eq(schema.quoteLines.quoteId, quoteId))
      updatedLines = await tx
        .insert(schema.quoteLines)
        .values(
          input.lines.map((line, idx) => {
            const computed = math.lines[idx]
            return {
              tenantId: ctx.tenantId,
              quoteId,
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
              lineTotalCents: computed.lineTotalCents,
              attributes: line.attributes ?? {},
              unverifiedItem: line.unverifiedItem ?? false
            }
          })
        )
        .returning()
    }

    const [updated] = await tx
      .update(schema.quotes)
      .set({
        ...(input.customerPoNumber !== undefined ? { customerPoNumber: input.customerPoNumber } : {}),
        ...(input.validUntil !== undefined
          ? { validUntil: input.validUntil ? new Date(input.validUntil) : null }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
        taxRateBps: effectiveTaxRateBps,
        subtotalCents,
        taxCents,
        totalCents,
        version: existing.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.quotes.id, quoteId))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'quote.draft_updated',
      entityType: 'quote',
      entityId: quoteId,
      beforeState: existing as unknown as Record<string, unknown>,
      afterState: { quote: updated, lines: updatedLines }
    })

    return { ...updated, lines: updatedLines, pdfUrl: `/api/v1/quotes/${updated.id}/pdf` }
  })
}

export async function approveAndSendQuote(
  ctx: ActorContext,
  quoteId: string,
  version: number
) {
  const tenant = await getCurrentTenant(ctx.tenantId)
  enforceAgentApprovalPolicy(ctx, tenant.settings, `/quotes?id=${quoteId}`)

  const db = await getDb()
  const existingFull = await getQuoteById(ctx, quoteId)
  if (existingFull.status !== 'draft') {
    throw Errors.conflict(`Quote ${existingFull.quoteNumber} cannot be approved from status "${existingFull.status}"`)
  }
  if (existingFull.version !== version) {
    throw Errors.versionConflict(version, existingFull.version)
  }

  // Generate and persist branded PDF
  const pdfBytes = await generateBrandedDocumentPdf({
    docType: 'QUOTE',
    docNumber: existingFull.quoteNumber,
    status: 'sent',
    issuedDate: new Date().toISOString().slice(0, 10),
    dueOrValidLabel: 'Valid Until',
    dueOrValidDate: existingFull.validUntil ? existingFull.validUntil.toISOString().slice(0, 10) : null,
    customerPoNumber: existingFull.customerPoNumber,
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
    customer: existingFull.customer,
    lines: existingFull.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.lineTotalCents,
      attributes: l.attributes
    })),
    subtotalCents: existingFull.subtotalCents,
    taxCents: existingFull.taxCents,
    totalCents: existingFull.totalCents,
    notes: existingFull.notes
  })

  const attachment = await storeAttachment(ctx, {
    entityType: 'quote',
    entityId: quoteId,
    filename: `${existingFull.quoteNumber}.pdf`,
    mimeType: 'application/pdf',
    data: pdfBytes
  })

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.quotes)
      .where(and(eq(schema.quotes.id, quoteId), eq(schema.quotes.tenantId, ctx.tenantId)))
    if (!current) throw Errors.notFound('Quote', quoteId)
    if (current.version !== version) {
      throw Errors.versionConflict(version, current.version)
    }

    const [updated] = await tx
      .update(schema.quotes)
      .set({
        status: 'sent',
        sentAt: new Date(),
        pdfAttachmentId: attachment.id,
        version: current.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.quotes.id, quoteId))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'quote.approved',
      entityType: 'quote',
      entityId: quoteId,
      beforeState: { status: current.status, version: current.version },
      afterState: { status: updated.status, version: updated.version, pdfAttachmentId: attachment.id }
    })

    return {
      ...updated,
      lines: existingFull.lines,
      customer: existingFull.customer,
      pdfUrl: `/api/v1/quotes/${updated.id}/pdf`
    }
  })
}

export async function createQuoteRevision(ctx: ActorContext, quoteId: string) {
  const db = await getDb()
  const source = await getQuoteById(ctx, quoteId)

  return db.transaction(async (tx) => {
    const existingRevisions = await tx
      .select({ revisionNumber: schema.quotes.revisionNumber })
      .from(schema.quotes)
      .where(
        and(
          eq(schema.quotes.tenantId, ctx.tenantId),
          eq(schema.quotes.baseQuoteNumber, source.baseQuoteNumber)
        )
      )
    const nextRev = Math.max(...existingRevisions.map((r) => r.revisionNumber), 1) + 1
    const newQuoteNumber = `${source.baseQuoteNumber}-R${nextRev}`

    if (source.status === 'sent' || source.status === 'draft') {
      await tx
        .update(schema.quotes)
        .set({ status: 'superseded', version: source.version + 1, updatedAt: new Date() })
        .where(eq(schema.quotes.id, source.id))
    }

    const [created] = await tx
      .insert(schema.quotes)
      .values({
        tenantId: ctx.tenantId,
        quoteNumber: newQuoteNumber,
        baseQuoteNumber: source.baseQuoteNumber,
        parentQuoteId: source.id,
        revisionNumber: nextRev,
        customerId: source.customerId,
        customerPoNumber: source.customerPoNumber,
        status: 'draft',
        validUntil: source.validUntil,
        notes: source.notes,
        internalNotes: source.internalNotes,
        taxRateBps: source.taxRateBps,
        subtotalCents: source.subtotalCents,
        taxCents: source.taxCents,
        totalCents: source.totalCents
      })
      .returning()

    const copiedLines = await tx
      .insert(schema.quoteLines)
      .values(
        source.lines.map((l) => ({
          tenantId: ctx.tenantId,
          quoteId: created.id,
          lineOrder: l.lineOrder,
          catalogItemId: l.catalogItemId,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPriceCents: l.unitPriceCents,
          taxable: l.taxable,
          taxRateBps: l.taxRateBps,
          lineSubtotalCents: l.lineSubtotalCents,
          lineTaxCents: l.lineTaxCents,
          lineTotalCents: l.lineTotalCents,
          attributes: l.attributes,
          unverifiedItem: l.unverifiedItem
        }))
      )
      .returning()

    await recordAudit(tx, ctx, {
      action: 'quote.revision_created',
      entityType: 'quote',
      entityId: created.id,
      afterState: { quoteNumber: created.quoteNumber, parentQuoteId: source.id }
    })

    return {
      ...created,
      customer: source.customer,
      lines: copiedLines,
      pdfUrl: `/api/v1/quotes/${created.id}/pdf`
    }
  })
}

export async function transitionQuoteStatus(
  ctx: ActorContext,
  quoteId: string,
  targetStatus: 'accepted' | 'declined' | 'expired',
  version: number
) {
  const db = await getDb()
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.quotes)
      .where(
        and(
          eq(schema.quotes.id, quoteId),
          eq(schema.quotes.tenantId, ctx.tenantId),
          isNull(schema.quotes.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('Quote', quoteId)
    if (existing.version !== version) throw Errors.versionConflict(version, existing.version)
    if (existing.status !== 'sent') {
      throw Errors.conflict(`Quote must be in "sent" status to transition to "${targetStatus}"`)
    }

    const [row] = await tx
      .update(schema.quotes)
      .set({
        status: targetStatus,
        ...(targetStatus === 'accepted' ? { acceptedAt: new Date() } : {}),
        version: existing.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.quotes.id, quoteId))
      .returning()

    await recordAudit(tx, ctx, {
      action: `quote.${targetStatus}`,
      entityType: 'quote',
      entityId: quoteId,
      beforeState: { status: existing.status, version: existing.version },
      afterState: { status: row.status, version: row.version }
    })
    return row
  })

  if (targetStatus === 'accepted') {
    await emitWebhookEvent(ctx.tenantId, 'quote.accepted', {
      quoteId: updated.id,
      quoteNumber: updated.quoteNumber,
      customerId: updated.customerId,
      totalCents: updated.totalCents
    })
  }

  return updated
}

export async function renderQuotePdfBytes(ctx: ActorContext, quoteId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const full = await getQuoteById(ctx, quoteId)
  const tenant = await getCurrentTenant(ctx.tenantId)
  const bytes = await generateBrandedDocumentPdf({
    docType: 'QUOTE',
    docNumber: full.quoteNumber,
    status: full.status,
    issuedDate: full.createdAt.toISOString().slice(0, 10),
    dueOrValidLabel: 'Valid Until',
    dueOrValidDate: full.validUntil ? full.validUntil.toISOString().slice(0, 10) : null,
    customerPoNumber: full.customerPoNumber,
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
      lineTotalCents: l.lineTotalCents,
      attributes: l.attributes
    })),
    subtotalCents: full.subtotalCents,
    taxCents: full.taxCents,
    totalCents: full.totalCents,
    notes: full.notes
  })
  return { filename: `${full.quoteNumber}.pdf`, bytes }
}
