export { default as SphereStage } from './SphereStage'
export type { SphereStageProps } from './SphereStage'

export { default as PhotoSphere } from './PhotoSphere'
export type { PhotoSphereProps } from './PhotoSphere'
export {
  SPHERE_RADIUS,
  SPHERE_FOV,
  VIEWPORT_FRACTION,
  SPIN_SPEED,
  RELIEF,
  PLACEMENT_SEED,
} from './PhotoSphere'

/**
 * The ring — what the globe opens out into as the camera comes in. A scroll
 * choreography needs `RING_RADIUS_SCALE` and the ring's own height to frame it;
 * see `planRing` in src/lib/sphereMath.ts for the rest of the layout.
 */
export {
  RING_RADIUS_SCALE,
  MORPH_RIPPLE,
  MORPH_BLOOM,
  MORPH_SETTLE,
  ringFraming,
} from './PhotoSphere'
export type { RingLayout } from '../../lib/sphereMath'

/**
 * The hit test. `pickPhotoAt(event.clientX, event.clientY)` returns the
 * photograph under the pointer, or null for the background, for a joint between
 * two frames, or when the sphere is not mounted. `index` is an index into
 * `PHOTOS`. See the block comment in PhotoSphere.tsx.
 */
export { pickPhotoAt } from './PhotoSphere'
export type { PhotoPick } from './PhotoSphere'

/** Level of detail — the photographs nearest the camera, drawn from their own
 *  files once the atlas would be an upscale. See NearTiles.tsx. */
export { default as NearTiles } from './NearTiles'
export type { NearTilesProps, TilePose, MorphSettings } from './NearTiles'
export {
  NEAR_TILES_DESKTOP,
  NEAR_TILES_MOBILE,
  NEAR_ACTIVATE_SCALE,
  NEAR_RELEASE_SCALE,
  NEAR_MIN_FACING,
  NEAR_FADE_SECONDS,
} from './NearTiles'

export { sphereDrive, resetSphereDrive, SPHERE_DRIVE_DEFAULTS } from './sphereDrive'
export type { SphereDrive } from './sphereDrive'

export { pickAtlasKind, useAtlasTexture } from './useAtlasTexture'
export type { AtlasKind } from './useAtlasTexture'
