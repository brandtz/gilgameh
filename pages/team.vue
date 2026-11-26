<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Team &amp; Permissions (RBAC)</h1>
        <p class="text-sm text-slate-500">
          Manage users and role-based permissions strictly scoped to <strong>{{ auth?.tenant?.name }}</strong>
        </p>
      </div>
      <button class="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg" @click="showAdd = !showAdd">
        {{ showAdd ? 'Close' : '+ Add Team Member' }}
      </button>
    </div>

    <!-- Add Member Form -->
    <form v-if="showAdd" class="bg-white rounded-xl border border-slate-200 p-5 space-y-4" @submit.prevent="addMember">
      <div class="font-semibold text-sm">Add or Invite User to {{ auth?.tenant?.name }}</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <input v-model="form.name" required placeholder="Full Name" class="border rounded-lg px-3 py-2" />
        <input v-model="form.email" type="email" required placeholder="Email Address" class="border rounded-lg px-3 py-2" />
        <input v-model="form.password" type="password" minlength="10" placeholder="Initial Password (min 10 chars, new users)" class="border rounded-lg px-3 py-2" />
        <input v-model="form.phone" placeholder="Phone (optional)" class="border rounded-lg px-3 py-2" />
        <input v-model="form.title" placeholder="Title (e.g. Shop Lead)" class="border rounded-lg px-3 py-2" />
        <select v-model="form.role" class="border rounded-lg px-3 py-2">
          <option value="owner">Owner (Full Business Access)</option>
          <option value="manager">Manager (Approve Quotes/Invoices/Expenses)</option>
          <option value="staff">Staff (Draft &amp; Shop Operations)</option>
          <option value="viewer">Viewer (Read-Only)</option>
          <option v-if="auth?.actor?.actorType === 'operator'" value="operator">BWE Operator</option>
        </select>
      </div>
      <div class="flex justify-end">
        <button type="submit" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          Save Member
        </button>
      </div>
    </form>

    <!-- Members Table -->
    <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table class="w-full min-w-[640px] text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">User</th>
            <th class="px-4 py-3">Contact</th>
            <th class="px-4 py-3">Tenant Role</th>
            <th class="px-4 py-3">Scopes</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="m in members" :key="m.membershipId">
            <td class="px-4 py-3">
              <div class="font-semibold text-slate-900">{{ m.name }}</div>
              <div class="text-xs text-slate-500">{{ m.title || '—' }}</div>
            </td>
            <td class="px-4 py-3 text-slate-600">
              <div>{{ m.email }}</div>
              <div class="text-xs text-slate-400">{{ m.phone || '' }}</div>
            </td>
            <td class="px-4 py-3">
              <select
                :value="m.role"
                class="border rounded px-2 py-1 text-xs bg-white"
                @change="changeRole(m, ($event.target as HTMLSelectElement).value)"
              >
                <option value="owner">owner</option>
                <option value="manager">manager</option>
                <option value="staff">staff</option>
                <option value="viewer">viewer</option>
                <option v-if="auth?.actor?.actorType === 'operator' || m.role === 'operator'" value="operator">operator</option>
              </select>
            </td>
            <td class="px-4 py-3">
              <div class="text-xs text-slate-600">{{ m.effectiveScopes.length }} active scope(s)</div>
              <button class="text-[11px] text-amber-700 hover:underline" @click="openScopeEditor(m)">
                Customize Scopes
              </button>
            </td>
            <td class="px-4 py-3 text-right">
              <button
                v-if="m.userId !== auth?.actor?.actorId"
                class="text-xs text-red-600 hover:underline"
                @click="removeMember(m)"
              >
                Remove
              </button>
              <span v-else class="text-xs text-slate-400">You</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Granular Scope Override Modal/Card -->
    <div v-if="editingScopesFor" class="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-semibold">Custom Scopes — {{ editingScopesFor.name }}</div>
          <div class="text-xs text-slate-500">Leave unchecked or reset to inherit defaults from role "{{ editingScopesFor.role }}".</div>
        </div>
        <button class="text-xs text-slate-500 underline" @click="editingScopesFor = null">Close</button>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
        <label v-for="scope in availableScopes" :key="scope" class="flex items-center gap-2 border rounded px-2.5 py-1.5">
          <input v-model="selectedScopes" type="checkbox" :value="scope" />
          <span class="font-mono">{{ scope }}</span>
        </label>
      </div>
      <div class="flex justify-end gap-2">
        <button class="text-xs border border-slate-300 px-3 py-2 rounded-lg" @click="saveCustomScopes(null)">
          Reset to Role Defaults
        </button>
        <button class="text-xs bg-amber-600 text-white px-4 py-2 rounded-lg font-medium" @click="saveCustomScopes(selectedScopes)">
          Save Custom Scopes
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { auth, apiFetch, showToast } = useAuthState()
const members = ref<any[]>([])
const availableScopes = ref<string[]>([])
const showAdd = ref(false)
const editingScopesFor = ref<any>(null)
const selectedScopes = ref<string[]>([])

const form = reactive({
  name: '',
  email: '',
  password: '',
  phone: '',
  title: '',
  role: 'staff'
})

async function load() {
  const res = await apiFetch<{ data: { members: any[]; availableScopes: string[] } }>('/api/v1/team')
  members.value = res.data.members
  availableScopes.value = res.data.availableScopes
}

async function addMember() {
  await apiFetch('/api/v1/team', {
    method: 'POST',
    body: {
      name: form.name,
      email: form.email,
      password: form.password || undefined,
      phone: form.phone || undefined,
      title: form.title || undefined,
      role: form.role
    }
  })
  showToast(`Added ${form.name} to ${auth.value?.tenant?.name}`)
  Object.assign(form, { name: '', email: '', password: '', phone: '', title: '', role: 'staff' })
  showAdd.value = false
  await load()
}

async function changeRole(m: any, role: string) {
  await apiFetch(`/api/v1/team/${m.membershipId}`, {
    method: 'PATCH',
    body: { role }
  })
  showToast(`Updated ${m.name} to ${role}`)
  await load()
}

function openScopeEditor(m: any) {
  editingScopesFor.value = m
  selectedScopes.value = [...m.effectiveScopes]
}

async function saveCustomScopes(scopes: string[] | null) {
  if (!editingScopesFor.value) return
  await apiFetch(`/api/v1/team/${editingScopesFor.value.membershipId}`, {
    method: 'PATCH',
    body: { scopes }
  })
  showToast('Permissions updated')
  editingScopesFor.value = null
  await load()
}

async function removeMember(m: any) {
  await apiFetch(`/api/v1/team/${m.membershipId}`, { method: 'DELETE' })
  showToast(`Removed ${m.name} from this workspace`)
  await load()
}

onMounted(load)
</script>
