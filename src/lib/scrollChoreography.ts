/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SCROLL CHOREOGRAPHY — the maths
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pure numbers. No DOM, no React, no three.js.
 *
 * One gesture, one meaning:
 *
 *   SCROLL  →  DISTANCE.  Down dollies the camera in toward the surface, up
 *              dollies back out to the resting globe. That is *all* scrolling
 *              does. The scroll range ends where the zoom ends: at the bottom of
 *              the document the camera is at the stop and there is nothing left
 *              to scroll.
 *
 *   DRAG    →  ORBIT.     Pointer and touch drag rotate the sphere in both axes,
 *              with momentum on release, so every photograph is reachable.
 *
 * Both are absolute functions of their input, so both are exactly reversible:
 * nothing here accumulates, and scrolling back up retraces the way down.
 *
 * Under `prefers-reduced-motion: reduce` both still work, and neither is
 * animated: the caller stops damping and feeds these functions the raw values,
 * so the sphere tracks the finger and the scrollbar frame for frame and is
 * perfectly still the instant either stops. What that mode removes is motion the
 * visitor did not ask for and cannot stop — the ambient spin, the eased dolly,
 * and the flick that keeps gliding after release. Not the ability to look
 * around: a static globe shows one hemisphere, and the other 81 photographs
 * would be unreachable.
 *
 * Camera model (mirrors PhotoSphere): the camera sits on +Z at
 * `baseDistance * distanceScale` looking down −Z, and never re-targets. The
 * sphere turns under it — `spin` about its own Y (longitude), `tilt` about world
 * X (latitude) — so orbiting is rotation, never a pan.
 */
import * as sphereMath from './sphereMath'

/**
 * sphereMath is being rewritten underneath this file, so its one helper we need
 * is looked up rather than imported by name: if it changes shape, disappears, or
 * starts returning nonsense mid-edit, the mirror below keeps the choreography
 * framing the sphere correctly instead of taking the landing page down with it.
 *
 * The mirror is the formula as of this writing. It is deliberately *only* a
 * fallback — while the real helper is there we defer to it, so that retuning
 * VIEWPORT_FRACTION or the projection over there still moves the stop with it.
 */
type DistanceForViewportFraction = (
  radius: number,
  fovYDegrees: number,
  viewportWidth: number,
  viewportHeight: number,
  fraction: number,
) => number

const sphereMathHelpers = sphereMath as unknown as Partial<{
  distanceForViewportFraction: DistanceForViewportFraction
}>

function restingDistance(
  radius: number,
  fovYDegrees: number,
  width: number,
  height: number,
  fraction: number,
): number {
  const helper = sphereMathHelpers.distanceForViewportFraction
  if (typeof helper === 'function') {
    const distance = helper(radius, fovYDegrees, width, height, fraction)
    if (Number.isFinite(distance) && distance > radius) return distance
  }
  const spanOfHeight = (Math.min(width, height) * fraction) / Math.max(1, height)
  const tanHalfFov = Math.tan((fovYDegrees * Math.PI) / 360)
  const tanBeta = Math.max(1e-4, spanOfHeight * tanHalfFov)
  const sinBeta = Math.min(0.98, tanBeta / Math.sqrt(1 + tanBeta * tanBeta))
  return radius / sinBeta
}

/* ── Tuning: the zoom ────────────────────────────────────────────────────── */

/** Scroll, in viewport heights, that the whole dolly consumes. The document is
 *  exactly this much taller than the viewport, and not one pixel more. */
export const ZOOM_SCREENS = 2

/** Sphere's angular radius at the stop, as a multiple of the viewport's
 *  half-diagonal. At 1 the silhouette passes through the corners: the frame is
 *  filled edge to edge, and the curvature is read from the foreshortening that
 *  runs from a photograph facing you dead centre to one nearly edge-on in the
 *  corner. Raise it to press closer; the picture flattens as you do. */
export const STOP_COVER = 1

/** Never closer than this, in sphere radii. The client chose to stay outside the
 *  shell looking at the convex face; this is the guard rail that keeps it so. */
export const MIN_STOP_DISTANCE = 1.34

/** Never further than this at the stop, in sphere radii. Stops a very tall,
 *  narrow viewport from calling it a day while the sphere is still a marble. */
export const MAX_STOP_DISTANCE = 3.1

/** Fraction of the zoom after which the ambient spin has fully stopped. */
export const SPIN_FADE_END = 0.8

/** Fraction of the zoom after which the landing text is gone. */
export const TEXT_FADE_END = 0.22

/** Progress past which the page counts as zoomed in: the way-back-out control
 *  appears, and on touch the scroll lock is armed. */
export const ZOOMED_PROGRESS = 0.82

/** Progress at which touch scrolling hands over to orbiting. Effectively "the
 *  document is at its bottom", so the lock never swallows a scroll that would
 *  still have moved the camera. */
export const LOCK_PROGRESS = 0.995

/* ── Tuning: the feel ────────────────────────────────────────────────────── */

/** Damping rate for scroll progress, s⁻¹. ~5 is a 180ms time constant: it lags
 *  the wheel just enough to feel weighty and settles without wobble. */
export const PROGRESS_DAMPING = 5.5

/** Damping rate for the orbit, s⁻¹. Higher than the scroll — direct
 *  manipulation should feel attached to the finger, not towed by it. */
export const ORBIT_DAMPING = 12

/** How far the orbit may travel from the equator, radians. Just short of π/2:
 *  the poles come fully into view without the axis passing through the camera. */
export const ORBIT_LATITUDE_LIMIT = 1.45

/** Decay rate of a flick, s⁻¹. The glide is over in roughly a second. */
export const FLICK_DECAY = 3.4

/** Fastest a flick may throw the sphere, radians per second. */
export const FLICK_MAX_SPEED = 7

/** Below this speed, radians per second, the glide is over. */
export const FLICK_MIN_SPEED = 0.02

/** A pointer that has been still this long, ms, releases without a flick. */
export const FLICK_IDLE_MS = 90

/** How much the EMA of pointer velocity trusts the newest sample. */
export const FLICK_SMOOTHING = 0.32

/* ── Tuning: gestures ────────────────────────────────────────────────────── */

/** Movement below this, px, is a click, not a drag. Under it the pointer is
 *  never captured and the click reaches the page untouched — which is what lets
 *  a lightbox hook clicks on the photographs. */
export const CLICK_SLOP_PX = 6

/** Clicks are swallowed for this long, ms, after a real drag ends, so releasing
 *  a spin does not also open the photograph under the finger. */
export const CLICK_SUPPRESS_MS = 400

/** Growth in the distance between two fingers, px, that means "pinch out" and
 *  takes a locked, zoomed-in phone back to the globe. */
export const PINCH_OUT_PX = 64

/* ── Small helpers ───────────────────────────────────────────────────────── */

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1)
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Ken Perlin's smootherstep: zero first *and* second derivative at both ends,
 *  which is what keeps the arrival at the stop from reading as a brake. */
export function smootherstep(x: number): number {
  const t = clamp01(x)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * Frame-rate independent damping. `lambda` is the rate in s⁻¹; the result is
 * identical at 60Hz and 120Hz and stays stable if a frame takes 300ms.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

/* ── View geometry ───────────────────────────────────────────────────────── */

export type ViewGeometry = {
  /** Camera distance for the resting framing, world units. */
  baseDistance: number
  /** Camera distance at the stop, world units. */
  stopDistance: number
  /** `distanceScale` that lands the camera at {@link stopDistance}. */
  stopScale: number
  /** Sphere radius these distances are expressed against. */
  radius: number
  /** tan of the half vertical FOV. */
  tanHalfFovY: number
  /** tan of the half horizontal FOV. */
  tanHalfFovX: number
}

export type ViewGeometryInput = {
  width: number
  height: number
  /** SPHERE_RADIUS from PhotoSphere. */
  radius: number
  /** SPHERE_FOV from PhotoSphere (vertical, degrees). */
  fovDegrees: number
  /** VIEWPORT_FRACTION from PhotoSphere — how the resting framing is defined. */
  viewportFraction: number
}

/**
 * Everything the choreography needs to know about the current viewport.
 *
 * The stop distance is derived from the viewport's *diagonal*, not its height:
 * a 16:9 desktop needs the camera much closer than a 390px phone before the
 * sphere covers the corners, and a fixed `distanceScale` would frame the two
 * completely differently. Deriving it means one constant (STOP_COVER) describes
 * the same look on every screen — 1440×900, 390×844 and 740×360 alike.
 */
export function viewGeometry(input: ViewGeometryInput): ViewGeometry {
  const { width, height, radius, fovDegrees, viewportFraction } = input
  const w = Math.max(1, width)
  const h = Math.max(1, height)

  const tanHalfFovY = Math.tan((fovDegrees * Math.PI) / 360)
  const tanHalfFovX = tanHalfFovY * (w / h)
  const halfDiagonal = Math.atan(Math.hypot(tanHalfFovX, tanHalfFovY))

  // Angular radius the silhouette should have at the stop, capped well short of
  // 90° — sin(limb) = radius/distance, so a limb near 90° is a camera on the skin.
  const limb = clamp(halfDiagonal * STOP_COVER, 0.05, 1.2)
  const stopDistance = clamp(
    radius / Math.sin(limb),
    radius * MIN_STOP_DISTANCE,
    radius * MAX_STOP_DISTANCE,
  )

  const baseDistance = restingDistance(radius, fovDegrees, w, h, viewportFraction)

  return {
    baseDistance,
    stopDistance,
    // Never above 1: the choreography only ever moves in.
    stopScale: Math.min(1, stopDistance / Math.max(1e-3, baseDistance)),
    radius,
    tanHalfFovY,
    tanHalfFovX,
  }
}

/**
 * Polar angle, from the point facing the camera, of the surface the ray at
 * `rayAngle` off the view axis lands on. Beyond the silhouette it returns the
 * silhouette's own angle, so it is defined for every ray.
 *
 * This is what makes orbiting feel like direct manipulation: the photograph
 * under the finger can follow the finger only if we know how many radians of
 * sphere a pixel is worth at the current distance.
 */
export function surfacePolarAngle(distance: number, rayAngle: number, radius: number): number {
  const d = Math.max(radius * 1.0001, distance)
  const cos = Math.cos(rayAngle)
  const disc = d * d * cos * cos - (d * d - radius * radius)
  if (disc <= 0) return Math.asin(clamp(radius / d, -1, 1))
  const t = d * cos - Math.sqrt(disc)
  return Math.atan2(t * Math.sin(rayAngle), d - t * cos)
}

/** Half the longitude visible across the screen at this camera distance. */
export function visibleLongitudeHalfAngle(geom: ViewGeometry, distance: number): number {
  return surfacePolarAngle(distance, Math.atan(geom.tanHalfFovX), geom.radius)
}

/** Half the latitude visible down the screen at this camera distance. */
export function visibleLatitudeHalfAngle(geom: ViewGeometry, distance: number): number {
  return surfacePolarAngle(distance, Math.atan(geom.tanHalfFovY), geom.radius)
}

/* ── Scroll → progress ───────────────────────────────────────────────────── */

export type ScrollLengths = {
  /** Scroll distance the zoom wants, px. */
  zoomPx: number
  /** Height the spacer must have to offer exactly that much scrolling, px. */
  spacerPx: number
}

export function scrollLengths(viewportHeight: number): ScrollLengths {
  const h = Math.max(1, viewportHeight)
  const zoomPx = ZOOM_SCREENS * h
  return {
    zoomPx,
    // A document can only be scrolled by its height *minus one viewport* — the
    // last screenful is already on screen. Without this the zoom would end one
    // screen before the bottom and leave dead scrolling behind it.
    spacerPx: zoomPx + h,
  }
}

/**
 * Normalised progress, 0 at the resting globe and 1 at the stop.
 *
 * The range is the smaller of what the zoom asked for and what the document can
 * actually scroll. That second term is what guarantees the two things the page
 * must never do: end the zoom early and leave dead scrolling underneath it, or
 * run out of document before the zoom finishes. It also absorbs a phone's URL
 * bar sliding away, which changes `innerHeight` by ~10% without the document
 * changing at all.
 */
export function progressFromScroll(
  scrollY: number,
  documentHeight: number,
  viewportHeight: number,
  lengths: ScrollLengths,
): number {
  const scrollable = Math.max(1, documentHeight - viewportHeight)
  const range = Math.max(1, Math.min(lengths.zoomPx, scrollable))
  return clamp01(Math.max(0, scrollY) / range)
}

/* ── Progress → drive ────────────────────────────────────────────────────── */

/** Where the visitor has orbited to, radians. Entirely hand-driven. */
export type OrbitState = {
  /** Longitude, unbounded — the sphere turns as far as you keep dragging. */
  longitude: number
  /** Latitude, clamped to ±{@link ORBIT_LATITUDE_LIMIT}. */
  latitude: number
}

export type ChoreoFrame = {
  /** Straight into `sphereDrive.distanceScale`. */
  distanceScale: number
  /** Straight into `sphereDrive.spin` — longitude. */
  spin: number
  /** Straight into `sphereDrive.tilt` — latitude. */
  tilt: number
  /** Straight into `sphereDrive.spinScale` — 1 at rest, 0 by the stop. */
  spinScale: number
  /** 1 → 0 across the first breath of the zoom. For landing text. */
  textOpacity: number
}

/**
 * The whole choreography, as one pure function.
 *
 * `progress` is the damped value, not the raw one, and `orbit` is the damped
 * orbit. Distance comes from scrolling and only from scrolling; rotation comes
 * from dragging and only from dragging.
 *
 * Under `reducedMotion` the shape of every curve is unchanged — what changes is
 * that the caller feeds this the *undamped* values, so nothing keeps moving once
 * the visitor stops. The one thing switched off here is the ambient spin, which
 * is the only motion in the whole page that runs on its own.
 */
export function frameForProgress(
  progress: number,
  orbit: OrbitState,
  geom: ViewGeometry,
  reducedMotion = false,
): ChoreoFrame {
  const p = clamp01(progress)
  const eased = smootherstep(p)

  return {
    // Geometric, not linear: a dolly that covers 3× in distance reads as a
    // constant-rate zoom only if the *ratio* moves at a constant rate.
    distanceScale: Math.pow(geom.stopScale, eased),
    spin: orbit.longitude,
    tilt: clamp(orbit.latitude, -ORBIT_LATITUDE_LIMIT, ORBIT_LATITUDE_LIMIT),
    // Unprompted motion, and the only motion here nobody asked for: off.
    spinScale: reducedMotion ? 0 : 1 - smootherstep(p / SPIN_FADE_END),
    textOpacity: 1 - smootherstep(p / TEXT_FADE_END),
  }
}
