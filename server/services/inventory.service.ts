import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import { enforceAgentApprovalPolicy, type ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'
import { getCurrentTenant } from './tenant.service'

export async function listInventory(ctx: ActorContext) {
  const db = await getDb()
  const rows = await db
    .select({
      inventory: schema.inventoryItems,
      catalogItem: schema.catalogItems
    })
    .from(schema.inventoryItems)
    .innerJoin(schema.catalogItems, eq(schema.catalogItems.id, schema.inventoryItems.catalogItemId))
    .where(
      and(
        eq(schema.inventoryItems.tenantId, ctx.tenantId),
        isNull(schema.inventoryItems.deletedAt),
        isNull(schema.catalogItems.deletedAt)
      )
    )
    .orderBy(desc(schema.inventoryItems.updatedAt))

  return rows.map((r) => ({
    ...r.inventory,
    sku: r.catalogItem.sku,
    name: r.catalogItem.name,
    unit: r.catalogItem.unit,
    lowStock: r.inventory.quantityOnHand <= r.inventory.reorderPoint
  }))
}

export async function listStockMovements(ctx: ActorContext, catalogItemId?: string, limit = 50) {
  const db = await getDb()
  const conditions = [eq(schema.stockMovements.tenantId, ctx.tenantId)]
  if (catalogItemId) conditions.push(eq(schema.stockMovements.catalogItemId, catalogItemId))

  return db
    .select()
    .from(schema.stockMovements)
    .where(and(...conditions))
    .orderBy(desc(schema.stockMovements.createdAt))
    .limit(limit)
}

/**
 * Creates a draft stock adjustment (draft-then-confirm for inventory).
 */
export async function createDraftStockAdjustment(
  ctx: ActorContext,
  input: {
    catalogItemId: string
    movementType: 'receipt' | 'sale' | 'adjustment' | 'production_use'
    quantityDelta: number
    reason: string
    referenceType?: string
    referenceId?: string
  }
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [catalogItem] = await tx
      .select()
      .from(schema.catalogItems)
      .where(
        and(
          eq(schema.catalogItems.id, input.catalogItemId),
          eq(schema.catalogItems.tenantId, ctx.tenantId),
          isNull(schema.catalogItems.deletedAt)
        )
      )
    if (!catalogItem) throw Errors.notFound('CatalogItem', input.catalogItemId)

    let [inv] = await tx
      .select()
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.tenantId, ctx.tenantId),
          eq(schema.inventoryItems.catalogItemId, input.catalogItemId),
          isNull(schema.inventoryItems.deletedAt)
        )
      )

    if (!inv) {
      ;[inv] = await tx
        .insert(schema.inventoryItems)
        .values({
          tenantId: ctx.tenantId,
          catalogItemId: input.catalogItemId,
          quantityOnHand: 0,
          reorderPoint: 0
        })
        .returning()
    }

    const [movement] = await tx
      .insert(schema.stockMovements)
      .values({
        tenantId: ctx.tenantId,
        inventoryItemId: inv.id,
        catalogItemId: input.catalogItemId,
        movementType: input.movementType,
        status: 'draft',
        quantityDelta: input.quantityDelta,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        reason: input.reason,
        createdByActorType: ctx.actorType,
        createdByActorId: ctx.actorId
      })
      .returning()

    await recordAudit(tx, ctx, {
      action: 'inventory.adjustment_drafted',
      entityType: 'stock_movement',
      entityId: movement.id,
      afterState: movement as unknown as Record<string, unknown>
    })

    return movement
  })
}

/**
 * Approves a drafted stock movement (version-pinned) and applies delta to inventory_items.
 */
export async function approveStockMovement(
  ctx: ActorContext,
  movementId: string,
  version: number
) {
  const tenant = await getCurrentTenant(ctx.tenantId)
  enforceAgentApprovalPolicy(ctx, tenant.settings, `/inventory?movementId=${movementId}`)

  const db = await getDb()
  return db.transaction(async (tx) => {
    const [movement] = await tx
      .select()
      .from(schema.stockMovements)
      .where(
        and(
          eq(schema.stockMovements.id, movementId),
          eq(schema.stockMovements.tenantId, ctx.tenantId)
        )
      )
    if (!movement) throw Errors.notFound('StockMovement', movementId)
    if (movement.status !== 'draft') {
      throw Errors.conflict(`Stock movement is already in status "${movement.status}"`)
    }
    if (movement.version !== version) {
      throw Errors.versionConflict(version, movement.version)
    }

    const [inv] = await tx
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, movement.inventoryItemId))
    if (!inv) throw Errors.notFound('InventoryItem', movement.inventoryItemId)

    const [updatedMovement] = await tx
      .update(schema.stockMovements)
      .set({
        status: 'approved',
        approvedByActorType: ctx.actorType,
        approvedByActorId: ctx.actorId,
        approvedAt: new Date(),
        version: movement.version + 1
      })
      .where(eq(schema.stockMovements.id, movementId))
      .returning()

    const [updatedInv] = await tx
      .update(schema.inventoryItems)
      .set({
        quantityOnHand: inv.quantityOnHand + movement.quantityDelta,
        version: inv.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.inventoryItems.id, inv.id))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'inventory.adjustment_approved',
      entityType: 'stock_movement',
      entityId: movementId,
      beforeState: { quantityOnHand: inv.quantityOnHand, status: 'draft' },
      afterState: { quantityOnHand: updatedInv.quantityOnHand, status: 'approved', delta: movement.quantityDelta }
    })

    return { movement: updatedMovement, inventory: updatedInv }
  })
}
