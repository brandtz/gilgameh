<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Quotes &amp; Revisions</h1>
        <p class="text-sm text-slate-500">Draft-then-confirm pricing, immutable sent quotes, revisions (Q-xxxx-R2), and branded PDFs</p>
      </div>
      <button class="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg" @click="showCreate = !showCreate">
        {{ showCreate ? 'Close Builder' : '+ New Draft Quote' }}
      </button>
    </div>

    <!-- Draft Quote Builder -->
    <form v-if="showCreate" class="bg-white rounded-xl border border-slate-200 p-5 space-y-4" @submit.prevent="createQuote">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <select v-model="form.customerId" required class="border rounded-lg px-3 py-2 text-sm">
          <option value="" disabled>Select Customer...</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <input v-model="form.customerPoNumber" placeholder="Customer PO # (optional)" class="border rounded-lg px-3 py-2 text-sm" />
        <input v-model="form.notes" placeholder="Quote notes..." class="border rounded-lg px-3 py-2 text-sm" />
      </div>

      <div class="space-y-2">
        <div class="text-xs font-semibold uppercase text-slate-500">Line Items</div>
        <div v-for="(line, idx) in form.lines" :key="idx" class="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
          <input v-model="line.description" required placeholder="Description" class="md:col-span-5 border rounded-lg px-3 py-2 text-sm" />
          <input v-model.number="line.quantity" type="number" step="0.5" min="0.001" required class="md:col-span-2 border rounded-lg px-3 py-2 text-sm" />
          <input v-model="line.unit" placeholder="Unit" class="md:col-span-2 border rounded-lg px-3 py-2 text-sm" />
          <input v-model.number="line.unitPriceDollars" type="number" step="0.01" min="0" required placeholder="Unit $" class="md:col-span-2 border rounded-lg px-3 py-2 text-sm" />
          <button v-if="form.lines.length > 1" type="button" class="text-xs text-red-600" @click="form.lines.splice(idx, 1)">Remove</button>
        </div>
        <button type="button" class="text-xs text-amber-700 font-medium underline" @click="addLine">+ Add Line</button>
      </div>

      <div class="flex justify-end">
        <button type="submit" class="bg-slate-900 text-white px-5 py-2 rounded-lg text-sm font-medium">
          Create Draft Quote
        </button>
      </div>
    </form>

    <!-- Quotes Table -->
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
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
const { apiFetch, showToast } = useAuthState()
const quotes = ref<any[]>([])
const customers = ref<any[]>([])
const showCreate = ref(false)

const form = reactive({
  customerId: '',
  customerPoNumber: '',
  notes: '',
  lines: [{ description: '', quantity: 1, unit: 'each', unitPriceDollars: 0 }]
})

function addLine() {
  form.lines.push({ description: '', quantity: 1, unit: 'each', unitPriceDollars: 0 })
}

async function load() {
  const [qRes, cRes] = await Promise.all([
    apiFetch<{ data: any[] }>('/api/v1/quotes'),
    apiFetch<{ data: any[] }>('/api/v1/customers')
  ])
  quotes.value = qRes.data
  customers.value = cRes.data
}

async function createQuote() {
  await apiFetch('/api/v1/quotes', {
    method: 'POST',
    body: {
      customerId: form.customerId,
      customerPoNumber: form.customerPoNumber || undefined,
      notes: form.notes || undefined,
      lines: form.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceCents: Math.round(l.unitPriceDollars * 100)
      }))
    }
  })
  showToast('Draft quote created')
  showCreate.value = false
  await load()
}

async function approve(q: any) {
  await apiFetch(`/api/v1/quotes/${q.id}/approve`, {
    method: 'POST',
    body: { version: q.version, sendEmail: true }
  })
  showToast(`Quote ${q.quoteNumber} approved and PDF generated`)
  await load()
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
