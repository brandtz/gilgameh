<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Invoices &amp; Payments</h1>
        <p class="text-sm text-slate-500">Create standalone invoices or convert orders, generate branded PDFs with your logo &amp; check instructions, and record payments</p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/settings" class="border border-slate-300 bg-white hover:bg-slate-50 text-sm px-3 py-2 rounded-lg">
          PDF Template &amp; Logo
        </NuxtLink>
        <button class="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg" @click="showCreate = !showCreate">
          {{ showCreate ? 'Close Builder' : '+ New Draft Invoice' }}
        </button>
      </div>
    </div>

    <!-- Standalone Draft Invoice Builder -->
    <form v-if="showCreate" class="bg-white rounded-xl border border-slate-200 p-5 space-y-4" @submit.prevent="createInvoice">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-xs text-slate-500 mb-1">Customer</label>
          <select v-model="invForm.customerId" required class="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="" disabled>Select Customer...</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Due Date (optional)</label>
          <input v-model="invForm.dueDate" type="date" class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Invoice Notes / Payment Instructions</label>
          <input v-model="invForm.notes" placeholder="Custom instructions..." class="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div class="space-y-2.5">
        <div class="text-xs font-semibold uppercase text-slate-500">Line Items (Catalog or Free-Form)</div>
        <div
          v-for="(line, idx) in invForm.lines"
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
            <button v-if="invForm.lines.length > 1" type="button" class="text-xs text-red-600 hover:underline" @click="invForm.lines.splice(idx, 1)">
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
          Create Draft Invoice
        </button>
      </div>
    </form>

    <!-- Catalog Default Update Confirmation Pop-up -->
    <div v-if="pendingCatalogUpdates.length > 0" class="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <h3 class="text-lg font-bold text-slate-900">Update Catalog Defaults?</h3>
        <p class="text-sm text-slate-600">
          Your draft invoice was saved with your edited values. Would you also like to update the product catalog defaults for these items?
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
            Keep Invoice-Only
          </button>
          <button type="button" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium" @click="applyCatalogUpdates">
            Update Selected Defaults
          </button>
        </div>
      </div>
    </div>

    <!-- Invoices Table -->
    <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table class="w-full min-w-[680px] text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Invoice #</th>
            <th class="px-4 py-3">Customer</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Total</th>
            <th class="px-4 py-3">Balance Due</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="inv in invoices" :key="inv.id">
            <td class="px-4 py-3 font-mono font-semibold">{{ inv.invoiceNumber }}</td>
            <td class="px-4 py-3">{{ inv.customerName }}</td>
            <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs bg-slate-100">{{ inv.status }}</span></td>
            <td class="px-4 py-3 font-mono">{{ formatMoney(inv.totalCents) }}</td>
            <td class="px-4 py-3 font-mono font-semibold text-amber-700">{{ formatMoney(inv.balanceDueCents) }}</td>
            <td class="px-4 py-3 text-right space-x-2">
              <a :href="inv.pdfUrl" target="_blank" class="text-xs text-slate-600 underline">PDF</a>
              <button v-if="inv.status === 'draft'" class="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded" @click="approve(inv)">
                Approve &amp; Send
              </button>
              <button
                v-if="inv.balanceDueCents > 0 && inv.status !== 'draft'"
                class="text-xs bg-slate-900 text-white px-2.5 py-1 rounded"
                @click="openPay(inv)"
              >
                Record Payment
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Payment Form -->
    <form v-if="payInvoice" class="bg-white rounded-xl border border-slate-200 p-5 space-y-3" @submit.prevent="submitPayment">
      <div class="font-semibold">Record Payment for {{ payInvoice.invoiceNumber }}</div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <select v-model="payForm.method" class="border rounded-lg px-3 py-2 text-sm">
          <option value="check">Check</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="stripe">Stripe</option>
          <option value="ach">ACH</option>
        </select>
        <input v-model.number="payForm.amountDollars" type="number" step="0.01" min="0.01" required class="border rounded-lg px-3 py-2 text-sm" />
        <input v-model="payForm.reference" placeholder="Check # / Reference" class="border rounded-lg px-3 py-2 text-sm" />
        <button type="submit" class="bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Save Payment</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { apiFetch, showToast } = useAuthState()
const invoices = ref<any[]>([])
const customers = ref<any[]>([])
const catalogItems = ref<any[]>([])
const showCreate = ref(false)
const payInvoice = ref<any>(null)
const payForm = reactive({ method: 'check', amountDollars: 0, reference: '' })
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

interface InvoiceBuilderLine {
  catalogItemId: string
  description: string
  quantity: number
  unit: string
  unitPriceDollars: number
  taxable: boolean
}

const invForm = reactive<{
  customerId: string
  dueDate: string
  notes: string
  lines: InvoiceBuilderLine[]
}>({
  customerId: '',
  dueDate: '',
  notes: '',
  lines: [{ catalogItemId: '', description: '', quantity: 1, unit: 'each', unitPriceDollars: 0, taxable: true }]
})

const estimatedSubtotalCents = computed(() =>
  invForm.lines.reduce((sum, l) => sum + Math.round((Number(l.quantity) || 0) * Math.round((Number(l.unitPriceDollars) || 0) * 100)), 0)
)

function addLine() {
  invForm.lines.push({ catalogItemId: '', description: '', quantity: 1, unit: 'each', unitPriceDollars: 0, taxable: true })
}

function onSelectCatalogItem(line: InvoiceBuilderLine) {
  if (!line.catalogItemId) return
  const item = catalogItems.value.find((i) => i.id === line.catalogItemId)
  if (!item) return
  line.description = item.name
  line.unit = item.unit || 'each'
  line.unitPriceDollars = Number((item.basePriceCents / 100).toFixed(2))
  line.taxable = item.taxable !== false
}

async function load() {
  const [iRes, cRes, catRes] = await Promise.all([
    apiFetch<{ data: any[] }>('/api/v1/invoices'),
    apiFetch<{ data: any[] }>('/api/v1/customers'),
    apiFetch<{ data: any[] }>('/api/v1/catalog?limit=100')
  ])
  invoices.value = iRes.data
  customers.value = cRes.data
  catalogItems.value = catRes.data
  if (typeof route.query.customerId === 'string' && route.query.customerId) {
    invForm.customerId = route.query.customerId
    showCreate.value = true
  }
}

async function createInvoice() {
  const diffs: typeof pendingCatalogUpdates.value = []
  for (const line of invForm.lines) {
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

  await apiFetch('/api/v1/invoices', {
    method: 'POST',
    body: {
      customerId: invForm.customerId,
      dueAt: invForm.dueDate ? new Date(`${invForm.dueDate}T23:59:59Z`).toISOString() : undefined,
      notes: invForm.notes || undefined,
      lines: invForm.lines.map((l) => ({
        catalogItemId: l.catalogItemId || undefined,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceCents: Math.round(l.unitPriceDollars * 100),
        taxable: l.taxable
      }))
    }
  })
  showToast('Draft invoice created')
  showCreate.value = false
  invForm.dueDate = ''
  invForm.notes = ''
  invForm.lines = [{ catalogItemId: '', description: '', quantity: 1, unit: 'each', unitPriceDollars: 0, taxable: true }]
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

async function approve(inv: any) {
  await apiFetch(`/api/v1/invoices/${inv.id}/approve`, {
    method: 'POST',
    body: { version: inv.version, sendEmail: true }
  })
  showToast(`Invoice ${inv.invoiceNumber} approved & sent`)
  await load()
}

function openPay(inv: any) {
  payInvoice.value = inv
  payForm.amountDollars = inv.balanceDueCents / 100
  payForm.reference = ''
}

async function submitPayment() {
  if (!payInvoice.value) return
  await apiFetch('/api/v1/payments', {
    method: 'POST',
    body: {
      invoiceId: payInvoice.value.id,
      method: payForm.method,
      amountCents: Math.round(payForm.amountDollars * 100),
      reference: payForm.reference || undefined
    }
  })
  showToast('Payment recorded')
  payInvoice.value = null
  await load()
}

onMounted(load)
</script>
