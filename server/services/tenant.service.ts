import { and, eq, isNull } from 'drizzle-orm'
import { getDb, schema, type Database } from '../db'
import { Errors } from '../utils/errors'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'
import { checkSenderDomainVerifiedInResend } from './email.service'

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
    .where(
      and(
        eq(schema.tenantMemberships.userId, ctx.userId),
        isNull(schema.tenantMemberships.deletedAt),
        isNull(schema.tenants.deletedAt)
      )
    )
  return rows.map((r) => r.tenant)
}

export async function createTenant(
  ctx: ActorContext,
  input: {
    slug: string
    name: string
    legalName?: string
    contactName?: string
    website?: string
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
        contactName: input.contactName ?? null,
        website: input.website ?? null,
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
    contactName: string | null
    website: string | null
    email: string | null
    phone: string | null
    address: schema.AddressJson
    branding: Record<string, unknown>
    numberingSettings: schema.TenantNumberingSettings
    taxSettings: Record<string, unknown>
    settings: schema.TenantSettings
  }>
) {
  if (patch.settings?.quoteEmailFromAddress) {
    const check = await checkSenderDomainVerifiedInResend(patch.settings.quoteEmailFromAddress)
    if (check.checked && !check.verified) {
      throw Errors.validation(
        check.reason || `Sender domain "${check.domain}" is not verified in Resend.`
      )
    }
  }

  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.tenants)
      .where(and(eq(schema.tenants.id, ctx.tenantId), isNull(schema.tenants.deletedAt)))
    if (!existing) throw Errors.notFound('Tenant', ctx.tenantId)

    const mergedBranding: schema.TenantBranding | undefined = patch.branding
      ? {
          ...existing.branding,
          primaryColor: String(patch.branding.primaryColor || existing.branding.primaryColor || '#1e293b'),
          accentColor: String(patch.branding.accentColor || existing.branding.accentColor || '#b45309'),
          logoUrl: (patch.branding.logoUrl as string) || undefined,
          logoDataUrl: (patch.branding.logoDataUrl as string) || undefined,
          headerText: (patch.branding.headerText as string) || undefined,
          footerText: (patch.branding.footerText as string) || undefined,
          paymentInstructions: (patch.branding.paymentInstructions as string) || undefined,
          quoteTerms: (patch.branding.quoteTerms as string) || undefined,
          invoiceTerms: (patch.branding.invoiceTerms as string) || undefined
        }
      : undefined

    const mergedTaxSettings: schema.TenantTaxSettings | undefined = patch.taxSettings
      ? {
          defaultTaxRateBps: Number(patch.taxSettings.defaultTaxRateBps ?? existing.taxSettings.defaultTaxRateBps),
          taxLabel: String(patch.taxSettings.taxLabel || existing.taxSettings.taxLabel || 'Tax'),
          taxId: (patch.taxSettings.taxId as string) || undefined
        }
      : undefined

    const mergedSettings: schema.TenantSettings | undefined = patch.settings
      ? {
          ...existing.settings,
          ...patch.settings,
          quoteEmailFromAddress: patch.settings.quoteEmailFromAddress || null,
          quoteEmailFromName: patch.settings.quoteEmailFromName || null,
          quoteEmailReplyTo: patch.settings.quoteEmailReplyTo || null,
          quoteEmailCopyOnApprove: patch.settings.quoteEmailCopyOnApprove ?? existing.settings.quoteEmailCopyOnApprove ?? true
        }
      : undefined

    const [updated] = await tx
      .update(schema.tenants)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.legalName !== undefined ? { legalName: patch.legalName } : {}),
        ...(patch.contactName !== undefined ? { contactName: patch.contactName } : {}),
        ...(patch.website !== undefined ? { website: patch.website || null } : {}),
        ...(patch.email !== undefined ? { email: patch.email || null } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(mergedBranding !== undefined ? { branding: mergedBranding } : {}),
        ...(patch.numberingSettings !== undefined ? { numberingSettings: patch.numberingSettings } : {}),
        ...(mergedTaxSettings !== undefined ? { taxSettings: mergedTaxSettings } : {}),
        ...(mergedSettings !== undefined ? { settings: mergedSettings } : {}),
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
