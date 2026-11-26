import { z } from 'zod'
import { ALL_SCOPES } from '../utils/scopes'

export const scopeEnum = z.enum(ALL_SCOPES)

export const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(30).optional(),
  country: z.string().max(10).optional()
})

// ── Auth & OAuth ──────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
})

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(scopeEnum).min(1),
  expiresInDays: z.number().int().min(1).max(3650).optional()
})

export const oauthRegisterClientSchema = z.object({
  client_name: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().url()).min(1),
  scope: z.string().optional()
})

export const oauthApproveSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(32).max(128),
  code_challenge_method: z.literal('S256').default('S256'),
  scope: z.string().optional(),
  state: z.string().optional(),
  tenant_id: z.string().uuid().optional()
})

export const oauthTokenSchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  code: z.string().optional(),
  redirect_uri: z.string().url().optional(),
  client_id: z.string().min(1),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional()
})

// ── Tenant ────────────────────────────────────────────────────────────────────

export const createTenantSchema = z.object({
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(160),
  legalName: z.string().max(200).optional(),
  contactName: z.string().max(160).optional(),
  website: z.string().url().optional().or(z.literal('')),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  address: addressSchema.optional()
})

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  legalName: z.string().max(200).optional().nullable(),
  contactName: z.string().max(160).optional().nullable(),
  website: z.string().url().optional().nullable().or(z.literal('')),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(40).optional().nullable(),
  address: addressSchema.optional(),
  branding: z
    .object({
      logoUrl: z.string().url().optional().or(z.literal('')),
      logoDataUrl: z
        .string()
        .max(2_000_000)
        .refine(
          (val) => !val || /^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(val),
          'Logo must be a PNG or JPEG image'
        )
        .optional()
        .or(z.literal('')),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      headerText: z.string().max(200).optional(),
      footerText: z.string().max(500).optional(),
      paymentInstructions: z.string().max(1000).optional(),
      quoteTerms: z.string().max(1000).optional(),
      invoiceTerms: z.string().max(1000).optional()
    })
    .optional(),
  numberingSettings: z
    .object({
      quotePrefix: z.string().min(1).max(10),
      nextQuoteNumber: z.number().int().min(1),
      orderPrefix: z.string().min(1).max(10),
      nextOrderNumber: z.number().int().min(1),
      invoicePrefix: z.string().min(1).max(10),
      nextInvoiceNumber: z.number().int().min(1)
    })
    .optional(),
  taxSettings: z
    .object({
      defaultTaxRateBps: z.number().int().min(0).max(5000),
      taxLabel: z.string().min(1).max(40),
      taxId: z.string().max(60).optional()
    })
    .optional(),
  settings: z
    .object({
      allowAgentApproveScopes: z.boolean(),
      defaultQuoteValidDays: z.number().int().min(1).max(365),
      defaultPaymentTermsDays: z.number().int().min(0).max(365),
      currency: z.string().length(3)
    })
    .optional()
})

// ── Customers & Interactions ──────────────────────────────────────────────────

export const createCustomerSchema = z.object({
  type: z.enum(['person', 'organization']).default('person'),
  name: z.string().min(1).max(200),
  companyName: z.string().max(200).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(40).optional().nullable(),
  address: addressSchema.optional(),
  status: z.enum(['lead', 'active', 'inactive']).default('lead'),
  leadSource: z.string().max(100).optional().nullable(),
  utmSource: z.string().max(100).optional().nullable(),
  utmMedium: z.string().max(100).optional().nullable(),
  utmCampaign: z.string().max(100).optional().nullable(),
  waitingOnOwner: z.boolean().default(false),
  notes: z.string().max(4000).optional().nullable(),
  externalIds: z.record(z.string()).optional()
})

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  version: z.number().int().min(1).optional()
})

export const createInteractionSchema = z.object({
  customerId: z.string().uuid(),
  channel: z.enum(['call', 'walk_in', 'message', 'form', 'email', 'other']).default('call'),
  direction: z.enum(['inbound', 'outbound', 'internal']).default('inbound'),
  summary: z.string().min(1).max(2000),
  rawContent: z.string().max(10000).optional().nullable(),
  containsExternalInput: z.boolean().optional(),
  externalRef: z.string().max(200).optional().nullable(),
  occurredAt: z.string().datetime().optional()
})

// ── Catalog & Attribute Schemas ───────────────────────────────────────────────

export const attributeFieldDefSchema = z.object({
  name: z.string().min(1).max(60).regex(/^[a-zA-Z0-9_]+$/),
  label: z.string().min(1).max(100),
  type: z.enum(['string', 'number', 'boolean', 'enum']),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  unit: z.string().max(30).optional()
})

export const createAttributeSchemaSchema = z.object({
  name: z.string().min(1).max(120),
  itemType: z.enum(['product', 'service', 'both']).default('both'),
  fields: z.array(attributeFieldDefSchema).min(1)
})

export const createCatalogItemSchema = z.object({
  type: z.enum(['product', 'service']).default('product'),
  sku: z.string().max(80).optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  unit: z.string().min(1).max(40).default('each'),
  basePriceCents: z.number().int().min(0),
  taxable: z.boolean().default(true),
  taxRateBps: z.number().int().min(0).max(5000).optional().nullable(),
  attributeSchemaId: z.string().uuid().optional().nullable(),
  attributes: z.record(z.unknown()).default({}),
  trackInventory: z.boolean().default(false),
  verified: z.boolean().optional(),
  initialQuantityOnHand: z.number().int().min(0).optional(),
  reorderPoint: z.number().int().min(0).optional()
})

export const updateCatalogItemSchema = createCatalogItemSchema.partial().extend({
  isActive: z.boolean().optional(),
  version: z.number().int().min(1).optional()
})

// ── Quotes ────────────────────────────────────────────────────────────────────

export const documentLineInputSchema = z.object({
  catalogItemId: z.string().uuid().optional().nullable(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(40).default('each'),
  unitPriceCents: z.number().int().min(0),
  taxable: z.boolean().optional(),
  taxRateBps: z.number().int().min(0).max(5000).optional().nullable(),
  attributes: z.record(z.unknown()).optional(),
  unverifiedItem: z.boolean().optional(),
  // Optional client-supplied math to verify server-side
  lineSubtotalCents: z.number().int().optional(),
  lineTaxCents: z.number().int().optional(),
  lineTotalCents: z.number().int().optional()
})

export const createQuoteSchema = z.object({
  customerId: z.string().uuid(),
  customerPoNumber: z.string().max(100).optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  internalNotes: z.string().max(4000).optional().nullable(),
  taxRateBps: z.number().int().min(0).max(5000).optional(),
  lines: z.array(documentLineInputSchema).min(1),
  // Optional client-supplied totals to verify server-side
  subtotalCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  totalCents: z.number().int().optional()
})

export const updateQuoteSchema = z.object({
  version: z.number().int().min(1),
  customerPoNumber: z.string().max(100).optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  internalNotes: z.string().max(4000).optional().nullable(),
  taxRateBps: z.number().int().min(0).max(5000).optional(),
  lines: z.array(documentLineInputSchema).min(1).optional(),
  subtotalCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  totalCents: z.number().int().optional()
})

export const approveVersionSchema = z.object({
  version: z.number().int().min(1),
  sendEmail: z.boolean().optional()
})

// ── Orders & Production ───────────────────────────────────────────────────────

export const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  quoteId: z.string().uuid().optional().nullable(),
  customerPoNumber: z.string().max(100).optional().nullable(),
  channel: z.enum(['quote', 'website', 'pos', 'manual', 'restaurant', 'other']).default('manual'),
  notes: z.string().max(4000).optional().nullable(),
  externalOrderId: z.string().max(200).optional().nullable(),
  lines: z.array(documentLineInputSchema).min(1),
  subtotalCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  totalCents: z.number().int().optional()
})

export const updateOrderStatusSchema = z.object({
  version: z.number().int().min(1),
  status: z.enum(['pending', 'confirmed', 'in_production', 'ready', 'fulfilled', 'cancelled']),
  notes: z.string().max(2000).optional().nullable()
})

export const updateWorkItemSchema = z.object({
  version: z.number().int().min(1),
  state: z.enum(['queued', 'in_progress', 'ready', 'shipped', 'picked_up', 'cancelled']).optional(),
  priorityRank: z.number().int().min(1).max(10000).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable()
})

// ── Invoices & Payments ───────────────────────────────────────────────────────

export const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  orderId: z.string().uuid().optional().nullable(),
  quoteId: z.string().uuid().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  taxRateBps: z.number().int().min(0).max(5000).optional(),
  lines: z.array(documentLineInputSchema).min(1),
  subtotalCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  totalCents: z.number().int().optional()
})

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  method: z.enum(['check', 'cash', 'card', 'stripe', 'ach', 'other']),
  amountCents: z.number().int().positive(),
  reference: z.string().max(200).optional().nullable(),
  paidAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional().nullable(),
  externalPaymentId: z.string().max(200).optional().nullable()
})

// ── Inventory ─────────────────────────────────────────────────────────────────

export const createStockAdjustmentSchema = z.object({
  catalogItemId: z.string().uuid(),
  movementType: z.enum(['receipt', 'sale', 'adjustment', 'production_use']).default('adjustment'),
  quantityDelta: z.number().int().refine((n) => n !== 0, 'quantityDelta must be non-zero'),
  reason: z.string().min(1).max(500),
  referenceType: z.string().max(60).optional(),
  referenceId: z.string().uuid().optional()
})

// ── Expenses ──────────────────────────────────────────────────────────────────

export const expenseLineSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().positive().default(1),
  unitPriceCents: z.number().int().min(0),
  lineTotalCents: z.number().int().min(0).optional(),
  category: z.string().max(80).optional()
})

export const createExpenseSchema = z.object({
  vendor: z.string().min(1).max(200),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().min(1).max(80).default('supplies'),
  taxCents: z.number().int().min(0).default(0),
  lineItems: z.array(expenseLineSchema).min(1),
  subtotalCents: z.number().int().optional(),
  totalCents: z.number().int().optional(),
  receiptAttachmentId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  allowDuplicate: z.boolean().optional()
})

// ── Webhooks & Integrations ───────────────────────────────────────────────────

export const createWebhookEndpointSchema = z.object({
  url: z.string().url(),
  events: z
    .array(z.enum(['order.created', 'order.status_changed', 'quote.accepted', 'invoice.paid']))
    .min(1),
  secret: z.string().min(16).max(200).optional()
})

export const updateIntegrationConfigSchema = z.object({
  isEnabled: z.boolean(),
  config: z.record(z.unknown()).default({}),
  webhookSecret: z.string().min(8).max(200).optional().nullable()
})

// ── Profile & Team RBAC ───────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional().nullable(),
  title: z.string().max(120).optional().nullable()
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'New password must be at least 10 characters').max(128)
})

export const tenantRoleEnum = z.enum(['owner', 'manager', 'staff', 'viewer', 'operator'])

export const createTenantMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(160),
  phone: z.string().max(40).optional().nullable(),
  title: z.string().max(120).optional().nullable(),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128).optional(),
  role: tenantRoleEnum.default('staff'),
  scopes: z.array(scopeEnum).optional().nullable()
})

export const updateTenantMemberSchema = z.object({
  role: tenantRoleEnum.optional(),
  scopes: z.array(scopeEnum).optional().nullable(),
  isActive: z.boolean().optional()
})

// ── Chatwoot ──────────────────────────────────────────────────────────────────

export const chatwootConfigSchema = z.object({
  isEnabled: z.boolean(),
  baseUrl: z.string().url().optional().or(z.literal('')),
  accountId: z.string().max(40).optional().or(z.literal('')),
  apiToken: z.string().max(300).optional().or(z.literal('')),
  webhookSecret: z.string().min(8).max(200).optional().nullable()
})

export const chatwootReplySchema = z.object({
  content: z.string().min(1).max(5000)
})
