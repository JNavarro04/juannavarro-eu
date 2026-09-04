# juannavarro.eu

Photography portfolio for Juan Navarro. Spanish photographer based in the
Netherlands, street and travel work. Live at `www.juannavarro.eu`.

The landing page is a rotating globe built from 162 of his photographs, which
unrolls into an endlessly scrolling cylinder as you scroll in.

## Read these before changing anything

**Structure** — a graphify code graph is built for this repo:

```bash
graphify update .          # rebuild, ~seconds, zero token cost
graphify explain "sphereMath.ts"
graphify path "A" "B"
```

Prefer querying the graph over reading files exhaustively.

**Reasoning** — `notes/` is an Obsidian vault holding the *why*, which the graph
cannot capture. Start at [[Architecture]], then:

- `notes/The Sphere.md` — band solver, the 20° tilt, why coverage is not a goal
- `notes/The Morph.md` — globe to cylinder, why zero roll is exact
- `notes/The Intro.md` — the one-shot composition and the snap bug
- `notes/Asset Pipeline.md` — the atlas, the tiers, the size discipline
- `notes/Contact and Deploy.md` — Vercel, Resend, `VITE_` is public
- `notes/Gotchas.md` — **read this one first if something looks broken**

## Commands

```bash
npm run dev        # dev server on :5173
npm run build      # tsc -b && vite build — use this, not just a typecheck
npm run assets     # regenerate photo derivatives from photos-src/ (~3 min)
```

## Non-obvious constraints

- **Never put a backtick inside the GLSL template literals** in
  `src/components/Sphere/shaders.ts`. It terminates the string and takes the
  whole site down. `tsc --noEmit` will not catch it; `npm run build` will.
- **`public/p/` is committed on purpose.** `photos-src/` (1.2 GB) is not in the
  repo, so a CI build cannot regenerate the derivatives. Untrack them and the
  deployed site has no photographs.
- **Anything prefixed `VITE_` is public**, inlined into the browser bundle.
  Secrets go server-side, which is why the contact form posts to `/api/contact`.
- **The sphere is one InstancedMesh, one draw call.** Keep it that way. Tiles are
  curved patches placed by the vertex shader — instance matrices are identity, so
  default raycasting is wrong; use `pickPhotoAt`.
- **`sphereDrive` is the seam.** The choreography writes to it, the sphere reads
  it every frame, React never re-renders for motion. Do not reach into the canvas.
- **Pushing to `main` deploys straight to production.** No preview gate. Instant
  Rollback is on the Vercel project Overview.

## Verifying visual work

The preview pane is often hidden, which throttles `requestAnimationFrame` to
~2/second and makes GPU draw calls measure zero. Frozen-looking animation is
usually this, not a bug — check `document.visibilityState` first. See
`notes/Gotchas.md`.

## Still open

- Juan is considering self-hosting; `api/contact.ts` is Vercel Edge-specific and
  would need adapting.
- A logo may replace the wordmark in `Nav.tsx` — the slot is ready.
- Nobody has profiled this at 60 fps on real hardware. Timing constants
  (`PROGRESS_DAMPING`, `ORBIT_DAMPING`, `INTRO_SECONDS`) are verified as maths,
  not as feel.
