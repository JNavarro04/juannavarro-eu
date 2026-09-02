/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  LEVEL OF DETAIL — the photographs nearest the camera, at their own resolution
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The globe is one draw call from a packed atlas, and that is the right trade
 * at the resting framing: 320px of source under a tile covering ~225 device px
 * (1440×900, DPR 2 — measured). It stops being the right trade as the camera
 * comes in. At the stop the same tile covers ~880 device px and the widest one
 * ~1467, so the sheet is being magnified 2.7× to 4.6× and the photographs go
 * soft and blocky exactly when the visitor has asked to look at them closely.
 *
 * Every photograph already has a 1200px `mid` derivative on disk. This draws the
 * handful nearest the camera from those files instead — one small mesh each,
 * curved by the *same* vertex function as the instanced tile it replaces, at the
 * same radius, with the same per-tile relief. Nothing moves when a photograph is
 * handed over; only the number of pixels it was stored at changes.
 *
 *   WHEN.   Only below {@link NEAR_ACTIVATE_SCALE} of the resting camera
 *           distance, with hysteresis on the way back out. At rest this
 *           component draws nothing, loads nothing, and the globe is still
 *           exactly one draw call.
 *
 *   WHICH.  The {@link NearTilesProps.maxTiles} tiles whose centres point most
 *           directly at the camera, which is where a tile is both largest on
 *           screen and least foreshortened. Tiles more than ~60° off the view
 *           axis are never chosen: they are small, edge-on, and the atlas is
 *           more than enough for them.
 *
 *   HOW.    A crossfade. The near tile blends in over its instanced twin, and
 *           only once it is fully opaque is the twin switched off — through an
 *           `iHidden` attribute the instanced vertex shader reads, which
 *           collapses that quad out of the clip volume so it costs nothing and
 *           cannot z-fight. Going the other way the twin comes back *first* and
 *           the near tile fades off it, so there is never a hole.
 *
 * Memory is the whole cost, and it is bounded on two sides: at most
 * `maxTiles` textures are held at once, and src/lib/tileTextures.ts caps how
 * many released ones may linger. Nothing ever loads all 162.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import type { Photo } from '../../types'
import { unrollAmount, type RingLayout, type TileLayout } from '../../lib/sphereMath'
import {
  acquireTileTexture,
  releaseTileTexture,
  setTileTextureAnisotropy,
} from '../../lib/tileTextures'
import { nearTileFragmentShader, nearTileVertexShader } from './shaders'
import { sphereDrive, type SphereDrive } from './sphereDrive'

/* ── Tunables ─────────────────────────────────────────────────────────────── */

/**
 * How many photographs are drawn at full resolution at once, on a desktop.
 *
 * Measured at the stop, 1440×900 at DPR 2: 27 tiles are on screen and 24 of
 * them are bigger than the 320px the atlas holds. Fifteen of those 24 point at
 * the camera by more than 0.68; the other nine are at the rim, past
 * {@link NEAR_MIN_FACING}, foreshortened to slivers and deliberately left on the
 * atlas. Twenty covers the first group with margin.
 *
 * The ceiling this sets is memory, not draw calls: a 1200px derivative is about
 * 5MB on the GPU once mipmapped, so twenty is ~100MB and every one past that is
 * another five. Lower it before anything else if a machine is struggling.
 */
export const NEAR_TILES_DESKTOP = 20

/** The same count for a phone. The mobile atlas is 160px per tile so the need
 *  starts earlier, but the screen is narrow, far fewer tiles are on it at once,
 *  and the memory ceiling is much lower. Eight covers the visible strip. */
export const NEAR_TILES_MOBILE = 8

/**
 * `distanceScale` at or below which the near tiles come in.
 *
 * Measured at 1440×900 DPR 2: a mean tile at the centre of the disc covers
 * 278 device px at scale 0.85 and 329 at 0.75, against 320px of atlas. So the
 * atlas runs out at about 0.8, and that — not the arrival at the stop — is
 * where the upgrade belongs.
 */
export const NEAR_ACTIVATE_SCALE = 0.82

/** …and the scale it takes to switch them off again. The gap is hysteresis:
 *  a camera parked exactly on the threshold must not thrash the network. */
export const NEAR_RELEASE_SCALE = 0.9

/** cos of the widest angle off the view axis a near tile may sit at. 0.5 is
 *  60°: past that a tile is foreshortened to half its width and shrinking. */
export const NEAR_MIN_FACING = 0.5

/** Crossfade, seconds. Long enough not to read as a switch, short enough that
 *  the sharp version has arrived by the time the eye lands on it. */
export const NEAR_FADE_SECONDS = 0.22

/** Score bonus for a tile already in the near set, so two tiles of nearly equal
 *  angle do not swap places every frame and re-request each other's files. */
export const NEAR_SET_HYSTERESIS = 0.02

/** Meshes kept beyond `maxTiles`, to fade out departures while their
 *  replacements fade in. Below this, a fast orbit would cut tiles off mid-fade. */
export const NEAR_SPARE_SLOTS = 6

/* ── The morph seam ───────────────────────────────────────────────────────── */

/**
 * Everything about the sphere-to-ring morph that this component and its parent
 * both need. See {@link flattenFor} for why it is shared rather than derived.
 */
export type MorphSettings = {
  /** Where every photograph goes once the globe has opened out. */
  ring: RingLayout
  /** Sphere radius over the resting camera distance. */
  sinRestingLimb: number
  /** Half the viewport diagonal's field of view, radians. */
  halfDiagonalFov: number
  /** Head start given to the poles, in flatten units. 0 under reduced motion. */
  ripple: number
  /** Outward excursion mid-morph, world units. 0 under reduced motion. */
  bloom: number
  /** Overshoot-and-settle at the end, world units. 0 under reduced motion. */
  settle: number
}

/**
 * How far the globe has opened out, this frame.
 *
 * The drive's own value wins when it has one, so a scroll choreography can put
 * the morph exactly where it wants it; otherwise it is derived from the camera
 * distance. Both the instanced sphere and this component call it, on the same
 * drive object, within the same frame — which is how the two shader programs
 * are guaranteed to be looking at the same number rather than at two numbers
 * that happen to agree.
 */
export function flattenFor(
  drive: Partial<SphereDrive>,
  morph: MorphSettings,
): number {
  const explicit = drive.flatten
  if (explicit !== null && explicit !== undefined) {
    return explicit < 0 ? 0 : explicit > 1 ? 1 : explicit
  }
  return unrollAmount(
    drive.distanceScale ?? 1,
    morph.sinRestingLimb,
    morph.halfDiagonalFov,
  )
}

/* ── The pose seam ────────────────────────────────────────────────────────── */

/**
 * Where a near tile is drawn.
 *
 * Filled from the layout before every frame and handed to
 * {@link NearTilesProps.poseFor} if one was given, which may rewrite any of it.
 * The four numbers are the *only* thing that positions a tile — the mesh's own
 * transform is identity and the vertex shader does the placement — so a caller
 * that wants the zoomed-in state to present photographs some other way (flatter,
 * screen-aligned, un-rolled as the camera closes in) can do it from here without
 * touching this file or the shader.
 *
 * `seed` feeds the sub-percent radius wobble. Leave it alone unless you also
 * change the instanced twin's, or the tile will pop radially at the crossfade.
 */
export type TilePose = {
  /** Unit direction of the tile's centre, in the sphere's local frame. */
  center: THREE.Vector3
  /** Angular half-extents in radians, along the tile's own u then v axis. */
  size: THREE.Vector2
  /** Roll within the tangent plane, radians. */
  roll: number
  /** Per-tile random in [0,1), the relief input. */
  seed: number
  /** Where this tile goes on the ring: angle, height, angular half-width,
   *  world half-height. The other half of the placement — at flatten 1 it is
   *  the only half that is read. */
  slot: THREE.Vector4
}

export type NearTilesProps = {
  /**
   * The photographs **in placement order** — index i is the tile drawn by
   * instance i, which is not the manifest order. See PhotoSphere.
   */
  photos: readonly Photo[]
  /** The same layout the instanced mesh was built from. */
  layout: TileLayout
  /** The instanced mesh's `iHidden` attribute, written as tiles are taken over. */
  hidden: THREE.InstancedBufferAttribute
  /** Sphere radius, world units. Must match the instanced mesh. */
  radius: number
  /** Relief amplitude. Must match the instanced mesh. */
  relief: number
  /** Quad subdivision. Must match the instanced mesh or the curvature differs. */
  segments: number
  /** How many photographs may be drawn at full resolution at once. */
  maxTiles: number
  /** The sphere-to-ring morph. Must be the parent's, or the two shader
   *  programs will place the same photograph in two different places. */
  morph: MorphSettings
  /** Overrides the shared {@link sphereDrive} singleton. */
  drive?: Partial<SphereDrive>
  /** Optional per-frame override of where a near tile is drawn. See {@link TilePose}. */
  poseFor?: (tile: number, pose: TilePose) => void
}

type Slot = {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  /** Placement index this slot is drawing, or −1 when free. */
  tile: number
  /** The url whose reference this slot holds, or '' when it holds none. */
  url: string
  /** Callback still queued on the texture cache, so it can be withdrawn. */
  pending: ((texture: THREE.Texture) => void) | null
  /** 0 → 1 crossfade. */
  fade: number
  /** True once the texture has arrived; nothing is drawn before that. */
  ready: boolean
  /** True while this tile is on its way out. */
  leaving: boolean
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export default function NearTiles({
  photos,
  layout,
  hidden,
  radius,
  relief,
  segments,
  maxTiles,
  morph,
  drive,
  poseFor,
}: NearTilesProps) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)

  const groupRef = useRef<THREE.Group>(null)
  const slotsRef = useRef<Slot[]>([])
  const activeRef = useRef(false)

  // One geometry for every near tile. Deliberately *not* the instanced mesh's:
  // that one carries per-instance attributes, and a plain mesh has no business
  // dragging them along. Same subdivision, so the same curvature.
  const geometry = useMemo(
    () => new THREE.PlaneGeometry(1, 1, segments, segments),
    [segments],
  )

  const scratch = useMemo(
    () => ({
      inverse: new THREE.Matrix4(),
      localCamera: new THREE.Vector3(),
      pose: {
        center: new THREE.Vector3(),
        size: new THREE.Vector2(),
        roll: 0,
        seed: 0,
        slot: new THREE.Vector4(),
      } as TilePose,
      best: [] as number[],
      bestScore: [] as number[],
      held: new Set<number>(),
      desired: new Set<number>(),
    }),
    [],
  )

  useLayoutEffect(() => {
    setTileTextureAnisotropy(gl.capabilities.getMaxAnisotropy())
  }, [gl])

  useEffect(() => () => geometry.dispose(), [geometry])

  // Teardown. Every texture reference is dropped, every material disposed, and
  // every instance handed back to the globe — so navigating away and back finds
  // the sphere whole and the cache empty a few seconds later.
  useEffect(() => {
    const slots = slotsRef.current
    const hiddenArray = hidden.array as Float32Array
    return () => {
      for (const slot of slots) {
        if (slot.url) releaseTileTexture(slot.url, slot.pending ?? undefined)
        slot.material.dispose()
        slot.mesh.removeFromParent()
      }
      slots.length = 0
      activeRef.current = false
      hiddenArray.fill(0)
      hidden.needsUpdate = true
    }
  }, [hidden])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return

    const d = drive ?? sphereDrive
    const distanceScale = d.distanceScale ?? 1
    const globalOpacity = d.opacity ?? 1
    const slots = slotsRef.current
    const hiddenArray = hidden.array as Float32Array
    const { centers, sizes, rotations, seeds, count } = layout
    const flatten = flattenFor(d, morph)
    const ringSlots = morph.ring.slots

    // Hysteresis: come in below the activate scale, go out above the release one.
    activeRef.current = activeRef.current
      ? distanceScale <= NEAR_RELEASE_SCALE
      : distanceScale <= NEAR_ACTIVATE_SCALE
    const active = activeRef.current && globalOpacity > 0.01

    /* ── which tiles ──────────────────────────────────────────────────────── */

    const { best, bestScore, held, desired } = scratch
    best.length = 0
    bestScore.length = 0
    held.clear()
    desired.clear()

    if (active) {
      // The camera in the sphere's own frame. This group is a child of the spin
      // group, so its world matrix *is* the sphere's orientation. It is read one
      // frame late (PhotoSphere writes the rotations after this callback runs),
      // and so is the camera position, so the two agree with each other — and a
      // frame of lag in *which* sixteen of 162 tiles are upgraded is invisible.
      group.updateWorldMatrix(true, false)
      scratch.inverse.copy(group.matrixWorld).invert()
      const localCamera = scratch.localCamera
        .copy(camera.position)
        .applyMatrix4(scratch.inverse)
      const distance = localCamera.length()
      if (distance > 1e-6) {
        localCamera.divideScalar(distance)
        for (const slot of slots) if (slot.tile >= 0 && !slot.leaving) held.add(slot.tile)

        const cx = localCamera.x
        const cy = localCamera.y
        const cz = localCamera.z
        // The meridian facing the camera — the same angle the vertex shader
        // reads out of the model-view matrix, and the ring's own zero.
        const lonFront = Math.atan2(cz, cx)
        for (let i = 0; i < count; i++) {
          const facing =
            cx * centers[i * 3] + cy * centers[i * 3 + 1] + cz * centers[i * 3 + 2]
          // On the shell, "nearest the camera" is how squarely a tile points at
          // it. On the ring it is only the angle *around* the ring: all four
          // rows are in frame at once, so the polar courses — which would never
          // clear NEAR_MIN_FACING on the globe — are exactly as much in need of
          // their own file as the equatorial ones. Blending the two by `flatten`
          // means the upgraded set follows the photographs, not the geometry
          // they used to be arranged on.
          const near =
            flatten <= 0
              ? facing
              : facing * (1 - flatten) +
                Math.cos(ringSlots[i * 4] + lonFront) * flatten
          if (near < NEAR_MIN_FACING) continue
          const score = held.has(i) ? near + NEAR_SET_HYSTERESIS : near
          if (best.length >= maxTiles && score <= bestScore[best.length - 1]) continue
          let at = best.length
          while (at > 0 && bestScore[at - 1] < score) at -= 1
          best.splice(at, 0, i)
          bestScore.splice(at, 0, score)
          if (best.length > maxTiles) {
            best.pop()
            bestScore.pop()
          }
        }
        for (const i of best) desired.add(i)
      }
    }

    /* ── slot bookkeeping ─────────────────────────────────────────────────── */

    const writePose = (slot: Slot, tile: number): void => {
      const pose = scratch.pose
      pose.center.set(centers[tile * 3], centers[tile * 3 + 1], centers[tile * 3 + 2])
      pose.size.set(sizes[tile * 2], sizes[tile * 2 + 1])
      pose.roll = rotations[tile]
      pose.seed = seeds[tile]
      pose.slot.set(
        ringSlots[tile * 4],
        ringSlots[tile * 4 + 1],
        ringSlots[tile * 4 + 2],
        ringSlots[tile * 4 + 3],
      )
      if (poseFor) poseFor(tile, pose)
      const u = slot.material.uniforms
      ;(u.uCenter.value as THREE.Vector3).copy(pose.center)
      ;(u.uSize.value as THREE.Vector2).copy(pose.size)
      ;(u.uSlot.value as THREE.Vector4).copy(pose.slot)
      u.uRot.value = pose.roll
      u.uSeed.value = pose.seed
      u.uFlatten.value = flatten
      u.uRipple.value = morph.ripple
      u.uBloom.value = morph.bloom
      u.uSettle.value = morph.settle
    }

    const free = (slot: Slot): void => {
      if (slot.url) releaseTileTexture(slot.url, slot.pending ?? undefined)
      slot.url = ''
      slot.pending = null
      slot.tile = -1
      slot.fade = 0
      slot.ready = false
      slot.leaving = false
      slot.mesh.visible = false
      slot.material.uniforms.uTile.value = null
    }

    const create = (): Slot => {
      const material = new THREE.ShaderMaterial({
        vertexShader: nearTileVertexShader,
        fragmentShader: nearTileFragmentShader,
        uniforms: {
          uTile: { value: null },
          uCenter: { value: new THREE.Vector3(0, 0, 1) },
          uSize: { value: new THREE.Vector2(0.1, 0.1) },
          uSlot: { value: new THREE.Vector4() },
          uRot: { value: 0 },
          uSeed: { value: 0 },
          uRadius: { value: radius },
          uRelief: { value: relief },
          uOpacity: { value: 0 },
          uFlatten: { value: 0 },
          uRing: { value: morph.ring.radius },
          uRipple: { value: morph.ripple },
          uBloom: { value: morph.bloom },
          uSettle: { value: morph.settle },
        },
        side: THREE.FrontSide,
        // Always blended: the crossfade needs it, and at full opacity the blend
        // is a straight copy. depthWrite off keeps a fading tile from stamping
        // depth its twin still needs; the polygon offset is the belt to that
        // brace — the two programs compute the same depth but not necessarily
        // bit-for-bit, and a tie must resolve in the near tile's favour.
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      const mesh = new THREE.Mesh(geometry, material)
      // The shader displaces every vertex onto the shell, so the derived bounds
      // are the flat quad's and culling against them would be nonsense.
      mesh.frustumCulled = false
      mesh.visible = false
      mesh.matrixAutoUpdate = false
      group.add(mesh)
      const slot: Slot = {
        mesh,
        material,
        tile: -1,
        url: '',
        pending: null,
        fade: 0,
        ready: false,
        leaving: false,
      }
      slots.push(slot)
      return slot
    }

    const obtain = (): Slot | null => {
      for (const slot of slots) if (slot.tile < 0) return slot
      if (slots.length < maxTiles + NEAR_SPARE_SLOTS) return create()
      let victim: Slot | null = null
      for (const slot of slots) {
        if (slot.leaving && (victim === null || slot.fade < victim.fade)) victim = slot
      }
      if (!victim) return null
      free(victim)
      return victim
    }

    const assign = (slot: Slot, tile: number): void => {
      const url = photos[tile].mid
      slot.tile = tile
      slot.url = url
      slot.fade = 0
      slot.ready = false
      slot.leaving = false
      const onReady = (texture: THREE.Texture): void => {
        // The slot may have been reassigned while the file was in flight.
        if (slot.url !== url) return
        slot.material.uniforms.uTile.value = texture
        slot.ready = true
        slot.pending = null
      }
      const warm = acquireTileTexture(url, onReady)
      if (warm) {
        slot.material.uniforms.uTile.value = warm
        slot.ready = true
        slot.pending = null
      } else {
        slot.pending = onReady
      }
      writePose(slot, tile)
    }

    // Anything not wanted this frame starts leaving; anything wanted again stops.
    for (const slot of slots) {
      if (slot.tile < 0) continue
      slot.leaving = !desired.has(slot.tile)
    }
    for (const tile of best) {
      let taken = false
      for (const slot of slots) {
        if (slot.tile === tile) {
          taken = true
          break
        }
      }
      if (taken) continue
      const slot = obtain()
      if (!slot) break
      assign(slot, tile)
    }

    /* ── crossfade ────────────────────────────────────────────────────────── */

    const step = NEAR_FADE_SECONDS > 0 ? Math.min(delta, 0.1) / NEAR_FADE_SECONDS : 1
    let hiddenDirty = false

    for (const slot of slots) {
      const tile = slot.tile
      if (tile < 0) continue

      const rising = !slot.leaving && slot.ready
      slot.fade = clamp01(slot.fade + (rising ? step : -step))

      // Every frame, not only when a caller is rewriting poses: the morph moves
      // a tile continuously, and this is where a near tile is told where its
      // instanced twin has got to.
      if (slot.ready) writePose(slot, tile)
      slot.material.uniforms.uOpacity.value = slot.fade * globalOpacity
      slot.mesh.visible = slot.ready && slot.fade > 0.001

      // The instanced twin goes dark only once the near tile is fully opaque,
      // and comes back the instant it is not. Neither direction can show a hole.
      const wantHidden = slot.fade >= 1 ? 1 : 0
      if (hiddenArray[tile] !== wantHidden) {
        hiddenArray[tile] = wantHidden
        hiddenDirty = true
      }

      if (slot.leaving && slot.fade <= 0) free(slot)
    }

    if (hiddenDirty) hidden.needsUpdate = true
  })

  return <group ref={groupRef} />
}
