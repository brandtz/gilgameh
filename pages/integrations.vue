<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">Webhooks &amp; Integrations</h1>
      <p class="text-sm text-slate-500">Signed outbound webhooks, inbound connectors (Website, Chatwoot, Stripe), and QuickBooks one-way sync</p>
    </div>

    <!-- Integrations -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-for="cfg in integrations" :key="cfg.provider" class="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div class="flex items-center justify-between">
          <div class="font-semibold uppercase text-sm">{{ cfg.provider.replace('_', ' ') }}</div>
          <span class="px-2 py-0.5 rounded-full text-xs" :class="cfg.isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'">
            {{ cfg.isEnabled ? 'Enabled' : 'Disabled' }}
          </span>
        </div>
        <div class="text-xs text-slate-500">
          Last synced: {{ cfg.lastSyncedAt ? formatDate(cfg.lastSyncedAt) : 'Never' }}
        </div>
        <div class="flex gap-2">
          <button class="text-xs border border-slate-300 px-3 py-1.5 rounded-lg" @click="toggleIntegration(cfg)">
            {{ cfg.isEnabled ? 'Disable' : 'Enable' }}
          </button>
          <button v-if="cfg.provider === 'quickbooks'" class="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg" @click="syncQuickBooks">
            Push Finalized to QBO
          </button>
        </div>
      </div>
    </div>

    <!-- Outbound Webhook Endpoints -->
    <div class="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div class="font-semibold">Outbound HMAC-Signed Webhooks</div>
      <form class="flex flex-wrap gap-2" @submit.prevent="addEndpoint">
        <input v-model="newUrl" type="url" required placeholder="https://your-site.example/webhooks/backoffice" class="flex-1 border rounded-lg px-3 py-2 text-sm" />
        <button type="submit" class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">Add Endpoint</button>
      </form>
      <div class="divide-y divide-slate-100">
        <div v-for="ep in endpoints" :key="ep.id" class="py-3 flex items-center justify-between text-sm">
          <div>
            <div class="font-mono text-xs">{{ ep.url }}</div>
            <div class="text-xs text-slate-500">{{ ep.events.join(', ') }} · Secret: {{ ep.secretPreview }}</div>
          </div>
          <button class="text-xs text-red-600 hover:underline" @click="removeEndpoint(ep.id)">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { apiFetch, showToast } = useAuthState()
const integrations = ref<any[]>([])
const endpoints = ref<any[]>([])
const newUrl = ref('')

async function load() {
  const [iRes, wRes] = await Promise.all([
    apiFetch<{ data: any[] }>('/api/v1/integrations'),
    apiFetch<{ data: { endpoints: any[]; deliveries: any[] } }>('/api/v1/webhooks')
  ])
  integrations.value = iRes.data
  endpoints.value = wRes.data.endpoints
}

async function toggleIntegration(cfg: any) {
  await apiFetch(`/api/v1/integrations/${cfg.provider}`, {
    method: 'PUT',
    body: { isEnabled: !cfg.isEnabled, config: cfg.config || {} }
  })
  showToast(`${cfg.provider} updated`)
  await load()
}

async function syncQuickBooks() {
  const res = await apiFetch<{ data: any }>('/api/v1/integrations/quickbooks/sync', { method: 'POST' })
  showToast(`Synced ${res.data.counts.invoices} invoices, ${res.data.counts.payments} payments, ${res.data.counts.expenses} expenses`)
  await load()
}

async function addEndpoint() {
  await apiFetch('/api/v1/webhooks', {
    method: 'POST',
    body: {
      url: newUrl.value,
      events: ['order.created', 'order.status_changed', 'quote.accepted', 'invoice.paid']
    }
  })
  newUrl.value = ''
  showToast('Webhook endpoint registered')
  await load()
}

async function removeEndpoint(id: string) {
  await apiFetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' })
  showToast('Webhook endpoint removed')
  await load()
}

onMounted(load)
</script>
