import { ref } from 'vue'

export interface LogEntry {
  at: string
  text: string
  tone: 'info' | 'success' | 'warn' | 'error'
}

const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** A timestamped trail of what happened, kept behind a disclosure so phone tests can be reported. */
export function useStepLog() {
  const entries = ref<LogEntry[]>([])
  const add = (text: string, tone: LogEntry['tone'] = 'info') => {
    entries.value.push({ at: clock.format(new Date()), text, tone })
  }
  return { entries, add }
}
