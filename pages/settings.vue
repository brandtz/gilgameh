<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">Security, API Keys &amp; MCP Agent Tokens</h1>
      <p class="text-sm text-slate-500">Manage tenant settings, AI agent approval policies, OAuth 2.1 tokens, and integration API keys</p>
    </div>

    <!-- Tenant Policy -->
    <div v-if="tenant" class="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div class="font-semibold">Tenant Security &amp; Branding</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <label class="block text-xs text-slate-500 mb-1">Business Name</label>
          <input v-model="tenant.name" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Default Tax Rate (basis points, e.g. 825 = 8.25%)</label>
          <input v-model.number="tenant.taxSettings.defaultTaxRateBps" type="number" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-2 border rounded-lg px-3 py-2 w-full bg-slate-50">
            <input v-model="tenant.settings.allowAgentApproveScopes" type="checkbox" />
            <span class="text-xs font-medium">Allow AI Agent Approve Scopes</span>
          </label>
        </div>
      </div>
      <button class="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium" @click="saveTenant">Save Settings</button>
    </div>

    <!-- API Keys -->
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

    <!-- MCP OAuth Tokens -->
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
const { apiFetch, showToast } = useAuthState()
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
  tenant.value = tRes.data
  apiKeys.value = kRes.data
  oauthTokens.value = oRes.data
}

async function saveTenant() {
  await apiFetch('/api/v1/tenant', {
    method: 'PATCH',
    body: {
      name: tenant.value.name,
      taxSettings: tenant.value.taxSettings,
      settings: tenant.value.settings
    }
  })
  showToast('Tenant settings saved')
}

async function createKey() {
  const res = await apiFetch<{ data: any }>('/api/v1/auth/api-keys', {
    method: 'POST',
    body: {
      name: keyName.value,
      scopes: ['customers:read', 'customers:write', 'catalog:read', 'orders:read', 'orders:write']
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
