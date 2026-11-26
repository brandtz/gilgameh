import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import { computeDocumentTotals } from '../utils/money'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'
import { allocateDocumentNumber, getCurrentTenant } from './tenant.service'
import { getCustomerById } from './customer.service'
import { getQuoteById } from './quote.service'
import { emitWebhookEvent } from './webhook.service'

export async function listOrders(
  ctx: ActorContext,
  filters: { status?: string; customerId?: string; channel?: string; limit: number; offset: number }
) {
  const db = await getDb()
  const conditions = [
    eq(schema.orders.tenantId, ctx.tenantId),
    isNull(schema.orders.deletedAt)
  ]
  if (filters.status) conditions.push(eq(schema.orders.status, filters.status))
  if (filters.customerId) conditions.push(eq(schema.orders.customerId, filters.customerId))
  if (filters.channel) conditions.push(eq(schema.orders.channel, filters.channel))

  const whereClause = and(...conditions)
  const [rows, countRows] = await Promise.all([
    db
      .select({
        order: schema.orders,
        customerName: schema.customers.name
      })
      .from(schema.orders)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(whereClause)
      .orderBy(desc(schema.orders.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(whereClause)
  ])

  return {
    items: rows.map((r) => ({ ...r.order, customerName: r.customerName })),
    total: countRows[0]?.count ?? 0
  }
}

export async function getOrderById(ctx: ActorContext, orderId: string) {
  const db = await getDb()
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.id, orderId),
        eq(schema.orders.tenantId, ctx.tenantId),
        isNull(schema.orders.deletedAt)
      )
    )
  if (!order) throw Errors.notFound('Order', orderId)

  const [lines, workItems, customer] = await Promise.all([
    db
      .select()
      .from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, order.id))
      .orderBy(asc(schema.orderLines.lineOrder)),
    db
      .select()
      .from(schema.workItems)
      .where(and(eq(schema.workItems.orderId, order.id), isNull(schema.workItems.deletedAt))),
    getCustomerById(ctx, order.customerId)
  ])

  return {
    ...order,
    customer: { id: customer.id, name: customer.name, email: customer.email },
    lines,
    workItems
  }
}

export async function createOrder(
  ctx: ActorContext,
  input: {
    customerId: string
    quoteId?: string | null
    customerPoNumber?: string | null
    channel?: 'quote' | 'website' | 'pos' | 'manual' | 'restaurant' | 'other'
    notes?: string | null
    externalOrderId?: string | null
    lines: Array<{
      catalogItemId?: string | null
      description: string
      quantity: number
      unit?: string
      unitPriceCents: number
      taxable?: boolean
      taxRateBps?: number | null
      attributes?: Record<string, unknown>
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
  const math = computeDocumentTotals(input.lines, tenant.taxSettings.defaultTaxRateBps, {
    subtotalCents: input.subtotalCents,
    taxCents: input.taxCents,
    totalCents: input.totalCents
  })

  const created = await db.transaction(async (tx) => {
    const { formatted: orderNumber } = await allocateDocumentNumber(tx, ctx.tenantId, 'order')

    const [order] = await tx
      .insert(schema.orders)
      .values({
        tenantId: ctx.tenantId,
        orderNumber,
        quoteId: input.quoteId ?? null,
        customerId: customer.id,
        customerPoNumber: input.customerPoNumber ?? null,
        channel: input.channel ?? 'manual',
        status: 'confirmed',
        subtotalCents: math.subtotalCents,
        taxCents: math.taxCents,
        totalCents: math.totalCents,
        notes: input.notes ?? null,
        externalOrderId: input.externalOrderId ?? null
      })
      .returning()

    const insertedLines = await tx
      .insert(schema.orderLines)
      .values(
        input.lines.map((line, idx) => {
          const computed = math.lines[idx]
          return {
            tenantId: ctx.tenantId,
            orderId: order.id,
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
            attributes: line.attributes ?? {}
          }
        })
      )
      .returning()

    // Automatically derive production WorkItems from order lines
    const insertedWorkItems = await tx
      .insert(schema.workItems)
      .values(
        insertedLines.map((line, idx) => ({
          tenantId: ctx.tenantId,
          orderId: order.id,
          orderLineId: line.id,
          title: `${order.orderNumber} — ${line.description}`,
          description: line.attributes && Object.keys(line.attributes).length
            ? JSON.stringify(line.attributes)
            : null,
          quantity: line.quantity,
          priorityRank: 100 + idx,
          state: 'queued'
        }))
      )
      .returning()

    // Deduct tracked inventory via append-only stock_movements (sale)
    for (const line of insertedLines) {
      if (!line.catalogItemId) continue
      const [inv] = await tx
        .select()
        .from(schema.inventoryItems)
        .where(
          and(
            eq(schema.inventoryItems.tenantId, ctx.tenantId),
            eq(schema.inventoryItems.catalogItemId, line.catalogItemId),
            isNull(schema.inventoryItems.deletedAt)
          )
        )
      if (inv) {
        const delta = -Math.round(Number(line.quantity))
        await tx.insert(schema.stockMovements).values({
          tenantId: ctx.tenantId,
          inventoryItemId: inv.id,
          catalogItemId: line.catalogItemId,
          movementType: 'sale',
          status: 'approved',
          quantityDelta: delta,
          referenceType: 'order',
          referenceId: order.id,
          reason: `Order ${order.orderNumber}`,
          approvedByActorType: ctx.actorType,
          approvedByActorId: ctx.actorId,
          approvedAt: new Date(),
          createdByActorType: ctx.actorType,
          createdByActorId: ctx.actorId
        })
        await tx
          .update(schema.inventoryItems)
          .set({
            quantityOnHand: inv.quantityOnHand + delta,
            version: inv.version + 1,
            updatedAt: new Date()
          })
          .where(eq(schema.inventoryItems.id, inv.id))
      }
    }

    await recordAudit(tx, ctx, {
      action: 'order.created',
      entityType: 'order',
      entityId: order.id,
      afterState: { order, lineCount: insertedLines.length, workItemCount: insertedWorkItems.length }
    })

    return {
      ...order,
      customer: { id: customer.id, name: customer.name },
      lines: insertedLines,
      workItems: insertedWorkItems
    }
  })

  await emitWebhookEvent(ctx.tenantId, 'order.created', {
    orderId: created.id,
    orderNumber: created.orderNumber,
    customerId: created.customerId,
    channel: created.channel,
    totalCents: created.totalCents
  })

  return created
}

export async function createOrderFromQuote(ctx: ActorContext, quoteId: string) {
  const quote = await getQuoteById(ctx, quoteId)
  if (quote.status !== 'accepted' && quote.status !== 'sent') {
    throw Errors.conflict(`Quote ${quote.quoteNumber} must be sent or accepted before converting to an order`)
  }
  return createOrder(ctx, {
    customerId: quote.customerId,
    quoteId: quote.id,
    customerPoNumber: quote.customerPoNumber,
    channel: 'quote',
    notes: quote.notes,
    lines: quote.lines.map((l) => ({
      catalogItemId: l.catalogItemId,
      description: l.description,
      quantity: Number(l.quantity),
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
      taxable: l.taxable,
      taxRateBps: l.taxRateBps,
      attributes: l.attributes
    }))
  })
}

export async function updateOrderStatus(
  ctx: ActorContext,
  orderId: string,
  input: {
    version: number
    status: 'pending' | 'confirmed' | 'in_production' | 'ready' | 'fulfilled' | 'cancelled'
    notes?: string | null
  }
) {
  const db = await getDb()
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.tenantId, ctx.tenantId),
          isNull(schema.orders.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('Order', orderId)
    if (existing.version !== input.version) throw Errors.versionConflict(input.version, existing.version)

    const [row] = await tx
      .update(schema.orders)
      .set({
        status: input.status,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        version: existing.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.orders.id, orderId))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'order.status_changed',
      entityType: 'order',
      entityId: orderId,
      beforeState: { status: existing.status, version: existing.version },
      afterState: { status: row.status, version: row.version }
    })

    return row
  })

  await emitWebhookEvent(ctx.tenantId, 'order.status_changed', {
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    status: updated.status
  })

  return updated
}
