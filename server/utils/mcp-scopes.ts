import { hasAllScopes, type Scope } from './scopes'

export interface McpToolPolicy {
  name: string
  requiredScopes: readonly Scope[]
  category: string
  requiresTenantAgentApproveOptIn?: boolean
  notes?: string
}

/**
 * Admin-only scopes that MUST NEVER be advertised by the MCP protected resource.
 */
export const ADMIN_ONLY_SCOPES: readonly Scope[] = [
  'webhooks:manage',
  'integrations:manage',
  'audit:read',
  'tenant:manage'
]

/**
 * Single source of truth mapping every MCP tool to the exact scope(s) it enforces.
 * Used by:
 * - /.well-known/oauth-protected-resource (and /api/mcp path variant)
 * - /api/mcp 403 insufficient_scope enforcement
 * - server/services/mcp.service.ts tool handlers
 * - docs/mcp-tools.md matrix
 */
export const MCP_TOOL_POLICIES: readonly McpToolPolicy[] = [
  // Customers & Interactions
  { name: 'find_customer', requiredScopes: ['customers:read'], category: 'Customers' },
  { name: 'create_customer', requiredScopes: ['customers:write'], category: 'Customers' },
  { name: 'update_customer', requiredScopes: ['customers:write'], category: 'Customers', notes: 'Updates contact info, status, notes, or waitingOnOwner flag' },
  { name: 'list_customers_waiting', requiredScopes: ['customers:read'], category: 'Customers', notes: 'Lists all customers flagged waitingOnOwner=true' },
  { name: 'log_interaction', requiredScopes: ['customers:write'], category: 'Customers' },
  { name: 'list_interactions', requiredScopes: ['customers:read'], category: 'Customers', notes: 'Returns summarized history; raw external messages are withheld for prompt safety' },

  // Catalog & Photos/Attachments
  { name: 'search_catalog', requiredScopes: ['catalog:read'], category: 'Catalog' },
  { name: 'create_catalog_item', requiredScopes: ['catalog:write'], category: 'Catalog', notes: 'Always sets verified=false for agents; supports inventory tracking & photo attachmentId' },
  { name: 'update_catalog_item', requiredScopes: ['catalog:write'], category: 'Catalog', notes: 'Updates name, description, price, unit, attributes, active flag, or photo (cannot self-verify)' },
  { name: 'upload_attachment', requiredScopes: ['catalog:write'], category: 'Attachments', notes: 'Uploads base64 photo (e.g. wood slab, product, or expense receipt) for linking to catalog/expenses/quotes' },

  // Quotes
  { name: 'create_draft_quote', requiredScopes: ['quotes:draft'], category: 'Quotes', notes: 'Returns draft Q-number, server-computed totals, and signed shareablePdfUrl' },
  { name: 'update_draft_quote', requiredScopes: ['quotes:draft'], category: 'Quotes', notes: 'Version-pinned draft update; returns updated shareablePdfUrl' },
  { name: 'get_quote', requiredScopes: ['quotes:read'], category: 'Quotes', notes: 'Returns full summary + signed shareablePdfUrl downloadable without login' },
  { name: 'revise_quote', requiredScopes: ['quotes:draft'], category: 'Quotes', notes: 'Creates next revision (e.g. Q-1001-R2) as a new editable draft' },
  {
    name: 'approve_quote',
    requiredScopes: ['quotes:approve'],
    category: 'Quotes',
    requiresTenantAgentApproveOptIn: true,
    notes: 'Requires both quotes:approve scope AND tenant allowAgentApproveScopes=true. Returns signed shareablePdfUrl and emails PDF copy to signed-in user only.'
  },
  {
    name: 'email_quote_copy',
    requiredScopes: ['quotes:read'],
    category: 'Quotes',
    notes: 'Sends finalized quote PDF strictly to signed-in user email only (rate-limited 3/hr/quote/user). Future customer send needs quotes:send.'
  },
  { name: 'list_open_quotes', requiredScopes: ['quotes:read'], category: 'Quotes' },

  // Orders & Production
  { name: 'create_order_from_quote', requiredScopes: ['orders:write'], category: 'Orders', notes: 'Converts sent/accepted quote into Order + Production WorkItems + inventory deduction' },
  { name: 'list_orders', requiredScopes: ['orders:read'], category: 'Orders' },
  { name: 'update_order_status', requiredScopes: ['orders:write'], category: 'Orders', notes: 'Updates order lifecycle status and fires outbound website webhook' },
  { name: 'list_production_queue', requiredScopes: ['production:read'], category: 'Production' },
  { name: 'update_work_item', requiredScopes: ['production:write'], category: 'Production' },

  // Invoices & Payments
  { name: 'create_draft_invoice', requiredScopes: ['invoices:draft'], category: 'Invoices & Payments', notes: 'Creates draft invoice from quoteId, orderId, or standalone lines; returns shareablePdfUrl' },
  { name: 'get_invoice', requiredScopes: ['invoices:read'], category: 'Invoices & Payments', notes: 'Returns invoice details, balance due, payments, and signed shareablePdfUrl' },
  {
    name: 'approve_invoice',
    requiredScopes: ['invoices:approve'],
    category: 'Invoices & Payments',
    requiresTenantAgentApproveOptIn: true,
    notes: 'Requires both invoices:approve scope AND tenant allowAgentApproveScopes=true. Returns signed shareablePdfUrl.'
  },
  { name: 'list_unpaid_invoices', requiredScopes: ['invoices:read'], category: 'Invoices & Payments' },
  { name: 'record_payment', requiredScopes: ['invoices:draft'], category: 'Invoices & Payments' },

  // Inventory
  { name: 'list_inventory', requiredScopes: ['inventory:read'], category: 'Inventory', notes: 'Lists tracked stock levels and low-stock alerts' },
  {
    name: 'adjust_inventory',
    requiredScopes: ['inventory:adjust'],
    category: 'Inventory',
    requiresTenantAgentApproveOptIn: true,
    notes: 'Drafting requires inventory:adjust; approving requires tenant allowAgentApproveScopes=true.'
  },

  // Expenses
  { name: 'create_draft_expense', requiredScopes: ['expenses:draft'], category: 'Expenses', notes: 'Requires receiptAttachmentId (from upload_attachment) for agents' },
  {
    name: 'approve_expense',
    requiredScopes: ['expenses:approve'],
    category: 'Expenses',
    requiresTenantAgentApproveOptIn: true,
    notes: 'Requires both expenses:approve scope AND tenant allowAgentApproveScopes=true.'
  },

  // Summary
  {
    name: 'business_summary',
    requiredScopes: [],
    category: 'Summary',
    notes: 'FLAGGED: Enforces no scope (available to any authenticated tenant token; returns aggregate KPI counts only, no PII).'
  }
]

const ADMIN_SET = new Set<string>(ADMIN_ONLY_SCOPES)

/**
 * Single source of truth for MCP OAuth `scopes_supported`:
 * All scopes required by MCP tools + invoices:approve, strictly excluding admin-only scopes.
 */
export const MCP_SCOPES_SUPPORTED: readonly Scope[] = Array.from(
  new Set<Scope>([
    ...MCP_TOOL_POLICIES.flatMap((t) => t.requiredScopes),
    'quotes:approve',
    'invoices:approve',
    'expenses:approve',
    'inventory:adjust'
  ])
).filter((s) => !ADMIN_SET.has(s))

export const MCP_TOOL_POLICY_MAP = new Map<string, McpToolPolicy>(
  MCP_TOOL_POLICIES.map((p) => [p.name, p])
)

export function getMissingScopesForMcpTool(
  toolName: string,
  grantedScopes: readonly string[]
): Scope[] {
  const policy = MCP_TOOL_POLICY_MAP.get(toolName)
  if (!policy || policy.requiredScopes.length === 0) return []
  if (hasAllScopes(grantedScopes, policy.requiredScopes)) return []
  const granted = new Set(grantedScopes)
  return policy.requiredScopes.filter((s) => !granted.has(s))
}

export function buildOAuthProtectedResourceMetadata(baseUrl: string) {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  return {
    resource: `${cleanBase}/api/mcp`,
    authorization_servers: [cleanBase],
    bearer_methods_supported: ['header'],
    scopes_supported: [...MCP_SCOPES_SUPPORTED]
  }
}

export function buildInsufficientScopeMessage(missingScopes: readonly Scope[]): string {
  const scopeText = missingScopes.join(', ')
  return `This action needs the ${scopeText} permission. Reconnect the Gilgameh connector to grant it.`
}
