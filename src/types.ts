export type AtlasRect = { sheet: number; u: number; v: number; w: number; h: number }

export type Photo = {
  id: string
  src: string
  w: number
  h: number
  aspect: number
  color: string
  orientation: 'landscape' | 'portrait' | 'square'
  exif: {
    camera?: string; lens?: string; focal?: string
    aperture?: string; shutter?: string; iso?: number; date?: string
  }
  /** Juan's title, or a readable fallback derived from the id. */
  title: string
  /** True only when the title was written by hand. */
  titled: boolean
  mid: string
  full: string
  atlas: { desktop: AtlasRect; mobile: AtlasRect }
}

export type PhotoManifest = {
  generated: string
  count: number
  atlas: Record<'desktop' | 'mobile', { sheet: number; tile: number }>
  photos: Photo[]
}
