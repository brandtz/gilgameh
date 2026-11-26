<template>
  <div class="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4 py-12">
    <div class="w-full max-w-3xl space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4 text-white">
        <div>
          <div class="text-xs uppercase tracking-wider font-semibold text-amber-400">Back Office Platform</div>
          <h1 class="text-2xl font-bold mt-1">Select a Business Workspace</h1>
          <p class="text-sm text-slate-400 mt-0.5">
            Signed in as {{ auth?.actor?.actorLabel }} — choose the business you want to manage.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button
            v-if="auth?.actor?.actorType === 'operator'"
            class="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
            @click="showCreate = !showCreate"
          >
            {{ showCreate ? 'Cancel' : '+ Add Business' }}
          </button>
          <NuxtLink to="/profile" class="text-xs text-slate-300 hover:text-white underline">My Profile</NuxtLink>
          <button class="text-xs text-slate-300 hover:text-white underline" @click="logout">Sign out</button>
        </div>
      </div>

      <!-- Create Business Form (BWE Operators only) -->
      <form
        v-if="showCreate && auth?.actor?.actorType === 'operator'"
        class="bg-white rounded-xl p-6 shadow-xl grid grid-cols-1 md:grid-cols-2 gap-4"
        @submit.prevent="createBusiness"
      >
        <div class="md:col-span-2 font-semibold text-slate-900">Onboard New Tenant Business</div>
        <input v-model="newBiz.name" required placeholder="Business Name (e.g. Guided Growth Early Learning)" class="border rounded-lg px-3 py-2 text-sm" @input="autoSlug" />
        <input v-model="newBiz.slug" required pattern="[a-z0-9-]+" placeholder="Slug (e.g. guided-growth)" class="border rounded-lg px-3 py-2 text-sm font-mono" />
        <input v-model="newBiz.legalName" placeholder="Legal Name (optional)" class="border rounded-lg px-3 py-2 text-sm" />
        <input v-model="newBiz.contactName" placeholder="Primary Owner / Contact Name" class="border rounded-lg px-3 py-2 text-sm" />
        <input v-model="newBiz.email" type="email" placeholder="Business Email" class="border rounded-lg px-3 py-2 text-sm" />
        <input v-model="newBiz.phone" placeholder="Business Phone" class="border rounded-lg px-3 py-2 text-sm" />
        <div class="md:col-span-2 flex justify-end">
          <button type="submit" class="bg-slate-900 text-white px-5 py-2 rounded-lg text-sm font-medium">
            Create &amp; Enter Workspace
          </button>
        </div>
      </form>

      <!-- Tenant Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          v-for="t in auth?.tenants || []"
          :key="t.id"
          class="bg-white hover:ring-2 hover:ring-amber-500 rounded-xl p-6 text-left shadow-lg transition group"
          @click="selectBusiness(t.id)"
        >
          <div class="flex items-center justify-between">
            <div class="text-lg font-bold text-slate-900 group-hover:text-amber-700">{{ t.name }}</div>
            <span class="text-xs font-mono text-slate-400">{{ t.slug }}</span>
          </div>
          <div class="text-xs text-slate-500 mt-2">
            Open isolated CRM, quotes, invoices, inventory, and Chatwoot workspace →
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { auth, loadMe, selectBusiness, apiFetch, showToast, logout } = useAuthState()
const showCreate = ref(false)
const newBiz = reactive({
  name: '',
  slug: '',
  legalName: '',
  contactName: '',
  email: '',
  phone: ''
})

function autoSlug() {
  newBiz.slug = newBiz.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

onMounted(async () => {
  const me = await loadMe()
  if (!me) {
    await navigateTo('/login')
    return
  }
  // Single-tenant users (e.g. Drew) should NEVER see the business selector landing page
  if (me.tenants.length <= 1) {
    await navigateTo('/')
  }
})

async function createBusiness() {
  const res = await apiFetch<{ data: { id: string } }>('/api/v1/tenant', {
    method: 'POST',
    body: {
      name: newBiz.name,
      slug: newBiz.slug,
      legalName: newBiz.legalName || undefined,
      contactName: newBiz.contactName || undefined,
      email: newBiz.email || undefined,
      phone: newBiz.phone || undefined
    }
  })
  showToast(`Created business "${newBiz.name}"`)
  showCreate.value = false
  await selectBusiness(res.data.id)
}
</script>
