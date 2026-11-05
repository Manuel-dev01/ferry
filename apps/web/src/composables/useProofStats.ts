import { statsResponseSchema, type StatsResponse } from '@ferry/shared'
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../lib/api'

/** Shared truthful loading, retry and stale-data behavior for both public Proof displays. */
export function useProofStats() {
  const stats = ref<StatsResponse | null>(null)
  const failed = ref(false)
  const loading = ref(false)
  let disposed = false
  async function load() {
    if (loading.value || disposed) return
    loading.value = true
    try {
      const response = statsResponseSchema.parse(await api<unknown>('/v1/stats'))
      if (!disposed) {
        stats.value = response
        failed.value = false
      }
    } catch {
      if (!disposed) failed.value = true
    } finally {
      loading.value = false
    }
  }
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    void load()
    timer = setInterval(() => void load(), 60_000)
  })
  onUnmounted(() => {
    disposed = true
    clearInterval(timer)
  })
  return { stats, failed, loading, load }
}
