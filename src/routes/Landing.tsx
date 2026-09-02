import { useCallback, useEffect, useState } from 'react'
import { SphereStage, pickPhotoAt } from '../components/Sphere'
import ScrollChoreography from '../components/ScrollChoreography'
import Lightbox from '../components/Lightbox'
import { PHOTOS } from '../lib/photos'

/**
 * The landing page is the sphere.
 *
 * `ScrollChoreography` supplies the scroll distance and pins the stage, then
 * writes to the shared `sphereDrive` every frame: scroll dollies the camera in,
 * the globe morphs into a cylinder of photographs, and drag orbits it. None of
 * that re-renders React — see src/components/Sphere/sphereDrive.ts.
 *
 * Clicks are the one thing that does. The choreography already tells a click
 * apart from a drag (6px of slop, then 400ms of suppression after a real drag),
 * so anything arriving here is a deliberate press on a photograph.
 */
export default function Landing() {
  const [index, setIndex] = useState<number | null>(null)

  const onClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const hit = pickPhotoAt(event.clientX, event.clientY)
    if (hit) setIndex(hit.index)
  }, [])

  const close = useCallback(() => setIndex(null), [])
  const prev = useCallback(
    () => setIndex((i) => (i === null ? i : (i - 1 + PHOTOS.length) % PHOTOS.length)),
    [],
  )
  const next = useCallback(
    () => setIndex((i) => (i === null ? i : (i + 1) % PHOTOS.length)),
    [],
  )

  // A photograph open while the visitor navigates away would otherwise persist
  // across the route change, since the lightbox portals into <body>.
  useEffect(() => () => setIndex(null), [])

  const photo = index === null ? null : PHOTOS[index]

  return (
    <main style={{ height: '100dvh', width: '100%' }}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div onClick={onClick} style={{ height: '100%', width: '100%' }}>
        <SphereStage />
      </div>
      <ScrollChoreography />
      <Lightbox
        photo={photo}
        onClose={close}
        onPrev={prev}
        onNext={next}
        index={index === null ? undefined : index + 1}
        total={PHOTOS.length}
      />
    </main>
  )
}

export { sphereDrive, resetSphereDrive, SPHERE_DRIVE_DEFAULTS } from '../components/Sphere'
export type { SphereDrive } from '../components/Sphere'
