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

    <div v-if="isStandaloneRoute">
      <slot />
    </div>

    <div v-else class="flex min-h-screen">
      <!-- Sidebar -->
      <aside class="w-64 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
        <div class="p-5 border-b border-slate-800">
          <div class="flex items-center gap-2.5">
            <img
              v-if="auth?.tenant?.branding?.logoDataUrl"
              :src="auth.tenant.branding.logoDataUrl"
              alt="Business logo"
              class="h-8 w-8 rounded object-contain bg-white p-0.5 shrink-0"
            />
            <div class="min-w-0">
              <div class="text-[11px] uppercase tracking-wider text-amber-400 font-semibold">Back Office</div>
              <div class="text-base font-bold truncate">{{ auth?.tenant?.name || 'Platform' }}</div>
            </div>
          </div>
          <div v-if="canSwitchTenants" class="mt-3 space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="text-[11px] text-slate-400">Active Business</label>
              <NuxtLink to="/select-business" class="text-[11px] text-amber-400 hover:underline">All Businesses</NuxtLink>
            </div>
            <select
              v-model="activeTenantId"
              class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
              @change="onSwitchTenant"
            >
              <option v-for="t in auth!.tenants" :key="t.id" :value="t.id">
                {{ t.name }}
              </option>
            </select>
          </div>
        </div>

        <nav class="flex-1 p-3 space-y-1 text-sm overflow-y-auto">
          <NuxtLink
            v-for="item in visibleNavItems"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-2.5 px-3 py-2 rounded-md transition"
            :class="route.path === item.to ? 'bg-amber-600 text-white font-medium' : 'text-slate-300 hover:bg-slate-800 hover:text-white'"
          >
            <span>{{ item.label }}</span>
          </NuxtLink>
        </nav>

        <div class="p-4 border-t border-slate-800 text-xs space-y-2">
          <NuxtLink to="/profile" class="block hover:text-amber-400 transition">
            <div class="font-medium text-slate-200 truncate">{{ auth?.actor?.actorLabel }}</div>
            <div class="text-[11px] text-slate-400">My Profile &amp; Password →</div>
          </NuxtLink>
          <div class="flex items-center justify-between gap-2 pt-1">
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
const { auth, activeTenantId, toast, setActiveTenant, hasScope, loadMe, logout } = useAuthState()

const isStandaloneRoute = computed(
  () => route.path === '/login' || route.path === '/select-business' || route.path.startsWith('/oauth/')
)
const canSwitchTenants = computed(() => (auth.value?.tenants?.length || 0) > 1)

const allNavItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/customers', label: 'Customers & History', scope: 'customers:read' },
  { to: '/chatwoot', label: 'Chatwoot Inbox', scope: 'customers:read' },
  { to: '/catalog', label: 'Catalog & Schemas', scope: 'catalog:read' },
  { to: '/quotes', label: 'Quotes & PDFs', scope: 'quotes:read' },
  { to: '/orders', label: 'Orders & Production', scope: 'orders:read' },
  { to: '/invoices', label: 'Invoices & Payments', scope: 'invoices:read' },
  { to: '/inventory', label: 'Inventory Ledger', scope: 'inventory:read' },
  { to: '/expenses', label: 'Expenses', scope: 'expenses:read' },
  { to: '/integrations', label: 'Webhooks & Integrations', scope: 'integrations:manage' },
  { to: '/team', label: 'Team & Permissions', scope: 'tenant:manage' },
  { to: '/settings', label: 'Business, PDF & Security', scope: 'tenant:manage' },
  { to: '/audit', label: 'Audit Log', scope: 'audit:read' }
]

const visibleNavItems = computed(() =>
  allNavItems.filter((item) => !item.scope || hasScope(item.scope))
)

onMounted(async () => {
  if (!isStandaloneRoute.value && !auth.value) {
    const me = await loadMe()
    if (!me) {
      await navigateTo('/login')
    }
  }
})

async function onSwitchTenant() {
  setActiveTenant(activeTenantId.value)
  await loadMe()
  window.location.reload()
}
</script>
