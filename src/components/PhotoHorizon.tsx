import { useEffect, useMemo, useRef } from 'react'
import { PHOTOS } from '../lib/photos'
import { atlasCrop, widthAtHeight, type AtlasKind } from '../lib/atlasCrop'

/**
 * A slow procession of photographs riding the curve of a very large circle.
 *
 * The landing page is a sphere of images; this is that sphere's horizon, seen
 * from close enough that only a shallow arc of it remains. Photos are laid out
 * by ARC LENGTH (not by angle), so a panorama occupies proportionally more of
 * the curve than a portrait does, and every frame keeps its true aspect ratio.
 *
 * Elements are read out of the DOM rather than collected through a ref array:
 * React 19 detaches and reattaches ref callbacks around effects, which leaves a
 * ref array momentarily full of nulls and the loop silently painting nothing.
 * Transforms are written directly in the rAF loop — pushing 36 elements through
 * React state every frame would be pointless churn.
 */

const COUNT = 36
const SPEED = 26 // px of arc travelled per second
const isPhone = () => window.matchMedia('(max-width: 768px)').matches

export default function PhotoHorizon() {
  const trackRef = useRef<HTMLDivElement>(null)

  // Spread the selection across the whole manifest so the strip is varied
  // rather than 36 consecutive frames from one afternoon.
  const picks = useMemo(() => {
    const stride = PHOTOS.length / COUNT
    return Array.from({ length: COUNT }, (_, i) => PHOTOS[Math.floor(i * stride) % PHOTOS.length])
  }, [])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let els: HTMLElement[] = []
    let kind: AtlasKind = 'desktop'
    let height = 116
    let radius = 1500
    let cx = 0
    let cy = 0
    let span = 1
    let starts: number[] = []

    const layout = () => {
      els = Array.from(track.querySelectorAll<HTMLElement>('.horizon__item'))
      const phone = isPhone()
      kind = phone ? 'mobile' : 'desktop'
      height = phone ? 74 : 116
      const w = track.clientWidth || window.innerWidth
      // A large radius keeps the curve gentle: an arc, not a wheel.
      radius = Math.max(1500, w * 1.35)
      cx = w / 2
      cy = radius + height * 0.35 // circle centre sits below, so the arc bulges up

      const gap = phone ? 12 : 20
      starts = []
      let acc = 0
      for (const p of picks) {
        starts.push(acc)
        acc += widthAtHeight(p, kind, height) + gap
      }
      span = acc || 1 // never 0: a modulo by zero would poison every transform
    }

    let offset = 0
    let last = performance.now()
    let raf = 0

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!reduced) offset = (offset + SPEED * dt) % span

      for (let i = 0; i < els.length; i++) {
        const p = picks[i]
        if (!p) continue
        const w = widthAtHeight(p, kind, height)
        // Centre of this tile along the arc, wrapped into [-span/2, span/2)
        let s = (starts[i] + w / 2 - offset) % span
        if (s < 0) s += span
        if (s > span / 2) s -= span

        const theta = s / radius
        const x = cx + radius * Math.sin(theta)
        const y = cy - radius * Math.cos(theta)
        els[i].style.transform =
          `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${theta.toFixed(5)}rad) translate(-50%, -50%)`
      }
      raf = requestAnimationFrame(frame)
    }

    layout()
    raf = requestAnimationFrame(frame)

    const ro = new ResizeObserver(layout)
    ro.observe(track)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [picks])

  const phone = typeof window !== 'undefined' && isPhone()
  const kind: AtlasKind = phone ? 'mobile' : 'desktop'
  const h = phone ? 74 : 116

  return (
    <div className="horizon" ref={trackRef} aria-hidden="true">
      <div className="horizon__mask">
        {picks.map((p, i) => (
          <div
            key={`${p.id}-${i}`}
            className="horizon__item"
            style={{ ...atlasCrop(p, kind, widthAtHeight(p, kind, h)), backgroundColor: p.color }}
          />
        ))}
      </div>
    </div>
  )
}
