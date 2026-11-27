import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { Errors } from '../utils/errors'
import type { ActorContext } from '../utils/auth-context'
import { recordAudit } from './audit.service'

export async function listCustomers(
  ctx: ActorContext,
  filters: {
    q?: string
    status?: string
    waitingOnOwner?: boolean
    limit: number
    offset: number
  }
) {
  const db = await getDb()
  const conditions = [
    eq(schema.customers.tenantId, ctx.tenantId),
    isNull(schema.customers.deletedAt)
  ]

  if (filters.status) conditions.push(eq(schema.customers.status, filters.status))
  if (filters.waitingOnOwner !== undefined) {
    conditions.push(eq(schema.customers.waitingOnOwner, filters.waitingOnOwner))
  }
  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim()}%`
    conditions.push(
      or(
        ilike(schema.customers.name, pattern),
        ilike(schema.customers.companyName, pattern),
        ilike(schema.customers.email, pattern),
        ilike(schema.customers.phone, pattern)
      )!
    )
  }

  const whereClause = and(...conditions)
  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(schema.customers)
      .where(whereClause)
      .orderBy(desc(schema.customers.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.customers)
      .where(whereClause)
  ])

  return { items, total: countRows[0]?.count ?? 0 }
}

/**
 * Candidate search designed for both API and MCP agents.
 * Never guesses when multiple candidates match (e.g. two customers named Wade).
 */
export async function findCustomerCandidates(ctx: ActorContext, query: string) {
  const { items } = await listCustomers(ctx, { q: query, limit: 10, offset: 0 })
  return {
    query,
    count: items.length,
    ambiguous: items.length > 1,
    exactMatch: items.length === 1 ? items[0] : null,
    candidates: items.map((c) => ({
      id: c.id,
      name: c.name,
      companyName: c.companyName,
      email: c.email,
      phone: c.phone,
      status: c.status,
      waitingOnOwner: c.waitingOnOwner
    }))
  }
}

/**
 * Strict matching for unattended inbound events (website leads/orders):
 * exact email when one is given, otherwise an exact, unique name.
 * Unlike findCustomerCandidates, never matches on substrings.
 */
export async function findCustomerForInboundEvent(
  ctx: ActorContext,
  input: { name: string; email?: string | null }
) {
  const db = await getDb()
  const base = [eq(schema.customers.tenantId, ctx.tenantId), isNull(schema.customers.deletedAt)]
  const email = input.email?.trim().toLowerCase()
  if (email) {
    const [match] = await db
      .select()
      .from(schema.customers)
      .where(and(...base, sql`lower(${schema.customers.email}) = ${email}`))
      .orderBy(desc(schema.customers.updatedAt))
      .limit(1)
    return match ?? null
  }
  const name = input.name.trim().toLowerCase()
  if (!name) return null
  const matches = await db
    .select()
    .from(schema.customers)
    .where(and(...base, sql`lower(trim(${schema.customers.name})) = ${name}`))
    .limit(2)
  return matches.length === 1 ? matches[0] : null
}

export async function getCustomerById(ctx: ActorContext, id: string) {
  const db = await getDb()
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.id, id),
        eq(schema.customers.tenantId, ctx.tenantId),
        isNull(schema.customers.deletedAt)
      )
    )
  if (!customer) throw Errors.notFound('Customer', id)
  return customer
}

export async function getCustomerFullDetails(ctx: ActorContext, id: string) {
  const customer = await getCustomerById(ctx, id)
  const db = await getDb()

  const [interactionsRes, quotesList, ordersList, invoicesList, paymentsList] = await Promise.all([
    listInteractions(ctx, { customerId: customer.id, limit: 100, offset: 0 }),
    db
      .select()
      .from(schema.quotes)
      .where(
        and(
          eq(schema.quotes.tenantId, ctx.tenantId),
          eq(schema.quotes.customerId, customer.id),
          isNull(schema.quotes.deletedAt)
        )
      )
      .orderBy(desc(schema.quotes.createdAt)),
    db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.tenantId, ctx.tenantId),
          eq(schema.orders.customerId, customer.id),
          isNull(schema.orders.deletedAt)
        )
      )
      .orderBy(desc(schema.orders.createdAt)),
    db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.tenantId, ctx.tenantId),
          eq(schema.invoices.customerId, customer.id),
          isNull(schema.invoices.deletedAt)
        )
      )
      .orderBy(desc(schema.invoices.createdAt)),
    db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.tenantId, ctx.tenantId),
          eq(schema.payments.customerId, customer.id),
          isNull(schema.payments.deletedAt)
        )
      )
      .orderBy(desc(schema.payments.paidAt))
  ])

  return {
    customer,
    interactions: interactionsRes.items,
    quotes: quotesList.map((q) => ({ ...q, pdfUrl: `/api/v1/quotes/${q.id}/pdf` })),
    orders: ordersList,
    invoices: invoicesList.map((i) => ({ ...i, pdfUrl: `/api/v1/invoices/${i.id}/pdf` })),
    payments: paymentsList
  }
}

export async function createCustomer(
  ctx: ActorContext,
  input: {
    type?: 'person' | 'organization'
    name: string
    companyName?: string | null
    email?: string | null
    phone?: string | null
    address?: schema.AddressJson
    status?: 'lead' | 'active' | 'inactive'
    leadSource?: string | null
    utmSource?: string | null
    utmMedium?: string | null
    utmCampaign?: string | null
    waitingOnOwner?: boolean
    notes?: string | null
    externalIds?: Record<string, string>
  }
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.customers)
      .values({
        tenantId: ctx.tenantId,
        type: input.type ?? 'person',
        name: input.name.trim(),
        companyName: input.companyName ?? null,
        email: input.email ? input.email.trim().toLowerCase() : null,
        phone: input.phone ?? null,
        address: input.address ?? {},
        status: input.status ?? 'lead',
        leadSource: input.leadSource ?? null,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        waitingOnOwner: input.waitingOnOwner ?? false,
        notes: input.notes ?? null,
        externalIds: input.externalIds ?? {}
      })
      .returning()

    await recordAudit(tx, ctx, {
      action: 'customer.created',
      entityType: 'customer',
      entityId: created.id,
      afterState: created as unknown as Record<string, unknown>
    })

    return created
  })
}

export async function updateCustomer(
  ctx: ActorContext,
  id: string,
  patch: Partial<{
    type: 'person' | 'organization'
    name: string
    companyName: string | null
    email: string | null
    phone: string | null
    address: schema.AddressJson
    status: 'lead' | 'active' | 'inactive'
    leadSource: string | null
    utmSource: string | null
    utmMedium: string | null
    utmCampaign: string | null
    waitingOnOwner: boolean
    notes: string | null
    externalIds: Record<string, string>
    version: number
  }>
) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, id),
          eq(schema.customers.tenantId, ctx.tenantId),
          isNull(schema.customers.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('Customer', id)
    if (patch.version !== undefined && patch.version !== existing.version) {
      throw Errors.versionConflict(patch.version, existing.version)
    }

    const [updated] = await tx
      .update(schema.customers)
      .set({
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.companyName !== undefined ? { companyName: patch.companyName } : {}),
        ...(patch.email !== undefined ? { email: patch.email ? patch.email.trim().toLowerCase() : null } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.leadSource !== undefined ? { leadSource: patch.leadSource } : {}),
        ...(patch.utmSource !== undefined ? { utmSource: patch.utmSource } : {}),
        ...(patch.utmMedium !== undefined ? { utmMedium: patch.utmMedium } : {}),
        ...(patch.utmCampaign !== undefined ? { utmCampaign: patch.utmCampaign } : {}),
        ...(patch.waitingOnOwner !== undefined ? { waitingOnOwner: patch.waitingOnOwner } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.externalIds !== undefined ? { externalIds: patch.externalIds } : {}),
        version: existing.version + 1,
        updatedAt: new Date()
      })
      .where(eq(schema.customers.id, id))
      .returning()

    await recordAudit(tx, ctx, {
      action: 'customer.updated',
      entityType: 'customer',
      entityId: id,
      beforeState: existing as unknown as Record<string, unknown>,
      afterState: updated as unknown as Record<string, unknown>
    })

    return updated
  })
}

export async function softDeleteCustomer(ctx: ActorContext, id: string) {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, id),
          eq(schema.customers.tenantId, ctx.tenantId),
          isNull(schema.customers.deletedAt)
        )
      )
    if (!existing) throw Errors.notFound('Customer', id)

    await tx
      .update(schema.customers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.customers.id, id))

    await recordAudit(tx, ctx, {
      action: 'customer.deleted',
      entityType: 'customer',
      entityId: id,
      beforeState: existing as unknown as Record<string, unknown>
    })
    return { deleted: true }
  })
}

// ── Interactions ──────────────────────────────────────────────────────────────

export async function listInteractions(
  ctx: ActorContext,
  filters: { customerId?: string; limit: number; offset: number; redactExternalRaw?: boolean }
) {
  const db = await getDb()
  const conditions = [
    eq(schema.interactions.tenantId, ctx.tenantId),
    isNull(schema.interactions.deletedAt)
  ]
  if (filters.customerId) {
    conditions.push(eq(schema.interactions.customerId, filters.customerId))
  }
  const whereClause = and(...conditions)

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(schema.interactions)
      .where(whereClause)
      .orderBy(desc(schema.interactions.occurredAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.interactions)
      .where(whereClause)
  ])

  // Prompt-injection protection: agents never receive raw inbound customer message bodies
  const items =
    filters.redactExternalRaw || ctx.actorType === 'agent'
      ? rows.map((r) => ({
          ...r,
          rawContent: r.containsExternalInput ? '[WITHHELD_FOR_PROMPT_SAFETY]' : r.rawContent
        }))
      : rows

  return { items, total: countRows[0]?.count ?? 0 }
}

export async function findInteractionByExternalRef(ctx: ActorContext, externalRef: string) {
  const db = await getDb()
  const [interaction] = await db
    .select()
    .from(schema.interactions)
    .where(
      and(
        eq(schema.interactions.tenantId, ctx.tenantId),
        eq(schema.interactions.externalRef, externalRef),
        isNull(schema.interactions.deletedAt)
      )
    )
    .orderBy(schema.interactions.createdAt)
    .limit(1)
  return interaction ?? null
}

export async function logInteraction(
  ctx: ActorContext,
  input: {
    customerId: string
    channel: 'call' | 'walk_in' | 'message' | 'form' | 'email' | 'other'
    direction: 'inbound' | 'outbound' | 'internal'
    summary: string
    rawContent?: string | null
    containsExternalInput?: boolean
    externalRef?: string | null
    occurredAt?: string
  }
) {
  const db = await getDb()
  // Verify customer belongs to tenant
  await getCustomerById(ctx, input.customerId)

  const containsExternalInput =
    input.containsExternalInput ??
    (input.direction === 'inbound' && (input.channel === 'message' || input.channel === 'form' || input.channel === 'email'))

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.interactions)
      .values({
        tenantId: ctx.tenantId,
        customerId: input.customerId,
        channel: input.channel,
        direction: input.direction,
        summary: input.summary,
        rawContent: input.rawContent ?? null,
        containsExternalInput,
        externalRef: input.externalRef ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        createdByActorType: ctx.actorType,
        createdByActorId: ctx.actorId
      })
      .returning()

    await recordAudit(tx, ctx, {
      action: 'interaction.logged',
      entityType: 'interaction',
      entityId: created.id,
      afterState: {
        id: created.id,
        customerId: created.customerId,
        channel: created.channel,
        direction: created.direction,
        summary: created.summary
      }
    })

    return created
  })
}
