import { formatUnitsFixed, NIM_DECIMALS, POL_DECIMALS, USDT_DECIMALS } from '@ferry/shared'

export const usdtDisplay = (units: bigint) => formatUnitsFixed(units, USDT_DECIMALS, 2)
export const polDisplay = (wei: bigint) => formatUnitsFixed(wei, POL_DECIMALS, 4)
export const nimDisplay = (luna: bigint) => {
  const [whole = '0', frac] = formatUnitsFixed(luna, NIM_DECIMALS, 2).split('.')
  return `${BigInt(whole).toLocaleString('en-US')}.${frac}`
}

export const polygonscanTx = (hash: string) => `https://polygonscan.com/tx/${hash}`
