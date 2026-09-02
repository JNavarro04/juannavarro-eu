/**
 * Regenerates only the `full` tier, smaller.
 *
 * 2400px at q82 made public/p/full 101MB, which is most of a 130MB deploy. The
 * lightbox fits a photograph inside the viewport and never upscales past its
 * natural size, so on any normal display 1800px is indistinguishable — the cap
 * that actually bites is the viewport, not the file.
 *
 * Deliberately does NOT touch the atlases or the mid tier: wiping public/p
 * wholesale would leave the running dev server without a sphere for minutes.
 *
 *   node scripts/shrink-full.mjs
 */
import sharp from 'sharp'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'photos-src')
const OUT = join(ROOT, 'public', 'p', 'full')

const EDGE = 1800
const QUALITY = 75

sharp.cache(false)
sharp.concurrency(4)

const dirBytes = (d) =>
  readdirSync(d).reduce((n, f) => n + statSync(join(d, f)).size, 0)

const fit = (w, h, max) =>
  w >= h
    ? { w: Math.round(max), h: Math.max(1, Math.round((max * h) / w)) }
    : { w: Math.max(1, Math.round((max * w) / h)), h: Math.round(max) }

const manifest = JSON.parse(readFileSync(join(ROOT, 'src/data/photos.json'), 'utf8'))
const before = dirBytes(OUT)

for (const [i, p] of manifest.photos.entries()) {
  const input = join(SRC, p.src)
  const pipeline = () => sharp(input, { limitInputPixels: 1_000_000_000 }).rotate()
  const meta = await pipeline().metadata()
  const swapped = meta.orientation && meta.orientation >= 5
  const w = swapped ? meta.height : meta.width
  const h = swapped ? meta.width : meta.height
  const t = fit(w, h, EDGE)

  await pipeline()
    .resize(t.w, t.h, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 5 })
    .toFile(join(OUT, `${p.id}.webp`))

  process.stdout.write(`\r  [${i + 1}/${manifest.photos.length}] ${p.id.padEnd(28).slice(0, 28)}`)
}

const after = dirBytes(OUT)
const mb = (n) => (n / 1048576).toFixed(1)
console.log(
  `\n\n  full/: ${mb(before)}MB -> ${mb(after)}MB  (${Math.round((1 - after / before) * 100)}% smaller, ${EDGE}px q${QUALITY})`,
)
