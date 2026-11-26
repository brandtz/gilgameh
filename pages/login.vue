<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-900 px-4">
    <div class="w-full max-w-md bg-white rounded-xl shadow-xl p-8">
      <div class="text-xs uppercase tracking-wider font-semibold text-amber-600">Back Office Platform</div>
      <h1 class="text-2xl font-bold text-slate-900 mt-1">Sign in to Operations</h1>
      <p class="text-sm text-slate-500 mt-1">BWE Operator &amp; Tenant Owner Portal</p>

      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            v-model="email"
            type="email"
            required
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-600 focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
          <input
            v-model="password"
            type="password"
            required
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-600 focus:outline-none"
          />
        </div>
        <div v-if="error" class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {{ error }}
        </div>
        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 rounded-lg text-sm transition disabled:opacity-50"
        >
          {{ loading ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>

      <div class="mt-6 pt-5 border-t border-slate-200">
        <div class="text-xs font-medium text-slate-500 mb-2">Seeded Demo Accounts (Studio 37):</div>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="text-xs border border-slate-200 rounded-lg py-2 px-2.5 hover:bg-slate-50 text-left"
            @click="fill('matthew@bwe.local', 'BweOperator!2026')"
          >
            <div class="font-semibold text-slate-800">BWE Operator</div>
            <div class="text-slate-500 truncate">matthew@bwe.local</div>
          </button>
          <button
            type="button"
            class="text-xs border border-slate-200 rounded-lg py-2 px-2.5 hover:bg-slate-50 text-left"
            @click="fill('drew@studio37.local', 'Studio37Owner!2026')"
          >
            <div class="font-semibold text-slate-800">Studio 37 Owner</div>
            <div class="text-slate-500 truncate">drew@studio37.local</div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { loadMe } = useAuthState()
const email = ref('drew@studio37.local')
const password = ref('Studio37Owner!2026')
const loading = ref(false)
const error = ref('')

function fill(e: string, p: string) {
  email.value = e
  password.value = p
}

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/v1/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
      credentials: 'include'
    })
    await loadMe()
    await navigateTo('/')
  } catch (err: any) {
    error.value = err?.data?.error?.message || 'Login failed'
  } finally {
    loading.value = false
  }
}
</script>
