<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">Orders &amp; Production Queue</h1>
      <p class="text-sm text-slate-500">Multi-channel orders and prioritized shop floor work items</p>
    </div>

    <!-- Production Queue -->
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-200 font-semibold">Production Queue (Work Items)</div>
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Priority</th>
            <th class="px-4 py-3">Work Item</th>
            <th class="px-4 py-3">Customer</th>
            <th class="px-4 py-3">Qty</th>
            <th class="px-4 py-3">State</th>
            <th class="px-4 py-3 text-right">Advance</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="w in workItems" :key="w.id">
            <td class="px-4 py-3 font-mono text-xs">#{{ w.priorityRank }}</td>
            <td class="px-4 py-3 font-medium">{{ w.title }}</td>
            <td class="px-4 py-3 text-slate-600">{{ w.customerName }}</td>
            <td class="px-4 py-3 font-mono">{{ Number(w.quantity) }}</td>
            <td class="px-4 py-3">
              <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">{{ w.state }}</span>
            </td>
            <td class="px-4 py-3 text-right space-x-1">
              <button v-if="w.state === 'queued'" class="text-xs bg-slate-900 text-white px-2.5 py-1 rounded" @click="setWorkState(w, 'in_progress')">Start</button>
              <button v-if="w.state === 'in_progress'" class="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded" @click="setWorkState(w, 'ready')">Mark Ready</button>
              <button v-if="w.state === 'ready'" class="text-xs bg-amber-600 text-white px-2.5 py-1 rounded" @click="setWorkState(w, 'picked_up')">Picked Up</button>
            </td>
          </tr>
          <tr v-if="workItems.length === 0">
            <td colspan="6" class="px-4 py-6 text-center text-slate-400">Production queue is clear.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Orders -->
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-200 font-semibold">Orders</div>
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Order #</th>
            <th class="px-4 py-3">Customer</th>
            <th class="px-4 py-3">Channel</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Total</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="o in orders" :key="o.id">
            <td class="px-4 py-3 font-mono font-semibold">{{ o.orderNumber }}</td>
            <td class="px-4 py-3">{{ o.customerName }}</td>
            <td class="px-4 py-3 text-xs uppercase text-slate-500">{{ o.channel }}</td>
            <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs bg-slate-100">{{ o.status }}</span></td>
            <td class="px-4 py-3 font-mono">{{ formatMoney(o.totalCents) }}</td>
            <td class="px-4 py-3 text-right">
              <button class="text-xs bg-slate-900 text-white px-2.5 py-1 rounded" @click="createInvoice(o)">Draft Invoice</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
const { apiFetch, showToast } = useAuthState()
const orders = ref<any[]>([])
const workItems = ref<any[]>([])

async function load() {
  const [oRes, wRes] = await Promise.all([
    apiFetch<{ data: any[] }>('/api/v1/orders'),
    apiFetch<{ data: any[] }>('/api/v1/production')
  ])
  orders.value = oRes.data
  workItems.value = wRes.data
}

async function setWorkState(w: any, state: string) {
  await apiFetch(`/api/v1/production/${w.id}`, {
    method: 'PATCH',
    body: { version: w.version, state }
  })
  showToast(`Work item marked ${state}`)
  await load()
}

async function createInvoice(o: any) {
  const res = await apiFetch<{ data: any }>('/api/v1/invoices', {
    method: 'POST',
    body: { fromOrderId: o.id }
  })
  showToast(`Draft invoice ${res.data.invoiceNumber} created`)
}

onMounted(load)
</script>
