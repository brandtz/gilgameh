<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">Immutable Audit Log</h1>
      <p class="text-sm text-slate-500">Every write attributed to an operator, user, AI agent token, or integration</p>
    </div>

    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 border-b">
          <tr>
            <th class="px-4 py-3">Timestamp</th>
            <th class="px-4 py-3">Actor</th>
            <th class="px-4 py-3">Action</th>
            <th class="px-4 py-3">Entity</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="log in logs" :key="log.id">
            <td class="px-4 py-3 text-xs font-mono text-slate-500">{{ new Date(log.createdAt).toLocaleString() }}</td>
            <td class="px-4 py-3">
              <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                {{ log.actorType }}
              </span>
              <span class="ml-1.5 text-slate-800">{{ log.actorLabel }}</span>
            </td>
            <td class="px-4 py-3 font-mono text-xs font-semibold text-amber-800">{{ log.action }}</td>
            <td class="px-4 py-3 text-xs text-slate-600">{{ log.entityType }} · {{ log.entityId.slice(0, 8) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
const { apiFetch } = useAuthState()
const logs = ref<any[]>([])

onMounted(async () => {
  const res = await apiFetch<{ data: any[] }>('/api/v1/audit?limit=100')
  logs.value = res.data
})
</script>
