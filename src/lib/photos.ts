import manifest from '../data/photos.json'
import type { PhotoManifest, Photo } from '../types'

const raw = manifest as unknown as PhotoManifest

export const PHOTOS: Photo[] = raw.photos
export const MANIFEST: PhotoManifest = raw

export const atlasUrl = (kind: 'desktop' | 'mobile', sheet = 0) =>
  `/p/atlas-${kind}-${sheet}.webp`
