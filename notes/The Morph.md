---
tags: [morph, interaction]
---

# The Morph

Scrolling unrolls the globe into a **vertical-axis cylinder, 4 rows tall**, that
scrolls endlessly side to side.

## Why a cylinder

Zoomed into the sphere, photographs fanned at every screen angle — tiles are
tangent to a doubly-curved surface, so their roll varies with position. Juan
photographed it and asked for something more professional.

A flat wall was the first answer. A **cylinder is better**: it has no edges, so
infinite side-to-side scrolling is free rather than faked, and it curves in one
direction only — **so every photograph is upright by construction**.

## Zero roll is exact, not approximate

The ring is built in **view space**, never touching the model matrix. A tile's
vertical edge is written as the view's own Y axis, and a direction perpendicular
to the view axis always projects to a vertical screen line.

Measured worst |roll| across all 162 tiles: **2×10⁻¹⁵ rad**. Machine epsilon.

This also disposes of the 20° tilt without interpolating it: the tilt lives in
the model matrix, the ring term never reads it, so the fan simply unwinds as the
mix crosses over.

## The ripple direction was measured

Tiles do not all move at once — each gets a delay so the globe unspools. The
direction was chosen by measurement, not taste:

| Wave | Peak double-covered area |
|---|---|
| Poles-first | 39.3% |
| No wave | 12.1% |
| **Equator-first** | **3.7%** ← shipped |

The ring is a belt at the globe's waist, so equatorial tiles barely leave the
shell — they slide along it into place.

## Constants

`MORPH_START 0.34` · `MORPH_END 0.8` · ripple amplitude `0.35` ·
`ARC_SWING 0.9` (51.6° of camera swing) · `ARC_LIFT 0.3` (peaks 17.2° mid-morph,
zero at both ends) · `RING_DRIFT 0.4`.

## Rotation composes, it does not switch

The ring keeps drifting at 40% of the globe's speed — about **9 seconds per
photograph**. Crucially the drift lives in `spinScale` and a visitor's drag in
`spin`, and PhotoSphere *adds* them. So dragging rides on top of the drift
rather than replacing it: no "user has taken control" mode to get stuck in.

## Known trade

Mid-morph overlap peaks at **3.7%** — 13 courses folding into 4 rows must
interpenetrate. Every case has enough depth separation to read as one photo
covering another rather than z-fighting.

Related: [[The Sphere]] · [[The Intro]]
