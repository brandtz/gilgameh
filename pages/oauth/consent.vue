<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-900 px-4 py-10">
    <div class="w-full max-w-lg bg-white rounded-xl shadow-xl p-8 space-y-5">
      <div>
        <div class="text-xs uppercase font-semibold text-amber-600">OAuth 2.1 MCP Authorization</div>
        <h1 class="text-xl font-bold text-slate-900 mt-1">Authorize AI Agent Access</h1>
        <p class="text-sm text-slate-500 mt-1">
          Client <code class="bg-slate-100 px-1.5 py-0.5 rounded">{{ clientId }}</code> is requesting access to your Back Office workspace.
        </p>
      </div>

      <div v-if="!auth" class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
        Please <NuxtLink to="/login" class="underline font-semibold">sign in</NuxtLink> first to authorize this agent.
      </div>

      <div v-else class="space-y-4">
        <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm">
          <div><span class="text-slate-500">Signed in as:</span> <strong>{{ auth.actor.actorLabel }}</strong></div>
          <div><span class="text-slate-500">Tenant:</span> <strong>{{ auth.tenant.name }}</strong></div>
        </div>

        <div>
          <div class="text-xs font-semibold uppercase text-slate-500 mb-2">Requested Scopes</div>
          <div class="flex flex-wrap gap-1.5">
            <span v-for="s in scopeList" :key="s" class="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              {{ s }}
            </span>
          </div>
          <p class="text-xs text-slate-500 mt-2">
            Note: Financial approval scopes are enforced by your tenant's security policy (currently
            <strong>{{ auth.tenant.settings.allowAgentApproveScopes ? 'enabled' : 'disabled — UI tap required' }}</strong>).
          </p>
        </div>

        <div class="flex gap-3 pt-2">
          <button
            class="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-medium py-2.5 rounded-lg text-sm"
            :disabled="submitting"
            @click="approve"
          >
            {{ submitting ? 'Authorizing...' : 'Approve & Connect Agent' }}
          </button>
          <NuxtLink to="/" class="px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { auth, loadMe, apiFetch } = useAuthState()
const submitting = ref(false)

const clientId = computed(() => String(route.query.client_id || ''))
const redirectUri = computed(() => String(route.query.redirect_uri || ''))
const codeChallenge = computed(() => String(route.query.code_challenge || ''))
const state = computed(() => String(route.query.state || ''))
const scopeStr = computed(() => String(route.query.scope || ''))
const scopeList = computed(() => (scopeStr.value ? scopeStr.value.split(/\s+/).filter(Boolean) : ['Default Read + Draft Scopes']))

onMounted(async () => {
  if (!auth.value) await loadMe()
})

async function approve() {
  submitting.value = true
  try {
    const res = await apiFetch<{ data: { redirectTo: string } }>('/api/oauth/authorize', {
      method: 'POST',
      body: {
        client_id: clientId.value,
        redirect_uri: redirectUri.value,
        code_challenge: codeChallenge.value,
        code_challenge_method: 'S256',
        scope: scopeStr.value || undefined,
        state: state.value || undefined,
        tenant_id: auth.value?.tenant?.id
      }
    })
    window.location.href = res.data.redirectTo
  } finally {
    submitting.value = false
  }
}
</script>
