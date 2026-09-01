import { SphereStage } from '../components/Sphere'
import ScrollChoreography from '../components/ScrollChoreography'
import LandingTitle from '../components/LandingTitle'

/**
 * The landing page is the sphere.
 *
 * `ScrollChoreography` supplies the scroll distance and pins the stage, then
 * writes to the shared `sphereDrive` every frame. Scroll dollies the camera in
 * and back out; once the zoom is spent, dragging orbits the globe. Neither
 * path re-renders React — see src/components/Sphere/sphereDrive.ts.
 */
export default function Landing() {
  return (
    <main style={{ height: '100dvh', width: '100%' }}>
      <SphereStage />
      <LandingTitle />
      <ScrollChoreography />
    </main>
  )
}

export { sphereDrive, resetSphereDrive, SPHERE_DRIVE_DEFAULTS } from '../components/Sphere'
export type { SphereDrive } from '../components/Sphere'
