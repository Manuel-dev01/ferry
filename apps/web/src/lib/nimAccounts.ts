// Nimiq Pay shares more than one NIM address: the wallet address, then the HTLC it shares with its
// cosigner, which holds the spendable NIM (the wallet address usually reads 0). getBalance reads one
// address at a time and needs no approval, so Ferry reads them all and adds them up.
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
