import { USDT_DECIMALS } from './money'

export const POLYGON_CHAIN_ID = 137
export const POLYGON_CHAIN_ID_HEX = '0x89'

/** USDT0 on Polygon: the USDT that Nimiq Pay holds. */
export const USDT0_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as const

export const USDT0 = {
  address: USDT0_ADDRESS,
  symbol: 'USDT',
  decimals: USDT_DECIMALS,
  chainId: POLYGON_CHAIN_ID,
} as const

export const POLYGONSCAN_TX = (hash: string): string => `https://polygonscan.com/tx/${hash}`

export const CORRIDORS = [
  { currency: 'NGN', country: 'NG', name: 'Nigeria' },
  { currency: 'KES', country: 'KE', name: 'Kenya' },
  { currency: 'UGX', country: 'UG', name: 'Uganda' },
  { currency: 'TZS', country: 'TZ', name: 'Tanzania' },
] as const

export type CorridorCurrency = (typeof CORRIDORS)[number]['currency']

export const isCorridorCurrency = (value: unknown): value is CorridorCurrency =>
  CORRIDORS.some((c) => c.currency === value)

/** Launch limits in whole USD. The server is the source of truth; these are display defaults. */
export const DEFAULT_LIMITS = {
  minUsd: '1',
  maxUsd: '200',
  dailyUsd: '500',
} as const
