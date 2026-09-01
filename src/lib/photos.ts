import manifest from '../data/photos.json'
import titles from '../data/titles.json'
import type { PhotoManifest, Photo } from '../types'

const TITLES = titles as Record<string, string>

/** "img-4529" -> "Img 4529". Only ever seen for photos Juan has not named yet. */
const fallbackTitle = (id: string) =>
  id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const raw = manifest as unknown as PhotoManifest

export const PHOTOS: Photo[] = raw.photos.map((p) => ({
  ...p,
  title: TITLES[p.id] ?? fallbackTitle(p.id),
  /** True only for titles Juan wrote — lets the UI hide placeholder names. */
  titled: Boolean(TITLES[p.id]),
}))

export const MANIFEST: PhotoManifest = { ...raw, photos: PHOTOS }

export const atlasUrl = (kind: 'desktop' | 'mobile', sheet = 0) =>
  `/p/atlas-${kind}-${sheet}.webp`

/** How many photographs Juan has actually named. */
export const TITLED_COUNT = PHOTOS.filter((p) => p.titled).length
