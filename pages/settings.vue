<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">Business Profile, PDF Templates &amp; Security</h1>
      <p class="text-sm text-slate-500">
        All settings below are strictly isolated to <strong>{{ tenant?.name || 'this business' }}</strong> and apply to all users in this workspace only.
      </p>
    </div>

    <!-- 1. Business / Tenant Profile -->
    <div v-if="tenant" class="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <div class="font-semibold text-base text-slate-900">Business Profile &amp; Primary Contact</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <label class="block text-xs text-slate-500 mb-1">Business Name</label>
          <input v-model="tenant.name" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Legal Entity Name</label>
          <input v-model="tenant.legalName" placeholder="e.g. Studio 37 Woodworking LLC" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Primary Contact / Owner Name</label>
          <input v-model="tenant.contactName" placeholder="e.g. Drew" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Business Email</label>
          <input v-model="tenant.email" type="email" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Business Phone</label>
          <input v-model="tenant.phone" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Website</label>
          <input v-model="tenant.website" placeholder="https://studio37customdesigns.com" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Street Address</label>
          <input v-model="tenant.address.line1" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-xs text-slate-500 mb-1">City</label>
            <input v-model="tenant.address.city" class="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-xs text-slate-500 mb-1">State</label>
            <input v-model="tenant.address.state" class="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-xs text-slate-500 mb-1">Postal Code</label>
            <input v-model="tenant.address.postalCode" class="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-xs text-slate-500 mb-1">Country</label>
            <input v-model="tenant.address.country" placeholder="US" class="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>
      </div>
    </div>

    <!-- 2. PDF Quote & Invoice Template Branding -->
    <div v-if="tenant" class="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
      <div class="font-semibold text-base text-slate-900">PDF Quote &amp; Invoice Template</div>

      <!-- Logo Upload -->
      <div class="flex flex-wrap items-center gap-4 p-4 rounded-lg bg-slate-50 border border-slate-200">
        <div class="h-16 w-28 rounded border bg-white flex items-center justify-center overflow-hidden p-1">
          <img
            v-if="tenant.branding.logoDataUrl"
            :src="tenant.branding.logoDataUrl"
            alt="Business Logo Preview"
            class="max-h-full max-w-full object-contain"
          />
          <span v-else class="text-xs text-slate-400">No Logo</span>
        </div>
        <div class="space-y-1.5 text-sm">
          <div class="font-medium text-slate-800">Upload Business Logo (PNG or JPEG, max 1MB)</div>
          <div class="flex items-center gap-2">
            <input type="file" accept="image/png,image/jpeg" class="text-xs" @change="onLogoSelected" />
            <button
              v-if="tenant.branding.logoDataUrl"
              type="button"
              class="text-xs text-red-600 underline"
              @click="tenant.branding.logoDataUrl = ''"
            >
              Remove Logo
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div class="flex gap-4">
          <div class="flex-1">
            <label class="block text-xs text-slate-500 mb-1">Primary Header Color</label>
            <div class="flex items-center gap-2">
              <input v-model="tenant.branding.primaryColor" type="color" class="h-9 w-12 rounded border" />
              <input v-model="tenant.branding.primaryColor" class="flex-1 border rounded-lg px-3 py-2 font-mono text-xs" />
            </div>
          </div>
          <div class="flex-1">
            <label class="block text-xs text-slate-500 mb-1">Accent Color</label>
            <div class="flex items-center gap-2">
              <input v-model="tenant.branding.accentColor" type="color" class="h-9 w-12 rounded border" />
              <input v-model="tenant.branding.accentColor" class="flex-1 border rounded-lg px-3 py-2 font-mono text-xs" />
            </div>
          </div>
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Custom Header Subtitle</label>
          <input v-model="tenant.branding.headerText" placeholder="e.g. Custom Woodworking & Millwork" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs text-slate-500 mb-1">Payment Instructions (e.g. "Make checks payable to...")</label>
          <textarea
            v-model="tenant.branding.paymentInstructions"
            rows="2"
            placeholder="Make checks payable to Studio 37 Woodworking LLC. Cash or check preferred."
            class="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Default Quote Terms</label>
          <textarea v-model="tenant.branding.quoteTerms" rows="2" placeholder="Valid for 30 days. 50% deposit due to schedule production." class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Default Invoice Terms</label>
          <textarea v-model="tenant.branding.invoiceTerms" rows="2" placeholder="Payment due upon receipt." class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs text-slate-500 mb-1">Custom PDF Footer Text</label>
          <input v-model="tenant.branding.footerText" placeholder="Thank you for your business!" class="w-full border rounded-lg px-3 py-2" />
        </div>
      </div>

      <!-- Tax & Security Controls -->
      <div class="pt-4 border-t grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <label class="block text-xs text-slate-500 mb-1">Default Tax Rate (basis points, e.g. 825 = 8.25%)</label>
          <input v-model.number="tenant.taxSettings.defaultTaxRateBps" type="number" min="0" max="5000" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Tax Label</label>
          <input v-model="tenant.taxSettings.taxLabel" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-2 border rounded-lg px-3 py-2 w-full bg-slate-50">
            <input v-model="tenant.settings.allowAgentApproveScopes" type="checkbox" />
            <span class="text-xs font-medium">Allow AI Agent Approve Scopes</span>
          </label>
        </div>
      </div>

      <div class="flex justify-end">
        <button class="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg text-sm font-medium" @click="saveTenant">
          Save Business &amp; PDF Settings
        </button>
      </div>
    </div>

    <!-- 3. API Keys -->
    <div class="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div class="font-semibold">Integration API Keys</div>
      <form class="flex gap-2" @submit.prevent="createKey">
        <input v-model="keyName" required placeholder="Key label (e.g. Studio 37 Website)" class="flex-1 border rounded-lg px-3 py-2 text-sm" />
        <button type="submit" class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">Issue Key</button>
      </form>
      <div v-if="createdPlainKey" class="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs font-mono break-all">
        Copy now (shown once): <strong>{{ createdPlainKey }}</strong>
      </div>
      <div class="divide-y divide-slate-100 text-sm">
        <div v-for="k in apiKeys" :key="k.id" class="py-2.5 flex justify-between items-center">
          <div>
            <span class="font-medium">{{ k.name }}</span>
            <span class="ml-2 font-mono text-xs text-slate-500">{{ k.keyPrefix }}...</span>
          </div>
          <span v-if="k.revokedAt" class="text-xs text-red-600">Revoked</span>
          <button v-else class="text-xs text-red-600 underline" @click="revokeKey(k.id)">Revoke</button>
        </div>
      </div>
    </div>

    <!-- 4. MCP OAuth Tokens -->
    <div class="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <div class="font-semibold">Authorized MCP AI Agent Tokens (OAuth 2.1)</div>
      <div class="text-xs text-slate-500">
        MCP Endpoint: <code class="bg-slate-100 px-1.5 py-0.5 rounded">/api/mcp</code> ·
        OAuth Discovery: <code class="bg-slate-100 px-1.5 py-0.5 rounded">/.well-known/oauth-authorization-server</code>
      </div>
      <div class="divide-y divide-slate-100 text-sm">
        <div v-for="t in oauthTokens" :key="t.id" class="py-2.5 flex justify-between items-center">
          <div>
            <div class="font-medium">{{ t.name }} <span class="text-xs text-slate-400">({{ t.clientId }})</span></div>
            <div class="text-xs text-slate-500">{{ (t.scopes || []).join(', ') }}</div>
          </div>
          <span v-if="t.revokedAt" class="text-xs text-red-600">Revoked</span>
          <button v-else class="text-xs text-red-600 underline" @click="revokeToken(t.id)">Revoke</button>
        </div>
        <div v-if="oauthTokens.length === 0" class="py-4 text-xs text-slate-400">No active agent tokens.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { apiFetch, loadMe, showToast } = useAuthState()
const tenant = ref<any>(null)
const apiKeys = ref<any[]>([])
const oauthTokens = ref<any[]>([])
const keyName = ref('')
const createdPlainKey = ref('')

async function load() {
  const [tRes, kRes, oRes] = await Promise.all([
    apiFetch<{ data: any }>('/api/v1/tenant'),
    apiFetch<{ data: any[] }>('/api/v1/auth/api-keys'),
    apiFetch<{ data: any[] }>('/api/v1/auth/tokens')
  ])
  const t = tRes.data
  t.address = t.address || {}
  t.branding = {
    primaryColor: '#1f2937',
    accentColor: '#b45309',
    logoDataUrl: '',
    headerText: '',
    footerText: '',
    paymentInstructions: '',
    quoteTerms: '',
    invoiceTerms: '',
    ...(t.branding || {})
  }
  tenant.value = t
  apiKeys.value = kRes.data
  oauthTokens.value = oRes.data
}

function onLogoSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    showToast('Logo must be a PNG or JPEG image', 'err')
    return
  }
  if (file.size > 1_000_000) {
    showToast('Logo file must be under 1MB', 'err')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string' && tenant.value) {
      tenant.value.branding.logoDataUrl = reader.result
    }
  }
  reader.readAsDataURL(file)
}

async function saveTenant() {
  await apiFetch('/api/v1/tenant', {
    method: 'PATCH',
    body: {
      name: tenant.value.name,
      legalName: tenant.value.legalName || null,
      contactName: tenant.value.contactName || null,
      website: tenant.value.website || null,
      email: tenant.value.email || null,
      phone: tenant.value.phone || null,
      address: tenant.value.address,
      branding: tenant.value.branding,
      taxSettings: tenant.value.taxSettings,
      settings: tenant.value.settings
    }
  })
  await loadMe()
  showToast('Business profile and PDF template saved')
}

async function createKey() {
  const res = await apiFetch<{ data: any }>('/api/v1/auth/api-keys', {
    method: 'POST',
    body: {
      name: keyName.value,
      scopes: ['customers:read', 'customers:write', 'catalog:read', 'catalog:write', 'orders:read', 'orders:write']
    }
  })
  createdPlainKey.value = res.data.key
  keyName.value = ''
  showToast('API key issued')
  await load()
}

async function revokeKey(id: string) {
  await apiFetch(`/api/v1/auth/api-keys/${id}`, { method: 'DELETE' })
  showToast('API key revoked')
  await load()
}

async function revokeToken(id: string) {
  await apiFetch(`/api/v1/auth/tokens/${id}`, { method: 'DELETE' })
  showToast('Agent token revoked')
  await load()
}

onMounted(load)
</script>
