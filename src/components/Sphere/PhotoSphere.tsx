import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import type { Photo } from '../../types'
import {
  distanceForViewportFraction,
  hexLuminance,
  layoutTiles,
  shuffledIndices,
  tonalOrder,
} from '../../lib/sphereMath'
import { sphereDrive, type SphereDrive } from './sphereDrive'
import { sphereFragmentShader, sphereVertexShader } from './shaders'
import type { AtlasKind } from './useAtlasTexture'

/* ── Tunables ───────────────────────────────────────────────────────────────
   How the photographs are arranged on the shell — courses, joint width, tile
   count per course — lives in src/lib/sphereMath.ts, in LAYOUT and
   BAND_LAYOUT_DEFAULTS, with the measurements that produced them. What is here
   is how that shell is aimed at the camera. The one that matters most is
   BAND_AXIS_TILT_DEG: the courses are the sphere's parallels, so where the
   polar axis points is what sets their angle on screen. */

/** Sphere radius in world units. Everything else is expressed against it. */
export const SPHERE_RADIUS = 1

/** Camera FOV. Narrow enough that the sphere reads as an object rather than a
 *  fisheye, wide enough to keep some perspective in the tiles near the edge. */
export const SPHERE_FOV = 35

/** Diameter as a fraction of the viewport's smaller side. */
export const VIEWPORT_FRACTION = 0.68

/** Ambient spin, radians per second. */
export const SPIN_SPEED = 0.028

/**
 * How far the courses rise, left to right, in degrees off horizontal on screen.
 *
 * The photographs are laid in bands of latitude, so what the viewer reads as
 * "the lines" are the sphere's parallels, and their angle is set entirely by
 * where the polar axis points. Tilting the axis is the only honest way to do
 * this: rotating the tiles instead would turn each photograph within its own
 * course and the courses would stop being lines.
 */
export const BAND_AXIS_TILT_DEG = 20

/** Lean of the spin axis toward the viewer. Small on purpose: it is what makes
 *  the courses bow like lines of latitude instead of running dead straight, and
 *  at this value it also keeps both poles a few degrees *behind* the silhouette,
 *  so the one place a band layout cannot tile is never in shot. */
export const AXIS_TILT_X = 0.1

/**
 * Roll of the spin axis, radians.
 *
 * Derived rather than chosen. A pole leaned by `AXIS_TILT_X` and rolled by this
 * lands on screen at atan(tan(roll) / cos(lean)) off vertical, and the courses
 * are perpendicular to it, so inverting that puts them at exactly
 * {@link BAND_AXIS_TILT_DEG}.
 */
export const AXIS_TILT_Z = Math.atan(
  Math.tan((BAND_AXIS_TILT_DEG * Math.PI) / 180) * Math.cos(AXIS_TILT_X),
)

/**
 * Per-tile radius wobble, as a fraction of the radius.
 *
 * Under the band layout almost nothing overlaps, so this is no longer load
 * bearing the way it was — but the courses at the very rim still graze each
 * other at the corner nearest the pole, and three thousandths of the radius is
 * enough to give those a definite stacking order instead of a z-fight. Far too
 * little to dent the silhouette.
 */
export const RELIEF = 0.003

/** Subdivision of each tile. 12×12 keeps the curvature smooth at this angular
 *  size; the whole sphere is still only ~47k triangles in one draw call. */
export const TILE_SEGMENTS = 12

/** Breaks ties in the tonal ordering below, so two photographs of the same
 *  average tone are not left in filename order (which clusters a shoot's frames
 *  together). 0 keeps the manifest order. */
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
    // Light frames toward the north pole, dark ones toward the south. The
    // courses are filled north to south from this order, so each one is a
    // narrow slice of tone and the globe shades along its own tilted axis.
    const order = tonalOrder(
      photos.map((p) => hexLuminance(p.color)),
      shuffledIndices(photos.length, PLACEMENT_SEED),
    )
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
