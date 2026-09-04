---
tags: [bugs, lessons]
---

# Gotchas

Bugs that cost real time. Each is a trap that survives to production because it
looks fine locally.

## A backtick inside a GLSL template literal took the site down

The shaders live in JS template literals. A doc comment written with markdown
backticks — `` `ripple` `` — **terminated the literal** and made the file a syntax
error. `tsc --noEmit` passed it; only `tsc -b` caught it.

**Never use a backtick inside those literals, even in comments.** Use single
quotes. And run `npm run build`, not just a typecheck.

## Preload without `crossorigin` doubled the atlas download

`THREE.TextureLoader` fetches in CORS mode. A `<link rel=preload>` *without* a
matching `crossorigin` attribute is a cache miss, so the 1.8 MB atlas downloaded
**twice** on every cold load. One attribute.

## `height: 100dvh` on a fixed element left a white gap

`dvh` shrinks when a phone's URL bar appears, but a fixed element's containing
block stays the full layout viewport — so the pinned canvas came up short and the
page showed through beneath it. Use `inset: 0`.

## Default raycasting returns the wrong photograph

The vertex shader displaces every vertex onto the sphere, so three.js's raycast
tests the *undisplaced* flat quads. `pickPhotoAt` intersects an analytic sphere
(and the cylinder past the halfway point) instead. See [[The Sphere]].

## `git add -A` swept an agent's scratch harness into a commit

Temporary render harnesses landed in history. Now ignored via `*-lab.*` and
`*-check.html` patterns — but check `git status` before a blanket add.

## Wall-clock gap heuristics misfire on cold loads

See [[The Intro]]. A 400 ms frame-gap guard could not tell "tab was backgrounded"
from "first frame was slow", and broke the animation on every load.

## Verifying in a hidden browser pane is impossible

Much of this was built with the preview pane hidden, which sets
`visibilityState: hidden`, throttles `requestAnimationFrame` to ~2/second,
starves the WebGL render loop, and makes GPU draw calls measure **zero**.
Screenshots time out or return partially-composited frames.

Symptoms look exactly like broken animation code. Several hours went into
chasing phantom bugs before this was diagnosed. **If motion appears frozen,
check `document.visibilityState` before touching the code.**

Workarounds that do work: patching `drawElements*` to count draw calls, asserting
against computed styles, and verifying the maths offline in Node against the real
modules.

Related: [[Architecture]]
