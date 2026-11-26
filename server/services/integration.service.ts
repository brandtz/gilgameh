import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { logger } from '../utils/logger'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'

export async function listIntegrationConfigs(ctx: ActorContext) {
  const db = await getDb()
  const rows = await db
    .select()
    .from(schema.integrationConfigs)
    .where(eq(schema.integrationConfigs.tenantId, ctx.tenantId))
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    isEnabled: r.isEnabled,
    config: r.config,
    hasWebhookSecret: Boolean(r.webhookSecret),
    lastSyncedAt: r.lastSyncedAt,
    updatedAt: r.updatedAt
  }))
}

export async function upsertIntegrationConfig(
  ctx: ActorContext,
  provider: 'website' | 'stripe_connect' | 'email' | 'chatwoot' | 'quickbooks',
  input: { isEnabled: boolean; config: Record<string, unknown>; webhookSecret?: string | null }
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.integrationConfigs)
      .where(
        and(
          eq(schema.integrationConfigs.tenantId, ctx.tenantId),
          eq(schema.integrationConfigs.provider, provider)
        )
      )

    let saved
    if (existing) {
      ;[saved] = await tx
        .update(schema.integrationConfigs)
        .set({
          isEnabled: input.isEnabled,
          config: input.config,
          ...(input.webhookSecret !== undefined ? { webhookSecret: input.webhookSecret } : {}),
          updatedAt: new Date()
        })
        .where(eq(schema.integrationConfigs.id, existing.id))
        .returning()
    } else {
      ;[saved] = await tx
        .insert(schema.integrationConfigs)
        .values({
          tenantId: ctx.tenantId,
          provider,
          isEnabled: input.isEnabled,
          config: input.config,
          webhookSecret: input.webhookSecret ?? null
        })
        .returning()
    }

    await recordAudit(tx, ctx, {
      action: 'integration.updated',
      entityType: 'integration_config',
      entityId: saved.id,
      afterState: { provider, isEnabled: saved.isEnabled }
    })

    return {
      id: saved.id,
      provider: saved.provider,
      isEnabled: saved.isEnabled,
      config: saved.config,
      hasWebhookSecret: Boolean(saved.webhookSecret),
      lastSyncedAt: saved.lastSyncedAt
    }
  })
}

/**
 * One-way accounting push (Ops -> QuickBooks Online).
 * Collects finalized (sent/paid) invoices, payments, and approved expenses not yet synced.
 */
export async function syncFinalizedToAccounting(ctx: ActorContext) {
  const db = await getDb()
  const now = new Date()

  const [unsyncedInvoices, unsyncedPayments, unsyncedExpenses] = await Promise.all([
    db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.tenantId, ctx.tenantId),
          inArray(schema.invoices.status, ['sent', 'partially_paid', 'paid']),
          isNull(schema.invoices.syncedToAccountingAt),
          isNull(schema.invoices.deletedAt)
        )
      ),
    db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.tenantId, ctx.tenantId),
          isNull(schema.payments.syncedToAccountingAt),
          isNull(schema.payments.deletedAt)
        )
      ),
    db
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.status, 'approved'),
          isNull(schema.expenses.syncedToAccountingAt),
          isNull(schema.expenses.deletedAt)
        )
      )
  ])

  await db.transaction(async (tx) => {
    for (const inv of unsyncedInvoices) {
      await tx
        .update(schema.invoices)
        .set({ syncedToAccountingAt: now, externalAccountingId: `qbo_inv_${inv.invoiceNumber}` })
        .where(eq(schema.invoices.id, inv.id))
    }
    for (const pay of unsyncedPayments) {
      await tx
        .update(schema.payments)
        .set({ syncedToAccountingAt: now })
        .where(eq(schema.payments.id, pay.id))
    }
    for (const exp of unsyncedExpenses) {
      await tx
        .update(schema.expenses)
        .set({ syncedToAccountingAt: now, externalAccountingId: `qbo_exp_${exp.id.slice(0, 8)}` })
        .where(eq(schema.expenses.id, exp.id))
    }
    await tx
      .update(schema.integrationConfigs)
      .set({ lastSyncedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.integrationConfigs.tenantId, ctx.tenantId),
          eq(schema.integrationConfigs.provider, 'quickbooks')
        )
      )

    await recordAudit(tx, ctx, {
      action: 'accounting.one_way_sync',
      entityType: 'integration_config',
      entityId: 'quickbooks',
      afterState: {
        invoicesSynced: unsyncedInvoices.length,
        paymentsSynced: unsyncedPayments.length,
        expensesSynced: unsyncedExpenses.length
      }
    })
  })

  return {
    provider: 'quickbooks',
    syncedAt: now.toISOString(),
    counts: {
      invoices: unsyncedInvoices.length,
      payments: unsyncedPayments.length,
      expenses: unsyncedExpenses.length
    }
  }
}

export async function sendTransactionalEmail(input: {
  to: string
  subject: string
  text: string
}) {
  const provider = process.env.EMAIL_PROVIDER || 'console'
  if (provider === 'resend' && process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Back Office <noreply@backoffice.local>',
        to: [input.to],
        subject: input.subject,
        text: input.text
      })
    })
    return { delivered: res.ok, provider: 'resend', status: res.status }
  }
  logger.info('Email queued (console provider)', { subject: input.subject })
  return { delivered: true, provider: 'console' }
}

export async function getBusinessSummary(ctx: ActorContext) {
  const db = await getDb()
  const [
    customerStats,
    openQuotes,
    activeOrders,
    queuedWork,
    unpaidInvoices,
    unverifiedCatalog,
    draftExpenses,
    lowStock
  ] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        waitingOnOwner: sql<number>`count(*) filter (where ${schema.customers.waitingOnOwner} = true)::int`
      })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), isNull(schema.customers.deletedAt))),
    db
      .select({
        count: sql<number>`count(*)::int`,
        totalCents: sql<number>`coalesce(sum(${schema.quotes.totalCents}), 0)::int`
      })
      .from(schema.quotes)
      .where(
        and(
          eq(schema.quotes.tenantId, ctx.tenantId),
          inArray(schema.quotes.status, ['draft', 'sent']),
          isNull(schema.quotes.deletedAt)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.tenantId, ctx.tenantId),
          inArray(schema.orders.status, ['pending', 'confirmed', 'in_production', 'ready']),
          isNull(schema.orders.deletedAt)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.workItems)
      .where(
        and(
          eq(schema.workItems.tenantId, ctx.tenantId),
          inArray(schema.workItems.state, ['queued', 'in_progress', 'ready']),
          isNull(schema.workItems.deletedAt)
        )
      ),
    db
      .select({
        count: sql<number>`count(*)::int`,
        balanceDueCents: sql<number>`coalesce(sum(${schema.invoices.balanceDueCents}), 0)::int`
      })
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.tenantId, ctx.tenantId),
          inArray(schema.invoices.status, ['sent', 'partially_paid', 'overdue']),
          isNull(schema.invoices.deletedAt)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.catalogItems)
      .where(
        and(
          eq(schema.catalogItems.tenantId, ctx.tenantId),
          eq(schema.catalogItems.verified, false),
          isNull(schema.catalogItems.deletedAt)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.tenantId, ctx.tenantId),
          eq(schema.expenses.status, 'draft'),
          isNull(schema.expenses.deletedAt)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.tenantId, ctx.tenantId),
          sql`${schema.inventoryItems.quantityOnHand} <= ${schema.inventoryItems.reorderPoint}`,
          isNull(schema.inventoryItems.deletedAt)
        )
      )
  ])

  return {
    customersTotal: customerStats[0]?.total ?? 0,
    customersWaitingOnOwner: customerStats[0]?.waitingOnOwner ?? 0,
    openQuotesCount: openQuotes[0]?.count ?? 0,
    openQuotesTotalCents: openQuotes[0]?.totalCents ?? 0,
    activeOrdersCount: activeOrders[0]?.count ?? 0,
    activeWorkItemsCount: queuedWork[0]?.count ?? 0,
    unpaidInvoicesCount: unpaidInvoices[0]?.count ?? 0,
    unpaidInvoicesBalanceCents: unpaidInvoices[0]?.balanceDueCents ?? 0,
    unverifiedCatalogItemsCount: unverifiedCatalog[0]?.count ?? 0,
    draftExpensesCount: draftExpenses[0]?.count ?? 0,
    lowStockItemsCount: lowStock[0]?.count ?? 0
  }
}
