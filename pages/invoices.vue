<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">Invoices &amp; Payments</h1>
      <p class="text-sm text-slate-500">Draft-then-confirm invoicing, branded PDFs, and multi-method payment recording</p>
    </div>

    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
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
const { apiFetch, showToast } = useAuthState()
const invoices = ref<any[]>([])
const payInvoice = ref<any>(null)
const payForm = reactive({ method: 'check', amountDollars: 0, reference: '' })

async function load() {
  const res = await apiFetch<{ data: any[] }>('/api/v1/invoices')
  invoices.value = res.data
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
