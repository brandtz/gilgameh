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
    legalName?: string
    email?: string
    phone?: string
    branding: { primaryColor: string; accentColor: string; footerText?: string; logoUrl?: string }
    taxSettings: { defaultTaxRateBps: number; taxLabel: string }
    settings: { allowAgentApproveScopes: boolean; defaultQuoteValidDays: number; defaultPaymentTermsDays: number; currency: string }
    numberingSettings: { quotePrefix: string; nextQuoteNumber: number; orderPrefix: string; nextOrderNumber: number; invoicePrefix: string; nextInvoiceNumber: number }
  }
  tenants: Array<{ id: string; slug: string; name: string }>
}

export function useAuthState() {
  const auth = useState<AuthMeResponse | null>('bo_auth', () => null)
  const activeTenantId = useState<string>('bo_active_tenant_id', () => '')
  const toast = useState<{ type: 'ok' | 'err'; message: string } | null>('bo_toast', () => null)

  function showToast(message: string, type: 'ok' | 'err' = 'ok') {
    toast.value = { type, message }
    setTimeout(() => {
      if (toast.value?.message === message) toast.value = null
    }, 4500)
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
      if (!activeTenantId.value) {
        activeTenantId.value = res.data.tenant.id
      }
      return res.data
    } catch {
      auth.value = null
      return null
    }
  }

  async function logout() {
    await $fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' })
    auth.value = null
    activeTenantId.value = ''
    await navigateTo('/login')
  }

  return { auth, activeTenantId, toast, showToast, apiFetch, loadMe, logout }
}

export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
  const value = typeof cents === 'number' ? cents / 100 : 0
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
