<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Customers &amp; Interactions</h1>
        <p class="text-sm text-slate-500">Leads, B2B accounts, walk-ins, and waiting-on-owner queue</p>
      </div>
      <div class="flex gap-2">
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
        <button class="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg" @click="showCreate = !showCreate">
          {{ showCreate ? 'Close' : '+ New Customer' }}
        </button>
      </div>
    </div>

    <!-- Create Customer Form -->
    <form v-if="showCreate" class="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-3 gap-4" @submit.prevent="create">
      <input v-model="form.name" required placeholder="Full Name or Business Name" class="border rounded-lg px-3 py-2 text-sm" />
      <select v-model="form.type" class="border rounded-lg px-3 py-2 text-sm">
        <option value="person">Person</option>
        <option value="organization">Organization</option>
      </select>
      <input v-model="form.companyName" placeholder="Company Name (optional)" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model="form.email" type="email" placeholder="Email" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model="form.phone" placeholder="Phone" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model="form.leadSource" placeholder="Lead Source (e.g. walk_in, instagram)" class="border rounded-lg px-3 py-2 text-sm" />
      <textarea v-model="form.notes" placeholder="Notes..." class="border rounded-lg px-3 py-2 text-sm md:col-span-2" rows="2" />
      <div class="flex items-end">
        <button type="submit" class="w-full bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg text-sm font-medium">
          Save Customer
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
              <div class="font-semibold text-slate-900">{{ c.name }}</div>
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
              <button class="text-xs text-amber-700 hover:underline" @click="selectCustomer(c)">Interactions</button>
              <button class="text-xs text-slate-600 hover:underline" @click="toggleWaiting(c)">
                {{ c.waitingOnOwner ? 'Clear Waiting' : 'Mark Waiting' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Selected Customer Interactions -->
    <div v-if="selected" class="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold text-lg">Interactions — {{ selected.name }}</h2>
        <button class="text-xs text-slate-500 underline" @click="selected = null">Close</button>
      </div>
      <form class="flex flex-wrap gap-2" @submit.prevent="addInteraction">
        <select v-model="intForm.channel" class="border rounded-lg px-2.5 py-2 text-sm">
          <option value="call">Call</option>
          <option value="walk_in">Walk-in</option>
          <option value="message">Message</option>
          <option value="form">Web Form</option>
          <option value="email">Email</option>
        </select>
        <input v-model="intForm.summary" required placeholder="Interaction summary..." class="flex-1 border rounded-lg px-3 py-2 text-sm" />
        <button type="submit" class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">Log Touchpoint</button>
      </form>
      <div class="divide-y divide-slate-100">
        <div v-for="i in interactions" :key="i.id" class="py-2.5 flex justify-between text-sm">
          <div>
            <span class="uppercase text-xs font-semibold text-amber-700 mr-2">{{ i.channel }}</span>
            <span>{{ i.summary }}</span>
          </div>
          <span class="text-xs text-slate-400">{{ formatDate(i.occurredAt) }}</span>
        </div>
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
const selected = ref<any>(null)
const interactions = ref<any[]>([])

const form = reactive({
  name: '',
  type: 'person',
  companyName: '',
  email: '',
  phone: '',
  leadSource: '',
  notes: ''
})

const intForm = reactive({ channel: 'call', summary: '' })

async function load() {
  const params = new URLSearchParams()
  if (search.value) params.set('q', search.value)
  if (onlyWaiting.value) params.set('waitingOnOwner', 'true')
  const res = await apiFetch<{ data: any[] }>(`/api/v1/customers?${params.toString()}`)
  customers.value = res.data
}

async function create() {
  await apiFetch('/api/v1/customers', {
    method: 'POST',
    body: { ...form, email: form.email || undefined }
  })
  showToast('Customer created')
  Object.assign(form, { name: '', type: 'person', companyName: '', email: '', phone: '', leadSource: '', notes: '' })
  showCreate.value = false
  await load()
}

async function toggleWaiting(c: any) {
  await apiFetch(`/api/v1/customers/${c.id}`, {
    method: 'PATCH',
    body: { waitingOnOwner: !c.waitingOnOwner, version: c.version }
  })
  await load()
}

async function selectCustomer(c: any) {
  selected.value = c
  const res = await apiFetch<{ data: any[] }>(`/api/v1/interactions?customerId=${c.id}`)
  interactions.value = res.data
}

async function addInteraction() {
  if (!selected.value) return
  await apiFetch('/api/v1/interactions', {
    method: 'POST',
    body: { customerId: selected.value.id, channel: intForm.channel, direction: 'inbound', summary: intForm.summary }
  })
  intForm.summary = ''
  showToast('Interaction logged')
  await selectCustomer(selected.value)
}

onMounted(load)
</script>
