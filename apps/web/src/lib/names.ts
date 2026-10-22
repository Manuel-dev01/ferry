/** "ADA OBI" → "Ada Obi" for running text; cards keep the bank's uppercase. */
export const titleCase = (name: string) =>
  name
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())

/** Short, readable reference for an order, e.g. "FRY-8K2Q". */
export function orderRef(orderId: string): string {
  const tail = orderId
    .replace(/[^a-z0-9]/gi, '')
    .slice(-4)
    .toUpperCase()
  return `FRY-${tail}`
}

/** "0x12…ab" */
export const tinyAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-2)}`

/** Group digits for display: NUBAN 3-3-4, phones in threes. */
export function groupDigits(digits: string, pattern: number[] = [3, 3, 4]): string {
  const out: string[] = []
  let i = 0
  for (const size of pattern) {
    if (i >= digits.length) break
    out.push(digits.slice(i, i + size))
    i += size
  }
  if (i < digits.length) out.push(digits.slice(i))
  return out.join(' ')
}
