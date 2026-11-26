<template>
  <div class="max-w-3xl space-y-6">
    <div>
      <h1 class="text-2xl font-bold">My Profile</h1>
      <p class="text-sm text-slate-500">Manage your personal contact information and password</p>
    </div>

    <form v-if="profile" class="bg-white rounded-xl border border-slate-200 p-6 space-y-4" @submit.prevent="saveProfile">
      <div class="font-semibold text-slate-900">Contact &amp; Account Details</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <label class="block text-xs text-slate-500 mb-1">Full Name</label>
          <input v-model="profile.name" required class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Email Address</label>
          <input v-model="profile.email" type="email" required class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Phone Number</label>
          <input v-model="profile.phone" placeholder="(503) 555-0100" class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Title / Role Label</label>
          <input v-model="profile.title" placeholder="Owner / Shop Manager" class="w-full border rounded-lg px-3 py-2" />
        </div>
      </div>
      <div class="flex items-center justify-between pt-2">
        <div class="text-xs text-slate-500">
          Platform role: <span class="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{{ profile.role }}</span>
        </div>
        <button type="submit" class="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
          Save Profile
        </button>
      </div>
    </form>

    <form class="bg-white rounded-xl border border-slate-200 p-6 space-y-4" @submit.prevent="updatePassword">
      <div class="font-semibold text-slate-900">Change Password</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <label class="block text-xs text-slate-500 mb-1">Current Password</label>
          <input v-model="pw.currentPassword" type="password" autocomplete="current-password" required class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">New Password (min 10 chars)</label>
          <input v-model="pw.newPassword" type="password" autocomplete="new-password" minlength="10" required class="w-full border rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Confirm New Password</label>
          <input v-model="pw.confirmPassword" type="password" autocomplete="new-password" minlength="10" required class="w-full border rounded-lg px-3 py-2" />
        </div>
      </div>
      <div class="flex justify-end">
        <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          Update Password
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
const { apiFetch, loadMe, showToast } = useAuthState()
const profile = ref<any>(null)
const pw = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })

async function load() {
  const res = await apiFetch<{ data: any }>('/api/v1/profile')
  profile.value = res.data
}

async function saveProfile() {
  await apiFetch('/api/v1/profile', {
    method: 'PATCH',
    body: {
      name: profile.value.name,
      email: profile.value.email,
      phone: profile.value.phone || null,
      title: profile.value.title || null
    }
  })
  await loadMe()
  showToast('Profile updated')
}

async function updatePassword() {
  if (pw.newPassword !== pw.confirmPassword) {
    showToast('New passwords do not match', 'err')
    return
  }
  await apiFetch('/api/v1/profile/password', {
    method: 'POST',
    body: {
      currentPassword: pw.currentPassword,
      newPassword: pw.newPassword
    }
  })
  pw.currentPassword = ''
  pw.newPassword = ''
  pw.confirmPassword = ''
  showToast('Password updated successfully')
}

onMounted(load)
</script>
