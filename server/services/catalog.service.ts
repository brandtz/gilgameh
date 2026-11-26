import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'

/**
 * Validates JSONB attributes against a tenant-defined CatalogAttributeSchema.
 */
export function validateAttributesAgainstSchema(
  attributes: Record<string, unknown>,
  fields: schema.AttributeFieldDef[]
) {
  for (const field of fields) {
    const val = attributes[field.name]
    if (val === undefined || val === null || val === '') {
      if (field.required) {
        throw Errors.validation(`Missing required attribute "${field.name}"`)
      }
      continue
    }
    if (field.type === 'string' && typeof val !== 'string') {
      throw Errors.validation(`Attribute "${field.name}" must be a string`)
    }
    if (field.type === 'number' && (typeof val !== 'number' || !Number.isFinite(val))) {
      throw Errors.validation(`Attribute "${field.name}" must be a number`)
    }
    if (field.type === 'boolean' && typeof val !== 'boolean') {
      throw Errors.validation(`Attribute "${field.name}" must be a boolean`)
    }
    if (field.type === 'enum' && field.options && !field.options.includes(String(val))) {
      throw Errors.validation(
        `Attribute "${field.name}" must be one of: ${field.options.join(', ')}`
      )
    }
  }
}

export async function listAttributeSchemas(ctx: ActorContext) {
  const db = await getDb()
  return db
    .select()
    .from(schema.catalogAttributeSchemas)
    .where(
      and(
        eq(schema.catalogAttributeSchemas.tenantId, ctx.tenantId),
        isNull(schema.catalogAttributeSchemas.deletedAt)
      )
    )
    .orderBy(desc(schema.catalogAttributeSchemas.createdAt))
}

export async function createAttributeSchema(
  ctx: ActorContext,
  input: {
    name: string
    itemType: 'product' | 'service' | 'both'
    fields: schema.AttributeFieldDef[]
  }
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.catalogAttributeSchemas)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        itemType: input.itemType,
        fields: input.fields
      })
      .returning()

    await recordAudit(tx, ctx, {
      action: 'catalog_attribute_schema.created',
      entityType: 'catalog_attribute_schema',
      entityId: created.id,
      afterState: created as unknown as Record<string, unknown>
    })
    return created
  })
}

export async function listCatalogItems(
  ctx: ActorContext,
  filters: {
    q?: string
    type?: 'product' | 'service'
    verified?: boolean
    limit: number
    offset: number
  }
) {
  const db = await getDb()
  const conditions = [
    eq(schema.catalogItems.tenantId, ctx.tenantId),
    isNull(schema.catalogItems.deletedAt)
  ]
  if (filters.type) conditions.push(eq(schema.catalogItems.type, filters.type))
  if (filters.verified !== undefined) conditions.push(eq(schema.catalogItems.verified, filters.verified))
  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim()}%`
    conditions.push(
      or(
        ilike(schema.catalogItems.name, pattern),
        ilike(schema.catalogItems.sku, pattern),
        ilike(schema.catalogItems.description, pattern)
      )!
    )
  }

  const whereClause = and(...conditions)
  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(schema.catalogItems)
      .where(whereClause)
      .orderBy(desc(schema.catalogItems.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.catalogItems)
      .where(whereClause)
  ])

  return { items, total: countRows[0]?.count ?? 0 }
}

export async function getCatalogItemById(ctx: ActorContext, id: string) {
  const db = await getDb()
  const [item] = await db
    .select()
    .from(schema.catalogItems)
    .where(
      and(
        eq(schema.catalogItems.id, id),
        eq(schema.catalogItems.tenantId, ctx.tenantId),
        isNull(schema.catalogItems.deletedAt)
      )
    )
  if (!item) throw Errors.notFound('CatalogItem', id)
  return item
}

export async function createCatalogItem(
  ctx: ActorContext,
  input: {
    type?: 'product' | 'service'
    sku?: string | null
    name: string
    description?: string | null
    unit?: string
    basePriceCents: number
    taxable?: boolean
    taxRateBps?: number | null
    attributeSchemaId?: string | null
    attributes?: Record<string, unknown>
    trackInventory?: boolean
    verified?: boolean
    initialQuantityOnHand?: number
    reorderPoint?: number
  }
) {
  const db = await getDb()

  if (input.attributeSchemaId) {
    const [attrSchema] = await db
      .select()
      .from(schema.catalogAttributeSchemas)
      .where(
        and(
          eq(schema.catalogAttributeSchemas.id, input.attributeSchemaId),
          eq(schema.catalogAttributeSchemas.tenantId, ctx.tenantId),
          isNull(schema.catalogAttributeSchemas.deletedAt)
        )
      )
    if (!attrSchema) throw Errors.notFound('CatalogAttributeSchema', input.attributeSchemaId)
    validateAttributesAgainstSchema(input.attributes ?? {}, attrSchema.fields)
  }

  // Non-negotiable rule: items created by an AI agent are ALWAYS unverified (verified = false)
  const verified = ctx.actorType === 'agent' ? false : (input.verified ?? true)

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.catalogItems)
      .values({
        tenantId: ctx.tenantId,
        type: input.type ?? 'product',
        sku: input.sku ?? null,
        name: input.name.trim(),
        description: input.description ?? null,
        unit: input.unit ?? 'each',
        basePriceCents: input.basePriceCents,
        taxable: input.taxable ?? true,
        taxRateBps: input.taxRateBps ?? null,
        attributeSchemaId: input.attributeSchemaId ?? null,
        attributes: input.attributes ?? {},
        trackInventory: input.trackInventory ?? false,
        verified
      })
      .returning()

    if (created.trackInventory) {
      await tx.insert(schema.inventoryItems).values({
        tenantId: ctx.tenantId,
        catalogItemId: created.id,
        quantityOnHand: input.initialQuantityOnHand ?? 0,
        reorderPoint: input.reorderPoint ?? 0
      })
    }

    await recordAudit(tx, ctx, {
      action: 'catalog_item.created',
      entityType: 'catalog_item',
      entityId: created.id,
      afterState: created as unknown as Record<string, unknown>
    })

    return created
  })
}

export async function updateCatalogItem(
  ctx: ActorContext,
  id: string,
  patch: Partial<{
    type: 'product' | 'service'
    sku: string | null
    name: string
    description: string | null
    unit: string
    basePriceCents: number
    taxable: boolean
    taxRateBps: number | null
    attributeSchemaId: string | null
    attributes: Record<string, unknown>
    trackInventory: boolean
    verified: boolean
    isActive: boolean
    version: number
  }>
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.catalogItems)
      .where(
        and(
          eq(schema.catalogItems.id, id),
          eq(schema.catalogItems.tenantId, ctx.tenantId),
          isNull(schema.catalogItems.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('CatalogItem', id)
    if (patch.version !== undefined && patch.version !== existing.version) {
      throw Errors.versionConflict(patch.version, existing.version)
    }

    // Agents cannot self-verify catalog items
    if (ctx.actorType === 'agent' && patch.verified === true) {
      throw Errors.forbidden('AI agents cannot mark catalog items as verified')
    }

    const schemaId = patch.attributeSchemaId !== undefined ? patch.attributeSchemaId : existing.attributeSchemaId
    if (schemaId && patch.attributes) {
      const [attrSchema] = await tx
        .select()
        .from(schema.catalogAttributeSchemas)
        .where(eq(schema.catalogAttributeSchemas.id, schemaId))
      if (attrSchema) {
        validateAttributesAgainstSchema(patch.attributes, attrSchema.fields)
      }
    }

    const [updated] = await tx
      .update(schema.catalogItems)
      .set({
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.sku !== undefined ? { sku: patch.sku } : {}),
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
        ...(patch.basePriceCents !== undefined ? { basePriceCents: patch.basePriceCents } : {}),
        ...(patch.taxable !== undefined ? { taxable: patch.taxable } : {}),
        ...(patch.taxRateBps !== undefined ? { taxRateBps: patch.taxRateBps } : {}),
        ...(patch.attributeSchemaId !== undefined ? { attributeSchemaId: patch.attributeSchemaId } : {}),
        ...(patch.attributes !== undefined ? { attributes: patch.attributes } : {}),
        ...(patch.trackInventory !== undefined ? { trackInventory: patch.trackInventory } : {}),
        ...(patch.verified !== undefined ? { verified: patch.verified } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        version: existing.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.catalogItems.id, id))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'catalog_item.updated',
      entityType: 'catalog_item',
      entityId: id,
      beforeState: existing as unknown as Record<string, unknown>,
      afterState: updated as unknown as Record<string, unknown>
    })

    return updated
  })
}
