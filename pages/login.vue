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
            autocomplete="email"
            placeholder="you@company.com"
            required
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-600 focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
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
    </div>
  </div>
</template>

<script setup lang="ts">
const { loadMe } = useAuthState()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

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
