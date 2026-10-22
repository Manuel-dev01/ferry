import { onMounted, onUnmounted } from 'vue'

/**
 * Landing-page motion: pointer parallax (--mx/--my on <html>, -1..1, eased) and scroll
 * progress (--p, 0..1) on every [data-scene] section. Reduced motion pins scenes at 1.
 */
export function useLandingMotion() {
  let mx = 0
  let my = 0
  let tx = 0
  let ty = 0
  let raf = 0
  let dirty = true
  const root = document.documentElement

  const scenes = () => Array.from(document.querySelectorAll<HTMLElement>('[data-scene]'))

  const tick = () => {
    raf = 0
    tx += (mx - tx) * 0.12
    ty += (my - ty) * 0.12
    root.style.setProperty('--mx', tx.toFixed(3))
    root.style.setProperty('--my', ty.toFixed(3))
    if (dirty) {
      dirty = false
      for (const s of scenes()) {
        const r = s.getBoundingClientRect()
        const d = r.height - innerHeight
        const p = d > 0 ? Math.min(1, Math.max(0, -r.top / d)) : 0
        s.style.setProperty('--p', p.toFixed(4))
      }
    }
    if (Math.abs(mx - tx) > 0.002 || Math.abs(my - ty) > 0.002) raf = requestAnimationFrame(tick)
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(tick)
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    mx = (e.clientX / innerWidth) * 2 - 1
    my = (e.clientY / innerHeight) * 2 - 1
    kick()
  }
  const onScroll = () => {
    dirty = true
    kick()
  }

  onMounted(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const s of scenes()) s.style.setProperty('--p', '1')
      return
    }
    addEventListener('pointermove', onMove, { passive: true })
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onScroll)
    kick()
  })
  onUnmounted(() => {
    removeEventListener('pointermove', onMove)
    removeEventListener('scroll', onScroll)
    removeEventListener('resize', onScroll)
    cancelAnimationFrame(raf)
    root.style.removeProperty('--mx')
    root.style.removeProperty('--my')
  })
}
