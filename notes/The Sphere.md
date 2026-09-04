---
tags: [sphere, geometry]
---

# The Sphere

162 photographs on a globe, rendered as **one InstancedMesh, one draw call**.

## Tiles are curved patches, not flat cards

The single most important decision. Flat quads tangent to a sphere leave corners
poking through the surface and it reads as a faceted polyhedron. Instead the
**vertex shader projects every vertex onto the sphere radius**, so each tile is a
spherical patch and the silhouette is a true circle.

Everything else — picking, the morph, the intro — had to be built around this,
because three.js's default raycast tests the *undisplaced* geometry and returns
the wrong photograph. See [[Gotchas]].

## Bands, not scatter

The first version used a Fibonacci lattice. Juan rejected it twice as
"clustered". The cause was structural: isotropic cells, but photographs are
rectangles in thirteen aspect ratios, so no single density makes every joint even.

Replaced with **13 latitude courses**, each solved to fill its own parallel:

```
2·Σ(h · aspectᵢ) + n · joint = 2π · sin θ
```

Because it is *solved* rather than approximated, `fill` is 1.000 in every course
and the joint is 8.6 px everywhere.

| | Fibonacci | Bands |
|---|---|---|
| Double-covered | 21.9% | **0.19%** |
| Joints | 0–20 px, ragged | **8.6 px, all** |

Photo counts per course follow circumference: `3 8 12 14 17 19 19 16 18 14 12 7 3`.

**Coverage is not a goal.** An airier sphere with even grout beats a fuller one
with overlap. Never close gaps by growing tiles into each other.

## The 20° tilt

Juan sketched courses rising left-to-right at ~20°. Implemented by tilting the
*polar axis*, never the tiles, so tiles stay square to their band:

```
AXIS_TILT_Z = atan(tan(20°) · cos(AXIS_TILT_X))
```

**The spin axis IS the band axis.** The courses therefore hold still on screen
while photographs travel *along* them. That was the effect the sketch was really
describing, and it falls out of sharing one axis rather than being animated.

## Tonal ordering

The lattice walks north-to-south, so a tile's index *is* its latitude. Sorting by
luminance puts light frames at the top and dark at the bottom — and since the
sphere spins about that same axis, **the gradient holds still while everything
turns**. It reads as light from above.

A *softened* order (luminance + noise) measured worse: it reintroduced the
bright-sky-next-to-near-black clash. Pure sort won.

Related: [[The Morph]] · [[Architecture]]
