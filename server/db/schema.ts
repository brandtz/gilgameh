import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core'

// ── Shared JSONB types ────────────────────────────────────────────────────────

export interface AddressJson {
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

export interface TenantBranding {
  logoUrl?: string
  logoDataUrl?: string
  primaryColor: string
  accentColor: string
  headerText?: string
  footerText?: string
  paymentInstructions?: string
  quoteTerms?: string
  invoiceTerms?: string
}

export interface TenantNumberingSettings {
  quotePrefix: string
  nextQuoteNumber: number
  orderPrefix: string
  nextOrderNumber: number
  invoicePrefix: string
  nextInvoiceNumber: number
}

export interface TenantTaxSettings {
  defaultTaxRateBps: number
  taxLabel: string
  taxId?: string
}

export interface TenantSettings {
  allowAgentApproveScopes: boolean
  defaultQuoteValidDays: number
  defaultPaymentTermsDays: number
  currency: string
  quoteEmailFromAddress?: string | null
  quoteEmailFromName?: string | null
  quoteEmailReplyTo?: string | null
  quoteEmailCopyOnApprove?: boolean
}

export interface AttributeFieldDef {
  name: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  required?: boolean
  options?: string[]
  unit?: string
}

export interface ExpenseLineItem {
  description: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
  category?: string
}

// ── 1. Tenants & Identity ─────────────────────────────────────────────────────

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    contactName: text('contact_name'),
    website: text('website'),
    email: text('email'),
    phone: text('phone'),
    address: jsonb('address').$type<AddressJson>().notNull().default({}),
    branding: jsonb('branding')
      .$type<TenantBranding>()
      .notNull()
      .default({ primaryColor: '#1e293b', accentColor: '#b45309' }),
    numberingSettings: jsonb('numbering_settings')
      .$type<TenantNumberingSettings>()
      .notNull()
      .default({
        quotePrefix: 'Q',
        nextQuoteNumber: 1001,
        orderPrefix: 'ORD',
        nextOrderNumber: 1001,
        invoicePrefix: 'INV',
        nextInvoiceNumber: 1001
      }),
    taxSettings: jsonb('tax_settings')
      .$type<TenantTaxSettings>()
      .notNull()
      .default({ defaultTaxRateBps: 0, taxLabel: 'Tax' }),
    settings: jsonb('settings')
      .$type<TenantSettings>()
      .notNull()
      .default({
        allowAgentApproveScopes: false,
        defaultQuoteValidDays: 30,
        defaultPaymentTermsDays: 30,
        currency: 'USD'
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [uniqueIndex('tenants_slug_idx').on(t.slug)]
)

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    title: text('title'),
    role: text('role').notNull().default('tenant_staff'), // 'bwe_operator' | 'tenant_owner' | 'tenant_staff'
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)]
)

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('staff'), // 'operator' | 'owner' | 'manager' | 'staff' | 'viewer'
    scopes: jsonb('scopes').$type<string[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [
    uniqueIndex('tenant_memberships_tenant_user_idx').on(t.tenantId, t.userId),
    index('tenant_memberships_user_idx').on(t.userId)
  ]
)

// ── 2. OAuth 2.1 & API Keys ──────────────────────────────────────────────────

export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: text('client_id').notNull(),
    clientSecretHash: text('client_secret_hash'),
    name: text('name').notNull(),
    redirectUris: jsonb('redirect_uris').$type<string[]>().notNull().default([]),
    allowedScopes: jsonb('allowed_scopes').$type<string[]>().notNull().default([]),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex('oauth_clients_client_id_idx').on(t.clientId)]
)

export const oauthAuthCodes = pgTable(
  'oauth_auth_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    codeHash: text('code_hash').notNull(),
    clientId: text('client_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex('oauth_auth_codes_hash_idx').on(t.codeHash)]
)

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull(),
    tokenType: text('token_type').notNull(), // 'access' | 'refresh'
    clientId: text('client_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull().default('Agent Token'),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('oauth_tokens_hash_idx').on(t.tokenHash),
    index('oauth_tokens_tenant_idx').on(t.tenantId)
  ]
)

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('api_keys_hash_idx').on(t.keyHash),
    index('api_keys_tenant_idx').on(t.tenantId)
  ]
)

// ── 3. Customers & Interactions ───────────────────────────────────────────────

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    type: text('type').notNull().default('person'), // 'person' | 'organization'
    name: text('name').notNull(),
    companyName: text('company_name'),
    email: text('email'),
    phone: text('phone'),
    address: jsonb('address').$type<AddressJson>().notNull().default({}),
    status: text('status').notNull().default('lead'), // 'lead' | 'active' | 'inactive'
    leadSource: text('lead_source'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    waitingOnOwner: boolean('waiting_on_owner').notNull().default(false),
    notes: text('notes'),
    externalIds: jsonb('external_ids').$type<Record<string, string>>().notNull().default({}),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [
    index('customers_tenant_name_idx').on(t.tenantId, t.name),
    index('customers_tenant_status_idx').on(t.tenantId, t.status)
  ]
)

export const interactions = pgTable(
  'interactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    channel: text('channel').notNull().default('call'), // 'call' | 'walk_in' | 'message' | 'form' | 'email' | 'other'
    direction: text('direction').notNull().default('inbound'), // 'inbound' | 'outbound' | 'internal'
    summary: text('summary').notNull(),
    rawContent: text('raw_content'),
    containsExternalInput: boolean('contains_external_input').notNull().default(false),
    externalRef: text('external_ref'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdByActorType: text('created_by_actor_type').notNull(),
    createdByActorId: text('created_by_actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [index('interactions_tenant_customer_idx').on(t.tenantId, t.customerId)]
)

// ── 4. Catalog & Tenant Attribute Schemas ─────────────────────────────────────

export const catalogAttributeSchemas = pgTable(
  'catalog_attribute_schemas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    itemType: text('item_type').notNull().default('both'), // 'product' | 'service' | 'both'
    fields: jsonb('fields').$type<AttributeFieldDef[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [index('catalog_attr_schemas_tenant_idx').on(t.tenantId)]
)

export const catalogItems = pgTable(
  'catalog_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    type: text('type').notNull().default('product'), // 'product' | 'service'
    sku: text('sku'),
    name: text('name').notNull(),
    description: text('description'),
    unit: text('unit').notNull().default('each'),
    basePriceCents: integer('base_price_cents').notNull().default(0),
    taxable: boolean('taxable').notNull().default(true),
    taxRateBps: integer('tax_rate_bps'),
    attributeSchemaId: uuid('attribute_schema_id').references(() => catalogAttributeSchemas.id),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    trackInventory: boolean('track_inventory').notNull().default(false),
    verified: boolean('verified').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [
    index('catalog_items_tenant_name_idx').on(t.tenantId, t.name),
    index('catalog_items_tenant_sku_idx').on(t.tenantId, t.sku)
  ]
)

// ── 5. Attachments ────────────────────────────────────────────────────────────

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    entityType: text('entity_type').notNull(), // 'quote' | 'invoice' | 'expense' | 'customer' | 'order' | 'general'
    entityId: uuid('entity_id'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    createdByActorType: text('created_by_actor_type').notNull(),
    createdByActorId: text('created_by_actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [index('attachments_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId)]
)

// ── 6. Quotes & Quote Lines ───────────────────────────────────────────────────

export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    quoteNumber: text('quote_number').notNull(),
    baseQuoteNumber: text('base_quote_number').notNull(),
    parentQuoteId: uuid('parent_quote_id'),
    revisionNumber: integer('revision_number').notNull().default(1),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    customerPoNumber: text('customer_po_number'),
    status: text('status').notNull().default('draft'), // 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'superseded'
    validUntil: timestamp('valid_until', { withTimezone: true }),
    notes: text('notes'),
    internalNotes: text('internal_notes'),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    pdfAttachmentId: uuid('pdf_attachment_id').references(() => attachments.id),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [
    uniqueIndex('quotes_tenant_number_idx').on(t.tenantId, t.quoteNumber),
    index('quotes_tenant_customer_idx').on(t.tenantId, t.customerId),
    index('quotes_tenant_status_idx').on(t.tenantId, t.status)
  ]
)

export const quoteLines = pgTable(
  'quote_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    lineOrder: integer('line_order').notNull().default(0),
    catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull().default('1'),
    unit: text('unit').notNull().default('each'),
    unitPriceCents: integer('unit_price_cents').notNull().default(0),
    taxable: boolean('taxable').notNull().default(true),
    taxRateBps: integer('tax_rate_bps'),
    lineSubtotalCents: integer('line_subtotal_cents').notNull().default(0),
    lineTaxCents: integer('line_tax_cents').notNull().default(0),
    lineTotalCents: integer('line_total_cents').notNull().default(0),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    unverifiedItem: boolean('unverified_item').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('quote_lines_quote_idx').on(t.quoteId)]
)

// ── 7. Orders & Order Lines ───────────────────────────────────────────────────

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    orderNumber: text('order_number').notNull(),
    quoteId: uuid('quote_id').references(() => quotes.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    customerPoNumber: text('customer_po_number'),
    channel: text('channel').notNull().default('manual'), // 'quote' | 'website' | 'pos' | 'manual' | 'restaurant' | 'other'
    status: text('status').notNull().default('confirmed'), // 'pending' | 'confirmed' | 'in_production' | 'ready' | 'fulfilled' | 'cancelled'
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    notes: text('notes'),
    externalOrderId: text('external_order_id'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [
    uniqueIndex('orders_tenant_number_idx').on(t.tenantId, t.orderNumber),
    index('orders_tenant_customer_idx').on(t.tenantId, t.customerId),
    index('orders_tenant_status_idx').on(t.tenantId, t.status)
  ]
)

export const orderLines = pgTable(
  'order_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    lineOrder: integer('line_order').notNull().default(0),
    catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull().default('1'),
    unit: text('unit').notNull().default('each'),
    unitPriceCents: integer('unit_price_cents').notNull().default(0),
    taxable: boolean('taxable').notNull().default(true),
    taxRateBps: integer('tax_rate_bps'),
    lineSubtotalCents: integer('line_subtotal_cents').notNull().default(0),
    lineTaxCents: integer('line_tax_cents').notNull().default(0),
    lineTotalCents: integer('line_total_cents').notNull().default(0),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('order_lines_order_idx').on(t.orderId)]
)

// ── 8. Production Queue (WorkItems) ───────────────────────────────────────────

export const workItems = pgTable(
  'work_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    orderLineId: uuid('order_line_id').references(() => orderLines.id),
    title: text('title').notNull(),
    description: text('description'),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull().default('1'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    priorityRank: integer('priority_rank').notNull().default(100),
    state: text('state').notNull().default('queued'), // 'queued' | 'in_progress' | 'ready' | 'shipped' | 'picked_up' | 'cancelled'
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [
    index('work_items_tenant_state_idx').on(t.tenantId, t.state),
    index('work_items_tenant_order_idx').on(t.tenantId, t.orderId)
  ]
)

// ── 9. Invoices & Payments ────────────────────────────────────────────────────

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    invoiceNumber: text('invoice_number').notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    quoteId: uuid('quote_id').references(() => quotes.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    status: text('status').notNull().default('draft'), // 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void'
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    balanceDueCents: integer('balance_due_cents').notNull().default(0),
    notes: text('notes'),
    pdfAttachmentId: uuid('pdf_attachment_id').references(() => attachments.id),
    externalAccountingId: text('external_accounting_id'),
    syncedToAccountingAt: timestamp('synced_to_accounting_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [
    uniqueIndex('invoices_tenant_number_idx').on(t.tenantId, t.invoiceNumber),
    index('invoices_tenant_customer_idx').on(t.tenantId, t.customerId),
    index('invoices_tenant_status_idx').on(t.tenantId, t.status)
  ]
)

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    lineOrder: integer('line_order').notNull().default(0),
    catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull().default('1'),
    unit: text('unit').notNull().default('each'),
    unitPriceCents: integer('unit_price_cents').notNull().default(0),
    taxable: boolean('taxable').notNull().default(true),
    taxRateBps: integer('tax_rate_bps'),
    lineSubtotalCents: integer('line_subtotal_cents').notNull().default(0),
    lineTaxCents: integer('line_tax_cents').notNull().default(0),
    lineTotalCents: integer('line_total_cents').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId)]
)

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    method: text('method').notNull().default('other'), // 'check' | 'cash' | 'card' | 'stripe' | 'ach' | 'other'
    amountCents: integer('amount_cents').notNull(),
    reference: text('reference'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    externalPaymentId: text('external_payment_id'),
    syncedToAccountingAt: timestamp('synced_to_accounting_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [
    index('payments_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
    index('payments_tenant_customer_idx').on(t.tenantId, t.customerId)
  ]
)

// ── 10. Inventory & Append-Only Stock Movements ───────────────────────────────

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => catalogItems.id),
    quantityOnHand: integer('quantity_on_hand').notNull().default(0),
    reorderPoint: integer('reorder_point').notNull().default(0),
    location: text('location'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [uniqueIndex('inventory_items_tenant_catalog_idx').on(t.tenantId, t.catalogItemId)]
)

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id),
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => catalogItems.id),
    movementType: text('movement_type').notNull(), // 'receipt' | 'sale' | 'adjustment' | 'production_use'
    status: text('status').notNull().default('draft'), // 'draft' | 'approved' | 'rejected'
    quantityDelta: integer('quantity_delta').notNull(),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    reason: text('reason'),
    approvedByActorType: text('approved_by_actor_type'),
    approvedByActorId: text('approved_by_actor_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdByActorType: text('created_by_actor_type').notNull(),
    createdByActorId: text('created_by_actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('stock_movements_tenant_item_idx').on(t.tenantId, t.inventoryItemId),
    index('stock_movements_tenant_status_idx').on(t.tenantId, t.status)
  ]
)

// ── 11. Expenses ──────────────────────────────────────────────────────────────

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    vendor: text('vendor').notNull(),
    expenseDate: text('expense_date').notNull(), // YYYY-MM-DD
    category: text('category').notNull().default('supplies'),
    status: text('status').notNull().default('draft'), // 'draft' | 'approved' | 'rejected' | 'void'
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    lineItems: jsonb('line_items').$type<ExpenseLineItem[]>().notNull().default([]),
    receiptAttachmentId: uuid('receipt_attachment_id').references(() => attachments.id),
    fingerprint: text('fingerprint').notNull(),
    notes: text('notes'),
    externalAccountingId: text('external_accounting_id'),
    syncedToAccountingAt: timestamp('synced_to_accounting_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [
    index('expenses_tenant_status_idx').on(t.tenantId, t.status),
    index('expenses_tenant_fingerprint_idx').on(t.tenantId, t.fingerprint)
  ]
)

// ── 12. Immutable Audit Log ───────────────────────────────────────────────────

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    actorType: text('actor_type').notNull(), // 'operator' | 'user' | 'agent' | 'integration' | 'system'
    actorId: text('actor_id').notNull(),
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    beforeState: jsonb('before_state').$type<Record<string, unknown> | null>(),
    afterState: jsonb('after_state').$type<Record<string, unknown> | null>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId)
  ]
)

// ── 13. Idempotency Keys ──────────────────────────────────────────────────────

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
  },
  (t) => [uniqueIndex('idempotency_tenant_key_idx').on(t.tenantId, t.key, t.method, t.path)]
)

// ── 14. Webhooks & Integrations ───────────────────────────────────────────────

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  (t) => [index('webhook_endpoints_tenant_idx').on(t.tenantId)]
)

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'delivered' | 'failed'
    attempts: integer('attempts').notNull().default(0),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('webhook_deliveries_tenant_idx').on(t.tenantId, t.createdAt)]
)

export const integrationConfigs = pgTable(
  'integration_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    provider: text('provider').notNull(), // 'website' | 'stripe_connect' | 'email' | 'chatwoot' | 'quickbooks'
    isEnabled: boolean('is_enabled').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    webhookSecret: text('webhook_secret'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex('integration_configs_tenant_provider_idx').on(t.tenantId, t.provider)]
)

// ── 15. Tenant-Isolated Chatwoot Contacts & Conversations ─────────────────────

export const chatwootContacts = pgTable(
  'chatwoot_contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    externalContactId: text('external_contact_id').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('chatwoot_contacts_tenant_ext_idx').on(t.tenantId, t.externalContactId),
    index('chatwoot_contacts_tenant_idx').on(t.tenantId)
  ]
)

export const chatwootConversations = pgTable(
  'chatwoot_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    externalConversationId: text('external_conversation_id').notNull(),
    chatwootContactId: uuid('chatwoot_contact_id')
      .notNull()
      .references(() => chatwootContacts.id),
    inboxName: text('inbox_name').notNull().default('Default Inbox'),
    channel: text('channel').notNull().default('web'),
    status: text('status').notNull().default('open'), // 'open' | 'pending' | 'resolved' | 'snoozed'
    unreadCount: integer('unread_count').notNull().default(0),
    lastMessagePreview: text('last_message_preview'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    messages: jsonb('messages')
      .$type<Array<{ id: string; direction: 'incoming' | 'outgoing'; sender: string; content: string; sentAt: string }>>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('chatwoot_convos_tenant_ext_idx').on(t.tenantId, t.externalConversationId),
    index('chatwoot_convos_tenant_status_idx').on(t.tenantId, t.status)
  ]
)

// ── 16. Quote Email Copy Send Log ─────────────────────────────────────────────

export const quoteEmailSends = pgTable(
  'quote_email_sends',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    quoteVersion: integer('quote_version').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    trigger: text('trigger').notNull(), // 'approve' | 'manual'
    recipient: text('recipient').notNull(),
    sender: text('sender').notNull(),
    replyTo: text('reply_to'),
    resendMessageId: text('resend_message_id'),
    status: text('status').notNull(), // 'sent' | 'failed' | 'skipped'
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('quote_email_sends_tenant_quote_idx').on(t.tenantId, t.quoteId),
    index('quote_email_sends_rate_idx').on(t.tenantId, t.quoteId, t.userId, t.trigger, t.createdAt),
    uniqueIndex('quote_email_sends_idem_idx').on(t.tenantId, t.idempotencyKey)
  ]
)
