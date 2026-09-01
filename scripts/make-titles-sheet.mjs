/**
 * Generates tools/titles.html — a local contact sheet for naming the photos.
 *
 * Open it in a browser, type a title beside each frame, then hit Copy. It keeps
 * your work in localStorage as you go, so closing the tab loses nothing, and it
 * emits JSON that drops straight into src/data/titles.json.
 *
 *   node scripts/make-titles-sheet.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'src/data/photos.json'), 'utf8'))

let existing = {}
try {
  existing = JSON.parse(readFileSync(join(ROOT, 'src/data/titles.json'), 'utf8'))
} catch {
  /* first run — no titles yet */
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

const rows = manifest.photos
  .map((p, i) => {
    const exif = [p.exif?.camera, p.exif?.focal, p.exif?.date].filter(Boolean).join(' · ')
    return `<li class="row">
  <img loading="lazy" src="../public/p/mid/${esc(p.id)}.webp" alt="" style="background:${esc(p.color)}">
  <div class="meta">
    <span class="n">${String(i + 1).padStart(3, '0')}</span>
    <code>${esc(p.id)}</code>
    <span class="exif">${esc(exif)}</span>
  </div>
  <input type="text" data-id="${esc(p.id)}" placeholder="Title…" value="${esc(existing[p.id] ?? '')}" autocomplete="off" spellcheck="false">
</li>`
  })
  .join('\n')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Name the photographs — ${manifest.count} frames</title>
<style>
  :root { --bg:#f4f6f7; --ink:#14181b; --soft:#5a6469; --line:#d9dfe2; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:16px/1.5 -apple-system,BlinkMacSystemFont,'Inter',sans-serif; }
  header { position:sticky; top:0; z-index:5; background:var(--bg);
           border-bottom:1px solid var(--line); padding:1rem clamp(1rem,4vw,3rem);
           display:flex; gap:1rem; align-items:center; flex-wrap:wrap }
  h1 { font-size:1rem; margin:0; font-weight:500; letter-spacing:.02em }
  .count { color:var(--soft); font-variant-numeric:tabular-nums; font-size:.85rem }
  button { font:inherit; font-size:.85rem; padding:.5rem .9rem; cursor:pointer;
           background:var(--ink); color:var(--bg); border:0; border-radius:2px }
  button.ghost { background:transparent; color:var(--ink); border:1px solid var(--line) }
  ul { list-style:none; margin:0; padding:clamp(1rem,4vw,3rem); display:grid; gap:.75rem }
  .row { display:grid; grid-template-columns:120px 1fr minmax(200px,26ch); gap:1rem;
         align-items:center; padding:.5rem; border-bottom:1px solid var(--line) }
  .row img { width:120px; height:80px; object-fit:cover; display:block }
  .meta { display:flex; flex-direction:column; gap:.15rem; min-width:0 }
  .n { color:var(--soft); font-size:.75rem; font-variant-numeric:tabular-nums }
  code { font-size:.8rem; color:var(--ink); overflow-wrap:anywhere }
  .exif { color:var(--soft); font-size:.75rem }
  input { font:inherit; padding:.55rem .7rem; border:1px solid var(--line);
          border-radius:2px; background:#fff; width:100% }
  input:focus { outline:2px solid var(--ink); outline-offset:1px }
  input.done { border-color:var(--ink) }
  @media (max-width:720px){ .row { grid-template-columns:88px 1fr } .row input { grid-column:1/-1 } .row img{width:88px;height:60px} }
</style>
</head>
<body>
<header>
  <h1>Name the photographs</h1>
  <span class="count"><b id="filled">0</b> / ${manifest.count} named</span>
  <button id="copy">Copy JSON</button>
  <button id="download" class="ghost">Download titles.json</button>
  <span class="count" id="status"></span>
</header>
<ul>
${rows}
</ul>
<script>
const KEY = 'jn-photo-titles';
const inputs = [...document.querySelectorAll('input[data-id]')];
const filledEl = document.getElementById('filled');
const statusEl = document.getElementById('status');

// Restore anything typed in a previous sitting.
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const el of inputs) if (!el.value && saved[el.dataset.id]) el.value = saved[el.dataset.id];
} catch {}

const collect = () => {
  const out = {};
  for (const el of inputs) { const v = el.value.trim(); if (v) out[el.dataset.id] = v; }
  return out;
};
const refresh = () => {
  const data = collect();
  filledEl.textContent = Object.keys(data).length;
  for (const el of inputs) el.classList.toggle('done', el.value.trim() !== '');
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
};
for (const el of inputs) el.addEventListener('input', refresh);
refresh();

// Enter moves to the next field, so the whole set can be typed without the mouse.
for (const [i, el] of inputs.entries()) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); inputs[i + 1]?.focus(); }
  });
}

const say = (m) => { statusEl.textContent = m; setTimeout(() => (statusEl.textContent = ''), 2500); };

document.getElementById('copy').addEventListener('click', async () => {
  const text = JSON.stringify(collect(), null, 2);
  try { await navigator.clipboard.writeText(text); say('Copied — paste it back to Claude.'); }
  catch { say('Copy failed; use Download instead.'); }
});

document.getElementById('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'titles.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
</script>
</body>
</html>
`

mkdirSync(join(ROOT, 'tools'), { recursive: true })
writeFileSync(join(ROOT, 'tools/titles.html'), html)
console.log(`tools/titles.html — ${manifest.count} photos, ${Object.keys(existing).length} already named`)
