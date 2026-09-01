/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE SCROLL-CHOREOGRAPHY SEAM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `PhotoSphere` reads this object once per frame and never re-renders because of
 * it. That is the point: a scroll handler can write to it at 120Hz without
 * touching React, and nothing here ever schedules a render.
 *
 *   import { sphereDrive } from '../components/Sphere'
 *
 *   window.addEventListener('scroll', () => {
 *     const t = window.scrollY / window.innerHeight   // 0 → 1 over one screen
 *     sphereDrive.distanceScale = 1 + t * 1.4         // dolly the camera back
 *     sphereDrive.offsetY = -t * 0.8                  // slide it up the page
 *     sphereDrive.spinScale = 1 - t                   // let the ambient spin die
 *     sphereDrive.spin = t * Math.PI                  // …and steer it yourself
 *   }, { passive: true })
 *
 * Everything is absolute, not incremental — write the value you want for this
 * frame. Interpolate on your side (a lerp toward a target in a rAF loop reads
 * much better than raw scroll position). `resetSphereDrive()` puts it back.
 *
 * Under `prefers-reduced-motion` the ambient spin stops but the drive is still
 * read every frame, so scroll-linked motion remains yours to decide about.
 *
 * If you would rather stay declarative, `<PhotoSphere drive={…} />` and
 * `<SphereStage drive={…} />` accept a partial of this shape and will use that
 * object instead of the singleton — handy for a second sphere, or for driving it
 * from a state library you already have.
 */
export type SphereDrive = {
  /** Multiplies the auto-computed camera distance. 1 = the default framing. */
  distanceScale: number
  /** World-space camera shift. Positive x moves the sphere left on screen. */
  offsetX: number
  /** World-space camera shift. Positive y moves the sphere down on screen. */
  offsetY: number
  /** Scales the ambient spin. 0 freezes it, negative reverses it. */
  spinScale: number
  /** Rotation (radians) added on top of the ambient spin. Absolute, not a delta. */
  spin: number
  /** Extra tilt (radians) on the spin axis, on top of the resting tilt. */
  tilt: number
  /** 0–1 fade for the whole sphere. Below 1 the tiles switch to blending. */
  opacity: number
}

export const SPHERE_DRIVE_DEFAULTS: SphereDrive = {
  distanceScale: 1,
  offsetX: 0,
  offsetY: 0,
  spinScale: 1,
  spin: 0,
  tilt: 0,
  opacity: 1,
}

/** The shared, mutable drive. Mutate it; do not replace it. */
export const sphereDrive: SphereDrive = { ...SPHERE_DRIVE_DEFAULTS }

export function resetSphereDrive(): void {
  Object.assign(sphereDrive, SPHERE_DRIVE_DEFAULTS)
}
