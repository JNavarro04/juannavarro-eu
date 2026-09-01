import { SphereStage } from '../components/Sphere'

/**
 * The landing page is the sphere. One full-viewport stage, nothing else.
 *
 * ── For whoever adds the scroll choreography ───────────────────────────────
 * Do not reach into the canvas. Import the drive and write to it from a rAF or
 * scroll handler; `PhotoSphere` reads it every frame and React is not involved,
 * so nothing here re-renders:
 *
 *   import { sphereDrive } from './routes/Landing'
 *   sphereDrive.distanceScale = 1 + progress   // dolly out
 *   sphereDrive.offsetY = -progress            // slide the sphere up
 *   sphereDrive.spinScale = 1 - progress       // ease the ambient spin down
 *
 * The full field list and semantics are in src/components/Sphere/sphereDrive.ts.
 * If this page ever needs its own drive rather than the shared one, pass a
 * partial to `<SphereStage drive={…} />` — the same object is read every frame.
 *
 * Adding page content below the sphere is a matter of giving this <main> a
 * scroll height and pinning `.sphere-stage` — the stage fills its parent and
 * has no opinions about the rest of the document.
 */
export default function Landing() {
  return (
    <main style={{ height: '100dvh', width: '100%' }}>
      <SphereStage />
    </main>
  )
}

export { sphereDrive, resetSphereDrive, SPHERE_DRIVE_DEFAULTS } from '../components/Sphere'
export type { SphereDrive } from '../components/Sphere'
