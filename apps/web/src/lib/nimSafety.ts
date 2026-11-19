/** Reserve time for native approvals, NIM confirmation and Lightning routing. */
export const NIM_PAYMENT_MARGIN_S = 5 * 60
export const NIM_POLL_MAX_MS = 2 * 60 * 60_000

/** The invoice may outlive the destination contract. Never use the later deadline. */
export function nimPayDeadline(swap: {
  invoiceExpiresAt: number
  claimBy: number | null
}): number | null {
  const deadlines = [swap.invoiceExpiresAt, swap.claimBy].filter(
    (n): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0,
  )
  return deadlines.length ? Math.min(...deadlines) : null
}
export function canStartNimPayment(
  swap: { invoiceExpiresAt: number; claimBy: number | null },
  nowSeconds: number,
) {
  if (
    !Number.isSafeInteger(swap.claimBy) ||
    !swap.claimBy ||
    swap.claimBy <= 0 ||
    !Number.isSafeInteger(swap.invoiceExpiresAt) ||
    swap.invoiceExpiresAt <= 0
  )
    return false
  const by = nimPayDeadline(swap)
  return by !== null && by - nowSeconds > NIM_PAYMENT_MARGIN_S
}
