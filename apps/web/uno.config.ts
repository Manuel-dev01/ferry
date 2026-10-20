import { presetNimiq } from 'nimiq-css'
import { defineConfig, presetWind4 } from 'unocss'

export default defineConfig({
  presets: [
    presetWind4({ preflights: { reset: false } }),
    presetNimiq({ utilities: true, attributifyUtilities: false }),
  ],
  shortcuts: {
    page: 'mx-auto max-w-120 px-4 pt-6 pb-10 min-h-screen',
    card: 'nq-card mb-4 block',
    'card-title': 'text-lg font-bold mb-3',
    muted: 'text-neutral-800',
    btn: 'w-full min-h-11 justify-center text-center disabled:opacity-50 disabled:cursor-not-allowed',
    'btn-primary': 'btn nq-pill-blue nq-pill-lg',
    'btn-secondary': 'btn nq-pill-secondary nq-pill-lg',
    'btn-ghost': 'btn nq-pill-tertiary',
    input: 'nq-input-box w-full min-h-11',
    label: 'nq-label block mb-1',
    link: 'text-blue min-h-11 inline-flex items-center underline-offset-2 hover:underline',
    row: 'flex justify-between gap-3 py-2 border-b border-neutral-300 last:border-b-0',
    'row-label': 'text-neutral-800 shrink-0',
    'row-value': 'font-semibold text-right break-all',
    status: 'rounded-2 px-3 py-2 mb-3 text-sm flex flex-col gap-1',
    'status-info': 'bg-neutral-200 text-neutral-1100',
    'status-success': 'bg-green-400 text-green-1100',
    'status-warn': 'bg-gold-400 text-gold-1100',
    'status-error': 'bg-red-400 text-red-1100',
    'status-ref': 'text-xs font-mono opacity-80',
    skeleton: 'h-4 rounded bg-neutral-300 mb-3 animate-pulse motion-reduce:animate-none',
    steplog: 'mt-3 text-sm flex flex-col gap-1 break-words',
    'steplog-at': 'font-mono text-neutral-700 mr-2',
    'steplog-info': 'text-neutral-1100',
    'steplog-success': 'text-green-1100',
    'steplog-warn': 'text-gold-1100',
    'steplog-error': 'text-red-1100',
  },
})
