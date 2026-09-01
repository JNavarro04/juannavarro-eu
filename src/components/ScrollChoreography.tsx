import { useEffect, useRef, useState } from 'react'

import {
  SPHERE_DRIVE_DEFAULTS,
  SPHERE_FOV,
  SPHERE_RADIUS,
  VIEWPORT_FRACTION,
  sphereDrive,
} from './Sphere'
import type { SphereDrive } from './Sphere'
import {
  APPROACH_SCREENS,
  GESTURE_HORIZONTAL_BIAS,
  GESTURE_LOCK_PX,
  LONGITUDE_DAMPING,
  PROGRESS_DAMPING,
  STOP_DWELL_SCREENS,
  SURFACE_SCREENS,
  WHEEL_DEAD_ZONE_PX,
  WHEEL_HORIZONTAL_BIAS,
  WHEEL_LONGITUDE_GAIN,
  damp,
  frameForProgress,
  progressFromScroll,
  scrollLengths,
  viewGeometry,
  visibleLongitudeHalfAngle,
} from '../lib/scrollChoreography'
import type { ScrollLengths, ViewGeometry } from '../lib/scrollChoreography'
import '../styles/choreography.css'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE SCROLL CHOREOGRAPHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Drop this in next to `<SphereStage />`:
 *
 *   <main style={{ height: '100dvh', width: '100%' }}>
 *     <SphereStage />
 *     <ScrollChoreography />
 *   </main>
 *
 * It gives the document its scroll height (a spacer), pins `.sphere-stage` to
 * the viewport while it is mounted (one rule in choreography.css, keyed off a
 * class on <html>, so nothing in Sphere/ has to change), and writes to the
 * `sphereDrive` seam once per frame from a single rAF loop.
 *
 * Native page scroll is the driver. Nothing is preventDefault-ed, so keyboard
 * scrolling, trackpad momentum, scrollbars, Find-in-page and — the point on a
 * phone — the platform's own vertical scrolling all behave exactly as they do
 * on any other page. What this adds on top is horizontal steering: pointer drag
 * on desktop, horizontal swipe on touch, and trackpad `deltaX`.
 *
 * Nothing here re-renders React. The only DOM writes per frame are two custom
 * properties, and only when their rounded value actually changed.
 */

/* ── The seam this component publishes to the rest of the page ─────────────
 *
 *  <html class="choreo-on" data-choreo-phase="approach | surface"
 *        style="--choreo-progress: 0…1; --choreo-text-opacity: 0…1">
 *
 * Any landing text can fade itself out with
 *   opacity: var(--choreo-text-opacity, 1)
 * without knowing anything about scrolling.
 */
const ACTIVE_CLASS = 'choreo-on'
const PROGRESS_VAR = '--choreo-progress'
const TEXT_OPACITY_VAR = '--choreo-text-opacity'

/** Pre-effect spacer height, in vh, so the document has its scroll range on the
 *  very first layout — otherwise a reload at mid-page would be clamped to 0.
 *  The +1 is the viewport itself, which is height a document cannot scroll. */
const FALLBACK_SCREENS = APPROACH_SCREENS + STOP_DWELL_SCREENS + SURFACE_SCREENS + 1

/** Gestures that start on these never steer the sphere. */
const INTERACTIVE = 'a, button, input, textarea, select, label, summary, [role="button"], [contenteditable]'

export type ScrollChoreographyProps = {
  /** The scroll cue's words. Pass an empty string to render no cue at all. */
  cue?: string
  /** Drive to write to. Defaults to the shared `sphereDrive` singleton. */
  drive?: SphereDrive
  className?: string
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export default function ScrollChoreography({
  cue = 'Scroll',
  drive,
  className,
}: ScrollChoreographyProps) {
  const spacerRef = useRef<HTMLDivElement>(null)
  const cueRef = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const target = drive ?? sphereDrive
    const root = document.documentElement
    const spacer = spacerRef.current
    const cueEl = cueRef.current

    // ── prefers-reduced-motion: reduce ───────────────────────────────────
    // No scroll-driven camera motion at all, and no scroll range to drive it
    // with. The resting sphere, and a page that scrolls like a page.
    if (reducedMotion) {
      Object.assign(target, SPHERE_DRIVE_DEFAULTS)
      if (spacer) spacer.style.height = '0px'
      return () => {
        Object.assign(target, SPHERE_DRIVE_DEFAULTS)
      }
    }

    root.classList.add(ACTIVE_CLASS)

    /* ── State. All of it lives here, none of it in React. ──────────────── */
    let geometry: ViewGeometry = viewGeometry({
      width: window.innerWidth,
      height: window.innerHeight,
      radius: SPHERE_RADIUS,
      fovDegrees: SPHERE_FOV,
      viewportFraction: VIEWPORT_FRACTION,
    })
    let lengths: ScrollLengths = scrollLengths(window.innerHeight)

    let targetProgress = 0
    let currentProgress = 0
    let targetLongitude = 0
    let currentLongitude = 0
    let currentDistanceScale = 1

    // Measured viewport. Deliberately *not* the live one: a phone's URL bar
    // sliding away changes innerHeight by ~10% mid-scroll, and re-deriving the
    // scroll range from it would make the whole choreography jump under the
    // finger. Only a real layout change (rotation, window resize) re-measures.
    let stableWidth = 0
    let stableHeight = 0

    let frameHandle = 0
    let lastTime = 0
    let lastPublishedProgress = -1
    let lastPublishedText = -1
    let lastPublishedPhase = ''

    const readScroll = () => {
      targetProgress = progressFromScroll(window.scrollY, lengths)
    }

    const measure = (force: boolean) => {
      const width = window.innerWidth
      const height = window.innerHeight
      const widthChanged = width !== stableWidth
      const heightJumped = Math.abs(height - stableHeight) > stableHeight * 0.2
      if (!force && !widthChanged && !heightJumped) return

      stableWidth = width
      stableHeight = height
      geometry = viewGeometry({
        width,
        height,
        radius: SPHERE_RADIUS,
        fovDegrees: SPHERE_FOV,
        viewportFraction: VIEWPORT_FRACTION,
      })
      lengths = scrollLengths(height)
      if (spacer) spacer.style.height = `${Math.round(lengths.spacerPx)}px`
      readScroll()
    }

    measure(true)
    // Land on whatever the browser restored rather than animating in from 0.
    currentProgress = targetProgress

    /* ── Horizontal steering ────────────────────────────────────────────── */

    /** Radians of longitude one pixel of horizontal input is worth, right now.
     *  Derived from the surface actually on screen, so the photograph under the
     *  pointer travels with the pointer at every zoom level. */
    const longitudePerPixel = () => {
      const distance = geometry.baseDistance * currentDistanceScale
      return (2 * visibleLongitudeHalfAngle(geometry, distance)) / Math.max(1, stableWidth)
    }

    let pointerId: number | null = null
    let pointerIsTouch = false
    let lastPointerX = 0
    let startX = 0
    let startY = 0
    /** 'pending' until the gesture has declared itself; 'page' means we let go. */
    let axis: 'pending' | 'sphere' | 'page' = 'pending'
    let captured: Element | null = null

    const releaseCapture = () => {
      if (captured && pointerId !== null) {
        try {
          captured.releasePointerCapture(pointerId)
        } catch {
          // The element may already be gone; the capture went with it.
        }
      }
      captured = null
    }

    const endGesture = () => {
      releaseCapture()
      pointerId = null
      axis = 'pending'
      root.classList.remove('choreo-dragging')
    }

    const onPointerDown = (event: PointerEvent) => {
      if (pointerId !== null || !event.isPrimary) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const node = event.target
      if (node instanceof Element && node.closest(INTERACTIVE)) return

      pointerId = event.pointerId
      pointerIsTouch = event.pointerType !== 'mouse' && event.pointerType !== 'pen'
      lastPointerX = event.clientX
      startX = event.clientX
      startY = event.clientY
      // A mouse drag has no competing gesture, so it steers from the first pixel.
      // Touch has to prove it is horizontal before we take it off the page.
      axis = pointerIsTouch ? 'pending' : 'sphere'

      if (!pointerIsTouch && node instanceof Element) {
        try {
          node.setPointerCapture(event.pointerId)
          captured = node
        } catch {
          captured = null
        }
        root.classList.add('choreo-dragging')
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return

      if (axis === 'pending') {
        const dx = event.clientX - startX
        const dy = event.clientY - startY
        if (Math.hypot(dx, dy) < GESTURE_LOCK_PX) return
        // Ties, and anything close to a tie, go to the page. Vertical scrolling
        // on a phone must never be something this component can swallow.
        axis = Math.abs(dx) > Math.abs(dy) * GESTURE_HORIZONTAL_BIAS ? 'sphere' : 'page'
        lastPointerX = event.clientX
        if (axis === 'page') {
          endGesture()
          return
        }
      }
      if (axis !== 'sphere') return

      // Drag right, the surface follows right: `spin` takes the near face toward +X.
      targetLongitude += (event.clientX - lastPointerX) * longitudePerPixel()
      lastPointerX = event.clientX
    }

    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      endGesture()
    }

    // Trackpad horizontal. Passive: a horizontal wheel on a page with no
    // horizontal overflow scrolls nothing, and body{overscroll-behavior:none}
    // already stops it becoming a back-navigation.
    const onWheel = (event: WheelEvent) => {
      // A two-finger *vertical* scroll on a trackpad carries a pixel or two of
      // sideways noise in nearly every event. Steer only on gestures that are
      // decisively horizontal, exactly as a touch gesture has to prove itself.
      if (Math.abs(event.deltaX) < WHEEL_DEAD_ZONE_PX) return
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * WHEEL_HORIZONTAL_BIAS) return
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stableWidth : 1
      // deltaX > 0 is "look right", which moves the surface left — the mirror of
      // a drag, and the same convention as scrolling a horizontal list.
      targetLongitude -= event.deltaX * scale * longitudePerPixel() * WHEEL_LONGITUDE_GAIN
    }

    const onScroll = () => readScroll()
    const onResize = () => measure(false)
    const onOrientation = () => measure(true)

    /* ── The one rAF loop ───────────────────────────────────────────────── */
    const tick = (now: number) => {
      frameHandle = requestAnimationFrame(tick)
      const dt = lastTime === 0 ? 1 / 60 : Math.min(0.1, (now - lastTime) / 1000)
      lastTime = now

      currentProgress = damp(currentProgress, targetProgress, PROGRESS_DAMPING, dt)
      currentLongitude = damp(currentLongitude, targetLongitude, LONGITUDE_DAMPING, dt)

      const frame = frameForProgress(currentProgress, currentLongitude, geometry, lengths)
      currentDistanceScale = frame.distanceScale

      target.distanceScale = frame.distanceScale
      target.spin = frame.spin
      target.tilt = frame.tilt
      target.spinScale = frame.spinScale
      target.offsetX = 0
      target.offsetY = 0
      target.opacity = 1

      // Style writes are a recalc each; quantise so a settling lerp does not
      // dirty the whole document 60 times for changes nobody can see.
      const textOpacity = Math.round(frame.textOpacity * 100) / 100
      if (textOpacity !== lastPublishedText) {
        lastPublishedText = textOpacity
        root.style.setProperty(TEXT_OPACITY_VAR, String(textOpacity))
        if (cueEl) {
          cueEl.style.opacity = String(textOpacity)
          cueEl.style.visibility = textOpacity < 0.01 ? 'hidden' : 'visible'
        }
      }
      const progress = Math.round(currentProgress * 200) / 200
      if (progress !== lastPublishedProgress) {
        lastPublishedProgress = progress
        root.style.setProperty(PROGRESS_VAR, progress.toFixed(3))
      }
      if (frame.phase !== lastPublishedPhase) {
        lastPublishedPhase = frame.phase
        root.dataset.choreoPhase = frame.phase
      }
    }
    frameHandle = requestAnimationFrame(tick)

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientation)
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerup', onPointerEnd, { passive: true })
    window.addEventListener('pointercancel', onPointerEnd, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: true })

    return () => {
      cancelAnimationFrame(frameHandle)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientation)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      window.removeEventListener('wheel', onWheel)
      endGesture()
      root.classList.remove(ACTIVE_CLASS)
      root.style.removeProperty(PROGRESS_VAR)
      root.style.removeProperty(TEXT_OPACITY_VAR)
      delete root.dataset.choreoPhase
      // /info and back must not inherit a camera dived into the surface.
      Object.assign(target, SPHERE_DRIVE_DEFAULTS)
    }
  }, [drive, reducedMotion])

  return (
    <div className={className ? `choreo ${className}` : 'choreo'}>
      {cue ? (
        <div className="choreo__cue" ref={cueRef}>
          <span className="choreo__cue-word">{cue}</span>
          <span className="choreo__cue-line" aria-hidden="true" />
        </div>
      ) : null}
      <div
        className="choreo__spacer"
        ref={spacerRef}
        aria-hidden="true"
        style={{ height: reducedMotion ? 0 : `${FALLBACK_SCREENS * 100}vh` }}
      />
    </div>
  )
}
