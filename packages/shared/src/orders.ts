// Order state machines. Status only ever moves to a higher rank, terminal states are final,
// and compliance_hold may return to pending.

export const OFFRAMP_RANKS = {
  created: 10,
  signed: 20,
  submitted: 30,
  unknown: 35,
  deposited: 40,
  pending: 50,
  compliance_hold: 55,
  validated: 60,
  settled: 70,
  refunded: 80,
  expired: 80,
  failed: 80,
} as const

export type OfframpStatus = keyof typeof OFFRAMP_RANKS

export const OFFRAMP_TERMINAL: readonly OfframpStatus[] = [
  'settled',
  'refunded',
  'expired',
  'failed',
]

export const isOfframpStatus = (v: unknown): v is OfframpStatus =>
  typeof v === 'string' && v in OFFRAMP_RANKS

export const isTerminal = (status: OfframpStatus) => OFFRAMP_TERMINAL.includes(status)

/** Whether an update from `from` to `to` may be applied. Late or out-of-order events return false. */
export function canTransition(from: OfframpStatus, to: OfframpStatus): boolean {
  if (from === to || isTerminal(from)) return false
  if (from === 'compliance_hold' && to === 'pending') return true
  return OFFRAMP_RANKS[to] > OFFRAMP_RANKS[from]
}

/** The steps the tracker shows, in order. Each covers one or more statuses. */
export const TRACKER_STEPS = ['sent', 'received', 'paying', 'paid'] as const
export type TrackerStep = (typeof TRACKER_STEPS)[number]

export function trackerStepFor(status: OfframpStatus): TrackerStep | null {
  switch (status) {
    case 'created':
    case 'signed':
      return null
    case 'submitted':
    case 'unknown':
      return 'sent'
    case 'deposited':
      return 'received'
    case 'pending':
    case 'compliance_hold':
    case 'validated':
      return 'paying'
    case 'settled':
      return 'paid'
    default:
      return null
  }
}
