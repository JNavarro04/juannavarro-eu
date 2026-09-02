/**
 * The one-photograph-at-a-time texture cache behind the sphere's level of
 * detail.
 *
 * The globe is drawn from a packed atlas — 320px per photograph on desktop,
 * 160px on a phone — which is generous at the resting framing and visibly
 * short of it once the camera has dollied in. Measured at 1440×900, DPR 2: a
 * mean tile covers 225 device px at rest and 880 at the stop, and the widest
 * one 1467. So somewhere in the middle of the zoom the atlas stops being a
 * source and starts being an upscale, and the photographs closest to the camera
 * have to come from their own file.
 *
 * The whole cost of doing that is memory, so this module is the accounting:
 *
 *   REFCOUNTS.   A tile that is on screen holds a reference; when it leaves the
 *                near set it drops it. Nothing is ever loaded twice, and two
 *                tiles that briefly want the same photograph share one upload.
 *
 *   A GRACE PERIOD, not an immediate free. A photograph that leaves the near
 *                set has a good chance of coming straight back — the visitor
 *                nudged the sphere, or crossed a threshold, or React remounted
 *                the tree in StrictMode. Freeing on the frame it left would
 *                make a small movement thrash the network.
 *
 *   AN IDLE CAP. The grace period alone is unbounded: swing the sphere hard for
 *                four seconds and you can touch sixty photographs, which at
 *                ~5MB of GPU memory each is not a cache, it is a leak with a
 *                timer. Past {@link IDLE_LIMIT} unheld textures the oldest is
 *                disposed at once, so the ceiling is the near set plus a fixed
 *                margin no matter how the sphere is thrown around.
 *
 * Nothing here knows about React or three's scene graph: it hands out
 * `THREE.Texture` and counts. See NearTiles.tsx for the thing that uses it.
 */
import * as THREE from 'three'

/**
 * How long a released texture is kept before it is disposed, ms.
 *
 * Long enough to cover a nudge of the sphere, a threshold crossed twice, and
 * StrictMode's double mount in development; short enough that memory comes back
 * while the visitor is still looking at the page.
 */
export const TILE_DISPOSE_GRACE_MS = 4000

/**
 * How many unreferenced textures may sit in the grace period at once.
 *
 * The hard ceiling on this module is (tiles on screen + this), and a mid
 * derivative is 1200px on its long edge — about 5MB on the GPU once mipmapped.
 * Four is a fifth of a desktop near set: enough that going back the way you came
 * is free, small enough that it adds only ~20MB to the ceiling.
 */
export const IDLE_LIMIT = 4

type Entry = {
  url: string
  texture: THREE.Texture | null
  refs: number
  /** Rising counter, for evicting the least recently released first. */
  touched: number
  disposeTimer: ReturnType<typeof setTimeout> | null
  waiters: Array<(texture: THREE.Texture) => void>
  error: Error | null
}

const cache = new Map<string, Entry>()
const loader = new THREE.TextureLoader()
let clock = 0

/**
 * Anisotropy for every tile texture, set once from the renderer's capabilities.
 *
 * A tile at the rim of the zoomed-in sphere is seen at a steep angle, and
 * without this the photograph goes to mush along one axis exactly where the
 * curvature is most readable.
 */
let anisotropy = 1

/** Call once with `renderer.capabilities.getMaxAnisotropy()`. */
export function setTileTextureAnisotropy(value: number): void {
  const next = Math.max(1, Math.min(16, Math.floor(value) || 1))
  if (next === anisotropy) return
  anisotropy = next
  for (const entry of cache.values()) {
    if (!entry.texture) continue
    entry.texture.anisotropy = next
    entry.texture.needsUpdate = true
  }
}

function configure(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace
  // flipY off, V flipped in the fragment shader — the same convention the atlas
  // uses, so one shader can be swapped for the other with no coordinate change.
  texture.flipY = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  // A mid derivative is *minified* over most of the zoom — 1200px of source in
  // 880 device px of screen — so the mipmaps are not optional; without them the
  // detail in a photograph crawls as the sphere turns.
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = anisotropy
  texture.needsUpdate = true
}

/** Dispose the least recently released idle entries until the cap is met. */
function trimIdle(): void {
  const idle = [...cache.values()].filter((e) => e.refs === 0)
  if (idle.length <= IDLE_LIMIT) return
  idle.sort((a, b) => a.touched - b.touched)
  for (const entry of idle.slice(0, idle.length - IDLE_LIMIT)) {
    if (entry.disposeTimer !== null) clearTimeout(entry.disposeTimer)
    entry.texture?.dispose()
    cache.delete(entry.url)
  }
}

/**
 * Take a reference on one photograph's texture.
 *
 * Returns it immediately when it is already decoded; otherwise returns null and
 * calls `onReady` once it arrives. The callback does not fire if the reference
 * was dropped in the meantime, but a caller that can be handed a *different*
 * photograph in between should still check that the url it asked for is the one
 * it still wants.
 *
 * Every acquire must be paired with exactly one {@link releaseTileTexture}.
 */
export function acquireTileTexture(
  url: string,
  onReady?: (texture: THREE.Texture) => void,
): THREE.Texture | null {
  let entry = cache.get(url)

  if (!entry) {
    const created: Entry = {
      url,
      texture: null,
      refs: 0,
      touched: clock++,
      disposeTimer: null,
      waiters: [],
      error: null,
    }
    entry = created
    cache.set(url, created)
    loader.load(
      url,
      (texture) => {
        // Dropped while in flight and already swept: do not resurrect it.
        if (cache.get(url) !== created) {
          texture.dispose()
          return
        }
        configure(texture)
        created.texture = texture
        const waiting = created.waiters.slice()
        created.waiters.length = 0
        for (const notify of waiting) notify(texture)
      },
      undefined,
      () => {
        if (cache.get(url) !== created) return
        created.error = new Error(`Could not load photograph: ${url}`)
        created.waiters.length = 0
      },
    )
  }

  if (entry.disposeTimer !== null) {
    clearTimeout(entry.disposeTimer)
    entry.disposeTimer = null
  }
  entry.refs += 1
  entry.touched = clock++

  if (entry.texture) return entry.texture
  if (onReady && !entry.error) entry.waiters.push(onReady)
  return null
}

/** Drop a reference. The texture survives {@link TILE_DISPOSE_GRACE_MS}. */
export function releaseTileTexture(url: string, onReady?: (t: THREE.Texture) => void): void {
  const entry = cache.get(url)
  if (!entry) return

  if (onReady) {
    const at = entry.waiters.indexOf(onReady)
    if (at >= 0) entry.waiters.splice(at, 1)
  }

  entry.refs = Math.max(0, entry.refs - 1)
  if (entry.refs > 0) return

  entry.touched = clock++
  if (entry.disposeTimer === null) {
    entry.disposeTimer = setTimeout(() => {
      entry.disposeTimer = null
      if (entry.refs > 0) return
      entry.texture?.dispose()
      cache.delete(url)
    }, TILE_DISPOSE_GRACE_MS)
  }
  trimIdle()
}

/** What the cache is holding. Diagnostics — nothing depends on this. */
export function tileTextureStats(): {
  entries: number
  decoded: number
  held: number
  idle: number
  failed: number
} {
  let decoded = 0
  let held = 0
  let idle = 0
  let failed = 0
  for (const entry of cache.values()) {
    if (entry.texture) decoded += 1
    if (entry.error) failed += 1
    if (entry.refs > 0) held += 1
    else idle += 1
  }
  return { entries: cache.size, decoded, held, idle, failed }
}

/** Drop everything, held or not. Only for teardown and tests. */
export function disposeAllTileTextures(): void {
  for (const entry of cache.values()) {
    if (entry.disposeTimer !== null) clearTimeout(entry.disposeTimer)
    entry.texture?.dispose()
  }
  cache.clear()
}
