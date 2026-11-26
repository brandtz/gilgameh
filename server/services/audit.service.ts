import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb, schema, type Database } from '../db'
import type { ActorContext } from '../utils/auth-context'

export interface AuditEntryInput {
  action: string
  entityType: string
  entityId: string
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

export async function recordAudit(
  dbOrTx: Pick<Database, 'insert'>,
  ctx: ActorContext,
  entry: AuditEntryInput
) {
  const [inserted] = await dbOrTx
    .insert(schema.auditLogs)
    .values({
      tenantId: ctx.tenantId,
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      actorLabel: ctx.actorLabel,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeState: entry.beforeState ?? null,
      afterState: entry.afterState ?? null,
      metadata: entry.metadata ?? {},
      requestId: ctx.requestId ?? null
    })
    .returning()
  return inserted
}

export async function listAuditLogs(
  ctx: ActorContext,
  filters: {
    entityType?: string
    entityId?: string
    actorType?: string
    action?: string
    limit: number
    offset: number
  }
) {
  const db = await getDb()
  const conditions = [eq(schema.auditLogs.tenantId, ctx.tenantId)]
  if (filters.entityType) conditions.push(eq(schema.auditLogs.entityType, filters.entityType))
  if (filters.entityId) conditions.push(eq(schema.auditLogs.entityId, filters.entityId))
  if (filters.actorType) conditions.push(eq(schema.auditLogs.actorType, filters.actorType))
  if (filters.action) conditions.push(eq(schema.auditLogs.action, filters.action))

  const whereClause = and(...conditions)

  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(schema.auditLogs)
      .where(whereClause)
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.auditLogs)
      .where(whereClause)
  ])

  return {
    items,
    total: countRows[0]?.count ?? 0
  }
}
