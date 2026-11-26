<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Quotes &amp; Revisions</h1>
        <p class="text-sm text-slate-500">Pull from your product catalog or enter custom items, with server-computed totals and branded PDFs</p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/settings" class="border border-slate-300 bg-white hover:bg-slate-50 text-sm px-3 py-2 rounded-lg">
          PDF Template &amp; Logo
        </NuxtLink>
        <button class="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg" @click="showCreate = !showCreate">
          {{ showCreate ? 'Close Builder' : '+ New Draft Quote' }}
        </button>
      </div>
    </div>

    <!-- Draft Quote Builder -->
    <form v-if="showCreate" class="bg-white rounded-xl border border-slate-200 p-5 space-y-4" @submit.prevent="createQuote">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-xs text-slate-500 mb-1">Customer</label>
          <select v-model="form.customerId" required class="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="" disabled>Select Customer...</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Customer PO # (optional)</label>
          <input v-model="form.customerPoNumber" placeholder="e.g. PO-12345" class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Quote Notes / Custom Instructions</label>
          <input v-model="form.notes" placeholder="Delivery notes or special terms..." class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div class="space-y-2.5">
        <div class="text-xs font-semibold uppercase text-slate-500">Line Items (Catalog or Free-Form)</div>
        <div
          v-for="(line, idx) in form.lines"
          :key="idx"
          class="p-3 bg-slate-50 rounded-lg border border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-2 items-end"
        >
          <div class="md:col-span-3">
            <label class="block text-[11px] text-slate-500 mb-1">Catalog Item (Optional)</label>
            <select
              v-model="line.catalogItemId"
              class="w-full border rounded-lg px-2.5 py-2 text-sm bg-white"
              @change="onSelectCatalogItem(line)"
            >
              <option value="">— Free-form / Custom —</option>
              <option v-for="item in catalogItems" :key="item.id" :value="item.id">
                {{ item.name }} ({{ formatMoney(item.basePriceCents) }}/{{ item.unit }})
              </option>
            </select>
          </div>
          <div class="md:col-span-3">
            <label class="block text-[11px] text-slate-500 mb-1">Description</label>
            <input v-model="line.description" required placeholder="Description" class="w-full border rounded-lg px-3 py-2 text-sm bg-white" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-[11px] text-slate-500 mb-1">Qty</label>
            <input
              v-model.number="line.quantity"
              type="number"
              step="any"
              min="0.001"
              required
              class="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            />
          </div>
          <div class="md:col-span-1">
            <label class="block text-[11px] text-slate-500 mb-1">Unit</label>
            <input v-model="line.unit" required placeholder="each" class="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-[11px] text-slate-500 mb-1">Unit Price ($)</label>
            <input
              v-model.number="line.unitPriceDollars"
              type="number"
              step="0.01"
              min="0"
              required
              class="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            />
          </div>
          <div class="md:col-span-1 flex justify-end pb-2">
            <button v-if="form.lines.length > 1" type="button" class="text-xs text-red-600 hover:underline" @click="form.lines.splice(idx, 1)">
              Remove
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between pt-1">
          <button type="button" class="text-xs text-amber-700 font-medium underline" @click="addLine">+ Add Line</button>
          <div class="text-sm font-semibold text-slate-800">
            Estimated Subtotal: <span class="font-mono">{{ formatMoney(estimatedSubtotalCents) }}</span>
          </div>
        </div>
      </div>

      <div class="flex justify-end">
        <button type="submit" class="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2 rounded-lg text-sm font-medium">
          Create Draft Quote
        </button>
      </div>
    </form>

    <!-- Catalog Default Update Confirmation Pop-up -->
    <div v-if="pendingCatalogUpdates.length > 0" class="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <h3 class="text-lg font-bold text-slate-900">Update Catalog Defaults?</h3>
        <p class="text-sm text-slate-600">
          Your draft quote was saved with your custom prices/units without changing the catalog. Would you also like to update the product catalog defaults for these modified items?
        </p>
        <div class="divide-y divide-slate-100 border rounded-lg">
          <label
            v-for="diff in pendingCatalogUpdates"
            :key="diff.catalogItemId"
            class="flex items-start gap-3 p-3 text-sm cursor-pointer hover:bg-slate-50"
          >
            <input v-model="diff.apply" type="checkbox" class="mt-1" />
            <div>
              <div class="font-semibold text-slate-900">{{ diff.name }}</div>
              <div class="text-xs text-slate-500">
                Catalog: {{ formatMoney(diff.oldPriceCents) }}/{{ diff.oldUnit }}
                → New: <strong class="text-amber-700">{{ formatMoney(diff.newPriceCents) }}/{{ diff.newUnit }}</strong>
              </div>
            </div>
          </label>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="border border-slate-300 px-4 py-2 rounded-lg text-sm" @click="pendingCatalogUpdates = []">
            Keep Quote-Only
          </button>
          <button type="button" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium" @click="applyCatalogUpdates">
            Update Selected Defaults
          </button>
        </div>
      </div>
    </div>

    <!-- Quotes Table -->
    <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table class="w-full min-w-[640px] text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Quote #</th>
            <th class="px-4 py-3">Customer</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Total</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="q in quotes" :key="q.id">
            <td class="px-4 py-3 font-semibold font-mono">
              {{ q.quoteNumber }}
              <span class="text-xs font-normal text-slate-400">v{{ q.version }}</span>
            </td>
            <td class="px-4 py-3">{{ q.customerName }}</td>
            <td class="px-4 py-3">
              <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">{{ q.status }}</span>
            </td>
            <td class="px-4 py-3 font-mono font-medium">{{ formatMoney(q.totalCents) }}</td>
            <td class="px-4 py-3 text-right space-x-2">
              <a :href="q.pdfUrl" target="_blank" class="text-xs text-slate-600 underline">PDF</a>
              <button v-if="q.status === 'draft'" class="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded" @click="approve(q)">
                Approve &amp; Send
              </button>
              <button v-if="q.status !== 'draft'" class="text-xs border border-slate-300 px-2 py-1 rounded" @click="emailCopy(q)">
                Email Copy
              </button>
              <button v-if="q.status === 'sent'" class="text-xs bg-amber-600 text-white px-2.5 py-1 rounded" @click="acceptAndOrder(q)">
                Accept → Order
              </button>
              <button v-if="q.status === 'sent'" class="text-xs border border-slate-300 px-2 py-1 rounded" @click="revise(q)">
                Revise
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { apiFetch, showToast } = useAuthState()
const quotes = ref<any[]>([])
const customers = ref<any[]>([])
const catalogItems = ref<any[]>([])
const showCreate = ref(false)
const pendingCatalogUpdates = ref<
  Array<{
    catalogItemId: string
    name: string
    version: number
    oldPriceCents: number
    newPriceCents: number
    oldUnit: string
    newUnit: string
    apply: boolean
  }>
>([])

interface QuoteBuilderLine {
  catalogItemId: string
  description: string
  quantity: number
  unit: string
  unitPriceDollars: number
  taxable: boolean
}

const form = reactive<{
  customerId: string
  customerPoNumber: string
  notes: string
  lines: QuoteBuilderLine[]
}>({
  customerId: '',
  customerPoNumber: '',
  notes: '',
  lines: [{ catalogItemId: '', description: '', quantity: 1, unit: 'each', unitPriceDollars: 0, taxable: true }]
})

const estimatedSubtotalCents = computed(() =>
  form.lines.reduce((sum, l) => sum + Math.round((Number(l.quantity) || 0) * Math.round((Number(l.unitPriceDollars) || 0) * 100)), 0)
)

function addLine() {
  form.lines.push({ catalogItemId: '', description: '', quantity: 1, unit: 'each', unitPriceDollars: 0, taxable: true })
}

function onSelectCatalogItem(line: QuoteBuilderLine) {
  if (!line.catalogItemId) return
  const item = catalogItems.value.find((i) => i.id === line.catalogItemId)
  if (!item) return
  line.description = item.name
  line.unit = item.unit || 'each'
  line.unitPriceDollars = Number((item.basePriceCents / 100).toFixed(2))
  line.taxable = item.taxable !== false
}

async function load() {
  const [qRes, cRes, catRes] = await Promise.all([
    apiFetch<{ data: any[] }>('/api/v1/quotes'),
    apiFetch<{ data: any[] }>('/api/v1/customers'),
    apiFetch<{ data: any[] }>('/api/v1/catalog?limit=100')
  ])
  quotes.value = qRes.data
  customers.value = cRes.data
  catalogItems.value = catRes.data
  if (typeof route.query.customerId === 'string' && route.query.customerId) {
    form.customerId = route.query.customerId
    showCreate.value = true
  }
}

async function createQuote() {
  // Check if any catalog-linked line has modified price or unit vs catalog defaults
  const diffs: typeof pendingCatalogUpdates.value = []
  for (const line of form.lines) {
    if (!line.catalogItemId) continue
    const cat = catalogItems.value.find((i) => i.id === line.catalogItemId)
    if (!cat) continue
    const newPriceCents = Math.round(line.unitPriceDollars * 100)
    if (newPriceCents !== cat.basePriceCents || line.unit.trim() !== cat.unit) {
      diffs.push({
        catalogItemId: cat.id,
        name: cat.name,
        version: cat.version,
        oldPriceCents: cat.basePriceCents,
        newPriceCents,
        oldUnit: cat.unit,
        newUnit: line.unit.trim(),
        apply: true
      })
    }
  }

  await apiFetch('/api/v1/quotes', {
    method: 'POST',
    body: {
      customerId: form.customerId,
      customerPoNumber: form.customerPoNumber || undefined,
      notes: form.notes || undefined,
      lines: form.lines.map((l) => ({
        catalogItemId: l.catalogItemId || undefined,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceCents: Math.round(l.unitPriceDollars * 100),
        taxable: l.taxable
      }))
    }
  })
  showToast('Draft quote created')
  showCreate.value = false
  form.customerPoNumber = ''
  form.notes = ''
  form.lines = [{ catalogItemId: '', description: '', quantity: 1, unit: 'each', unitPriceDollars: 0, taxable: true }]
  if (diffs.length > 0) {
    pendingCatalogUpdates.value = diffs
  }
  await load()
}

async function applyCatalogUpdates() {
  const chosen = pendingCatalogUpdates.value.filter((d) => d.apply)
  for (const diff of chosen) {
    await apiFetch(`/api/v1/catalog/${diff.catalogItemId}`, {
      method: 'PATCH',
      body: {
        basePriceCents: diff.newPriceCents,
        unit: diff.newUnit,
        version: diff.version
      }
    })
  }
  pendingCatalogUpdates.value = []
  if (chosen.length > 0) {
    showToast(`Updated ${chosen.length} catalog default(s)`)
    await load()
  }
}

async function approve(q: any) {
  const res = await apiFetch<{ data: { emailCopy?: { status: string; sentTo?: string; reason?: string } } }>(
    `/api/v1/quotes/${q.id}/approve`,
    {
      method: 'POST',
      body: { version: q.version }
    }
  )
  const ec = res.data?.emailCopy
  if (ec?.status === 'sent') {
    showToast(`Quote ${q.quoteNumber} approved & PDF emailed to ${ec.sentTo}`)
  } else if (ec?.status === 'skipped') {
    showToast(`Quote ${q.quoteNumber} approved (email skipped: ${ec.reason || 'not configured'})`)
  } else if (ec?.status === 'failed') {
    showToast(`Quote ${q.quoteNumber} approved (email failed: ${ec.reason || 'check Resend'})`, 'err')
  } else {
    showToast(`Quote ${q.quoteNumber} approved and PDF generated`)
  }
  await load()
}

async function emailCopy(q: any) {
  const res = await apiFetch<{ data: { status: string; sentTo?: string; from?: string; reason?: string } }>(
    `/api/v1/quotes/${q.id}/email-copy`,
    { method: 'POST', body: {} }
  )
  if (res.data.status === 'sent') {
    showToast(`Emailed ${q.quoteNumber} copy to ${res.data.sentTo}`)
  } else {
    showToast(`Email copy ${res.data.status}: ${res.data.reason || ''}`, res.data.status === 'failed' ? 'err' : 'ok')
  }
}

async function revise(q: any) {
  const res = await apiFetch<{ data: any }>(`/api/v1/quotes/${q.id}/revise`, { method: 'POST' })
  showToast(`Created revision ${res.data.quoteNumber}`)
  await load()
}

async function acceptAndOrder(q: any) {
  await apiFetch(`/api/v1/quotes/${q.id}/status`, {
    method: 'POST',
    body: { version: q.version, status: 'accepted' }
  })
  const ord = await apiFetch<{ data: any }>('/api/v1/orders', {
    method: 'POST',
    body: { fromQuoteId: q.id }
  })
  showToast(`Order ${ord.data.orderNumber} created and queued for production`)
  await load()
}

onMounted(load)
</script>
