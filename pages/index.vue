<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">Operations Dashboard</h1>
        <p class="text-sm text-slate-500">{{ auth?.tenant?.name }} — API-first Back Office</p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/quotes" class="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
          + Draft Quote
        </NuxtLink>
        <NuxtLink to="/customers" class="bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg">
          + New Customer
        </NuxtLink>
      </div>
    </div>

    <!-- KPI Grid -->
    <div v-if="summary" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <div class="text-xs font-semibold uppercase text-slate-500">Open Quotes</div>
        <div class="text-2xl font-bold mt-1">{{ summary.openQuotesCount }}</div>
        <div class="text-xs text-slate-500 mt-1">{{ formatMoney(summary.openQuotesTotalCents) }} pipeline</div>
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <div class="text-xs font-semibold uppercase text-slate-500">Unpaid Invoices</div>
        <div class="text-2xl font-bold mt-1 text-amber-700">{{ formatMoney(summary.unpaidInvoicesBalanceCents) }}</div>
        <div class="text-xs text-slate-500 mt-1">{{ summary.unpaidInvoicesCount }} open invoice(s)</div>
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <div class="text-xs font-semibold uppercase text-slate-500">Production Queue</div>
        <div class="text-2xl font-bold mt-1">{{ summary.activeWorkItemsCount }}</div>
        <div class="text-xs text-slate-500 mt-1">{{ summary.activeOrdersCount }} active order(s)</div>
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <div class="text-xs font-semibold uppercase text-slate-500">Needs Attention</div>
        <div class="text-2xl font-bold mt-1 text-rose-600">{{ summary.customersWaitingOnOwner }}</div>
        <div class="text-xs text-slate-500 mt-1">
          waiting on owner · {{ summary.unverifiedCatalogItemsCount }} unverified items · {{ summary.lowStockItemsCount }} low stock
        </div>
      </div>
    </div>

    <!-- Recent Audit Activity -->
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
        <h2 class="font-semibold text-slate-900">Recent Audit Trail</h2>
        <NuxtLink to="/audit" class="text-xs text-amber-700 font-medium hover:underline">View full log →</NuxtLink>
      </div>
      <div class="divide-y divide-slate-100">
        <div v-for="log in recentAudit" :key="log.id" class="px-5 py-3 flex items-center justify-between text-sm">
          <div>
            <span class="font-medium text-slate-800">{{ log.action }}</span>
            <span class="text-slate-400 mx-1.5">·</span>
            <span class="text-slate-600">{{ log.entityType }}</span>
            <span class="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
              {{ log.actorType }}: {{ log.actorLabel }}
            </span>
          </div>
          <div class="text-xs text-slate-400">{{ formatDate(log.createdAt) }}</div>
        </div>
        <div v-if="recentAudit.length === 0" class="px-5 py-8 text-center text-sm text-slate-400">
          No audit events yet.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { auth, apiFetch } = useAuthState()
const summary = ref<any>(null)
const recentAudit = ref<any[]>([])

onMounted(async () => {
  const [s, a] = await Promise.all([
    apiFetch<{ data: any }>('/api/v1/dashboard/summary'),
    apiFetch<{ data: any[] }>('/api/v1/audit?limit=10')
  ])
  summary.value = s.data
  recentAudit.value = a.data
})
</script>
