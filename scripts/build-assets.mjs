/**
 * Photo pipeline: photos-src/*.{jpg,jpeg} -> public/p/** + src/data/photos.json
 *
 * Three jobs:
 *  1. Derivatives. Each original becomes `mid` (1200px) and `full` (2400px) WebP.
 *  2. Atlases. Every `tile` (320px desktop / 160px mobile) is shelf-packed into
 *     4096²/2048² sheets so the sphere renders in one draw call instead of 162.
 *  3. Manifest. Dimensions, aspect, EXIF, average colour, atlas UV rects.
 *
 * Filenames are slugified to lowercase — this is deliberate. Case-sensitive
 * hosting has bitten this site before with .JPG vs .jpg.
 */
import sharp from 'sharp'
import exifr from 'exifr'
import { readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, extname, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'photos-src')
const OUT = join(ROOT, 'public', 'p')
const DATA = join(ROOT, 'src', 'data')

const VARIANTS = { mid: 1200, full: 1800 }
const ATLASES = {
  desktop: { sheet: 4096, tile: 320 },
  mobile: { sheet: 2048, tile: 160 },
}
const GUTTER = 4 // keeps mip levels from bleeding between neighbours

sharp.cache(false)
sharp.concurrency(4)

const slugify = (f) =>
  basename(f, extname(f)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Next-Fit Decreasing Height shelf packer. Returns sheets of placed rects. */
function shelfPack(items, sheet) {
  const sorted = [...items].sort((a, b) => b.h - a.h)
  const sheets = []
  let cur = null
  for (const it of sorted) {
    if (it.w > sheet || it.h > sheet) throw new Error(`tile ${it.id} exceeds sheet`)
    let placed = false
    while (!placed) {
      if (!cur) { cur = { rects: [], x: GUTTER, y: GUTTER, shelfH: 0 }; sheets.push(cur) }
      if (cur.x + it.w + GUTTER > sheet) {            // advance to next shelf
        cur.y += cur.shelfH + GUTTER
        cur.x = GUTTER
        cur.shelfH = 0
      }
      if (cur.y + it.h + GUTTER > sheet) { cur = null; continue } // sheet full
      cur.rects.push({ ...it, x: cur.x, y: cur.y })
      cur.x += it.w + GUTTER
      cur.shelfH = Math.max(cur.shelfH, it.h)
      placed = true
    }
  }
  return sheets
}

/** Fit longest edge to `max`, preserving aspect. */
const fit = (w, h, max) =>
  w >= h
    ? { w: Math.round(max), h: Math.max(1, Math.round((max * h) / w)) }
    : { w: Math.max(1, Math.round((max * w) / h)), h: Math.round(max) }

async function main() {
  await rm(OUT, { recursive: true, force: true })
  for (const v of Object.keys(VARIANTS)) await mkdir(join(OUT, v), { recursive: true })
  await mkdir(DATA, { recursive: true })

  const files = (await readdir(SRC))
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !f.startsWith('.'))
    .sort()

  console.log(`Found ${files.length} originals\n`)

  const photos = []
  const seen = new Set()

  for (const [i, file] of files.entries()) {
    let slug = slugify(file)
    while (seen.has(slug)) slug = `${slug}-2`
    seen.add(slug)

    const input = join(SRC, file)
    // limitInputPixels: one panorama is 24000px wide and trips sharp's default cap.
    const pipeline = () => sharp(input, { limitInputPixels: 1_000_000_000 }).rotate()

    const meta = await pipeline().metadata()
    // .rotate() applies EXIF orientation, so post-rotation dims may be swapped.
    const swapped = meta.orientation && meta.orientation >= 5
    const w = swapped ? meta.height : meta.width
    const h = swapped ? meta.width : meta.height

    for (const [name, max] of Object.entries(VARIANTS)) {
      const t = fit(w, h, max)
      await pipeline()
        .resize(t.w, t.h, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: name === 'full' ? 75 : 80, effort: 4 })
        .toFile(join(OUT, name, `${slug}.webp`))
    }

    const { data: avg } = await pipeline().resize(1, 1, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
    const hex = '#' + [avg[0], avg[1], avg[2]].map((c) => c.toString(16).padStart(2, '0')).join('')

    let exif = {}
    try {
      const e = await exifr.parse(input, ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal'])
      if (e) exif = {
        camera: [e.Make, e.Model].filter(Boolean).join(' ').trim() || undefined,
        lens: e.LensModel || undefined,
        focal: e.FocalLength ? `${Math.round(e.FocalLength)}mm` : undefined,
        aperture: e.FNumber ? `f/${e.FNumber}` : undefined,
        shutter: e.ExposureTime ? (e.ExposureTime < 1 ? `1/${Math.round(1 / e.ExposureTime)}s` : `${e.ExposureTime}s`) : undefined,
        iso: e.ISO || undefined,
        date: e.DateTimeOriginal ? new Date(e.DateTimeOriginal).toISOString().slice(0, 10) : undefined,
      }
    } catch { /* EXIF is optional metadata; a missing block is not an error */ }

    photos.push({
      id: slug,
      src: file,
      w, h,
      aspect: +(w / h).toFixed(4),
      color: hex,
      orientation: w / h > 1.05 ? 'landscape' : w / h < 0.95 ? 'portrait' : 'square',
      exif,
      mid: `/p/mid/${slug}.webp`,
      full: `/p/full/${slug}.webp`,
    })

    process.stdout.write(`\r  [${i + 1}/${files.length}] ${slug.padEnd(28).slice(0, 28)}`)
  }
  console.log('\n')

  // --- atlases -------------------------------------------------------------
  for (const [kind, cfg] of Object.entries(ATLASES)) {
    const tiles = await Promise.all(
      photos.map(async (p) => {
        const t = fit(p.w, p.h, cfg.tile)
        const buf = await sharp(join(SRC, p.src), { limitInputPixels: 1_000_000_000 })
          .rotate()
          .resize(t.w, t.h, { fit: 'fill' })
          .webp({ quality: 82 })
          .toBuffer()
        return { id: p.id, w: t.w, h: t.h, buf }
      })
    )

    const sheets = shelfPack(tiles, cfg.sheet)
    for (const [si, sheet] of sheets.entries()) {
      await sharp({
        create: { width: cfg.sheet, height: cfg.sheet, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite(sheet.rects.map((r) => ({ input: r.buf, left: r.x, top: r.y })))
        .webp({ quality: 84, effort: 5 })
        .toFile(join(OUT, `atlas-${kind}-${si}.webp`))

      for (const r of sheet.rects) {
        const p = photos.find((x) => x.id === r.id)
        p.atlas ??= {}
        // Normalised UV rect. Origin top-left; the shader flips V.
        p.atlas[kind] = {
          sheet: si,
          u: +(r.x / cfg.sheet).toFixed(6),
          v: +(r.y / cfg.sheet).toFixed(6),
          w: +(r.w / cfg.sheet).toFixed(6),
          h: +(r.h / cfg.sheet).toFixed(6),
        }
      }
    }
    console.log(`  atlas/${kind}: ${sheets.length} sheet(s) @ ${cfg.sheet}px, ${cfg.tile}px tiles`)
  }

  const manifest = {
    generated: new Date().toISOString(),
    count: photos.length,
    atlas: Object.fromEntries(
      Object.entries(ATLASES).map(([k, v]) => [k, { sheet: v.sheet, tile: v.tile }])
    ),
    photos,
  }
  await writeFile(join(DATA, 'photos.json'), JSON.stringify(manifest, null, 2))
  console.log(`\n✓ ${photos.length} photos -> public/p/ + src/data/photos.json`)
}

main().catch((e) => { console.error(e); process.exit(1) })
