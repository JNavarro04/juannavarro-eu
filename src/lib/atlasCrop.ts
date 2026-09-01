import type { CSSProperties } from 'react'
import type { Photo } from '../types'
import { MANIFEST, atlasUrl } from './photos'

export type AtlasKind = 'desktop' | 'mobile'

/**
 * Crops a single photo out of the packed sphere atlas using background-position.
 *
 * The atlas is already in cache from the landing page, so every thumbnail
 * elsewhere on the site costs zero additional bytes. Given a normalised rect
 * (u, v, w, h) in a sheet of S px, displaying it at `width` px means scaling
 * the whole sheet by width / (w * S) — which reduces to a background-size of
 * width / w, and the same factor applied to the offsets.
 */
export function atlasCrop(photo: Photo, kind: AtlasKind, width: number): CSSProperties {
  const r = photo.atlas[kind]
  const height = (width * r.h) / r.w
  const sheetW = width / r.w
  const sheetH = height / r.h
  return {
    width: `${width}px`,
    height: `${height}px`,
    backgroundImage: `url(${atlasUrl(kind, r.sheet)})`,
    backgroundSize: `${sheetW}px ${sheetH}px`,
    backgroundPosition: `${-r.u * sheetW}px ${-r.v * sheetH}px`,
    backgroundRepeat: 'no-repeat',
  }
}

/** Width a photo occupies when every tile shares one height — a filmstrip. */
export const widthAtHeight = (photo: Photo, kind: AtlasKind, height: number) => {
  const r = photo.atlas[kind]
  return (height * r.w) / r.h
}

export const sheetSize = (kind: AtlasKind) => MANIFEST.atlas[kind].sheet
