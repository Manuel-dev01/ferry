import { renderShareImage } from './shareImage'

export interface ShareResult {
  /** Big number on the card, e.g. "KSh 635". */
  amount: string
  /** Small line above it, e.g. "Paid in 48 s". */
  eyebrow: string
  /** Line under it, e.g. "to M-Pesa in Kenya 🇰🇪". */
  place: string
  /** Caption for the share sheet. The link to Ferry is appended. */
  text: string
  headline: string
  sub: string
}

/** Where people who see a shared receipt can find Ferry. */
export const publicSite = () =>
  new URL(import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin).host

/**
 * Shares a receipt card through the system share sheet, falling back to text only, then to a
 * download. Returns false when the user closed the sheet or nothing could be shared.
 */
export async function shareResult(input: ShareResult): Promise<boolean> {
  const url = `https://${publicSite()}`
  const text = `${input.text} ${url}`
  try {
    const blob = await renderShareImage(input)
    const file = new File([blob], 'ferry-receipt.png', { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text })
    } else if (navigator.share) {
      await navigator.share({ text, url })
    } else {
      const href = URL.createObjectURL(blob)
      Object.assign(document.createElement('a'), { href, download: 'ferry-receipt.png' }).click()
      setTimeout(() => URL.revokeObjectURL(href), 5000)
    }
    return true
  } catch {
    // the user closed the share sheet, or the browser can't share
    return false
  }
}
