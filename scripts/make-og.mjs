/**
 * Builds public/og.jpg — the card shown when the link is pasted into WhatsApp,
 * Slack, iMessage, LinkedIn or X.
 *
 * The landing page is WebGL, so no crawler can screenshot it: without this file
 * the link previews as a blank rectangle. Rather than pick one photograph to
 * stand for the whole portfolio, this lays a band of them across ice white —
 * the same idea as the sphere, flattened into the one frame social cards allow.
 *
 *   node scripts/make-og.mjs
 */
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const W = 1200
const H = 630
const BG = { r: 244, g: 246, b: 247, alpha: 1 } // --bg, ice white
const BAND_H = 152
const GAP = 8
const ROWS = [146, 306]  // two courses, echoing the sphere's bands

const manifest = JSON.parse(readFileSync(join(ROOT, 'src/data/photos.json'), 'utf8'))

// Spread the choice across the whole set, and prefer landscape frames — a
// portrait at a fixed band height eats horizontal room for little gain.
const pool = manifest.photos.filter((p) => p.aspect >= 1.2)
const stride = pool.length / 24
const picks = Array.from({ length: 24 }, (_, i) => pool[Math.floor(i * stride)])

const tiles = []
let taken = 0
for (const [row, top] of ROWS.entries()) {
  // Offset the second course by a third of a frame — running bond, the same
  // reason the sphere's courses are offset: aligned seams read as a grid.
  let x = row === 1 ? -Math.round(BAND_H * 0.55) : -12
  while (x < W && taken < picks.length) {
    const p = picks[taken++]
    const w = Math.round(BAND_H * p.aspect)
    const buf = await sharp(join(ROOT, 'photos-src', p.src), { limitInputPixels: 1_000_000_000 })
      .rotate()
      .resize(w, BAND_H, { fit: 'cover' })
      .toBuffer()
    tiles.push({ input: buf, left: x, top })
    x += w + GAP
  }
}

const label = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <text x="${W / 2}" y="86" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif" font-size="58"
        letter-spacing="3" fill="#14181b">Juan Navarro</text>
  <text x="${W / 2}" y="512" text-anchor="middle"
        font-family="Menlo, monospace" font-size="19" letter-spacing="5"
        fill="#5a6469">STREET &amp; TRAVEL PHOTOGRAPHY</text>
  <text x="${W / 2}" y="556" text-anchor="middle"
        font-family="Menlo, monospace" font-size="16" letter-spacing="3"
        fill="#9aa4a9">juannavarro.eu</text>
</svg>`)

await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
  .composite([
    ...tiles.filter((t) => t.left < W),
    { input: label, left: 0, top: 0 },
  ])
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(join(ROOT, 'public', 'og.jpg'))

console.log(`public/og.jpg — ${W}x${H}, ${tiles.length} photographs`)
