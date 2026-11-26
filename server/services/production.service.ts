import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'

export async function listProductionQueue(
  ctx: ActorContext,
  filters: {
    state?: string
    activeOnly?: boolean
    orderId?: string
    limit: number
    offset: number
  }
) {
  const db = await getDb()
  const conditions = [
    eq(schema.workItems.tenantId, ctx.tenantId),
    isNull(schema.workItems.deletedAt)
  ]

  if (filters.state) {
    conditions.push(eq(schema.workItems.state, filters.state))
  } else if (filters.activeOnly) {
    conditions.push(inArray(schema.workItems.state, ['queued', 'in_progress', 'ready']))
  }
  if (filters.orderId) {
    conditions.push(eq(schema.workItems.orderId, filters.orderId))
  }

  const whereClause = and(...conditions)
  const [rows, countRows] = await Promise.all([
    db
      .select({
        workItem: schema.workItems,
        orderNumber: schema.orders.orderNumber,
        customerName: schema.customers.name
      })
      .from(schema.workItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.workItems.orderId))
      .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(whereClause)
      .orderBy(asc(schema.workItems.priorityRank), asc(schema.workItems.dueDate), asc(schema.workItems.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.workItems)
      .where(whereClause)
  ])

  return {
    items: rows.map((r) => ({
      ...r.workItem,
      orderNumber: r.orderNumber,
      customerName: r.customerName
    })),
    total: countRows[0]?.count ?? 0
  }
}

export async function updateWorkItem(
  ctx: ActorContext,
  workItemId: string,
  input: {
    version: number
    state?: 'queued' | 'in_progress' | 'ready' | 'shipped' | 'picked_up' | 'cancelled'
    priorityRank?: number
    dueDate?: string | null
    assignedToUserId?: string | null
    notes?: string | null
  }
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.workItems)
      .where(
        and(
          eq(schema.workItems.id, workItemId),
          eq(schema.workItems.tenantId, ctx.tenantId),
          isNull(schema.workItems.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('WorkItem', workItemId)
    if (existing.version !== input.version) {
      throw Errors.versionConflict(input.version, existing.version)
    }

    const [updated] = await tx
      .update(schema.workItems)
      .set({
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.priorityRank !== undefined ? { priorityRank: input.priorityRank } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
        ...(input.assignedToUserId !== undefined ? { assignedToUserId: input.assignedToUserId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        version: existing.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.workItems.id, workItemId))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'work_item.updated',
      entityType: 'work_item',
      entityId: workItemId,
      beforeState: existing as unknown as Record<string, unknown>,
      afterState: updated as unknown as Record<string, unknown>
    })

    return updated
  })
}
