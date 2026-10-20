import { onUnmounted, ref } from 'vue'

/** A ticking clock for countdowns and relative times. */
export function useNow(intervalMs = 1000) {
  const now = ref(Date.now())
  const timer = setInterval(() => (now.value = Date.now()), intervalMs)
  onUnmounted(() => clearInterval(timer))
  return now
}
