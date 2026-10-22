// The shareable receipt image (1080 × 1350): cobalt background, the mint "paid" card dealt
// on a cream card, and the headline. No names, no account digits.

const W = 1080
const H = 1350

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function card(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  deg: number,
  fill: string,
  shadow = false,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((deg * Math.PI) / 180)
  if (shadow) {
    ctx.shadowColor = 'rgba(11,14,58,0.55)'
    ctx.shadowBlur = 90
    ctx.shadowOffsetY = 50
  }
  roundRect(ctx, -w / 2, -h / 2, w, h, 64)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
}

export interface ShareImageInput {
  amount: string // "₦27,061"
  seconds: string // "31 SECONDS"
  place: string // "landed in Nigeria 🇳🇬"
  headline: string
  sub: string
}

export async function renderShareImage(input: ShareImageInput): Promise<Blob> {
  await Promise.all([
    document.fonts.load('800 150px Syne'),
    document.fonts.load('600 40px "Albert Sans"'),
  ]).catch(() => undefined)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')

  ctx.fillStyle = '#2337E8'
  ctx.fillRect(0, 0, W, H)

  // Logo: two small cards and the wordmark
  card(ctx, 119, 142, 62, 46, -10, '#FF8A3D')
  card(ctx, 141, 125, 62, 46, 6, '#FFF4E2')
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '800 72px Syne'
  ctx.textBaseline = 'middle'
  ctx.fillText('ferry', 194, 136)

  // The dealt card
  const cx = W / 2
  const cy = 590
  card(ctx, cx + 30, cy + 30, 820, 520, 7, '#FFF4E2')
  card(ctx, cx, cy, 820, 520, -3, '#8FE3C2', true)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-3 * Math.PI) / 180)
  ctx.fillStyle = '#0B0E3A'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '600 32px "Albert Sans"'
  ctx.fillText(`PAID IN ${input.seconds}`.toUpperCase(), -346, -170)
  let size = 150
  ctx.font = `800 ${size}px Syne`
  while (ctx.measureText(input.amount).width > 690 && size > 70) {
    size -= 6
    ctx.font = `800 ${size}px Syne`
  }
  ctx.fillText(input.amount, -350, 40)
  ctx.font = '600 40px "Albert Sans"'
  ctx.fillText(input.place, -346, 190)
  ctx.restore()

  // Headline
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '800 84px Syne'
  ctx.fillText(input.headline, 88, 1130)
  ctx.fillStyle = '#DCE1FF'
  ctx.font = '500 34px "Albert Sans"'
  ctx.fillText(input.sub, 88, 1200)

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not render image'))),
      'image/png',
    ),
  )
}
