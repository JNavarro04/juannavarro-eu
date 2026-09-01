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
  CLICK_SLOP_PX,
  CLICK_SUPPRESS_MS,
  FLICK_DECAY,
  FLICK_IDLE_MS,
  FLICK_MAX_SPEED,
  FLICK_MIN_SPEED,
  FLICK_SMOOTHING,
  LOCK_PROGRESS,
  ORBIT_DAMPING,
  ORBIT_LATITUDE_LIMIT,
  PINCH_OUT_PX,
  PROGRESS_DAMPING,
  ZOOMED_PROGRESS,
  ZOOM_SCREENS,
  clamp,
  damp,
  frameForProgress,
  progressFromScroll,
  scrollLengths,
  viewGeometry,
  visibleLatitudeHalfAngle,
  visibleLongitudeHalfAngle,
} from '../lib/scrollChoreography'
import type { OrbitState, ScrollLengths, ViewGeometry } from '../lib/scrollChoreography'
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
 * It pins `.sphere-stage` to the viewport for the whole scroll (one rule in
 * choreography.css, keyed off a class on <html>, so nothing in Sphere/ changes),
 * gives the document exactly as much scroll height as the zoom needs — a spacer
 * behind the pinned canvas, never visible — and writes to the `sphereDrive` seam
 * once per frame from a single rAF loop.
 *
 *   SCROLL is distance and nothing else. Native scroll, never preventDefault-ed
 *   on the way in, so the wheel, the keyboard, the scrollbar, trackpad momentum
 *   and a phone's own scrolling all behave exactly as they do on any other page.
 *
 *   DRAG is rotation and nothing else. Both axes, with momentum on release.
 *
 * On touch those two are the same physical gesture, so they are separated in
 * time rather than in space: while the zoom still has somewhere to go, a swipe
 * scrolls; once the document is at its bottom and the camera is at the stop, the
 * page has nothing left to scroll, so swipes orbit instead and the way back out
 * is the "Back to globe" control (or a pinch out). See `applyLock` below.
 *
 * Nothing here re-renders React. The only DOM writes per frame are two custom
 * properties, and only when their rounded value actually changed.
 */

/* ── The seam this component publishes to the rest of the page ─────────────
 *
 *  <html class="choreo-on choreo-zoomed choreo-locked choreo-dragging"
 *        style="--choreo-progress: 0…1; --choreo-text-opacity: 0…1">
 *
 * Any landing text can fade itself out with
 *   opacity: var(--choreo-text-opacity, 1)
 * without knowing anything about scrolling.
 */
const ACTIVE_CLASS = 'choreo-on'
const ZOOMED_CLASS = 'choreo-zoomed'
const LOCKED_CLASS = 'choreo-locked'
const DRAGGING_CLASS = 'choreo-dragging'
const PROGRESS_VAR = '--choreo-progress'
const TEXT_OPACITY_VAR = '--choreo-text-opacity'

/** Pre-effect spacer height, in vh, so the document has its scroll range on the
 *  very first layout — otherwise a reload at mid-page would be clamped to 0.
 *  The +1 is the viewport itself, which is height a document cannot scroll. */
const FALLBACK_SCREENS = ZOOM_SCREENS + 1

/** Gestures that start on these never orbit the sphere. */
const INTERACTIVE = 'a, button, input, textarea, select, label, summary, [role="button"], [contenteditable]'

export type ScrollChoreographyProps = {
  /** The scroll cue's words. Pass an empty string to render no cue at all. */
  cue?: string
  /** The way-back-out control's words. */
  backLabel?: string
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
  cue = 'Scroll to explore',
  backLabel = 'Back to globe',
  drive,
  className,
}: ScrollChoreographyProps) {
  const spacerRef = useRef<HTMLDivElement>(null)
  const cueRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const target = drive ?? sphereDrive
    const root = document.documentElement
    const spacer = spacerRef.current
    const cueEl = cueRef.current
    const backEl = backRef.current

    // ── prefers-reduced-motion: reduce ───────────────────────────────────
    // No scroll-driven camera motion at all, and no scroll range to drive it
    // with. The resting sphere, and a page that scrolls like a page. Clicks on
    // the photographs still work, so the page is still usable without motion.
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
    const targetOrbit: OrbitState = { longitude: 0, latitude: 0 }
    const currentOrbit: OrbitState = { longitude: 0, latitude: 0 }
    let velocityLongitude = 0
    let velocityLatitude = 0
    let currentDistanceScale = 1

    // Measured viewport. Deliberately *not* the live one: a phone's URL bar
    // sliding away changes innerHeight by ~10% mid-scroll, and re-deriving the
    // scroll range from it would make the zoom jump under the finger. Only a
    // real layout change (rotation, window resize) re-measures.
    let stableWidth = 0
    let stableHeight = 0
    // Read once per measure, because reading it forces layout.
    let documentHeight = 0

    let frameHandle = 0
    let lastTime = 0
    let lastPublishedProgress = -1
    let lastPublishedText = -1
    let zoomed = false
    let locked = false

    const readScroll = () => {
      // innerHeight, not stableHeight: it is free to read and it tracks the URL
      // bar, which is exactly what decides how much document is left to scroll.
      targetProgress = progressFromScroll(
        window.scrollY,
        documentHeight,
        window.innerHeight,
        lengths,
      )
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
      // After the write, so it reflects the spacer we just sized.
      documentHeight = root.scrollHeight
      readScroll()
    }

    measure(true)
    // Land on whatever the browser restored rather than animating in from 0.
    currentProgress = targetProgress

    /* ── Orbiting ───────────────────────────────────────────────────────── */

    /** Radians of longitude/latitude one pixel of drag is worth, right now.
     *  Derived from the surface actually on screen, so the photograph under the
     *  pointer travels with the pointer at every distance. */
    const orbitPerPixel = () => {
      const distance = geometry.baseDistance * currentDistanceScale
      return {
        x: (2 * visibleLongitudeHalfAngle(geometry, distance)) / Math.max(1, stableWidth),
        y: (2 * visibleLatitudeHalfAngle(geometry, distance)) / Math.max(1, stableHeight),
      }
    }

    /** Live pointers, so a two-finger pinch can be told from a one-finger drag. */
    const pointers = new Map<number, { x: number; y: number }>()
    let dragId: number | null = null
    let dragging = false
    let dragStartX = 0
    let dragStartY = 0
    let lastPointerX = 0
    let lastPointerY = 0
    let lastMoveTime = 0
    let captured: Element | null = null
    let pinchStart = 0
    let suppressClickUntil = 0

    const releaseCapture = () => {
      if (captured && dragId !== null) {
        try {
          captured.releasePointerCapture(dragId)
        } catch {
          // The element may already be gone; the capture went with it.
        }
      }
      captured = null
    }

    const endDrag = () => {
      releaseCapture()
      dragId = null
      dragging = false
      root.classList.remove(DRAGGING_CLASS)
    }

    /** Scroll back to the resting globe. Nothing on screen scrolls — the stage
     *  is pinned and the spacer is empty — so this is invisible on its own: what
     *  the visitor sees is the camera easing out under the usual damping. */
    const backToGlobe = () => {
      velocityLongitude = 0
      velocityLatitude = 0
      window.scrollTo(0, 0)
      targetProgress = 0
      // Directly, not by waiting for the scroll event this fires: the lock is
      // the only thing standing between the visitor and the way out.
      applyLock()
    }

    /**
     * The mobile answer to "scroll and drag are the same gesture".
     *
     * They are separated in time. Below the end state the page still has zoom
     * left, so touch belongs to the page and a swipe scrolls (touch-action:
     * pan-y). At the end state there is no scrollable distance left at all, so
     * touch belongs to the sphere: the canvas takes touch-action: none and every
     * drag orbits. Because the hand-over happens exactly at the document's
     * bottom, the lock never swallows a swipe that would have done anything.
     *
     * Getting out again is explicit: the "Back to globe" button, or a pinch out.
     * Desktop never locks — the wheel zooms and the mouse orbits at the same
     * time without either one being ambiguous.
     */
    const applyLock = () => {
      const coarse = window.matchMedia('(pointer: coarse)').matches
      const shouldLock = coarse && targetProgress >= LOCK_PROGRESS
      if (shouldLock === locked) return
      locked = shouldLock
      root.classList.toggle(LOCKED_CLASS, locked)
    }

    /** Touch may only orbit once the page has nothing left to scroll. */
    const mayOrbit = (isTouch: boolean) => !isTouch || locked

    const onPointerDown = (event: PointerEvent) => {
      const node = event.target
      if (node instanceof Element && node.closest(INTERACTIVE)) return

      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (pointers.size === 2) {
        // A second finger is a pinch, never a drag.
        endDrag()
        const [a, b] = [...pointers.values()]
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y)
        return
      }
      if (pointers.size > 2 || dragId !== null) return

      const isTouch = event.pointerType !== 'mouse' && event.pointerType !== 'pen'
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (!mayOrbit(isTouch)) return

      dragId = event.pointerId
      dragging = false
      dragStartX = event.clientX
      dragStartY = event.clientY
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      lastMoveTime = event.timeStamp
      // Deliberately no pointer capture yet, and no dragging class: until the
      // gesture passes the slop it is still a click, and a click must reach the
      // page exactly as it would if this component were not here.
    }

    const onPointerMove = (event: PointerEvent) => {
      const tracked = pointers.get(event.pointerId)
      if (tracked) {
        tracked.x = event.clientX
        tracked.y = event.clientY
      }

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const spread = Math.hypot(a.x - b.x, a.y - b.y)
        if (locked && spread - pinchStart > PINCH_OUT_PX) {
          pinchStart = spread
          backToGlobe()
        }
        return
      }
      if (event.pointerId !== dragId) return

      if (!dragging) {
        if (Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) < CLICK_SLOP_PX) {
          return
        }
        dragging = true
        root.classList.add(DRAGGING_CLASS)
        if (event.target instanceof Element) {
          try {
            event.target.setPointerCapture(event.pointerId)
            captured = event.target
          } catch {
            captured = null
          }
        }
        // Start the drag from here, so the slop is not applied as a jump.
        lastPointerX = event.clientX
        lastPointerY = event.clientY
      }

      const rate = orbitPerPixel()
      // Drag right and the near face follows right; drag down and it follows
      // down. Direct manipulation, both axes.
      const dx = (event.clientX - lastPointerX) * rate.x
      const dy = (event.clientY - lastPointerY) * rate.y
      targetOrbit.longitude += dx
      targetOrbit.latitude = clamp(
        targetOrbit.latitude + dy,
        -ORBIT_LATITUDE_LIMIT,
        ORBIT_LATITUDE_LIMIT,
      )

      const dt = Math.max(8, event.timeStamp - lastMoveTime) / 1000
      velocityLongitude = mixVelocity(velocityLongitude, dx / dt)
      velocityLatitude = mixVelocity(velocityLatitude, dy / dt)

      lastPointerX = event.clientX
      lastPointerY = event.clientY
      lastMoveTime = event.timeStamp
    }

    const onPointerEnd = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (pointers.size < 2) pinchStart = 0
      if (event.pointerId !== dragId) return

      if (dragging) {
        // A pointer that came to rest before lifting should not fling.
        if (event.timeStamp - lastMoveTime > FLICK_IDLE_MS) {
          velocityLongitude = 0
          velocityLatitude = 0
        }
        // …and the click that follows a real drag is not a click on a photograph.
        suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS
      }
      endDrag()
    }

    /** Swallow only the click that a drag generates. Clean clicks — and every
     *  click on a link or button — are untouched, so a lightbox can hook them. */
    const onClickCapture = (event: MouseEvent) => {
      if (performance.now() > suppressClickUntil) return
      suppressClickUntil = 0
      const node = event.target
      if (node instanceof Element && node.closest(INTERACTIVE)) return
      event.stopPropagation()
      event.preventDefault()
    }

    const onScroll = () => {
      readScroll()
      applyLock()
    }
    const onResize = () => measure(false)
    const onOrientation = () => measure(true)
    // A mouse released outside the window never sends pointerup if the capture
    // did not take. Without this the page keeps the grabbing cursor for ever.
    const onBlur = () => {
      pointers.clear()
      endDrag()
    }
    const onBack = () => backToGlobe()

    /* ── The one rAF loop ───────────────────────────────────────────────── */
    const tick = (now: number) => {
      frameHandle = requestAnimationFrame(tick)
      const dt = lastTime === 0 ? 1 / 60 : Math.min(0.1, (now - lastTime) / 1000)
      lastTime = now

      // Momentum: the flick keeps feeding the *target*, and the same damping
      // that smooths a drag smooths the glide, so the two cannot disagree.
      if (!dragging && (velocityLongitude !== 0 || velocityLatitude !== 0)) {
        targetOrbit.longitude += velocityLongitude * dt
        const next = clamp(
          targetOrbit.latitude + velocityLatitude * dt,
          -ORBIT_LATITUDE_LIMIT,
          ORBIT_LATITUDE_LIMIT,
        )
        // Hitting the pole ends the vertical glide instead of grinding on it.
        if (next === targetOrbit.latitude) velocityLatitude = 0
        targetOrbit.latitude = next

        const decay = Math.exp(-FLICK_DECAY * dt)
        velocityLongitude *= decay
        velocityLatitude *= decay
        if (Math.hypot(velocityLongitude, velocityLatitude) < FLICK_MIN_SPEED) {
          velocityLongitude = 0
          velocityLatitude = 0
        }
      }

      currentProgress = damp(currentProgress, targetProgress, PROGRESS_DAMPING, dt)
      currentOrbit.longitude = damp(
        currentOrbit.longitude,
        targetOrbit.longitude,
        ORBIT_DAMPING,
        dt,
      )
      currentOrbit.latitude = damp(currentOrbit.latitude, targetOrbit.latitude, ORBIT_DAMPING, dt)

      const frame = frameForProgress(currentProgress, currentOrbit, geometry)
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
      const nowZoomed = currentProgress >= ZOOMED_PROGRESS
      if (nowZoomed !== zoomed) {
        zoomed = nowZoomed
        root.classList.toggle(ZOOMED_CLASS, zoomed)
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
    window.addEventListener('blur', onBlur)
    window.addEventListener('click', onClickCapture, true)
    backEl?.addEventListener('click', onBack)

    return () => {
      cancelAnimationFrame(frameHandle)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientation)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('click', onClickCapture, true)
      backEl?.removeEventListener('click', onBack)
      endDrag()
      root.classList.remove(ACTIVE_CLASS, ZOOMED_CLASS, LOCKED_CLASS, DRAGGING_CLASS)
      root.style.removeProperty(PROGRESS_VAR)
      root.style.removeProperty(TEXT_OPACITY_VAR)
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
      <button className="choreo__back" ref={backRef} type="button">
        {backLabel}
      </button>
      <div
        className="choreo__spacer"
        ref={spacerRef}
        aria-hidden="true"
        style={{ height: reducedMotion ? 0 : `${FALLBACK_SCREENS * 100}vh` }}
      />
    </div>
  )
}

/** EMA of pointer velocity, capped so one bad sample cannot launch the sphere. */
function mixVelocity(previous: number, sample: number): number {
  const blended = previous * (1 - FLICK_SMOOTHING) + sample * FLICK_SMOOTHING
  return clamp(blended, -FLICK_MAX_SPEED, FLICK_MAX_SPEED)
}
