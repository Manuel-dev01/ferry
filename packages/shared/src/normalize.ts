/** Kenyan mobile numbers: accepts 07…, 01…, 7…, 1…, 2547…, +254 7… and returns 2547XXXXXXXX / 2541XXXXXXXX. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '').replace(/^\+/, '')
  if (!/^\d+$/.test(digits)) return null
  let local: string
  if (digits.startsWith('254')) local = digits.slice(3)
  else if (digits.startsWith('0')) local = digits.slice(1)
  else local = digits
  return /^[17]\d{8}$/.test(local) ? `254${local}` : null
}

/** Display form: 0712 345 678 */
export function formatKenyanPhoneLocal(normalized: string): string {
  const local = `0${normalized.slice(3)}`
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
}

/** Nigerian NUBAN account numbers are exactly 10 digits. */
export function normalizeNuban(input: string): string | null {
  const digits = input.replace(/\s/g, '')
  return /^\d{10}$/.test(digits) ? digits : null
}

/** "0x1234…abcd" */
export function shortAddress(address: string, head = 6, tail = 4): string {
  return address.length <= head + tail
    ? address
    : `${address.slice(0, head)}…${address.slice(-tail)}`
}
