<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Catalog &amp; Attribute Schemas</h1>
        <p class="text-sm text-slate-500">Tenant-configurable products, services, custom attributes, and agent-created item verification</p>
      </div>
      <button class="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg" @click="showCreate = !showCreate">
        {{ showCreate ? 'Close' : '+ New Catalog Item' }}
      </button>
    </div>

    <form v-if="showCreate" class="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-3 gap-4" @submit.prevent="createItem">
      <input v-model="form.name" required placeholder="Item Name" class="border rounded-lg px-3 py-2 text-sm" />
      <select v-model="form.type" class="border rounded-lg px-3 py-2 text-sm">
        <option value="product">Product</option>
        <option value="service">Service</option>
      </select>
      <input v-model="form.sku" placeholder="SKU (optional)" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model="form.unit" placeholder="Unit (each, hour, sqft)" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model.number="form.priceDollars" type="number" step="0.01" min="0" required placeholder="Base Price ($)" class="border rounded-lg px-3 py-2 text-sm" />
      <label class="flex items-center gap-2 text-sm px-2">
        <input v-model="form.trackInventory" type="checkbox" />
        <span>Track Inventory</span>
      </label>
      <input v-model="form.dimensions" placeholder="Attr: Dimensions (e.g. 5x8x24)" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model="form.finish" placeholder="Attr: Finish (e.g. Rubio Monocoat)" class="border rounded-lg px-3 py-2 text-sm" />
      <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg text-sm font-medium">Save Item</button>
    </form>

    <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table class="w-full min-w-[680px] text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Item</th>
            <th class="px-4 py-3">Type / SKU</th>
            <th class="px-4 py-3">Price</th>
            <th class="px-4 py-3">Attributes</th>
            <th class="px-4 py-3">Verification</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="item in items" :key="item.id">
            <td class="px-4 py-3 font-medium">{{ item.name }}</td>
            <td class="px-4 py-3 text-xs text-slate-500">{{ item.type }} · {{ item.sku || '—' }}</td>
            <td class="px-4 py-3 font-mono">{{ formatMoney(item.basePriceCents) }} / {{ item.unit }}</td>
            <td class="px-4 py-3 text-xs text-slate-600">
              <span v-for="(val, key) in item.attributes" :key="key" class="mr-2 bg-slate-100 px-1.5 py-0.5 rounded">
                {{ key }}: {{ val }}
              </span>
            </td>
            <td class="px-4 py-3">
              <span
                class="px-2 py-0.5 rounded-full text-xs font-medium"
                :class="item.verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'"
              >
                {{ item.verified ? 'Verified' : 'Unverified (Agent)' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button v-if="!item.verified" class="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded" @click="verifyItem(item)">
                Verify
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
const showCreate = ref(false)
const form = reactive({
  name: '',
  type: 'product',
  sku: '',
  unit: 'each',
  priceDollars: 0,
  trackInventory: false,
  dimensions: '',
  finish: ''
})

async function load() {
  const res = await apiFetch<{ data: any[] }>('/api/v1/catalog')
  items.value = res.data
}

async function createItem() {
  const attributes: Record<string, unknown> = {}
  if (form.dimensions) attributes.dimensions = form.dimensions
  if (form.finish) attributes.finish = form.finish
  await apiFetch('/api/v1/catalog', {
    method: 'POST',
    body: {
      name: form.name,
      type: form.type,
      sku: form.sku || undefined,
      unit: form.unit,
      basePriceCents: Math.round(form.priceDollars * 100),
      trackInventory: form.trackInventory,
      attributes
    }
  })
  showToast('Catalog item created')
  showCreate.value = false
  await load()
}

async function verifyItem(item: any) {
  await apiFetch(`/api/v1/catalog/${item.id}`, {
    method: 'PATCH',
    body: { verified: true, version: item.version }
  })
  showToast('Item verified')
  await load()
}

onMounted(load)
</script>
