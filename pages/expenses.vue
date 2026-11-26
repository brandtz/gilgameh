<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Expenses &amp; Receipts</h1>
        <p class="text-sm text-slate-500">Draft-then-confirm expenses with duplicate fingerprint detection and receipt attachments</p>
      </div>
      <button class="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg" @click="showCreate = !showCreate">
        {{ showCreate ? 'Close' : '+ Draft Expense' }}
      </button>
    </div>

    <form v-if="showCreate" class="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-3 gap-4" @submit.prevent="create">
      <input v-model="form.vendor" required placeholder="Vendor (e.g. Crosscut Hardwoods)" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model="form.expenseDate" type="date" required class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model="form.category" placeholder="Category (lumber, finish, tools)" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model="form.description" required placeholder="Line Description" class="border rounded-lg px-3 py-2 text-sm" />
      <input v-model.number="form.amountDollars" type="number" step="0.01" min="0" required placeholder="Amount ($)" class="border rounded-lg px-3 py-2 text-sm" />
      <button type="submit" class="bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Create Draft Expense</button>
    </form>

    <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table class="w-full min-w-[640px] text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Date</th>
            <th class="px-4 py-3">Vendor</th>
            <th class="px-4 py-3">Category</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Total</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="e in expenses" :key="e.id">
            <td class="px-4 py-3 font-mono text-xs">{{ e.expenseDate }}</td>
            <td class="px-4 py-3 font-medium">{{ e.vendor }}</td>
            <td class="px-4 py-3 text-slate-600">{{ e.category }}</td>
            <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs bg-slate-100">{{ e.status }}</span></td>
            <td class="px-4 py-3 font-mono">{{ formatMoney(e.totalCents) }}</td>
            <td class="px-4 py-3 text-right">
              <button v-if="e.status === 'draft'" class="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded" @click="approve(e)">
                Approve (v{{ e.version }})
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
const expenses = ref<any[]>([])
const showCreate = ref(false)
const form = reactive({
  vendor: '',
  expenseDate: new Date().toISOString().slice(0, 10),
  category: 'materials',
  description: '',
  amountDollars: 0
})

async function load() {
  const res = await apiFetch<{ data: any[] }>('/api/v1/expenses')
  expenses.value = res.data
}

async function create() {
  await apiFetch('/api/v1/expenses', {
    method: 'POST',
    body: {
      vendor: form.vendor,
      expenseDate: form.expenseDate,
      category: form.category,
      lineItems: [{ description: form.description, quantity: 1, unitPriceCents: Math.round(form.amountDollars * 100) }]
    }
  })
  showToast('Draft expense created')
  showCreate.value = false
  await load()
}

async function approve(e: any) {
  await apiFetch(`/api/v1/expenses/${e.id}/approve`, {
    method: 'POST',
    body: { version: e.version }
  })
  showToast('Expense approved')
  await load()
}

onMounted(load)
</script>
