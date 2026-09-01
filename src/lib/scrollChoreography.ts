/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SCROLL CHOREOGRAPHY — the maths
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pure numbers. No DOM, no React, no three.js — everything here is a function of
 * (scroll position, viewport, a longitude the visitor has steered by hand), so
 * the whole choreography is deterministic and exactly reversible: scrolling back
 * up retraces the way down, because nothing accumulates.
 *
 * The three phases, off one normalised progress value:
 *
 *   0 ────────────── 0.5 ─────────────────────────────────────────────── 1
 *   │  1. approach    │  2. the stop  │  3. travel across the surface
 *   │  camera dollies │  a held beat  │  latitude sweeps, longitude spirals
 *   │  ambient spin   │  at a distance│  drag / swipe steers longitude
 *   │  eases to zero  │  that still   │  directly on top of it
 *   │  landing text   │  shows the    │
 *   │  fades out      │  curvature    │
 *
 * The stop sits at exactly {@link STOP_PROGRESS} even though the two phases are
 * given very different amounts of real scrolling — {@link scrollLengths} maps
 * pixels to progress piecewise, so the constants below stay readable.
 *
 * Camera model (mirrors PhotoSphere): the camera sits on +Z at
 * `baseDistance * distanceScale`, looking down −Z, and never re-targets. The
 * sphere is rotated under it — `spin` about its own Y (longitude), `tilt` about
 * world X (latitude). So travelling the surface is a rotation, never a pan.
 */
import { distanceForViewportFraction } from './sphereMath'

/* ── Tuning ──────────────────────────────────────────────────────────────── */

/** Scroll, in viewport heights, that the phase-1 dolly consumes. */
export const APPROACH_SCREENS = 1.8

/** Scroll, in viewport heights, that is held perfectly still at the stop. */
export const STOP_DWELL_SCREENS = 0.3

/** Scroll, in viewport heights, of phase-3 travel across the sphere's surface. */
export const SURFACE_SCREENS = 18

/** Normalised progress at which the dolly ends and surface travel begins. */
export const STOP_PROGRESS = 0.5

/** Sphere's angular radius at the stop, as a multiple of the viewport's
 *  half-diagonal. Above 1 the silhouette overflows the frame, so the curvature
 *  is read from the foreshortening in the corners rather than from an edge. */
export const STOP_COVER = 1

/** Never closer than this, in sphere radii. The client chose to stay outside the
 *  shell looking at the convex face; this is the guard rail that keeps it so. */
export const MIN_STOP_DISTANCE = 1.34

/** Never further than this at the stop, in sphere radii. Stops very tall, narrow
 *  viewports from calling it a day while the sphere is still a distant marble. */
export const MAX_STOP_DISTANCE = 3.1

/** Latitude the surface phase starts at, radians. Positive looks north. */
export const LATITUDE_TOP = 1.05

/** Latitude the surface phase ends at, radians. */
export const LATITUDE_BOTTOM = -1.05

/** Full turns of longitude across the whole surface phase. Latitude sweeps once
 *  while this spirals, so the path wraps the globe; more turns close the gaps
 *  between passes at the cost of a faster sideways drift per screen scrolled. */
export const SURFACE_TURNS = 3.5

/** Fraction of the approach spent before the latitude roll starts. Early scroll
 *  is a pure dolly; the roll settles in with the stop. */
export const APPROACH_TILT_DELAY = 0.28

/** Fraction of the approach after which the ambient spin has fully stopped. */
export const SPIN_FADE_END = 0.8

/** Fraction of the approach after which the landing text is gone. */
export const TEXT_FADE_END = 0.22

/** Damping rate for scroll progress, s⁻¹. Lower = heavier, more expensive.
 *  ~5 gives a 200ms time constant: it lags the finger and settles without wobble. */
export const PROGRESS_DAMPING = 5.5

/** Damping rate for hand-steered longitude, s⁻¹. Higher than the scroll: direct
 *  manipulation should feel attached to the pointer. */
export const LONGITUDE_DAMPING = 9

/** How far a gesture must travel before it is committed to an axis, px. */
export const GESTURE_LOCK_PX = 8

/** How much more horizontal than vertical a touch gesture must be to steer the
 *  sphere instead of scrolling the page. Above 1 so vertical scroll always wins ties. */
export const GESTURE_HORIZONTAL_BIAS = 1.2

/** Radians of longitude per pixel of horizontal wheel/trackpad delta, as a
 *  multiple of the drag rate. Trackpad deltas are coarser than pointer motion. */
export const WHEEL_LONGITUDE_GAIN = 0.8

/** How much more horizontal than vertical a wheel event must be before it steers
 *  the sphere. A two-finger vertical scroll on a trackpad carries a pixel or two
 *  of sideways noise in almost every event; without this the sphere would drift
 *  west all the way down the page. */
export const WHEEL_HORIZONTAL_BIAS = 1.2

/** Horizontal wheel deltas below this many pixels are noise, not intent. */
export const WHEEL_DEAD_ZONE_PX = 0.6

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
 * the same look on every screen.
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

  const baseDistance = distanceForViewportFraction(radius, fovDegrees, w, h, viewportFraction)

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
 * This is what makes hand-steering feel like direct manipulation: the surface
 * under the pointer can follow the pointer only if we know how many radians of
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

/* ── Scroll → progress ───────────────────────────────────────────────────── */

export type ScrollLengths = {
  /** Pixels of scroll spent on phase 1. */
  approachPx: number
  /** Pixels of scroll spent holding still at the stop. */
  dwellPx: number
  /** Pixels of scroll spent travelling the surface. */
  travelPx: number
  /** Total scrollable distance the choreography wants. */
  totalPx: number
  /** Height the spacer must have to *offer* that much scrolling. */
  spacerPx: number
  /** Share of phase 3 that is the dwell. */
  dwellFraction: number
}

export function scrollLengths(viewportHeight: number): ScrollLengths {
  const h = Math.max(1, viewportHeight)
  const approachPx = APPROACH_SCREENS * h
  const dwellPx = STOP_DWELL_SCREENS * h
  const travelPx = SURFACE_SCREENS * h
  const totalPx = approachPx + dwellPx + travelPx
  return {
    approachPx,
    dwellPx,
    travelPx,
    totalPx,
    // A document can only be scrolled by its height *minus one viewport* — the
    // last screenful is already on screen. Without this the final screen of the
    // choreography would be unreachable.
    spacerPx: totalPx + h,
    dwellFraction: dwellPx / Math.max(1, dwellPx + travelPx),
  }
}

/**
 * Normalised progress from a raw scroll position.
 *
 * Piecewise so that the stop lands on {@link STOP_PROGRESS} exactly while the
 * two phases keep wildly different physical lengths — one and a bit screens to
 * dive in, eighteen to walk the globe.
 */
export function progressFromScroll(scrollY: number, lengths: ScrollLengths): number {
  const y = Math.max(0, scrollY)
  if (y <= lengths.approachPx) {
    return STOP_PROGRESS * clamp01(y / Math.max(1, lengths.approachPx))
  }
  const after = (y - lengths.approachPx) / Math.max(1, lengths.dwellPx + lengths.travelPx)
  return STOP_PROGRESS + (1 - STOP_PROGRESS) * clamp01(after)
}

/* ── Progress → drive ────────────────────────────────────────────────────── */

export type ChoreoFrame = {
  /** Straight into `sphereDrive.distanceScale`. */
  distanceScale: number
  /** Straight into `sphereDrive.spin` — longitude, hand-steering included. */
  spin: number
  /** Straight into `sphereDrive.tilt` — latitude. */
  tilt: number
  /** Straight into `sphereDrive.spinScale` — 1 at rest, 0 by the stop. */
  spinScale: number
  /** 1 → 0 across the first breath of the approach. For landing text. */
  textOpacity: number
  /** Which phase this frame belongs to. */
  phase: 'approach' | 'surface'
}

/**
 * The whole choreography, as one pure function.
 *
 * `progress` is the damped value, not the raw one. `longitude` is the radians
 * the visitor has dragged/swiped by hand, added on top of the spiral.
 */
export function frameForProgress(
  progress: number,
  longitude: number,
  geom: ViewGeometry,
  lengths: ScrollLengths,
): ChoreoFrame {
  const p = clamp01(progress)

  if (p <= STOP_PROGRESS) {
    // ── Phase 1: approach ────────────────────────────────────────────────
    const t = p / STOP_PROGRESS
    const eased = smootherstep(t)

    // Geometric, not linear: a dolly that covers 3× in distance reads as a
    // constant-rate zoom only if the *ratio* moves at a constant rate.
    const distanceScale = Math.pow(geom.stopScale, eased)

    const tiltT = smootherstep((t - APPROACH_TILT_DELAY) / (1 - APPROACH_TILT_DELAY))

    return {
      distanceScale,
      spin: longitude,
      tilt: LATITUDE_TOP * tiltT,
      spinScale: 1 - smootherstep(t / SPIN_FADE_END),
      textOpacity: 1 - smootherstep(t / TEXT_FADE_END),
      phase: 'approach',
    }
  }

  // ── Phases 2 and 3: the held beat, then travel ─────────────────────────
  const afterStop = (p - STOP_PROGRESS) / (1 - STOP_PROGRESS)
  const travel = clamp01((afterStop - lengths.dwellFraction) / (1 - lengths.dwellFraction))

  return {
    // The dolly is over. Every further pixel of scroll is surface, not depth.
    distanceScale: geom.stopScale,
    // Negative so the surface drifts left and new photographs arrive from the
    // right — the direction a page of content moves when you scroll down.
    spin: longitude - SURFACE_TURNS * 2 * Math.PI * travel,
    // Top to bottom: the surface rises, new photographs arrive from below.
    tilt: mix(LATITUDE_TOP, LATITUDE_BOTTOM, travel),
    spinScale: 0,
    textOpacity: 0,
    phase: 'surface',
  }
}
