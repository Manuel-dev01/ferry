import { presetNimiq } from 'nimiq-css'
import { defineConfig, presetWind4 } from 'unocss'

// nimiq-css supplies the palette, fonts, icons and preflight. Its `utilities` option is off:
// in 1.0.0-beta.162 those rules render with an `undefined` selector, so components are
// styled here with Nimiq's color tokens instead.

const TONES = ['info', 'success', 'warn', 'error'] as const

export default defineConfig({
  presets: [
    presetWind4({ preflights: { reset: false } }),
    presetNimiq({ utilities: false, attributifyUtilities: false }),
  ],
  preflights: [
    {
      getCSS: () => `
        body { background-color: var(--colors-neutral-100); color: var(--colors-neutral); }
        :focus-visible { outline: 2px solid var(--colors-blue); outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
      `,
    },
  ],
  // Classes built from template strings (`status-${tone}`), which the scanner can't see.
  safelist: [
    ...TONES.map((t) => `status-${t}`),
    ...TONES.map((t) => `steplog-${t}`),
    'tracker-done',
    'tracker-active',
    'tracker-todo',
    'input-invalid',
  ],
  shortcuts: {
    page: 'mx-auto max-w-120 px-4 pt-4 pb-10 min-h-screen',
    card: 'block mb-4 p-5 rounded-2xl bg-neutral-0 border border-neutral-300',
    'card-title': 'text-lg font-bold mb-3',
    muted: 'text-neutral-800',
    'section-label': 'text-xs font-bold uppercase tracking-wide text-neutral-700 mb-2 px-1',

    // Buttons: 44px minimum touch targets everywhere.
    btn: 'w-full min-h-12 px-5 inline-flex items-center justify-center gap-2 rounded-full font-bold text-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    'btn-primary': 'btn bg-blue text-white hover:bg-blue-1100',
    'btn-secondary': 'btn bg-neutral-200 text-neutral-1100 hover:bg-neutral-300',
    'btn-ghost': 'btn min-h-11 text-blue hover:bg-blue-400/40',
    'icon-btn':
      'size-11 shrink-0 inline-flex items-center justify-center rounded-full hover:bg-neutral-200',
    link: 'text-blue min-h-11 inline-flex items-center font-semibold underline-offset-2 hover:underline',
    chip: 'min-h-11 px-4 rounded-full border border-neutral-400 text-sm font-semibold bg-neutral-0',
    'chip-active': 'bg-blue text-white border-blue',

    // Inputs
    input:
      'w-full min-h-12 px-4 rounded-xl border-2 border-neutral-300 bg-neutral-0 outline-none focus:border-blue placeholder:text-neutral-600',
    'input-invalid': 'border-red',
    label: 'block mb-2 text-sm font-semibold text-neutral-800',
    'amount-field':
      'flex items-baseline gap-2 border-b-2 border-neutral-400 focus-within:border-blue pb-1',
    'amount-input':
      'flex-1 min-w-0 bg-transparent text-4xl font-bold outline-none placeholder:text-neutral-500',

    // Layout pieces
    topbar: 'flex items-center gap-2 mb-2 -ml-2',
    progress: 'h-1 rounded-full bg-neutral-300 mb-5 overflow-hidden',
    'progress-fill': 'h-full bg-blue transition-all duration-300',
    'bottom-spacer': 'h-40',
    'bottom-action':
      'fixed inset-x-0 bottom-0 z-10 bg-neutral-0/95 backdrop-blur border-t border-neutral-300 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]',
    tile: 'flex items-center gap-3 w-full min-h-16 p-4 rounded-2xl bg-neutral-0 border border-neutral-300 text-left hover:border-blue disabled:opacity-50',
    'tile-primary': 'bg-blue text-white border-blue hover:bg-blue-1100',
    'tile-icon': 'size-11 shrink-0 rounded-full inline-flex items-center justify-center text-lg',
    list: 'mb-4 rounded-2xl bg-neutral-0 border border-neutral-300 overflow-hidden',
    'list-item':
      'flex items-center gap-3 w-full min-h-14 px-4 py-3 border-b border-neutral-300 last:border-b-0 hover:bg-neutral-100 text-left',
    monogram: 'shrink-0 rounded-full inline-flex items-center justify-center font-bold',
    row: 'flex justify-between gap-3 py-2 border-b border-neutral-300 last:border-b-0',
    'row-label': 'text-neutral-800 shrink-0',
    'row-value': 'font-semibold text-right break-all',

    // Tracker
    tracker: 'flex flex-col gap-4',
    'tracker-step': 'flex items-start gap-3',
    'tracker-dot':
      'size-6 shrink-0 rounded-full inline-flex items-center justify-center border-2 mt-0.5',
    'tracker-done':
      '[&_.tracker-dot]:bg-green [&_.tracker-dot]:border-green [&_.tracker-dot]:text-white',
    'tracker-active': '[&_.tracker-dot]:border-blue [&_.tracker-dot]:animate-pulse',
    'tracker-todo': 'opacity-50 [&_.tracker-dot]:border-neutral-400',

    // Messages
    status: 'rounded-xl px-3 py-2 mb-3 text-sm flex flex-col gap-1',
    'status-info': 'bg-neutral-200 text-neutral-1100',
    'status-success': 'bg-green-400 text-green-1100',
    'status-warn': 'bg-gold-400 text-gold-1100',
    'status-error': 'bg-red-400 text-red-1100',
    'status-ref': 'text-xs font-mono opacity-80',
    skeleton: 'h-4 rounded bg-neutral-300 mb-3 animate-pulse',
    steplog: 'mt-3 text-sm flex flex-col gap-1 break-words',
    'steplog-at': 'font-mono text-neutral-700 mr-2',
    'steplog-info': 'text-neutral-1100',
    'steplog-success': 'text-green-1100',
    'steplog-warn': 'text-gold-1100',
    'steplog-error': 'text-red-1100',

    // Dev-only mock wallet
    'mock-badge':
      'sticky top-0 z-20 text-center text-xs font-semibold py-1 bg-gold-400 text-gold-1100',
    'sheet-backdrop': 'fixed inset-0 z-30 bg-neutral/40 flex items-end justify-center',
    sheet:
      'w-full max-w-120 bg-neutral-0 rounded-t-2xl p-5 pb-[max(20px,env(safe-area-inset-bottom))]',
  },
})
