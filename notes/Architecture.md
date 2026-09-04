---
tags: [moc, architecture]
---

# Architecture

Map of content for juannavarro.eu. Structure lives in the graphify graph;
these notes hold the *reasoning* — the things you cannot read off the code.

## The pieces

- [[The Sphere]] — 162 photographs as one instanced mesh
- [[The Morph]] — globe unrolling into a scrolling cylinder
- [[The Intro]] — the one-shot composition on page load
- [[Asset Pipeline]] — 1.2 GB of originals to a 1.8 MB atlas
- [[Contact and Deploy]] — the form, Vercel, the domain
- [[Gotchas]] — bugs that cost real time, and why

## Shape of it

```
Landing  ──> SphereStage ──> PhotoSphere (1 InstancedMesh, 1 draw call)
   │                              ▲
   │                              │ reads every frame
   └──> ScrollChoreography ──> sphereDrive   ← the seam
```

`sphereDrive` is a plain mutable object. The choreography writes to it; the
sphere reads it in `useFrame`. React never re-renders for motion. The graph
confirms the separation held: there is no directed path from
`scrollChoreography.ts` to `shaders.ts`.

## Stack

Vite · React 19 · TypeScript · three r185 · @react-three/fiber v9 ·
React Router 7. No animation library — every easing is hand-written.
