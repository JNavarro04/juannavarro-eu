import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import type { Photo } from '../../types'
import { distanceForViewportFraction, layoutTiles, shuffledIndices } from '../../lib/sphereMath'
import { sphereDrive, type SphereDrive } from './sphereDrive'
import { sphereFragmentShader, sphereVertexShader } from './shaders'
import type { AtlasKind } from './useAtlasTexture'

/* ── Tunables ───────────────────────────────────────────────────────────────
   Layout tunables (fill, size jitter, tilt) live in src/lib/sphereMath.ts, in
   TILE_LAYOUT_DEFAULTS, with the coverage measurements that produced them. */

/** Sphere radius in world units. Everything else is expressed against it. */
export const SPHERE_RADIUS = 1

/** Camera FOV. Narrow enough that the sphere reads as an object rather than a
 *  fisheye, wide enough to keep some perspective in the tiles near the edge. */
export const SPHERE_FOV = 35

/** Diameter as a fraction of the viewport's smaller side. */
export const VIEWPORT_FRACTION = 0.68

/** Ambient spin, radians per second. */
export const SPIN_SPEED = 0.028

/** Resting tilt of the spin axis: a lean toward the viewer and a roll, so the
 *  pole never sits dead centre and the rotation reads as a globe's. */
export const AXIS_TILT_X = 0.1
export const AXIS_TILT_Z = 0.2

/** Per-tile radius wobble, as a fraction of the radius. Gives overlaps a
 *  definite stacking order and the surface a little life. */
export const RELIEF = 0.003

/** Subdivision of each tile. 12×12 keeps the curvature smooth at this angular
 *  size; the whole sphere is still only ~47k triangles in one draw call. */
export const TILE_SEGMENTS = 12

/** Shuffles which photo lands on which lattice point, so portraits, panoramas
 *  and dark frames spread out instead of clumping in filename order. 0 keeps
 *  the manifest order. */
export const PLACEMENT_SEED = 20250901

/** Half-texel inset on each atlas rect, in atlas pixels. The packer already
 *  leaves a 4px gutter; this covers the last of the mip bleed at grazing angles. */
const UV_INSET_PX = 0.5

export type PhotoSphereProps = {
  texture: THREE.Texture
  photos: readonly Photo[]
  atlasKind: AtlasKind
  atlasSize: number
  /** Overrides the shared {@link sphereDrive} singleton. See sphereDrive.ts. */
  drive?: Partial<SphereDrive>
  /** When true the sphere is drawn exactly as usual but never moves. */
  reducedMotion?: boolean
}

export default function PhotoSphere({
  texture,
  photos,
  atlasKind,
  atlasSize,
  drive,
  reducedMotion = false,
}: PhotoSphereProps) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const axisRef = useRef<THREE.Group>(null)
  const spinRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const ambientSpin = useRef(0)

  const geometry = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1, TILE_SEGMENTS, TILE_SEGMENTS)
    const order = shuffledIndices(photos.length, PLACEMENT_SEED)
    const placed = order.map((i) => photos[i])
    const layout = layoutTiles(placed.map((p) => p.aspect))

    const uv = new Float32Array(layout.count * 4)
    const inset = UV_INSET_PX / atlasSize
    for (let i = 0; i < layout.count; i++) {
      const rect = placed[i].atlas[atlasKind]
      uv[i * 4] = rect.u + inset
      uv[i * 4 + 1] = rect.v + inset
      uv[i * 4 + 2] = rect.w - inset * 2
      uv[i * 4 + 3] = rect.h - inset * 2
    }

    base.setAttribute('iCenter', new THREE.InstancedBufferAttribute(layout.centers, 3))
    base.setAttribute('iSize', new THREE.InstancedBufferAttribute(layout.sizes, 2))
    base.setAttribute('iRot', new THREE.InstancedBufferAttribute(layout.rotations, 1))
    base.setAttribute('iSeed', new THREE.InstancedBufferAttribute(layout.seeds, 1))
    base.setAttribute('iUV', new THREE.InstancedBufferAttribute(uv, 4))
    return base
  }, [photos, atlasKind, atlasSize])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: sphereVertexShader,
        fragmentShader: sphereFragmentShader,
        uniforms: {
          uAtlas: { value: texture },
          uRadius: { value: SPHERE_RADIUS },
          uRelief: { value: RELIEF },
          uOpacity: { value: 1 },
        },
        // Tiles face outward, so the far half of the shell culls itself and the
        // gaps show the page instead of the backs of distant photographs.
        side: THREE.FrontSide,
        transparent: false,
        depthWrite: true,
        depthTest: true,
      }),
    [texture],
  )

  useLayoutEffect(() => {
    // Runs before r3f's first render, so this lands on the initial upload.
    texture.anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy())
    texture.needsUpdate = true
  }, [texture, gl])

  useLayoutEffect(() => {
    // THREE.InstancedMesh allocates its instance matrices as zeros. The shader
    // never reads them — every tile is placed from its own attributes — but a
    // zero matrix is a trap for anything that later asks the mesh where it is.
    const mesh = meshRef.current
    if (!mesh) return
    const identity = new THREE.Matrix4()
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, identity)
    mesh.instanceMatrix.needsUpdate = true
  }, [geometry, material])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  const baseDistance = useMemo(
    () =>
      distanceForViewportFraction(
        SPHERE_RADIUS,
        SPHERE_FOV,
        size.width,
        size.height,
        VIEWPORT_FRACTION,
      ),
    [size.width, size.height],
  )

  useFrame((_, delta) => {
    const d = drive ?? sphereDrive

    // Frame-rate independent, and clamped so a backgrounded tab does not come
    // back to a sphere that has spun half a turn during a single long frame.
    if (!reducedMotion) {
      ambientSpin.current += Math.min(delta, 0.1) * SPIN_SPEED * (d.spinScale ?? 1)
    }
    if (spinRef.current) spinRef.current.rotation.y = ambientSpin.current + (d.spin ?? 0)
    if (axisRef.current) axisRef.current.rotation.x = AXIS_TILT_X + (d.tilt ?? 0)

    camera.position.set(
      d.offsetX ?? 0,
      d.offsetY ?? 0,
      baseDistance * (d.distanceScale ?? 1),
    )

    const opacity = d.opacity ?? 1
    material.uniforms.uOpacity.value = opacity
    material.transparent = opacity < 1
  })

  return (
    <group ref={axisRef} rotation={[AXIS_TILT_X, 0, AXIS_TILT_Z]}>
      <group ref={spinRef}>
        <instancedMesh
          ref={meshRef}
          args={[geometry, material, photos.length]}
          // The instance matrices are identity — the shader places every tile
          // from its own attributes — so the derived bounding sphere would be
          // the unit quad's, not the shell's. Culling it by hand is wrong; skip it.
          frustumCulled={false}
        />
      </group>
    </group>
  )
}
