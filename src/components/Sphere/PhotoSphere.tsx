import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import type { Photo } from '../../types'
import {
  distanceForViewportFraction,
  hexLuminance,
  layoutTiles,
  shuffledIndices,
  tonalOrder,
  type TileLayout,
} from '../../lib/sphereMath'
import { sphereDrive, type SphereDrive } from './sphereDrive'
import { sphereFragmentShader, sphereVertexShader } from './shaders'
import NearTiles, {
  NEAR_TILES_DESKTOP,
  NEAR_TILES_MOBILE,
  type TilePose,
} from './NearTiles'
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

/** Ambient spin, radians per second. One turn takes about two and a half
 *  minutes: fast enough that the globe is plainly alive on a first glance,
 *  slow enough that a photograph can be looked at while it drifts. */
export const SPIN_SPEED = 0.042

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
  /** How many photographs may be drawn from their own file at full zoom.
   *  Defaults to {@link NEAR_TILES_DESKTOP} / {@link NEAR_TILES_MOBILE}. */
  nearTiles?: number
  /** Per-frame override of where a near tile is drawn. See {@link TilePose}. */
  nearTilePose?: (tile: number, pose: TilePose) => void
}

/* ── Placement ──────────────────────────────────────────────────────────────
   Instance i draws `placed[i]`, which is NOT `photos[i]`: the photographs are
   sorted by tone before they are laid out. `source[i]` is the index back into
   the caller's array, and it is the only thing that makes the picking API below
   return the photograph a visitor actually clicked on.                        */

type Placement = {
  /** The photographs in placement order. `placed[i]` is drawn by instance i. */
  placed: readonly Photo[]
  /** `source[i]` is the index of `placed[i]` in the `photos` prop. */
  source: readonly number[]
  layout: TileLayout
}

function placePhotos(photos: readonly Photo[]): Placement {
  // Light frames toward the north pole, dark ones toward the south. The
  // courses are filled north to south from this order, so each one is a
  // narrow slice of tone and the globe shades along its own tilted axis.
  const source = tonalOrder(
    photos.map((p) => hexLuminance(p.color)),
    shuffledIndices(photos.length, PLACEMENT_SEED),
  )
  const placed = source.map((i) => photos[i])
  return { placed, source, layout: layoutTiles(placed.map((p) => p.aspect)) }
}

export default function PhotoSphere({
  texture,
  photos,
  atlasKind,
  atlasSize,
  drive,
  reducedMotion = false,
  nearTiles,
  nearTilePose,
}: PhotoSphereProps) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const axisRef = useRef<THREE.Group>(null)
  const spinRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const ambientSpin = useRef(0)

  const placement = useMemo(() => placePhotos(photos), [photos])

  const geometry = useMemo(() => {
    const { placed, layout } = placement
    const base = new THREE.PlaneGeometry(1, 1, TILE_SEGMENTS, TILE_SEGMENTS)

    const uv = new Float32Array(layout.count * 4)
    const inset = UV_INSET_PX / atlasSize
    for (let i = 0; i < layout.count; i++) {
      const rect = placed[i].atlas[atlasKind]
      uv[i * 4] = rect.u + inset
      uv[i * 4 + 1] = rect.v + inset
      uv[i * 4 + 2] = rect.w - inset * 2
      uv[i * 4 + 3] = rect.h - inset * 2
    }

    // 1 while a NearTiles mesh is drawing this photograph from its own file.
    // Written every frame from that component; zero the rest of the time, which
    // is what keeps the resting globe at a single draw call.
    const hidden = new THREE.InstancedBufferAttribute(new Float32Array(layout.count), 1)
    hidden.setUsage(THREE.DynamicDrawUsage)

    base.setAttribute('iCenter', new THREE.InstancedBufferAttribute(layout.centers, 3))
    base.setAttribute('iSize', new THREE.InstancedBufferAttribute(layout.sizes, 2))
    base.setAttribute('iRot', new THREE.InstancedBufferAttribute(layout.rotations, 1))
    base.setAttribute('iSeed', new THREE.InstancedBufferAttribute(layout.seeds, 1))
    base.setAttribute('iUV', new THREE.InstancedBufferAttribute(uv, 4))
    base.setAttribute('iHidden', hidden)
    return base
  }, [placement, atlasKind, atlasSize])

  const hidden = geometry.getAttribute('iHidden') as THREE.InstancedBufferAttribute

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

  // Publish the live sphere for the pointer hit test. Registered from an effect
  // so the group refs are already populated, and matched by identity on the way
  // out so StrictMode's double mount cannot leave a dead handle behind.
  useEffect(() => {
    const handle: SphereHandle = {
      placement,
      radius: SPHERE_RADIUS,
      relief: RELIEF,
      spin: spinRef,
      camera,
      canvas: gl.domElement,
    }
    liveSphere = handle
    return () => {
      if (liveSphere === handle) liveSphere = null
    }
  }, [placement, camera, gl])

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
        <NearTiles
          photos={placement.placed}
          layout={placement.layout}
          hidden={hidden}
          radius={SPHERE_RADIUS}
          relief={RELIEF}
          segments={TILE_SEGMENTS}
          maxTiles={
            nearTiles ??
            (atlasKind === 'mobile' ? NEAR_TILES_MOBILE : NEAR_TILES_DESKTOP)
          }
          drive={drive}
          poseFor={nearTilePose}
        />
      </group>
    </group>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  PICKING — which photograph is under the pointer
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The vertex shader puts every tile where it is. Nothing in the scene graph
 * knows: the instance matrices are identity, the geometry is a flat unit quad,
 * and `frustumCulled` is off because even the bounds would be a lie. So
 * three.js's own raycast against this mesh returns nonsense, and the hit test
 * has to be done in the same coordinates the shader works in.
 *
 * Which is four steps, and no rasterisation:
 *
 *   1. Unproject the pointer to a world-space ray.
 *   2. Rotate the whole ray into the sphere's own frame, undoing the live tilt
 *      and spin. Both are read from the scene graph at the moment of the call,
 *      so this is correct while the sphere is turning.
 *   3. Intersect it with the shell and take the *near* root, so the answer is
 *      always a photograph on the side of the globe facing the viewer. The
 *      shell is not one sphere: {@link RELIEF} gives every tile its own radius,
 *      so a coarse pass against {@link SPHERE_RADIUS} narrows the field and each
 *      surviving tile is then intersected at the radius it is actually drawn at.
 *      Skipping that second pass costs a couple of milliradians of error — a few
 *      pixels at full zoom, and enough to misread a click near a tile's edge.
 *   4. Invert the gnomonic patch the shader draws: for each tile, express the
 *      hit direction in that tile's tangent frame and ask whether it falls
 *      inside the tile's own angular extent. That is the exact inverse of the
 *      mapping in shaders.ts, so the region that answers "yes" is precisely the
 *      quad that was drawn — joints between photographs included, which is why
 *      a click on the grout correctly returns null.
 *
 * Usage — framework-agnostic, no React, no r3f:
 *
 *   import { pickPhotoAt } from './components/Sphere'
 *
 *   element.addEventListener('click', (event) => {
 *     const hit = pickPhotoAt(event.clientX, event.clientY)
 *     if (hit) openLightbox(hit.index)      // index into PHOTOS
 *   })
 */

type SphereHandle = {
  placement: Placement
  radius: number
  relief: number
  spin: RefObject<THREE.Group | null>
  camera: THREE.Camera
  canvas: HTMLCanvasElement
}

/** The mounted sphere, or null. One at a time; the last to mount wins. */
let liveSphere: SphereHandle | null = null

export type PhotoPick = {
  /** The photograph under the pointer. */
  photo: Photo
  /**
   * Its index in the array the sphere was given — i.e. in `PHOTOS`, the
   * manifest order. This is the one to hand a lightbox.
   */
  index: number
  /**
   * Its instance index on the shell, in placement (tonal) order. Only useful
   * for talking to the sphere itself; it is *not* an index into `PHOTOS`.
   */
  tile: number
  /** Where in the photograph the pointer landed: 0,0 top-left, 1,1 bottom-right. */
  u: number
  v: number
}

const pickRaycaster = new THREE.Raycaster()
const pickPointer = new THREE.Vector2()
const pickInverse = new THREE.Matrix4()
const pickOrigin = new THREE.Vector3()
const pickDirection = new THREE.Vector3()
const pickCoarse = new THREE.Vector3()
const pickLocal = new THREE.Vector3()
const pickCenter = new THREE.Vector3()
const pickRefAxis = new THREE.Vector3()
const pickTangent = new THREE.Vector3()
const pickBitangent = new THREE.Vector3()
const pickE1 = new THREE.Vector3()
const pickE2 = new THREE.Vector3()

/**
 * Slack on the coarse rejection, radians.
 *
 * The first pass finds the hit on a shell of mean radius; the exact one is on
 * each tile's own, up to {@link RELIEF} away. That moves the hit direction by
 * almost nothing head-on and by up to √(2·relief) ≈ 0.08 rad where the ray
 * grazes the limb, so the coarse cap has to be widened by about that much or a
 * tile at the rim could be rejected before it was ever tested properly.
 */
const PICK_COARSE_SLACK = 0.09

/**
 * The photograph under a pointer position, in client (viewport) coordinates —
 * i.e. straight from a PointerEvent's `clientX`/`clientY`.
 *
 * Returns null when the sphere is not mounted, when the pointer is outside the
 * canvas, when the ray misses the shell entirely, and when it lands on a joint
 * between two photographs. Works at any zoom and while the sphere is spinning:
 * the orientation is read from the scene graph on every call.
 *
 * Cheap enough to call on `pointermove` — one ray, 162 dot products, and the
 * full test on the handful of tiles that survive it. Nothing is allocated.
 */
export function pickPhotoAt(clientX: number, clientY: number): PhotoPick | null {
  const live = liveSphere
  if (!live) return null
  const spin = live.spin.current
  if (!spin) return null

  const rect = live.canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const nx = (clientX - rect.left) / rect.width
  const ny = (clientY - rect.top) / rect.height
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null

  // The camera moves in useFrame, so its world matrix can be a frame behind the
  // value that was actually rendered. Bring both it and the sphere up to date.
  live.camera.updateMatrixWorld()
  spin.updateWorldMatrix(true, false)

  pickPointer.set(nx * 2 - 1, 1 - ny * 2)
  pickRaycaster.setFromCamera(pickPointer, live.camera)

  // Take the ray into the sphere's frame once, rather than taking every hit
  // point back out of it. The groups only ever rotate, so the direction stays
  // a unit vector and the intersection maths below is unchanged.
  pickInverse.copy(spin.matrixWorld).invert()
  pickOrigin.copy(pickRaycaster.ray.origin).applyMatrix4(pickInverse)
  pickDirection
    .copy(pickRaycaster.ray.origin)
    .add(pickRaycaster.ray.direction)
    .applyMatrix4(pickInverse)
    .sub(pickOrigin)
    .normalize()

  // |origin + t·direction|² = r², with direction normalised.
  const half = pickOrigin.dot(pickDirection)
  const square = pickOrigin.dot(pickOrigin)
  const meanRadius = live.radius
  const coarseDisc = half * half - (square - meanRadius * meanRadius)
  if (coarseDisc <= 0) return null
  const coarseT = -half - Math.sqrt(coarseDisc)
  if (coarseT <= 0) return null
  pickCoarse.copy(pickDirection).multiplyScalar(coarseT).add(pickOrigin).normalize()

  const { placed, source, layout } = live.placement
  const { centers, sizes, rotations, seeds, count } = layout

  let bestTile = -1
  // Depth, not facing: where two tiles genuinely overlap, the one the ray
  // reaches first is the one that was drawn on top.
  let bestDepth = Number.POSITIVE_INFINITY
  let bestU = 0
  let bestV = 0

  for (let i = 0; i < count; i++) {
    pickCenter
      .set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2])
      .normalize()
    const coarseAlong = pickCoarse.dot(pickCenter)
    if (coarseAlong <= 0) continue

    const halfU = sizes[i * 2]
    const halfV = sizes[i * 2 + 1]
    // Cheap reject against the cap that circumscribes the tile. hypot of the
    // two half-extents over-estimates the corner's angle from the centre for
    // every extent this layout produces; the slack covers the relief.
    const cap = Math.min(1.5, Math.hypot(halfU, halfV) + PICK_COARSE_SLACK)
    if (coarseAlong < Math.cos(cap)) continue

    // This tile's own radius — the shader's `tileRadius`, to the decimal.
    const radius = meanRadius * (1 + live.relief * (seeds[i] * 2 - 1))
    const disc = half * half - (square - radius * radius)
    if (disc <= 0) continue
    const t = -half - Math.sqrt(disc)
    if (t <= 0 || t >= bestDepth) continue
    pickLocal.copy(pickDirection).multiplyScalar(t).add(pickOrigin).normalize()

    const along = pickLocal.dot(pickCenter)
    if (along <= 0) continue

    // The shader's tangent frame, to the letter — including the pole guard.
    const polar = Math.abs(pickCenter.y) > 0.99
    pickRefAxis.set(polar ? 1 : 0, polar ? 0 : 1, 0)
    pickTangent.copy(pickRefAxis).cross(pickCenter).normalize()
    pickBitangent.copy(pickCenter).cross(pickTangent)

    const roll = rotations[i]
    const ca = Math.cos(roll)
    const sa = Math.sin(roll)
    pickE1.copy(pickTangent).multiplyScalar(ca).addScaledVector(pickBitangent, sa)
    pickE2.copy(pickTangent).multiplyScalar(-sa).addScaledVector(pickBitangent, ca)

    // Inverse of the gnomonic patch: the shader draws
    // normalize(c + e1·tan θ + e2·tan φ), so θ and φ come straight back out as
    // the arctangents of the hit's components in that frame.
    const theta = Math.atan2(pickLocal.dot(pickE1), along)
    const phi = Math.atan2(pickLocal.dot(pickE2), along)
    if (Math.abs(theta) > halfU || Math.abs(phi) > halfV) continue

    bestDepth = t
    bestTile = i
    bestU = theta / (2 * halfU) + 0.5
    bestV = 0.5 - phi / (2 * halfV)
  }

  if (bestTile < 0) return null
  return {
    photo: placed[bestTile],
    index: source[bestTile],
    tile: bestTile,
    u: bestU,
    v: bestV,
  }
}
