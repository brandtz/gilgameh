import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { computeExpenseFingerprint } from '../utils/crypto'
import { Errors } from '../utils/errors'
import { enforceAgentApprovalPolicy, type ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'
import { getCurrentTenant } from './tenant.service'

export async function listExpenses(
  ctx: ActorContext,
  filters: { status?: string; category?: string; limit: number; offset: number }
) {
  const db = await getDb()
  const conditions = [
    eq(schema.expenses.tenantId, ctx.tenantId),
    isNull(schema.expenses.deletedAt)
  ]
  if (filters.status) conditions.push(eq(schema.expenses.status, filters.status))
  if (filters.category) conditions.push(eq(schema.expenses.category, filters.category))

  const whereClause = and(...conditions)
  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(schema.expenses)
      .where(whereClause)
      .orderBy(desc(schema.expenses.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.expenses)
      .where(whereClause)
  ])

  return { items, total: countRows[0]?.count ?? 0 }
}

export async function createDraftExpense(
  ctx: ActorContext,
  input: {
    vendor: string
    expenseDate: string
    category?: string
    taxCents?: number
    lineItems: Array<{
      description: string
      quantity: number
      unitPriceCents: number
      lineTotalCents?: number
      category?: string
    }>
    subtotalCents?: number
    totalCents?: number
    receiptAttachmentId?: string | null
    notes?: string | null
    allowDuplicate?: boolean
  }
) {
  // Non-negotiable rule: original receipt image is REQUIRED when agent-created
  if (ctx.actorType === 'agent' && !input.receiptAttachmentId) {
    throw Errors.unprocessable(
      'Expenses created by an AI agent require a receiptAttachmentId referencing an uploaded receipt image.'
    )
  }

  const db = await getDb()

  if (input.receiptAttachmentId) {
    const [att] = await db
      .select()
      .from(schema.attachments)
      .where(
        and(
          eq(schema.attachments.id, input.receiptAttachmentId),
          eq(schema.attachments.tenantId, ctx.tenantId),
          isNull(schema.attachments.deletedAt)
        )
      )
    if (!att) throw Errors.notFound('Receipt attachment', input.receiptAttachmentId)
  }

  // Server-side math only
  let subtotalCents = 0
  const computedLines: schema.ExpenseLineItem[] = input.lineItems.map((line) => {
    const qtyMilli = Math.round(line.quantity * 1000)
    const computedLineTotal = Math.round((qtyMilli * line.unitPriceCents) / 1000)
    if (line.lineTotalCents !== undefined && line.lineTotalCents !== computedLineTotal) {
      throw Errors.mathMismatch('lineTotalCents', computedLineTotal, line.lineTotalCents)
    }
    subtotalCents += computedLineTotal
    return {
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: computedLineTotal,
      category: line.category
    }
  })

  const taxCents = input.taxCents ?? 0
  const totalCents = subtotalCents + taxCents

  if (input.subtotalCents !== undefined && input.subtotalCents !== subtotalCents) {
    throw Errors.mathMismatch('subtotalCents', subtotalCents, input.subtotalCents)
  }
  if (input.totalCents !== undefined && input.totalCents !== totalCents) {
    throw Errors.mathMismatch('totalCents', totalCents, input.totalCents)
  }

  // Duplicate-detection fingerprint
  const fingerprint = computeExpenseFingerprint(
    ctx.tenantId,
    input.vendor,
    input.expenseDate,
    totalCents
  )

  if (!input.allowDuplicate) {
    const [dup] = await db
      .select({ id: schema.expenses.id, vendor: schema.expenses.vendor, expenseDate: schema.expenses.expenseDate })
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.fingerprint, fingerprint),
          ne(schema.expenses.status, 'void'),
          isNull(schema.expenses.deletedAt)
        )
      )
    if (dup) {
      throw Errors.conflict(
        `Possible duplicate expense detected for "${dup.vendor}" on ${dup.expenseDate} with identical total (${totalCents} cents).`,
        { duplicateExpenseId: dup.id, fingerprint }
      )
    }
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.expenses)
      .values({
        tenantId: ctx.tenantId,
        vendor: input.vendor.trim(),
        expenseDate: input.expenseDate,
        category: input.category ?? 'supplies',
        status: 'draft',
        subtotalCents,
        taxCents,
        totalCents,
        lineItems: computedLines,
        receiptAttachmentId: input.receiptAttachmentId ?? null,
        fingerprint,
        notes: input.notes ?? null
      })
      .returning()

    await recordAudit(tx, ctx, {
      action: 'expense.draft_created',
      entityType: 'expense',
      entityId: created.id,
      afterState: created as unknown as Record<string, unknown>
    })

    return created
  })
}

export async function approveExpense(ctx: ActorContext, expenseId: string, version: number) {
  const tenant = await getCurrentTenant(ctx.tenantId)
  enforceAgentApprovalPolicy(ctx, tenant.settings, `/expenses?id=${expenseId}`)

  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.id, expenseId),
          eq(schema.expenses.tenantId, ctx.tenantId),
          isNull(schema.expenses.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('Expense', expenseId)
    if (existing.status !== 'draft') {
      throw Errors.conflict(`Expense is already in status "${existing.status}"`)
    }
    if (existing.version !== version) {
      throw Errors.versionConflict(version, existing.version)
    }

    const [updated] = await tx
      .update(schema.expenses)
      .set({
        status: 'approved',
        version: existing.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.expenses.id, expenseId))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'expense.approved',
      entityType: 'expense',
      entityId: expenseId,
      beforeState: { status: existing.status, version: existing.version },
      afterState: { status: updated.status, version: updated.version }
    })

    return updated
  })
}
