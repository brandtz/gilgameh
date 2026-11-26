<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Customers &amp; History</h1>
        <p class="text-sm text-slate-500">Click any customer name for full profile, edit options, interactions, quotes, orders, invoices, and payments</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <input
          v-model="search"
          placeholder="Search name, email, phone..."
          class="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          @input="load"
        />
        <label class="flex items-center gap-1.5 text-sm bg-white border border-slate-300 rounded-lg px-3 py-2">
          <input v-model="onlyWaiting" type="checkbox" @change="load" />
          <span>Waiting on owner</span>
        </label>
        <button class="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg" @click="toggleCreate">
          {{ showCreate ? 'Close' : '+ New Customer' }}
        </button>
      </div>
    </div>

    <!-- Create / Edit Customer Form -->
    <form v-if="showCreate || editingCustomer" class="bg-white rounded-xl border border-slate-200 p-5 space-y-4" @submit.prevent="saveCustomer">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold text-base">
          {{ editingCustomer ? `Edit Customer — ${editingCustomer.name}` : 'New Customer' }}
        </h2>
        <button type="button" class="text-xs text-slate-500 underline" @click="cancelForm">Cancel</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <input v-model="form.name" required placeholder="Full Name or Business Name" class="border rounded-lg px-3 py-2" />
        <select v-model="form.type" class="border rounded-lg px-3 py-2">
          <option value="person">Person</option>
          <option value="organization">Organization</option>
        </select>
        <select v-model="form.status" class="border rounded-lg px-3 py-2">
          <option value="lead">Lead</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <input v-model="form.companyName" placeholder="Company Name (optional)" class="border rounded-lg px-3 py-2" />
        <input v-model="form.email" type="email" placeholder="Email" class="border rounded-lg px-3 py-2" />
        <input v-model="form.phone" placeholder="Phone" class="border rounded-lg px-3 py-2" />
        <input v-model="form.address.line1" placeholder="Street Address" class="border rounded-lg px-3 py-2" />
        <input v-model="form.address.city" placeholder="City" class="border rounded-lg px-3 py-2" />
        <div class="grid grid-cols-2 gap-2">
          <input v-model="form.address.state" placeholder="State" class="border rounded-lg px-3 py-2" />
          <input v-model="form.address.postalCode" placeholder="ZIP" class="border rounded-lg px-3 py-2" />
        </div>
        <input v-model="form.leadSource" placeholder="Lead Source (e.g. walk_in, website)" class="border rounded-lg px-3 py-2" />
        <label class="flex items-center gap-2 border rounded-lg px-3 py-2 bg-slate-50">
          <input v-model="form.waitingOnOwner" type="checkbox" />
          <span>Waiting on owner</span>
        </label>
        <textarea v-model="form.notes" placeholder="Customer notes..." class="border rounded-lg px-3 py-2 md:col-span-3" rows="2" />
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" class="border border-slate-300 px-4 py-2 rounded-lg text-sm" @click="cancelForm">Cancel</button>
        <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg text-sm font-medium">
          {{ editingCustomer ? 'Save Changes' : 'Create Customer' }}
        </button>
      </div>
    </form>

    <!-- Customers Table -->
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b border-slate-200">
          <tr>
            <th class="px-4 py-3">Customer</th>
            <th class="px-4 py-3">Contact</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Source</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="c in customers" :key="c.id" class="hover:bg-slate-50">
            <td class="px-4 py-3">
              <button
                type="button"
                class="font-semibold text-amber-800 hover:text-amber-600 hover:underline text-left"
                @click="openCustomerDetails(c.id)"
              >
                {{ c.name }}
              </button>
              <div v-if="c.companyName" class="text-xs text-slate-500">{{ c.companyName }}</div>
            </td>
            <td class="px-4 py-3 text-slate-600">
              <div>{{ c.email || '—' }}</div>
              <div class="text-xs text-slate-400">{{ c.phone || '' }}</div>
            </td>
            <td class="px-4 py-3">
              <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">{{ c.status }}</span>
              <span v-if="c.waitingOnOwner" class="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">
                Waiting on owner
              </span>
            </td>
            <td class="px-4 py-3 text-xs text-slate-500">{{ c.leadSource || '—' }}</td>
            <td class="px-4 py-3 text-right space-x-2">
              <button class="text-xs text-amber-700 hover:underline font-medium" @click="openCustomerDetails(c.id)">Details</button>
              <button class="text-xs text-slate-700 hover:underline font-medium" @click="startEdit(c)">Edit</button>
              <button class="text-xs text-slate-500 hover:underline" @click="toggleWaiting(c)">
                {{ c.waitingOnOwner ? 'Clear Waiting' : 'Mark Waiting' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Full Customer Record & Connected History Panel -->
    <div v-if="details" class="bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-bold text-slate-900">{{ details.customer.name }}</h2>
            <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">{{ details.customer.status }}</span>
            <span v-if="details.customer.waitingOnOwner" class="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">
              Waiting on owner
            </span>
          </div>
          <div class="text-sm text-slate-600 mt-1 space-x-3">
            <span v-if="details.customer.companyName">{{ details.customer.companyName }}</span>
            <span v-if="details.customer.email">{{ details.customer.email }}</span>
            <span v-if="details.customer.phone">{{ details.customer.phone }}</span>
          </div>
          <div v-if="formatAddress(details.customer.address)" class="text-xs text-slate-500 mt-1">
            {{ formatAddress(details.customer.address) }}
          </div>
          <div v-if="details.customer.notes" class="text-xs text-slate-600 mt-2 bg-slate-50 rounded p-2.5 border">
            {{ details.customer.notes }}
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg" @click="startEdit(details.customer)">
            Edit Record
          </button>
          <NuxtLink :to="`/quotes?customerId=${details.customer.id}`" class="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg">
            + Draft Quote
          </NuxtLink>
          <NuxtLink :to="`/invoices?customerId=${details.customer.id}`" class="text-xs border border-slate-300 px-3 py-1.5 rounded-lg">
            + New Invoice
          </NuxtLink>
          <button class="text-xs text-slate-500 underline px-2" @click="details = null">Close</button>
        </div>
      </div>

      <!-- Detail Tabs -->
      <div class="flex flex-wrap gap-2 border-b border-slate-200 text-sm">
        <button
          v-for="t in detailTabs"
          :key="t.key"
          class="px-3 py-2 font-medium border-b-2 transition"
          :class="activeTab === t.key ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-800'"
          @click="activeTab = t.key"
        >
          {{ t.label }} ({{ t.count }})
        </button>
      </div>

      <!-- Interactions Tab -->
      <div v-if="activeTab === 'interactions'" class="space-y-4">
        <form class="flex flex-wrap gap-2" @submit.prevent="addInteraction">
          <select v-model="intForm.channel" class="border rounded-lg px-2.5 py-2 text-sm">
            <option value="call">Call</option>
            <option value="walk_in">Walk-in</option>
            <option value="message">Message</option>
            <option value="form">Web Form</option>
            <option value="email">Email</option>
          </select>
          <input v-model="intForm.summary" required placeholder="Log a call, walk-in, or note..." class="flex-1 border rounded-lg px-3 py-2 text-sm" />
          <button type="submit" class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">Log Touchpoint</button>
        </form>
        <div class="divide-y divide-slate-100">
          <div v-for="i in details.interactions" :key="i.id" class="py-2.5 flex justify-between text-sm">
            <div>
              <span class="uppercase text-xs font-semibold text-amber-700 mr-2">{{ i.channel }}</span>
              <span>{{ i.summary }}</span>
            </div>
            <span class="text-xs text-slate-400">{{ formatDate(i.occurredAt) }}</span>
          </div>
          <div v-if="details.interactions.length === 0" class="py-4 text-center text-xs text-slate-400">No interactions logged yet.</div>
        </div>
      </div>

      <!-- Connected Quotes Tab -->
      <div v-else-if="activeTab === 'quotes'" class="divide-y divide-slate-100 text-sm">
        <div v-for="q in details.quotes" :key="q.id" class="py-2.5 flex items-center justify-between">
          <div>
            <span class="font-mono font-semibold">{{ q.quoteNumber }}</span>
            <span class="ml-2 px-2 py-0.5 rounded-full text-xs bg-slate-100">{{ q.status }}</span>
            <span v-if="q.customerPoNumber" class="ml-2 text-xs text-slate-500">PO: {{ q.customerPoNumber }}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="font-mono font-medium">{{ formatMoney(q.totalCents) }}</span>
            <a :href="q.pdfUrl" target="_blank" class="text-xs text-amber-700 underline">PDF</a>
          </div>
        </div>
        <div v-if="details.quotes.length === 0" class="py-4 text-center text-xs text-slate-400">No quotes yet for this customer.</div>
      </div>

      <!-- Connected Orders Tab -->
      <div v-else-if="activeTab === 'orders'" class="divide-y divide-slate-100 text-sm">
        <div v-for="o in details.orders" :key="o.id" class="py-2.5 flex items-center justify-between">
          <div>
            <span class="font-mono font-semibold">{{ o.orderNumber }}</span>
            <span class="ml-2 px-2 py-0.5 rounded-full text-xs bg-slate-100">{{ o.status }}</span>
            <span class="ml-2 text-xs uppercase text-slate-400">{{ o.channel }}</span>
          </div>
          <div class="font-mono font-medium">{{ formatMoney(o.totalCents) }}</div>
        </div>
        <div v-if="details.orders.length === 0" class="py-4 text-center text-xs text-slate-400">No orders yet for this customer.</div>
      </div>

      <!-- Connected Invoices Tab -->
      <div v-else-if="activeTab === 'invoices'" class="divide-y divide-slate-100 text-sm">
        <div v-for="inv in details.invoices" :key="inv.id" class="py-2.5 flex items-center justify-between">
          <div>
            <span class="font-mono font-semibold">{{ inv.invoiceNumber }}</span>
            <span class="ml-2 px-2 py-0.5 rounded-full text-xs bg-slate-100">{{ inv.status }}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="font-mono">Total {{ formatMoney(inv.totalCents) }} · Due {{ formatMoney(inv.balanceDueCents) }}</span>
            <a :href="inv.pdfUrl" target="_blank" class="text-xs text-amber-700 underline">PDF</a>
          </div>
        </div>
        <div v-if="details.invoices.length === 0" class="py-4 text-center text-xs text-slate-400">No invoices yet for this customer.</div>
      </div>

      <!-- Connected Payments Tab -->
      <div v-else-if="activeTab === 'payments'" class="divide-y divide-slate-100 text-sm">
        <div v-for="p in details.payments" :key="p.id" class="py-2.5 flex items-center justify-between">
          <div>
            <span class="uppercase text-xs font-semibold text-emerald-700 mr-2">{{ p.method }}</span>
            <span class="text-slate-600">{{ p.reference || 'Payment received' }}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="font-mono font-semibold">{{ formatMoney(p.amountCents) }}</span>
            <span class="text-xs text-slate-400">{{ formatDate(p.paidAt) }}</span>
          </div>
        </div>
        <div v-if="details.payments.length === 0" class="py-4 text-center text-xs text-slate-400">No payments recorded yet.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { apiFetch, showToast } = useAuthState()
const customers = ref<any[]>([])
const search = ref('')
const onlyWaiting = ref(false)
const showCreate = ref(false)
const editingCustomer = ref<any>(null)
const details = ref<any>(null)
const activeTab = ref<'interactions' | 'quotes' | 'orders' | 'invoices' | 'payments'>('interactions')

const form = reactive({
  name: '',
  type: 'person',
  status: 'lead',
  companyName: '',
  email: '',
  phone: '',
  leadSource: '',
  waitingOnOwner: false,
  notes: '',
  address: { line1: '', city: '', state: '', postalCode: '' }
})

const intForm = reactive({ channel: 'call', summary: '' })

const detailTabs = computed(() => [
  { key: 'interactions' as const, label: 'Interactions', count: details.value?.interactions?.length || 0 },
  { key: 'quotes' as const, label: 'Quotes', count: details.value?.quotes?.length || 0 },
  { key: 'orders' as const, label: 'Orders', count: details.value?.orders?.length || 0 },
  { key: 'invoices' as const, label: 'Invoices', count: details.value?.invoices?.length || 0 },
  { key: 'payments' as const, label: 'Payments', count: details.value?.payments?.length || 0 }
])

function formatAddress(addr: any) {
  if (!addr) return ''
  return [addr.line1, addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ')
}

function resetForm() {
  Object.assign(form, {
    name: '',
    type: 'person',
    status: 'lead',
    companyName: '',
    email: '',
    phone: '',
    leadSource: '',
    waitingOnOwner: false,
    notes: '',
    address: { line1: '', city: '', state: '', postalCode: '' }
  })
}

function toggleCreate() {
  editingCustomer.value = null
  resetForm()
  showCreate.value = !showCreate.value
}

function startEdit(c: any) {
  showCreate.value = false
  editingCustomer.value = c
  Object.assign(form, {
    name: c.name || '',
    type: c.type || 'person',
    status: c.status || 'lead',
    companyName: c.companyName || '',
    email: c.email || '',
    phone: c.phone || '',
    leadSource: c.leadSource || '',
    waitingOnOwner: Boolean(c.waitingOnOwner),
    notes: c.notes || '',
    address: {
      line1: c.address?.line1 || '',
      city: c.address?.city || '',
      state: c.address?.state || '',
      postalCode: c.address?.postalCode || ''
    }
  })
}

function cancelForm() {
  showCreate.value = false
  editingCustomer.value = null
  resetForm()
}

async function load() {
  const params = new URLSearchParams()
  if (search.value) params.set('q', search.value)
  if (onlyWaiting.value) params.set('waitingOnOwner', 'true')
  const res = await apiFetch<{ data: any[] }>(`/api/v1/customers?${params.toString()}`)
  customers.value = res.data
}

async function openCustomerDetails(id: string) {
  const res = await apiFetch<{ data: any }>(`/api/v1/customers/${id}?include=details`)
  details.value = res.data
}

async function saveCustomer() {
  const payload = {
    name: form.name,
    type: form.type,
    status: form.status,
    companyName: form.companyName || null,
    email: form.email || null,
    phone: form.phone || null,
    leadSource: form.leadSource || null,
    waitingOnOwner: form.waitingOnOwner,
    notes: form.notes || null,
    address: form.address
  }

  if (editingCustomer.value) {
    const id = editingCustomer.value.id
    await apiFetch(`/api/v1/customers/${id}`, {
      method: 'PATCH',
      body: { ...payload, version: editingCustomer.value.version }
    })
    showToast('Customer updated')
    cancelForm()
    await load()
    if (details.value?.customer?.id === id) {
      await openCustomerDetails(id)
    }
  } else {
    await apiFetch('/api/v1/customers', {
      method: 'POST',
      body: { ...payload, email: form.email || undefined }
    })
    showToast('Customer created')
    cancelForm()
    await load()
  }
}

async function toggleWaiting(c: any) {
  await apiFetch(`/api/v1/customers/${c.id}`, {
    method: 'PATCH',
    body: { waitingOnOwner: !c.waitingOnOwner, version: c.version }
  })
  await load()
  if (details.value?.customer?.id === c.id) {
    await openCustomerDetails(c.id)
  }
}

async function addInteraction() {
  if (!details.value?.customer) return
  await apiFetch('/api/v1/interactions', {
    method: 'POST',
    body: {
      customerId: details.value.customer.id,
      channel: intForm.channel,
      direction: 'inbound',
      summary: intForm.summary
    }
  })
  intForm.summary = ''
  showToast('Interaction logged')
  await openCustomerDetails(details.value.customer.id)
}

onMounted(load)
</script>
