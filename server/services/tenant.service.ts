import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema, type Database } from '../db'
import { Errors } from '../utils/errors'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'

export async function getCurrentTenant(tenantId: string) {
  const db = await getDb()
  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)))
  if (!tenant) throw Errors.notFound('Tenant', tenantId)
  return tenant
}

export async function listAccessibleTenants(ctx: ActorContext) {
  const db = await getDb()
  if (ctx.actorType === 'operator') {
    return db
      .select()
      .from(schema.tenants)
      .where(isNull(schema.tenants.deletedAt))
  }
  if (!ctx.userId) {
    const t = await getCurrentTenant(ctx.tenantId)
    return [t]
  }
  const rows = await db
    .select({ tenant: schema.tenants })
    .from(schema.tenantMemberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantMemberships.tenantId))
    .where(and(eq(schema.tenantMemberships.userId, ctx.userId), isNull(schema.tenants.deletedAt)))
  return rows.map((r) => r.tenant)
}

export async function createTenant(
  ctx: ActorContext,
  input: {
    slug: string
    name: string
    legalName?: string
    email?: string
    phone?: string
    address?: Record<string, string | undefined>
  }
) {
  if (ctx.actorType !== 'operator') {
    throw Errors.forbidden('Only BWE operators can create new tenants')
  }
  const db = await getDb()
  const [existing] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, input.slug))
  if (existing) {
    throw Errors.conflict(`Tenant slug "${input.slug}" already exists`)
  }

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(schema.tenants)
      .values({
        slug: input.slug,
        name: input.name,
        legalName: input.legalName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? {}
      })
      .returning()

    if (ctx.userId) {
      await tx.insert(schema.tenantMemberships).values({
        tenantId: tenant.id,
        userId: ctx.userId,
        role: 'operator'
      })
    }

    await recordAudit(tx, { ...ctx, tenantId: tenant.id }, {
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      afterState: tenant as unknown as Record<string, unknown>
    })

    return tenant
  })
}

export async function updateTenant(
  ctx: ActorContext,
  patch: Partial<{
    name: string
    legalName: string | null
    email: string | null
    phone: string | null
    address: schema.AddressJson
    branding: schema.TenantBranding
    numberingSettings: schema.TenantNumberingSettings
    taxSettings: schema.TenantTaxSettings
    settings: schema.TenantSettings
  }>
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.tenants)
      .where(and(eq(schema.tenants.id, ctx.tenantId), isNull(schema.tenants.deletedAt)))
    if (!existing) throw Errors.notFound('Tenant', ctx.tenantId)

    const [updated] = await tx
      .update(schema.tenants)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.legalName !== undefined ? { legalName: patch.legalName } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(patch.branding !== undefined ? { branding: patch.branding } : {}),
        ...(patch.numberingSettings !== undefined ? { numberingSettings: patch.numberingSettings } : {}),
        ...(patch.taxSettings !== undefined ? { taxSettings: patch.taxSettings } : {}),
        ...(patch.settings !== undefined ? { settings: patch.settings } : {}),
        updatedAt: new Date()
      })
      .where(eq(schema.tenants.id, ctx.tenantId))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'tenant.updated',
      entityType: 'tenant',
      entityId: ctx.tenantId,
      beforeState: existing as unknown as Record<string, unknown>,
      afterState: updated as unknown as Record<string, unknown>
    })

    return updated
  })
}

/**
 * Atomically allocates the next sequential document number (Q-1001, ORD-1001, INV-1001)
 * inside an active database transaction.
 */
export async function allocateDocumentNumber(
  tx: Pick<Database, 'select' | 'update'>,
  tenantId: string,
  kind: 'quote' | 'order' | 'invoice'
): Promise<{ formatted: string; tenant: typeof schema.tenants.$inferSelect }> {
  const [tenant] = await tx
    .select()
    .from(schema.tenants)
    .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.deletedAt)))

  if (!tenant) throw Errors.notFound('Tenant', tenantId)

  const ns = { ...tenant.numberingSettings }
  let formatted: string
  if (kind === 'quote') {
    formatted = `${ns.quotePrefix}-${ns.nextQuoteNumber}`
    ns.nextQuoteNumber += 1
  } else if (kind === 'order') {
    formatted = `${ns.orderPrefix}-${ns.nextOrderNumber}`
    ns.nextOrderNumber += 1
  } else {
    formatted = `${ns.invoicePrefix}-${ns.nextInvoiceNumber}`
    ns.nextInvoiceNumber += 1
  }

  const [updatedTenant] = await tx
    .update(schema.tenants)
    .set({ numberingSettings: ns, updatedAt: new Date() })
    .where(eq(schema.tenants.id, tenantId))
    .returning()

  return { formatted, tenant: updatedTenant }
}
