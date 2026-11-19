// A Nimiq Pay wallet can share several NIM addresses, and getBalance reads one address at a time.
// Reading them all needs no approval, so the cash-out screen can start on the address that holds
// the NIM instead of whichever one the wallet happened to list first.
import { lunaFromNumber } from '@ferry/shared'

/** Balances in Luna for the addresses that could be read. A failed read is left out, not zero. */
export async function readNimBalances(
  accounts: readonly string[],
  getBalance: (address: string) => Promise<number>,
): Promise<Map<string, bigint>> {
  const reads = await Promise.allSettled(
    accounts.map(async (a) => [a, lunaFromNumber(await getBalance(a))] as const),
  )
  return new Map(reads.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])))
}

/**
 * The address with the most NIM. On a tie the current choice stays, then the wallet's own order.
 * Null when no balance could be read, so the caller keeps its usual choice.
 */
export function fullestNimAddress(
  accounts: readonly string[],
  balances: ReadonlyMap<string, bigint>,
  current: string | null,
): string | null {
  let best: string | null = null
  for (const a of current && accounts.includes(current) ? [current, ...accounts] : accounts) {
    const balance = balances.get(a)
    if (balance === undefined) continue
    if (best === null || balance > (balances.get(best) ?? 0n)) best = a
  }
  return best
}
