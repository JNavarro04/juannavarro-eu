import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import type { Photo } from '../../types'
import {
  distanceForViewportFraction,
  halfDiagonalFov,
  hexLuminance,
  layoutTiles,
  morphEase,
  morphLocal,
  morphRadial,
  planRing,
  shuffledIndices,
  tonalOrder,
  type RingLayout,
  type TileLayout,
} from '../../lib/sphereMath'
import { sphereDrive, type SphereDrive } from './sphereDrive'
import {
  INTRO_ALPHA,
  INTRO_JITTER,
  INTRO_LIFT,
  INTRO_RIPPLE,
  advanceIntro,
  introRemaining,
  introSpinScale,
  introYields,
  skipIntro,
} from './introClock'
import { sphereFragmentShader, sphereVertexShader } from './shaders'
import NearTiles, {
  NEAR_TILES_DESKTOP,
  NEAR_TILES_MOBILE,
  flattenFor,
  type MorphSettings,
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

/* ── The ring ───────────────────────────────────────────────────────────────
   What the globe opens out into as the camera comes in: a cylinder of
   photographs about a vertical axis, four rows tall, that turns for ever. The
   layout of it — how the thirteen courses become four rows, and how each row is
   solved to close on itself — is in src/lib/sphereMath.ts under
   RING_LAYOUT_DEFAULTS. What is here is how the change is *performed*.        */

/**
 * Ring radius, as a multiple of the sphere's.
 *
 * The single number that decides how large a photograph is on the ring, because
 * a row has to fit its ~40 frames into 2π·radius. At 1 the ring's axis passes
 * exactly through the globe's centre and its near face through the globe's near
 * point, so the photograph at the middle of the frame does not move at all
 * during the morph — the surface opens out around whatever the visitor is
 * already looking at.
 *
 * At 1 the ring is 4 rows of ~40, each frame 0.099 world tall with a 0.0133
 * joint. Measured at the camera's current stop (SPHERE_FOV 35, STOP_COVER 1):
 *
 *   1920×1080   8.0 photographs across the frame, 285 CSS px each
 *   1440×900    7.9 across, 211 px
 *   1024×1024   6.8 across, 157 px
 *   390×844     4.0 across,  92 px   ← a phone, and too small: the fix is the
 *                                      camera's stop, not this. See the report.
 *
 * Raising it makes the frames larger and fewer, since the circumference has to
 * carry the same 40 either way.
 */
export const RING_RADIUS_SCALE = 1

/**
 * The head start the equator gets over the poles, in `flatten` units.
 *
 * Without it all 162 photographs leave the shell on the same schedule, and a
 * uniform transition of 162 objects reads as a diagram rather than as a
 * movement. With it a wave runs from the globe's waist out to both poles: the
 * equator gathers into the rows first and the caps fold in after it.
 *
 * The direction was measured, not chosen — the ring is a belt at the globe's
 * own waist, so sending the poles in first lands them in a band that is still
 * occupied. Peak share of drawn photograph area covered twice, over the whole
 * morph, on the real 162: 3.7% this way, 12.1% with no wave at all, 39.3% the
 * other way round. See `morphLocal` in shaders.ts.
 *
 * The amplitude was measured too — 0.15 gives 8.9%, 0.25 gives 5.3%, 0.35
 * gives 3.7%, and past 0.4 it climbs again as the poles start arriving after
 * the rows below them have already settled. A third of the morph is also about
 * as long as a wave can be and still leave every photograph landed by the time
 * `flatten` reaches 1: the last course starts at 0.345 and lands at 0.995.
 */
export const MORPH_RIPPLE = 0.35

/** Outward excursion at the middle of a tile's crossing, world units, before
 *  the per-tile scatter. Sub-tile on purpose: the globe should look like it
 *  loosens, not like it explodes. */
export const MORPH_BLOOM = 0.055

/**
 * The landing, world units. Larger than {@link MORPH_BLOOM}, which is what
 * turns the excursion asymmetric: outward early, a shade *inside* the ring's
 * radius late, then out to rest. A tile settles onto its slot instead of
 * stopping on it. It is a radial motion only and so cannot disturb the joints —
 * see `morphRadial` in shaders.ts.
 */
export const MORPH_SETTLE = 0.1

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
  /** Where each tile goes once the globe has opened out. */
  ring: RingLayout
}

/** Placements already solved, keyed by the array they were solved from. The
 *  band solver is not cheap and both the sphere and {@link ringFraming} want
 *  the same answer for the same photographs. */
const placements = new WeakMap<readonly Photo[], Placement>()

function placePhotos(photos: readonly Photo[]): Placement {
  const cached = placements.get(photos)
  if (cached) return cached
  const placement = solvePlacement(photos)
  placements.set(photos, placement)
  return placement
}

/**
 * The finished ring's dimensions, in world units against {@link SPHERE_RADIUS}.
 *
 * What a scroll choreography needs in order to frame the end of the zoom on the
 * *ring* rather than on the globe: the camera should stop where the ring's
 * `height` fills the fraction of the viewport you want it to. Exported rather
 * than written down as a number because it moves with the photo count, the row
 * count and the ring radius, and a stale copy of it would frame the end state
 * wrongly on the day any of those change.
 */
export function ringFraming(photos: readonly Photo[]): RingLayout {
  return placePhotos(photos).ring
}

function solvePlacement(photos: readonly Photo[]): Placement {
  // Light frames toward the north pole, dark ones toward the south. The
  // courses are filled north to south from this order, so each one is a
  // narrow slice of tone and the globe shades along its own tilted axis.
  const source = tonalOrder(
    photos.map((p) => hexLuminance(p.color)),
    shuffledIndices(photos.length, PLACEMENT_SEED),
  )
  const placed = source.map((i) => photos[i])
  const aspects = placed.map((p) => p.aspect)
  const layout = layoutTiles(aspects)
  // The ring's rows are contiguous runs of courses, and the courses are already
  // in tonal order, so the ring shades top to bottom exactly as the globe shades
  // pole to pole. The same photographs, in the same order, on a different shape.
  const ring = planRing(layout, aspects, { radius: SPHERE_RADIUS * RING_RADIUS_SCALE })
  return { placed, source, layout, ring }
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
  const flattenRef = useRef(0)

  const placement = useMemo(() => placePhotos(photos), [photos])

  const geometry = useMemo(() => {
    const { placed, layout, ring } = placement
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
    // Static: the destination is solved once, at layout time. Nothing about the
    // morph is computed per frame on the CPU — one uniform moves all 162.
    base.setAttribute('iSlot', new THREE.InstancedBufferAttribute(ring.slots, 4))
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
          uFlatten: { value: 0 },
          uRing: { value: SPHERE_RADIUS * RING_RADIUS_SCALE },
          uRipple: { value: MORPH_RIPPLE },
          uBloom: { value: MORPH_BLOOM },
          uSettle: { value: MORPH_SETTLE },
          // The landing composition. uIntro is written every frame; the four
          // below never change — see introClock.ts, which owns the gesture.
          uIntro: { value: introRemaining() },
          uIntroLift: { value: INTRO_LIFT },
          uIntroAlpha: { value: INTRO_ALPHA },
          uIntroRipple: { value: INTRO_RIPPLE },
          uIntroJitter: { value: INTRO_JITTER },
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
    // Unprompted motion, so prefers-reduced-motion removes it rather than
    // shortening it: the assembled globe is simply there. A layout effect
    // because it has to land before r3f's first frame, not after it.
    if (reducedMotion) skipIntro()
  }, [reducedMotion])

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

  /**
   * Everything the morph needs that depends on the viewport, in one object so
   * that this component and {@link NearTiles} derive the *same* number from the
   * *same* inputs on the same frame. They compute it separately rather than
   * passing it down: r3f runs a child's frame callback before its parent's, so
   * a value handed down would arrive a frame late, and a near tile a frame
   * behind its instanced twin is a visible shear during the morph.
   */
  const morph = useMemo<MorphSettings>(
    () => ({
      ring: placement.ring,
      sinRestingLimb: SPHERE_RADIUS / baseDistance,
      halfDiagonalFov: halfDiagonalFov(SPHERE_FOV, size.width, size.height),
      ripple: reducedMotion ? 0 : MORPH_RIPPLE,
      bloom: reducedMotion ? 0 : MORPH_BLOOM,
      settle: reducedMotion ? 0 : MORPH_SETTLE,
    }),
    [placement.ring, baseDistance, size.width, size.height, reducedMotion],
  )

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
      morph,
      // Written every frame below; read by the hit test, which has to work in
      // whichever shape the shader last drew.
      flatten: flattenRef,
    }
    liveSphere = handle
    return () => {
      if (liveSphere === handle) liveSphere = null
    }
  }, [placement, camera, gl, morph])

  useFrame((state, delta) => {
    const d = drive ?? sphereDrive
    const flatten = flattenFor(d, morph)

    // The landing composition — see introClock.ts. It is on its own clock, it
    // plays once per page load, and it never writes to the drive: the only
    // thing it reads from the drive is whether the visitor has taken over, in
    // which case it runs out its remainder in a quarter of a second and gets
    // out of the way. NearTiles calls this too, with the same frame stamp, and
    // the second caller in a frame gets the first one's answer.
    const intro = advanceIntro(
      state.clock.elapsedTime,
      delta,
      introYields(d.distanceScale ?? 1, d.spin ?? 0, d.tilt ?? 0, flatten),
    )

    // Frame-rate independent, and clamped so a backgrounded tab does not come
    // back to a sphere that has spun half a turn during a single long frame.
    // The composition's contribution is a multiplier on the ambient rate and
    // decays to exactly 1, so what it leaves behind is the shipped drift.
    if (!reducedMotion) {
      ambientSpin.current +=
        Math.min(delta, 0.1) * SPIN_SPEED * (d.spinScale ?? 1) * introSpinScale(intro)
    }
    if (spinRef.current) spinRef.current.rotation.y = ambientSpin.current + (d.spin ?? 0)
    if (axisRef.current) axisRef.current.rotation.x = AXIS_TILT_X + (d.tilt ?? 0)

    camera.position.set(
      d.offsetX ?? 0,
      d.offsetY ?? 0,
      baseDistance * (d.distanceScale ?? 1),
    )

    flattenRef.current = flatten
    material.uniforms.uFlatten.value = flatten
    material.uniforms.uRipple.value = morph.ripple
    material.uniforms.uBloom.value = morph.bloom
    material.uniforms.uSettle.value = morph.settle
    material.uniforms.uIntro.value = intro

    const opacity = d.opacity ?? 1
    material.uniforms.uOpacity.value = opacity
    // Untouched by the composition, deliberately. Its per-tile fade leaves the
    // fragment premultiplied, and this canvas is composited premultiplied, so
    // the page shows through a half-faded tile correctly with GL blending off —
    // which is what leaves this material's shader program, render list and
    // depth behaviour exactly as they were. See the fragment shader.
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
          morph={morph}
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
 * There are now two of those, because the shell opens out into a ring, so there
 * are two tests. {@link pickPhotoAt} chooses between them on the morph amount
 * the last frame was actually drawn at:
 *
 *   flatten < ½   the shell test below — exact, unchanged, and the only one
 *                 that runs at the resting globe.
 *   flatten ≥ ½   `pickOnRing` — the tile's four corners are interpolated with
 *                 the identical arithmetic the vertex shader uses, so the test
 *                 is exact at the finished ring and approximate only while the
 *                 surface is still moving. See the note there.
 *
 * THE SHELL TEST is four steps, and no rasterisation:
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
  morph: MorphSettings
  /** The morph amount the last frame was drawn at. */
  flatten: RefObject<number>
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
 * Where the hit test hands over from the shell to the ring.
 *
 * Half way, because that is where the tile is half way: below it the surface is
 * still recognisably a sphere and the exact shell test is the better model,
 * above it the ring test is — and it becomes exact as the morph finishes. The
 * hand-over is where both are at their least accurate, which is also the one
 * moment nobody is clicking: it is the middle of a scroll.
 */
const PICK_RING_FROM = 0.5

/**
 * The photograph under a pointer position, in client (viewport) coordinates —
 * i.e. straight from a PointerEvent's `clientX`/`clientY`.
 *
 * Returns null when the sphere is not mounted, when the pointer is outside the
 * canvas, when the ray misses the surface entirely, when it lands on a joint
 * between two photographs, and while the landing composition is still playing.
 * Works at any zoom, in either shape and anywhere between them, and while the
 * surface is turning: the orientation and the morph amount are both read at the
 * moment of the call.
 *
 * Cheap enough to call on `pointermove` — one ray and 162 tiles, with no
 * rasterisation and nothing allocated.
 */
export function pickPhotoAt(clientX: number, clientY: number): PhotoPick | null {
  // The landing composition displaces every tile along its own normal, and
  // neither test below models that — they would both answer from the layout
  // while the shader is drawing something else, and near the limb that is a
  // different photograph. It lasts a second and a half at the very start of a
  // page load, it ends the moment the visitor touches anything, and no
  // considered press on a photograph happens inside it. Declining to answer is
  // the honest option; guessing is not.
  if (introRemaining() > 0) return null

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

  const flatten = live.flatten.current
  return flatten < PICK_RING_FROM
    ? pickOnShell(live)
    : pickOnRing(live, spin, flatten)
}

/** The photograph under {@link pickRaycaster}'s ray, on the spherical shell. */
function pickOnShell(live: SphereHandle): PhotoPick | null {
  const spin = live.spin.current
  if (!spin) return null

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

/* ── The ring test ──────────────────────────────────────────────────────────
   Once the globe has opened out there is no shell to intersect, so the analytic
   surface is gone and the test has to be built from the tiles themselves.

   Each tile is rebuilt in view space from its centre and its two half-axes,
   using the *same* three functions the vertex shader uses to decide where it is
   — morphLocal, morphEase, morphRadial, mirrored in sphereMath.ts — and the ray
   is solved against that parallelogram directly. A 3×3 Cramer per tile, no
   allocation, and the α,β that fall out of it are the tile's own u,v.

   Exact at the finished ring, where a tile *is* a parallelogram to within the
   0.3% its bend around the cylinder costs. Approximate while the surface is
   still moving, because a tile mid-morph is a curved patch and this flattens
   it: the error is the patch's sagitta, well under a tile, so a click near the
   middle of a photograph is always right and one within a hair of a joint can
   go to the neighbour. Nothing is ever silently attributed to a photograph
   somewhere else on the surface, which was the failure to avoid.               */

const pickModelView = new THREE.Matrix4()
const pickViewOrigin = new THREE.Vector3()
const pickViewDir = new THREE.Vector3()
const pickShellCenter = new THREE.Vector3()
const pickShellU = new THREE.Vector3()
const pickShellV = new THREE.Vector3()
const pickRingCenter = new THREE.Vector3()
const pickRingU = new THREE.Vector3()
const pickRingV = new THREE.Vector3()
const pickQuadCenter = new THREE.Vector3()
const pickQuadU = new THREE.Vector3()
const pickQuadV = new THREE.Vector3()
const pickToTile = new THREE.Vector3()
const pickCross = new THREE.Vector3()

/** The point on the shell at `quad`, in the sphere's own frame. Mirrors
 *  `tilePlacement` in shaders.ts, including the pole guard. */
function shellPointAt(
  out: THREE.Vector3,
  center: THREE.Vector3,
  halfU: number,
  halfV: number,
  roll: number,
  radius: number,
  quadX: number,
  quadY: number,
): THREE.Vector3 {
  const polar = Math.abs(center.y) > 0.99
  pickRefAxis.set(polar ? 1 : 0, polar ? 0 : 1, 0)
  pickTangent.copy(pickRefAxis).cross(center).normalize()
  pickBitangent.copy(center).cross(pickTangent)
  const ca = Math.cos(roll)
  const sa = Math.sin(roll)
  pickE1.copy(pickTangent).multiplyScalar(ca).addScaledVector(pickBitangent, sa)
  pickE2.copy(pickTangent).multiplyScalar(-sa).addScaledVector(pickBitangent, ca)
  return out
    .copy(center)
    .addScaledVector(pickE1, Math.tan(quadX * 2 * halfU))
    .addScaledVector(pickE2, Math.tan(quadY * 2 * halfV))
    .normalize()
    .multiplyScalar(radius)
}

/** The photograph under {@link pickRaycaster}'s ray, once the globe has begun
 *  to open out. See the block above. */
function pickOnRing(
  live: SphereHandle,
  spin: THREE.Group,
  flatten: number,
): PhotoPick | null {
  const { placed, source, layout } = live.placement
  const { centers, sizes, rotations, seeds, count } = layout
  const { ring, ripple, bloom, settle } = live.morph
  const slots = ring.slots

  // The shader's own frame, to the letter: the model-view matrix, the sphere's
  // centre out of its translation column, and the camera-facing meridian out of
  // the third row of its rotation.
  pickModelView.multiplyMatrices(live.camera.matrixWorldInverse, spin.matrixWorld)
  const mv = pickModelView.elements
  const originX = mv[12]
  const originY = mv[13]
  const originZ = mv[14]
  const frontLon = Math.atan2(mv[10], mv[2])
  const axisZ = originZ + live.radius - ring.radius

  // The ray, in view space. For a perspective camera the origin is the eye, but
  // it is transformed rather than assumed so an offset or orthographic camera
  // would still be handled correctly.
  pickViewOrigin.copy(pickRaycaster.ray.origin).applyMatrix4(live.camera.matrixWorldInverse)
  pickViewDir
    .copy(pickRaycaster.ray.origin)
    .add(pickRaycaster.ray.direction)
    .applyMatrix4(live.camera.matrixWorldInverse)
    .sub(pickViewOrigin)
    .normalize()

  let bestTile = -1
  let bestDepth = Number.POSITIVE_INFINITY
  let bestU = 0
  let bestV = 0

  for (let i = 0; i < count; i++) {
    const seed = seeds[i]
    const local = morphLocal(flatten, ripple, centers[i * 3 + 1])
    const ease = morphEase(local)
    const radial = morphRadial(local, seed, bloom, settle)

    // Where the shell would have put it.
    pickCenter.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]).normalize()
    const halfU = sizes[i * 2]
    const halfV = sizes[i * 2 + 1]
    const roll = rotations[i]
    const shellRadius = live.radius * (1 + live.relief * (seed * 2 - 1)) + radial
    shellPointAt(pickShellCenter, pickCenter, halfU, halfV, roll, shellRadius, 0, 0)
    shellPointAt(pickShellU, pickCenter, halfU, halfV, roll, shellRadius, 0.5, 0)
    shellPointAt(pickShellV, pickCenter, halfU, halfV, roll, shellRadius, 0, 0.5)
    pickShellCenter.applyMatrix4(pickModelView)
    pickShellU.applyMatrix4(pickModelView).sub(pickShellCenter)
    pickShellV.applyMatrix4(pickModelView).sub(pickShellCenter)

    // …and where the ring puts it.
    const angle = slots[i * 4] + frontLon
    const slotY = slots[i * 4 + 1]
    const slotHalfAngle = slots[i * 4 + 2]
    const slotHalfHeight = slots[i * 4 + 3]
    const ringRadius = ring.radius * (1 + live.relief * (seed * 2 - 1)) + radial
    pickRingCenter.set(
      originX + ringRadius * Math.sin(angle),
      originY + slotY,
      axisZ + ringRadius * Math.cos(angle),
    )
    pickRingU.set(
      ringRadius * Math.sin(angle + slotHalfAngle) - ringRadius * Math.sin(angle),
      0,
      ringRadius * Math.cos(angle + slotHalfAngle) - ringRadius * Math.cos(angle),
    )
    pickRingV.set(0, slotHalfHeight, 0)

    pickQuadCenter.lerpVectors(pickShellCenter, pickRingCenter, ease)
    pickQuadU.lerpVectors(pickShellU, pickRingU, ease)
    pickQuadV.lerpVectors(pickShellV, pickRingV, ease)

    // Solve  α·U + β·V + γ·D = origin − centre  by Cramer, and read the hit off
    // it: α and β are the tile's own coordinates, in [−1, 1], and −γ is the
    // distance along the ray.
    pickToTile.subVectors(pickViewOrigin, pickQuadCenter)
    pickCross.crossVectors(pickQuadV, pickViewDir)
    const det = pickQuadU.dot(pickCross)
    if (Math.abs(det) < 1e-12) continue
    const alpha = pickToTile.dot(pickCross) / det
    if (alpha < -1 || alpha > 1) continue
    pickCross.crossVectors(pickToTile, pickViewDir)
    const beta = pickQuadU.dot(pickCross) / det
    if (beta < -1 || beta > 1) continue
    pickCross.crossVectors(pickQuadV, pickToTile)
    const depth = -(pickQuadU.dot(pickCross) / det)
    if (depth <= 0 || depth >= bestDepth) continue

    bestDepth = depth
    bestTile = i
    bestU = alpha / 2 + 0.5
    bestV = 0.5 - beta / 2
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
