import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'

import { MANIFEST, PHOTOS, atlasUrl } from '../../lib/photos'
import PhotoSphere, { SPHERE_FOV } from './PhotoSphere'
import type { SphereDrive } from './sphereDrive'
import { pickAtlasKind, useAtlasTexture } from './useAtlasTexture'
import './sphere.css'

export type SphereStageProps = {
  /** Overrides the shared `sphereDrive` singleton. See sphereDrive.ts. */
  drive?: Partial<SphereDrive>
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

/**
 * The photo sphere plus everything around it: atlas choice, the loading state,
 * and the WebGL canvas itself.
 *
 * The canvas is not mounted until the atlas is decoded — a canvas that appears
 * empty and then fills in is worse than one that appears late.
 */
export default function SphereStage({ drive, className }: SphereStageProps) {
  // Picked once. A phone does not become a desktop mid-session, and swapping
  // atlases on a resize would mean re-uploading 2MB of texture for nothing.
  const atlasKind = useMemo(() => pickAtlasKind(), [])
  const url = useMemo(() => atlasUrl(atlasKind), [atlasKind])
  const { texture, error } = useAtlasTexture(url)
  const reducedMotion = usePrefersReducedMotion()

  return (
    <div className={className ? `sphere-stage ${className}` : 'sphere-stage'}>
      {texture ? (
        <Canvas
          className="sphere-stage__canvas"
          // `flat` = no tone mapping. ACES would quietly re-grade every
          // photograph on the page; these frames are already finished.
          flat
          dpr={[1, 2]}
          // Always, even under prefers-reduced-motion. The sphere itself stops
          // moving, but the drive seam can be written to at any moment and
          // "demand" would leave those writes on screen only after an
          // invalidate() the caller has no reason to know about.
          frameloop="always"
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ fov: SPHERE_FOV, near: 0.1, far: 100, position: [0, 0, 5] }}
        >
          <PhotoSphere
            texture={texture}
            photos={PHOTOS}
            atlasKind={atlasKind}
            atlasSize={MANIFEST.atlas[atlasKind].sheet}
            drive={drive}
            reducedMotion={reducedMotion}
          />
        </Canvas>
      ) : error ? (
        <div className="sphere-stage__error" role="status">
          The photographs could not be loaded.
        </div>
      ) : (
        <div className="sphere-stage__loading" role="status" aria-label="Loading photographs">
          <div className="sphere-stage__ring" />
        </div>
      )}
    </div>
  )
}
