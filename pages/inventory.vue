<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">Inventory &amp; Append-Only Stock Ledger</h1>
      <p class="text-sm text-slate-500">Tracked stock levels and draft-then-confirm inventory adjustments</p>
    </div>

    <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <div class="px-5 py-4 border-b font-semibold">Stock On Hand</div>
      <table class="w-full min-w-[640px] text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Item</th>
            <th class="px-4 py-3">SKU</th>
            <th class="px-4 py-3">Location</th>
            <th class="px-4 py-3">On Hand</th>
            <th class="px-4 py-3">Reorder Pt</th>
            <th class="px-4 py-3 text-right">Adjust</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="i in items" :key="i.id">
            <td class="px-4 py-3 font-medium">{{ i.name }}</td>
            <td class="px-4 py-3 text-xs font-mono text-slate-500">{{ i.sku || '—' }}</td>
            <td class="px-4 py-3 text-xs text-slate-500">{{ i.location || '—' }}</td>
            <td class="px-4 py-3 font-mono font-semibold" :class="i.lowStock ? 'text-rose-600' : 'text-slate-900'">
              {{ i.quantityOnHand }} {{ i.unit }}
              <span v-if="i.lowStock" class="ml-1 text-xs bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">Low</span>
            </td>
            <td class="px-4 py-3 font-mono text-slate-500">{{ i.reorderPoint }}</td>
            <td class="px-4 py-3 text-right">
              <button class="text-xs bg-slate-900 text-white px-2.5 py-1 rounded" @click="adjCatalogId = i.catalogItemId">
                Draft Adjustment
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form v-if="adjCatalogId" class="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-4 gap-3" @submit.prevent="draftAdjustment">
      <select v-model="adjForm.movementType" class="border rounded-lg px-3 py-2 text-sm">
        <option value="receipt">Receipt (+)</option>
        <option value="adjustment">Adjustment (+/-)</option>
        <option value="production_use">Production Use (-)</option>
      </select>
      <input v-model.number="adjForm.quantityDelta" type="number" required placeholder="Qty Delta (e.g. 50 or -5)" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model="adjForm.reason" required placeholder="Reason..." class="border rounded-lg px-3 py-2 text-sm" />
      <button type="submit" class="bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Create Draft</button>
    </form>

    <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <div class="px-5 py-4 border-b font-semibold">Append-Only Stock Movements</div>
      <table class="w-full min-w-[600px] text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Type</th>
            <th class="px-4 py-3">Delta</th>
            <th class="px-4 py-3">Reason</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="m in movements" :key="m.id">
            <td class="px-4 py-3 uppercase text-xs font-semibold">{{ m.movementType }}</td>
            <td class="px-4 py-3 font-mono font-semibold" :class="m.quantityDelta > 0 ? 'text-emerald-700' : 'text-rose-700'">
              {{ m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta }}
            </td>
            <td class="px-4 py-3 text-slate-600">{{ m.reason || '—' }}</td>
            <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs bg-slate-100">{{ m.status }}</span></td>
            <td class="px-4 py-3 text-right">
              <button v-if="m.status === 'draft'" class="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded" @click="approveMovement(m)">
                Approve (v{{ m.version }})
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
const { apiFetch, showToast } = useAuthState()
const items = ref<any[]>([])
const movements = ref<any[]>([])
const adjCatalogId = ref('')
const adjForm = reactive({ movementType: 'receipt', quantityDelta: 10, reason: '' })

async function load() {
  const [iRes, mRes] = await Promise.all([
    apiFetch<{ data: any[] }>('/api/v1/inventory'),
    apiFetch<{ data: any[] }>('/api/v1/inventory/movements')
  ])
  items.value = iRes.data
  movements.value = mRes.data
}

async function draftAdjustment() {
  await apiFetch('/api/v1/inventory/movements', {
    method: 'POST',
    body: { catalogItemId: adjCatalogId.value, ...adjForm }
  })
  showToast('Draft stock movement created')
  adjCatalogId.value = ''
  adjForm.reason = ''
  await load()
}

async function approveMovement(m: any) {
  await apiFetch(`/api/v1/inventory/movements/${m.id}/approve`, {
    method: 'POST',
    body: { version: m.version }
  })
  showToast('Stock movement approved')
  await load()
}

onMounted(load)
</script>
