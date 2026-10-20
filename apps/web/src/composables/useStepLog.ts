import { ref } from 'vue'

export interface LogEntry {
  at: string
  text: string
  tone: 'info' | 'success' | 'warn' | 'error'
}

/** A visible, timestamped trail of what happened, so phone tests can be reported precisely. */
export function useStepLog() {
  const entries = ref<LogEntry[]>([])
  const started = Date.now()
  const add = (text: string, tone: LogEntry['tone'] = 'info') => {
    entries.value.push({ at: `+${((Date.now() - started) / 1000).toFixed(1)}s`, text, tone })
  }
  return { entries, add }
}
