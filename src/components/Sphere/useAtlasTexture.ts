import { useEffect, useState } from 'react'
import * as THREE from 'three'

export type AtlasKind = 'desktop' | 'mobile'

/**
 * Which atlas sheet to pull. The mobile sheet is 2048² with 160px tiles, the
 * desktop one 4096² with 320px tiles. On a phone a tile lands at roughly 40 CSS
 * px, so even at DPR 3 the 160px source is oversampled; the 1.9MB desktop sheet
 * would be four times the bytes for no visible gain. A large high-DPR tablet
 * still gets the desktop sheet, which is what the width test is for.
 */
export function pickAtlasKind(): AtlasKind {
  if (typeof window === 'undefined') return 'desktop'
  const narrow = window.matchMedia('(max-width: 768px)').matches
  // A tile lands at roughly 40 CSS px on a phone, so the 160px mobile source is
  // still oversampled at DPR 3. Past that the sums stop working, so fall back.
  const extremeDensity = window.devicePixelRatio > 3
  return narrow && !extremeDensity ? 'mobile' : 'desktop'
}

type CacheEntry = {
  texture: THREE.Texture | null
  refs: number
  disposeTimer: ReturnType<typeof setTimeout> | null
  waiters: Array<(t: THREE.Texture) => void>
  failures: Array<(e: Error) => void>
  error: Error | null
}

const cache = new Map<string, CacheEntry>()

/** Grace period before a released atlas is actually freed. Covers StrictMode's
 *  double mount in dev and a quick Work → Info → Work round trip in prod. */
const DISPOSE_GRACE_MS = 2000

function configure(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace
  // The atlas rects are quoted with the image origin at top-left. Keeping flipY
  // off means the GPU's t axis agrees with them, and the fragment shader's V
  // flip is the only coordinate handling anywhere.
  texture.flipY = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
}

function acquire(url: string): CacheEntry {
  const existing = cache.get(url)
  const entry: CacheEntry = existing ?? {
    texture: null,
    refs: 0,
    disposeTimer: null,
    waiters: [],
    failures: [],
    error: null,
  }
  if (!existing) {
    cache.set(url, entry)
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        configure(texture)
        entry.texture = texture
        for (const notify of entry.waiters) notify(texture)
        entry.waiters.length = 0
        entry.failures.length = 0
      },
      undefined,
      () => {
        const failure = new Error(`Could not load photo atlas: ${url}`)
        entry.error = failure
        for (const notify of entry.failures) notify(failure)
        entry.waiters.length = 0
        entry.failures.length = 0
      },
    )
  }
  if (entry.disposeTimer !== null) {
    clearTimeout(entry.disposeTimer)
    entry.disposeTimer = null
  }
  entry.refs += 1
  return entry
}

function release(url: string): void {
  const entry = cache.get(url)
  if (!entry) return
  entry.refs -= 1
  if (entry.refs > 0 || entry.disposeTimer !== null) return
  entry.disposeTimer = setTimeout(() => {
    if (entry.refs > 0) return
    entry.texture?.dispose()
    cache.delete(url)
  }, DISPOSE_GRACE_MS)
}

export type AtlasState = { texture: THREE.Texture | null; error: Error | null }

const PENDING: AtlasState = { texture: null, error: null }

/** Reads the cache without taking a reference — lets the first render already
 *  show the sphere when the atlas is still warm from an earlier visit. */
function peek(url: string): AtlasState {
  const entry = cache.get(url)
  if (!entry) return PENDING
  if (entry.texture) return { texture: entry.texture, error: null }
  if (entry.error) return { texture: null, error: entry.error }
  return PENDING
}

/** Loads (and refcounts) an atlas sheet. The texture is disposed once nothing
 *  has been holding it for {@link DISPOSE_GRACE_MS}. */
export function useAtlasTexture(url: string): AtlasState {
  const [state, setState] = useState<AtlasState>(() => peek(url))

  useEffect(() => {
    let live = true
    const entry = acquire(url)

    // Returning `prev` unchanged lets React bail out instead of re-rendering.
    const settle = (next: AtlasState) =>
      setState((prev) =>
        prev.texture === next.texture && prev.error === next.error ? prev : next,
      )

    if (entry.texture) {
      settle({ texture: entry.texture, error: null })
    } else if (entry.error) {
      settle({ texture: null, error: entry.error })
    } else {
      settle(PENDING)
      entry.waiters.push((texture) => {
        if (live) settle({ texture, error: null })
      })
      entry.failures.push((error) => {
        if (live) settle({ texture: null, error })
      })
    }

    return () => {
      live = false
      release(url)
    }
  }, [url])

  return state
}
