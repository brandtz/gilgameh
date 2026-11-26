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
  { name: 'find_customer', requiredScopes: ['customers:read'], category: 'Customers' },
  { name: 'create_customer', requiredScopes: ['customers:write'], category: 'Customers' },
  { name: 'log_interaction', requiredScopes: ['customers:write'], category: 'Customers' },
  { name: 'search_catalog', requiredScopes: ['catalog:read'], category: 'Catalog' },
  { name: 'create_catalog_item', requiredScopes: ['catalog:write'], category: 'Catalog', notes: 'Always sets verified=false for agents' },
  { name: 'create_draft_quote', requiredScopes: ['quotes:draft'], category: 'Quotes' },
  { name: 'update_draft_quote', requiredScopes: ['quotes:draft'], category: 'Quotes' },
  { name: 'get_quote', requiredScopes: ['quotes:read'], category: 'Quotes' },
  {
    name: 'approve_quote',
    requiredScopes: ['quotes:approve'],
    category: 'Quotes',
    requiresTenantAgentApproveOptIn: true,
    notes: 'Requires both quotes:approve scope AND tenant allowAgentApproveScopes=true. Emails PDF copy to signed-in user only.'
  },
  {
    name: 'email_quote_copy',
    requiredScopes: ['quotes:read'],
    category: 'Quotes',
    notes: 'Sends finalized quote PDF strictly to signed-in user email only (rate-limited 3/hr/quote/user). Future customer send needs quotes:send.'
  },
  { name: 'list_open_quotes', requiredScopes: ['quotes:read'], category: 'Quotes' },
  { name: 'list_production_queue', requiredScopes: ['production:read'], category: 'Production' },
  { name: 'update_work_item', requiredScopes: ['production:write'], category: 'Production' },
  { name: 'list_unpaid_invoices', requiredScopes: ['invoices:read'], category: 'Invoices & Payments' },
  { name: 'record_payment', requiredScopes: ['invoices:draft'], category: 'Invoices & Payments' },
  { name: 'create_draft_expense', requiredScopes: ['expenses:draft'], category: 'Expenses', notes: 'Requires receiptAttachmentId for agents' },
  {
    name: 'approve_expense',
    requiredScopes: ['expenses:approve'],
    category: 'Expenses',
    requiresTenantAgentApproveOptIn: true,
    notes: 'Requires both expenses:approve scope AND tenant allowAgentApproveScopes=true.'
  },
  {
    name: 'adjust_inventory',
    requiredScopes: ['inventory:adjust'],
    category: 'Inventory',
    requiresTenantAgentApproveOptIn: true,
    notes: 'Drafting requires inventory:adjust; approving requires tenant allowAgentApproveScopes=true.'
  },
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
