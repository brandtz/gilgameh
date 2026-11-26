<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Chatwoot Contacts &amp; Inbox</h1>
        <p class="text-sm text-slate-500">
          Dedicated Chatwoot workspace strictly isolated to <strong>{{ auth?.tenant?.name }}</strong>
        </p>
      </div>
      <div class="flex gap-2">
        <button class="border border-slate-300 bg-white hover:bg-slate-50 text-sm px-4 py-2 rounded-lg" @click="showConfig = !showConfig">
          {{ showConfig ? 'Hide Connection' : 'Chatwoot Connection' }}
        </button>
        <button
          class="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          :disabled="syncing"
          @click="syncNow"
        >
          {{ syncing ? 'Syncing...' : 'Sync from Chatwoot' }}
        </button>
      </div>
    </div>

    <!-- Per-Tenant Chatwoot Configuration -->
    <form v-if="showConfig" class="bg-white rounded-xl border border-slate-200 p-5 space-y-4" @submit.prevent="saveConfig">
      <div class="flex items-center justify-between">
        <div class="font-semibold text-sm">Chatwoot Connection ({{ auth?.tenant?.name }} only)</div>
        <label class="flex items-center gap-2 text-xs font-medium">
          <input v-model="cfg.isEnabled" type="checkbox" />
          <span>Enabled for this business</span>
        </label>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <label class="block text-xs text-slate-500 mb-1">Chatwoot Base URL</label>
          <input v-model="cfg.baseUrl" placeholder="https://app.chatwoot.com" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Chatwoot Account ID</label>
          <input v-model="cfg.accountId" placeholder="e.g. 12345" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">
            API Access Token
            <span v-if="cfg.hasApiToken" class="text-emerald-600">(saved — leave blank to keep)</span>
          </label>
          <input v-model="cfg.apiToken" type="password" placeholder="Chatwoot User API Access Token" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">
            Inbound Webhook Secret
            <span v-if="cfg.hasWebhookSecret" class="text-emerald-600">(saved — leave blank to keep)</span>
          </label>
          <input v-model="cfg.webhookSecret" type="password" placeholder="HMAC signing secret" class="w-full border rounded-lg px-3 py-2" />
        </div>
      </div>
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
        Webhook URL for Chatwoot: <code class="font-mono text-slate-900">{{ webhookUrl }}</code>
        with header <code class="font-mono text-slate-900">X-Tenant-Slug: {{ auth?.tenant?.slug }}</code>
      </div>
      <div class="flex justify-end">
        <button type="submit" class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium">Save Chatwoot Settings</button>
      </div>
    </form>

    <!-- Tabs: Conversations vs Contacts -->
    <div class="flex gap-2 border-b border-slate-200">
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition"
        :class="tab === 'inbox' ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-500'"
        @click="tab = 'inbox'"
      >
        Inbox Conversations ({{ conversations.length }})
      </button>
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition"
        :class="tab === 'contacts' ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-500'"
        @click="tab = 'contacts'"
      >
        Chatwoot Contacts ({{ contacts.length }})
      </button>
    </div>

    <!-- Conversations Split View -->
    <div v-if="tab === 'inbox'" class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
        <button
          v-for="conv in conversations"
          :key="conv.id"
          class="w-full text-left p-4 hover:bg-slate-50 transition"
          :class="selectedConv?.id === conv.id ? 'bg-amber-50' : ''"
          @click="selectedConv = conv"
        >
          <div class="flex items-center justify-between">
            <div class="font-semibold text-sm text-slate-900">{{ conv.contact?.name }}</div>
            <span v-if="conv.unreadCount > 0" class="px-2 py-0.5 rounded-full text-[11px] bg-rose-100 text-rose-700 font-semibold">
              {{ conv.unreadCount }}
            </span>
          </div>
          <div class="text-xs text-slate-500 mt-0.5">{{ conv.inboxName }} · {{ conv.status }}</div>
          <div class="text-xs text-slate-600 mt-1 truncate">{{ conv.lastMessagePreview || 'No messages yet' }}</div>
        </button>
        <div v-if="conversations.length === 0" class="p-6 text-center text-sm text-slate-400">
          No Chatwoot conversations synced yet for {{ auth?.tenant?.name }}.
        </div>
      </div>

      <div class="lg:col-span-2 bg-white rounded-xl border border-slate-200 flex flex-col min-h-[420px]">
        <div v-if="!selectedConv" class="flex-1 flex items-center justify-center text-sm text-slate-400 p-8">
          Select a conversation to view messages and reply.
        </div>
        <template v-else>
          <div class="px-5 py-3.5 border-b flex items-center justify-between">
            <div>
              <div class="font-semibold text-slate-900">{{ selectedConv.contact?.name }}</div>
              <div class="text-xs text-slate-500">
                {{ selectedConv.contact?.email || selectedConv.contact?.phone || 'No direct contact info' }} · Conv #{{ selectedConv.externalConversationId }}
              </div>
            </div>
            <button
              v-if="!selectedConv.contact?.customerId"
              class="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg"
              @click="linkContact(selectedConv.contact.id)"
            >
              Link to CRM Customer
            </button>
            <NuxtLink
              v-else
              to="/customers"
              class="text-xs text-emerald-700 font-medium underline"
            >
              Linked to CRM Customer ✓
            </NuxtLink>
          </div>

          <div class="flex-1 p-5 space-y-3 overflow-y-auto max-h-[400px]">
            <div
              v-for="m in selectedConv.messages"
              :key="m.id"
              class="flex"
              :class="m.direction === 'outgoing' ? 'justify-end' : 'justify-start'"
            >
              <div
                class="max-w-md rounded-xl px-3.5 py-2.5 text-sm"
                :class="m.direction === 'outgoing' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'"
              >
                <div class="text-[11px] opacity-70 mb-0.5">{{ m.sender }}</div>
                <div>{{ m.content }}</div>
              </div>
            </div>
          </div>

          <form class="p-4 border-t flex gap-2" @submit.prevent="sendReply">
            <input v-model="replyText" required placeholder="Write a reply..." class="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
              Send Reply
            </button>
          </form>
        </template>
      </div>
    </div>

    <!-- Contacts Directory -->
    <div v-else class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Email / Phone</th>
            <th class="px-4 py-3">External ID</th>
            <th class="px-4 py-3 text-right">CRM Link</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="c in contacts" :key="c.id">
            <td class="px-4 py-3 font-semibold">{{ c.name }}</td>
            <td class="px-4 py-3 text-slate-600">{{ c.email || '—' }} · {{ c.phone || '—' }}</td>
            <td class="px-4 py-3 font-mono text-xs text-slate-500">#{{ c.externalContactId }}</td>
            <td class="px-4 py-3 text-right">
              <span v-if="c.customerId" class="text-xs text-emerald-700 font-medium">Linked ✓</span>
              <button v-else class="text-xs bg-slate-900 text-white px-2.5 py-1 rounded" @click="linkContact(c.id)">
                Import to Customers
              </button>
            </td>
          </tr>
          <tr v-if="contacts.length === 0">
            <td colspan="4" class="px-4 py-6 text-center text-slate-400">No Chatwoot contacts yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
const { auth, apiFetch, showToast } = useAuthState()
const config = useRuntimeConfig()
const tab = ref<'inbox' | 'contacts'>('inbox')
const showConfig = ref(false)
const syncing = ref(false)
const contacts = ref<any[]>([])
const conversations = ref<any[]>([])
const selectedConv = ref<any>(null)
const replyText = ref('')

const cfg = reactive({
  isEnabled: false,
  baseUrl: '',
  accountId: '',
  apiToken: '',
  webhookSecret: '',
  hasApiToken: false,
  hasWebhookSecret: false
})

const webhookUrl = computed(() => `${config.public.appBaseUrl}/api/webhooks/chatwoot`)

async function load() {
  const res = await apiFetch<{ data: { config: any; contacts: any[]; conversations: any[] } }>('/api/v1/chatwoot')
  Object.assign(cfg, {
    isEnabled: res.data.config.isEnabled,
    baseUrl: res.data.config.baseUrl,
    accountId: res.data.config.accountId,
    apiToken: '',
    webhookSecret: '',
    hasApiToken: res.data.config.hasApiToken,
    hasWebhookSecret: res.data.config.hasWebhookSecret
  })
  contacts.value = res.data.contacts
  conversations.value = res.data.conversations
  if (selectedConv.value) {
    selectedConv.value = conversations.value.find((c) => c.id === selectedConv.value.id) || null
  }
}

async function saveConfig() {
  await apiFetch('/api/v1/chatwoot/config', {
    method: 'PUT',
    body: {
      isEnabled: cfg.isEnabled,
      baseUrl: cfg.baseUrl || undefined,
      accountId: cfg.accountId || undefined,
      apiToken: cfg.apiToken || undefined,
      webhookSecret: cfg.webhookSecret || undefined
    }
  })
  showToast('Chatwoot settings saved for this business')
  await load()
}

async function syncNow() {
  syncing.value = true
  try {
    const res = await apiFetch<{ data: { syncedContacts: number; syncedConversations: number } }>('/api/v1/chatwoot/sync', {
      method: 'POST'
    })
    showToast(`Synced ${res.data.syncedContacts} contacts & ${res.data.syncedConversations} conversations`)
    await load()
  } finally {
    syncing.value = false
  }
}

async function sendReply() {
  if (!selectedConv.value) return
  const res = await apiFetch<{ data: { conversation: any; deliveredToChatwoot: boolean } }>(
    `/api/v1/chatwoot/conversations/${selectedConv.value.id}/reply`,
    { method: 'POST', body: { content: replyText.value } }
  )
  replyText.value = ''
  showToast(res.data.deliveredToChatwoot ? 'Reply sent to Chatwoot' : 'Reply logged locally (configure Chatwoot API to send live)')
  await load()
}

async function linkContact(id: string) {
  await apiFetch(`/api/v1/chatwoot/contacts/${id}/link`, { method: 'POST' })
  showToast('Chatwoot contact linked to Customers')
  await load()
}

onMounted(load)
</script>
