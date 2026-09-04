---
tags: [assets, performance]
---

# Asset Pipeline

`photos-src/` (162 originals, **1.2 GB**) → `public/p/` via `npm run assets`.
About 3 minutes.

## Tiers

| Tier | Size | Used for | Weight |
|---|---|---|---|
| atlas tile | 320 px (160 mobile) | the globe surface | **1.84 MB / 0.57 MB** |
| `mid` | 1200 px | near tiles when zoomed | 25 MB total, lazy |
| `full` | 1800 px q75 | the lightbox | 34 MB total, on click |

**All 162 photographs fit in a single 4096² atlas sheet.** That is what makes the
sphere one draw call — one texture bind, no sheet switching.

## Why LOD exists

The atlas is 320 px per tile. At rest a tile covers ~220 device px, so that is
ample. Fully zoomed it covers ~1580 px — a **4.9× upscale**, which Juan correctly
called out as pixelated. `NearTiles` redraws the ~20 photographs nearest the
camera from their own 1200 px files, taking the upscale to about 1.3×.

## Size discipline

`full` was originally 2400 px q82 = 88 MB, making the deploy 130 MB. Dropped to
1800 px q75 = 34 MB, deploy **67 MB**. The lightbox fits a photograph inside the
viewport and never upscales past natural size, so the viewport was always the
binding constraint — not the file.

## Two things that will bite

**Filenames are lowercased to slugs.** Deliberate: case-sensitive hosting had
previously broken `.JPG` vs `.jpg`. Do not reintroduce mixed case.

**`public/p/` is committed; `photos-src/` is not.** This looks wrong but is
required — the originals are too large for the repo, so a CI build has nothing to
regenerate from. Untrack the derivatives and the deployed site has no photographs
at all. See [[Contact and Deploy]].

## Also generated

`npm run assets` writes `src/data/photos.json` — dimensions, aspect, average
colour, atlas UV rects, and EXIF for 121 of 162. `scripts/make-og.mjs` builds the
social card; `scripts/shrink-full.mjs` regenerates only the `full` tier without
wiping the atlases.

Related: [[The Sphere]] · [[Gotchas]]
