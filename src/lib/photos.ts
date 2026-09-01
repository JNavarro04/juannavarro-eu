import manifest from '../data/photos.json'
import type { PhotoManifest, Photo } from '../types'

export const MANIFEST = manifest as unknown as PhotoManifest
export const PHOTOS: Photo[] = MANIFEST.photos
export const atlasUrl = (kind: 'desktop' | 'mobile', sheet = 0) =>
  `/p/atlas-${kind}-${sheet}.webp`
