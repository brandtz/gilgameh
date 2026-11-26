export interface AuthMeResponse {
  actor: {
    actorType: string
    actorId: string
    actorLabel: string
    role?: string
    tenantId: string
    scopes: string[]
  }
  tenant: {
    id: string
    slug: string
    name: string
    legalName?: string | null
    contactName?: string | null
    website?: string | null
    email?: string | null
    phone?: string | null
    address?: {
      line1?: string
      line2?: string
      city?: string
      state?: string
      postalCode?: string
      country?: string
    }
    branding: {
      primaryColor: string
      accentColor: string
      logoUrl?: string
      logoDataUrl?: string
      headerText?: string
      footerText?: string
      paymentInstructions?: string
      quoteTerms?: string
      invoiceTerms?: string
    }
    taxSettings: { defaultTaxRateBps: number; taxLabel: string; taxId?: string }
    settings: {
      allowAgentApproveScopes: boolean
      defaultQuoteValidDays: number
      defaultPaymentTermsDays: number
      currency: string
    }
    numberingSettings: {
      quotePrefix: string
      nextQuoteNumber: number
      orderPrefix: string
      nextOrderNumber: number
      invoicePrefix: string
      nextInvoiceNumber: number
    }
  }
  tenants: Array<{ id: string; slug: string; name: string }>
}

const TENANT_STORAGE_KEY = 'bo_active_tenant_id'

export function useAuthState() {
  const auth = useState<AuthMeResponse | null>('bo_auth', () => null)
  const activeTenantId = useState<string>('bo_active_tenant_id', () => {
    if (import.meta.client) {
      return localStorage.getItem(TENANT_STORAGE_KEY) || ''
    }
    return ''
  })
  const toast = useState<{ type: 'ok' | 'err'; message: string } | null>('bo_toast', () => null)

  function showToast(message: string, type: 'ok' | 'err' = 'ok') {
    toast.value = { type, message }
    setTimeout(() => {
      if (toast.value?.message === message) toast.value = null
    }, 4500)
  }

  function setActiveTenant(tenantId: string) {
    activeTenantId.value = tenantId
    if (import.meta.client) {
      if (tenantId) localStorage.setItem(TENANT_STORAGE_KEY, tenantId)
      else localStorage.removeItem(TENANT_STORAGE_KEY)
    }
  }

  function hasScope(scope: string): boolean {
    const scopes = auth.value?.actor?.scopes || []
    return scopes.includes('*') || scopes.includes(scope)
  }

  async function apiFetch<T = any>(path: string, options: Record<string, any> = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(options.headers || {})
    }
    if (activeTenantId.value) {
      headers['X-Tenant-Id'] = activeTenantId.value
    }
    try {
      return await $fetch<T>(path, {
        ...options,
        headers,
        credentials: 'include'
      })
    } catch (err: any) {
      const msg = err?.data?.error?.message || err?.message || 'Request failed'
      showToast(msg, 'err')
      throw err
    }
  }

  async function loadMe(): Promise<AuthMeResponse | null> {
    try {
      const res = await apiFetch<{ data: AuthMeResponse }>('/api/v1/auth/me')
      auth.value = res.data
      const allowedIds = new Set(res.data.tenants.map((t) => t.id))
      if (!activeTenantId.value || !allowedIds.has(activeTenantId.value)) {
        setActiveTenant(res.data.tenant.id)
      }
      return res.data
    } catch {
      if (activeTenantId.value) {
        setActiveTenant('')
        try {
          const retry = await $fetch<{ data: AuthMeResponse }>('/api/v1/auth/me', {
            credentials: 'include'
          })
          auth.value = retry.data
          setActiveTenant(retry.data.tenant.id)
          return retry.data
        } catch {
          auth.value = null
          return null
        }
      }
      auth.value = null
      return null
    }
  }

  async function selectBusiness(tenantId: string) {
    setActiveTenant(tenantId)
    await loadMe()
    await navigateTo('/')
  }

  async function logout() {
    await $fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' })
    auth.value = null
    setActiveTenant('')
    await navigateTo('/login')
  }

  return {
    auth,
    activeTenantId,
    toast,
    showToast,
    setActiveTenant,
    hasScope,
    apiFetch,
    loadMe,
    selectBusiness,
    logout
  }
}

export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
  const value = typeof cents === 'number' ? cents / 100 : 0
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
