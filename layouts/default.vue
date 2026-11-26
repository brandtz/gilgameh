<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <!-- Toast Notification -->
    <div
      v-if="toast"
      class="fixed bottom-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg text-white transition"
      :class="toast.type === 'err' ? 'bg-red-600' : 'bg-emerald-700'"
    >
      {{ toast.message }}
    </div>

    <div v-if="isPublicRoute">
      <slot />
    </div>

    <div v-else class="flex min-h-screen">
      <!-- Sidebar -->
      <aside class="w-64 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
        <div class="p-5 border-b border-slate-800">
          <div class="text-xs uppercase tracking-wider text-amber-400 font-semibold">Back Office</div>
          <div class="text-lg font-bold mt-0.5 truncate">{{ auth?.tenant?.name || 'Platform' }}</div>
          <div v-if="auth && auth.tenants.length > 1" class="mt-3">
            <label class="text-[11px] text-slate-400 block mb-1">Active Tenant</label>
            <select
              v-model="activeTenantId"
              class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
              @change="onSwitchTenant"
            >
              <option v-for="t in auth.tenants" :key="t.id" :value="t.id">
                {{ t.name }}
              </option>
            </select>
          </div>
        </div>

        <nav class="flex-1 p-3 space-y-1 text-sm overflow-y-auto">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-2.5 px-3 py-2 rounded-md transition"
            :class="route.path === item.to ? 'bg-amber-600 text-white font-medium' : 'text-slate-300 hover:bg-slate-800 hover:text-white'"
          >
            <span>{{ item.label }}</span>
          </NuxtLink>
        </nav>

        <div class="p-4 border-t border-slate-800 text-xs space-y-2">
          <div class="text-slate-400 truncate">{{ auth?.actor?.actorLabel }}</div>
          <div class="flex items-center justify-between gap-2">
            <a href="/api/v1/openapi.json" target="_blank" class="text-amber-400 hover:underline">OpenAPI JSON</a>
            <button class="text-slate-300 hover:text-white underline" @click="logout">Sign out</button>
          </div>
        </div>
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0 p-6 lg:p-8 overflow-x-auto">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { auth, activeTenantId, toast, loadMe, logout } = useAuthState()

const isPublicRoute = computed(() => route.path === '/login' || route.path.startsWith('/oauth/'))

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/customers', label: 'Customers & Inbox' },
  { to: '/catalog', label: 'Catalog & Schemas' },
  { to: '/quotes', label: 'Quotes & PDFs' },
  { to: '/orders', label: 'Orders & Production' },
  { to: '/invoices', label: 'Invoices & Payments' },
  { to: '/inventory', label: 'Inventory Ledger' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/integrations', label: 'Webhooks & Integrations' },
  { to: '/settings', label: 'Security, Keys & MCP' },
  { to: '/audit', label: 'Audit Log' }
]

onMounted(async () => {
  if (!isPublicRoute.value && !auth.value) {
    const me = await loadMe()
    if (!me) {
      await navigateTo('/login')
    }
  }
})

async function onSwitchTenant() {
  await loadMe()
  window.location.reload()
}
</script>
