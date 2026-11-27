import { eq } from 'drizzle-orm'
import { getDb, schema, closeDb } from './index'
import { generateOpaqueToken, hashPassword } from '../utils/crypto'

export interface SeedResult {
  tenantId: string
  operatorUserId: string
  ownerUserId: string
  staffUserId: string
  coasterItemId: string
  slabFlatteningItemId: string
  madeInOregonCustomerId: string
}

export async function seedDatabase(): Promise<SeedResult> {
  const db = await getDb()

  // 1. Tenant: Studio 37 (Woodworking design partner)
  let [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'studio-37'))
  if (!tenant) {
    ;[tenant] = await db
      .insert(schema.tenants)
      .values({
        slug: 'studio-37',
        name: 'Studio 37',
        legalName: 'Studio 37 Woodworking LLC',
        contactName: 'Drew',
        website: 'https://studio37customdesigns.com',
        email: 'drew@studio37.local',
        phone: '(503) 555-0137',
        address: {
          line1: '3700 Timber Mill Way',
          city: 'Portland',
          state: 'OR',
          postalCode: '97214',
          country: 'US'
        },
        branding: {
          primaryColor: '#1f2937',
          accentColor: '#b45309',
          headerText: 'Custom Woodworking & Millwork',
          footerText: 'Handcrafted in Oregon — Thank you for supporting Studio 37!',
          paymentInstructions: 'Make checks payable to Studio 37 Woodworking LLC. Cash or check preferred.'
        },
        numberingSettings: {
          quotePrefix: 'Q',
          nextQuoteNumber: 1001,
          orderPrefix: 'ORD',
          nextOrderNumber: 1001,
          invoicePrefix: 'INV',
          nextInvoiceNumber: 1001
        },
        taxSettings: {
          defaultTaxRateBps: 0, // Oregon: 0% sales tax by default
          taxLabel: 'Sales Tax'
        },
        settings: {
          allowAgentApproveScopes: false,
          defaultQuoteValidDays: 30,
          defaultPaymentTermsDays: 30,
          currency: 'USD',
          quoteEmailFromAddress: 'quotes@studio37customdesigns.com',
          quoteEmailFromName: 'Studio 37',
          quoteEmailReplyTo: 'drew@studio37.local',
          quoteEmailCopyOnApprove: true
        }
      })
      .returning()
  }

  // 2. Users: BWE Operator, Studio 37 Owner, Studio 37 Staff
  const upsertUser = async (email: string, password: string, name: string, role: string) => {
    let [u] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    if (!u) {
      ;[u] = await db
        .insert(schema.users)
        .values({
          email,
          passwordHash: await hashPassword(password),
          name,
          role,
          isActive: true
        })
        .returning()
    }
    return u
  }

  const operator = await upsertUser('matthew@bwe.local', 'BweOperator!2026', 'Matthew (BWE Operator)', 'bwe_operator')
  const owner = await upsertUser('drew@studio37.local', 'Studio37Owner!2026', 'Drew (Studio 37)', 'tenant_owner')
  const staff = await upsertUser('staff@studio37.local', 'Studio37Staff!2026', 'Alex (Studio 37 Shop)', 'tenant_staff')

  // 3. Memberships
  const ensureMembership = async (userId: string, role: string) => {
    const existing = await db
      .select()
      .from(schema.tenantMemberships)
      .where(eq(schema.tenantMemberships.userId, userId))
    if (!existing.some((m) => m.tenantId === tenant.id)) {
      await db.insert(schema.tenantMemberships).values({
        tenantId: tenant.id,
        userId,
        role
      })
    }
  }
  await ensureMembership(operator.id, 'operator')
  await ensureMembership(owner.id, 'owner')
  await ensureMembership(staff.id, 'staff')

  // 4. Tenant-defined Attribute Schema for Woodworking
  const existingSchemas = await db
    .select()
    .from(schema.catalogAttributeSchemas)
    .where(eq(schema.catalogAttributeSchemas.tenantId, tenant.id))
  let woodSchema = existingSchemas[0]
  if (!woodSchema) {
    ;[woodSchema] = await db
      .insert(schema.catalogAttributeSchemas)
      .values({
        tenantId: tenant.id,
        name: 'Woodworking Specifications',
        itemType: 'both',
        fields: [
          { name: 'dimensions', label: 'Dimensions', type: 'string', required: false, unit: 'in' },
          { name: 'species', label: 'Wood Species', type: 'string', required: false },
          { name: 'finish', label: 'Finish', type: 'string', required: false },
          { name: 'edgeProfile', label: 'Edge Profile', type: 'enum', options: ['square', 'beveled', 'live-edge', 'chamfered'] }
        ]
      })
      .returning()
  }

  // 5. Catalog Items (Products + Services)
  const existingItems = await db
    .select()
    .from(schema.catalogItems)
    .where(eq(schema.catalogItems.tenantId, tenant.id))

  let coasterItem = existingItems.find((i) => i.sku === 'S37-COASTER-WAL')
  if (!coasterItem) {
    ;[coasterItem] = await db
      .insert(schema.catalogItems)
      .values({
        tenantId: tenant.id,
        type: 'product',
        sku: 'S37-COASTER-WAL',
        name: 'Black Walnut Coaster',
        description: 'Laser-engraved black walnut coaster, bulk B2B ready',
        unit: 'each',
        basePriceCents: 650,
        taxable: true,
        attributeSchemaId: woodSchema.id,
        attributes: { dimensions: '4x4x0.5', species: 'Black Walnut', finish: 'Rubio Monocoat Pure' },
        trackInventory: true,
        verified: true
      })
      .returning()

    await db.insert(schema.inventoryItems).values({
      tenantId: tenant.id,
      catalogItemId: coasterItem.id,
      quantityOnHand: 250,
      reorderPoint: 50,
      location: 'Shelf A-2'
    })
  }

  let slabFlattening = existingItems.find((i) => i.sku === 'S37-SVC-FLATTEN')
  if (!slabFlattening) {
    ;[slabFlattening] = await db
      .insert(schema.catalogItems)
      .values({
        tenantId: tenant.id,
        type: 'service',
        sku: 'S37-SVC-FLATTEN',
        name: 'CNC Slab Flattening',
        description: 'Precision CNC flattening for live-edge slabs up to 60x120 in',
        unit: 'hour',
        basePriceCents: 12500,
        taxable: false,
        attributeSchemaId: woodSchema.id,
        attributes: { finish: 'Sanded 120 grit' },
        trackInventory: false,
        verified: true
      })
      .returning()
  }

  if (!existingItems.some((i) => i.sku === 'S37-COUNTER-MAPLE')) {
    await db.insert(schema.catalogItems).values({
      tenantId: tenant.id,
      type: 'product',
      sku: 'S37-COUNTER-MAPLE',
      name: 'Custom Hard Maple Countertop',
      description: 'Butcher-block hard maple countertop, custom cut to dimensions',
      unit: 'sqft',
      basePriceCents: 8500,
      taxable: true,
      attributeSchemaId: woodSchema.id,
      attributes: { species: 'Hard Maple', finish: 'Food-Safe Mineral Oil', edgeProfile: 'chamfered' },
      trackInventory: false,
      verified: true
    })
  }

  // 6. Customers (B2B + Retail)
  const existingCustomers = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.tenantId, tenant.id))

  let madeInOregon = existingCustomers.find((c) => c.name === 'Made in Oregon')
  if (!madeInOregon) {
    ;[madeInOregon] = await db
      .insert(schema.customers)
      .values({
        tenantId: tenant.id,
        type: 'organization',
        name: 'Made in Oregon',
        companyName: 'Made in Oregon Retail Group',
        email: 'purchasing@madeinoregon.example',
        phone: '(503) 555-0199',
        status: 'active',
        leadSource: 'b2b_referral',
        waitingOnOwner: false,
        notes: 'Bulk coaster POs (50-100 units per order)'
      })
      .returning()
  }

  if (!existingCustomers.some((c) => c.name === 'Sarah Jenkins')) {
    await db.insert(schema.customers).values({
      tenantId: tenant.id,
      type: 'person',
      name: 'Sarah Jenkins',
      email: 'sarah.jenkins@example.com',
      phone: '(503) 555-0142',
      status: 'lead',
      leadSource: 'website',
      utmSource: 'instagram',
      utmMedium: 'social',
      waitingOnOwner: true,
      notes: 'Interested in custom walnut dining table'
    })
  }

  // 7. Default OAuth client for MCP agents (Claude / ChatGPT)
  const [existingClient] = await db
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, 'mcp-default-client'))
  if (!existingClient) {
    await db.insert(schema.oauthClients).values({
      clientId: 'mcp-default-client',
      name: 'Back Office MCP Client',
      redirectUris: ['http://localhost:3000/oauth/callback', 'https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect'],
      allowedScopes: [
        'customers:read', 'customers:write',
        'catalog:read', 'catalog:write',
        'quotes:read', 'quotes:draft', 'quotes:approve',
        'orders:read', 'orders:write',
        'invoices:read', 'invoices:draft', 'invoices:approve',
        'production:read', 'production:write',
        'expenses:read', 'expenses:draft', 'expenses:approve',
        'inventory:read', 'inventory:adjust'
      ],
      tenantId: tenant.id
    })
  }

  // 8. Default Integration Configs
  for (const provider of ['website', 'stripe_connect', 'email', 'chatwoot', 'quickbooks'] as const) {
    const existing = await db
      .select()
      .from(schema.integrationConfigs)
      .where(eq(schema.integrationConfigs.tenantId, tenant.id))
    if (!existing.some((c) => c.provider === provider)) {
      await db.insert(schema.integrationConfigs).values({
        tenantId: tenant.id,
        provider,
        isEnabled: provider === 'email' || provider === 'website',
        config: provider === 'email' ? { from: 'quotes@studio37.local' } : {},
        webhookSecret: generateOpaqueToken('whsec', 24)
      })
    }
  }

  return {
    tenantId: tenant.id,
    operatorUserId: operator.id,
    ownerUserId: owner.id,
    staffUserId: staff.id,
    coasterItemId: coasterItem.id,
    slabFlatteningItemId: slabFlattening.id,
    madeInOregonCustomerId: madeInOregon.id
  }
}

// Allow running directly via `pnpm run db:seed`
const isMain = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')
if (isMain) {
  seedDatabase()
    .then((res) => {
      console.log(JSON.stringify({ level: 'info', msg: 'Seed completed', ...res }))
      return closeDb()
    })
    .catch((err) => {
      console.error(JSON.stringify({ level: 'error', msg: 'Seed failed', error: String(err) }))
      process.exit(1)
    })
}
