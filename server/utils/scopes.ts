export const ALL_SCOPES = [
  'customers:read',
  'customers:write',
  'catalog:read',
  'catalog:write',
  'quotes:read',
  'quotes:draft',
  'quotes:approve',
  'orders:read',
  'orders:write',
  'invoices:read',
  'invoices:draft',
  'invoices:approve',
  'production:read',
  'production:write',
  'expenses:read',
  'expenses:draft',
  'expenses:approve',
  'inventory:read',
  'inventory:adjust',
  'webhooks:manage',
  'integrations:manage',
  'audit:read',
  'tenant:manage'
] as const

export type Scope = (typeof ALL_SCOPES)[number]

export const DEFAULT_AGENT_SCOPES: Scope[] = [
  'customers:read',
  'customers:write',
  'catalog:read',
  'catalog:write',
  'quotes:read',
  'quotes:draft',
  'orders:read',
  'orders:write',
  'invoices:read',
  'invoices:draft',
  'production:read',
  'production:write',
  'expenses:read',
  'expenses:draft',
  'inventory:read'
]

export const APPROVE_SCOPES: Scope[] = [
  'quotes:approve',
  'invoices:approve',
  'expenses:approve',
  'inventory:adjust'
]

export const MANAGER_SCOPES: Scope[] = [
  'customers:read',
  'customers:write',
  'catalog:read',
  'catalog:write',
  'quotes:read',
  'quotes:draft',
  'quotes:approve',
  'orders:read',
  'orders:write',
  'invoices:read',
  'invoices:draft',
  'invoices:approve',
  'production:read',
  'production:write',
  'expenses:read',
  'expenses:draft',
  'expenses:approve',
  'inventory:read',
  'inventory:adjust',
  'audit:read'
]

export const STAFF_SCOPES: Scope[] = [
  'customers:read',
  'customers:write',
  'catalog:read',
  'catalog:write',
  'quotes:read',
  'quotes:draft',
  'orders:read',
  'orders:write',
  'invoices:read',
  'invoices:draft',
  'production:read',
  'production:write',
  'expenses:read',
  'expenses:draft',
  'inventory:read',
  'inventory:adjust'
]

export const VIEWER_SCOPES: Scope[] = [
  'customers:read',
  'catalog:read',
  'quotes:read',
  'orders:read',
  'invoices:read',
  'production:read',
  'expenses:read',
  'inventory:read'
]

export function getScopesForRole(role: string): Scope[] {
  if (role === 'bwe_operator' || role === 'operator' || role === 'tenant_owner' || role === 'owner') {
    return [...ALL_SCOPES]
  }
  if (role === 'manager') {
    return [...MANAGER_SCOPES]
  }
  if (role === 'viewer') {
    return [...VIEWER_SCOPES]
  }
  return [...STAFF_SCOPES]
}

export function hasAllScopes(granted: readonly string[], required: readonly Scope[]): boolean {
  if (granted.includes('*')) return true
  const set = new Set(granted)
  return required.every((s) => set.has(s))
}

export function isValidScope(scope: string): scope is Scope {
  return (ALL_SCOPES as readonly string[]).includes(scope)
}
