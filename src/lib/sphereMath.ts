/**
 * Layout maths for the photo sphere.
 *
 * Pure numbers — no three.js, no React — so the whole arrangement can be
 * reasoned about (and measured) without a renderer. Everything is deterministic:
 * the same manifest always produces the same sphere.
 */

export type Vec3 = [number, number, number]

/** π(3 − √5). Consecutive golden-angle turns never repeat, so the spiral never
 *  falls into rows — that is what keeps the lattice free of polar clustering. */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export type TileLayoutOptions = {
  /**
   * How much of its own share of the sphere each tile tries to cover.
   *
   * Each tile owns 4π/N steradians. A tile's patch is ~4·w·h steradians, so
   * `fill = 1` would tile the sphere exactly *if* the cells were axis-aligned
   * rectangles of the photo's aspect. They are not — cells are near-hexagonal
   * and photos come in thirteen different aspects — so a rectangle can never
   * sit flush in its cell. Whatever is left over has to go somewhere: either
   * into white showing through, or into photographs lying across each other.
   *
   * Overlap is the more expensive of the two. A photograph cut by its
   * neighbour's edge reads as mess; a sliver of the ice-white page between two
   * photographs reads as grout, and grout is what makes a mosaic look laid
   * rather than piled. So this is deliberately tuned *below* the point where
   * the gaps close. Measured on the real 162-photo manifest at the default
   * tilt (250k sample directions, the same patch test the shader performs):
   *
   *   fill 0.95 → 84% covered, 10% double-covered — airy, but a few cells go
   *                            conspicuously empty and read as a missing photo
   *   fill 1.05 → 89% covered, 15% double-covered  ← default
   *   fill 1.12 → 91% covered, 19% double-covered
   *   fill 1.22 → 94% covered, 25% double-covered — gaps nearly closed, and
   *                            the surface goes back to reading as a pile
   *
   * The 11% that is not covered is grout, not holes: no sample direction on
   * the sphere is further than 0.067 rad from a photograph — about a quarter
   * of a tile — so the white arrives as joints between frames, never as a
   * blotch, and the silhouette still reads as a clean circle.
   */
  fill: number
  /**
   * ±fraction of size variation per tile, from a seeded RNG.
   *
   * The photographs are already many different shapes; this is only there so
   * that two neighbours of the same aspect are not identical twins. Kept
   * gentle on purpose — at ±0.10 the joints between courses visibly widen and
   * narrow, which is the same visual noise the tilt used to add.
   */
  sizeJitter: number
  /**
   * Maximum tile tilt away from the local horizon, radians. Off by default.
   *
   * Tiles can be nudged toward the direction in which their neighbours are
   * furthest away, which lets a 3:2 photo lie along the roomy axis of its
   * cell. Geometrically it is nearly free — at fill 1.05, allowing 6° of tilt
   * moves coverage 88.5% → 90% and double-coverage 14.6% → 13%.
   *
   * It is still set to zero, because the numbers were measuring the wrong
   * thing. Every tile getting its own angle is what made the surface read as
   * confetti: a dozen competing horizons in one glance, with no two edges
   * parallel. With the tilt off, tiles line up on the local horizon, the
   * courses read as courses, and the object reads as a woven globe. The one
   * or two percent of coverage that costs is bought back with `fill` instead.
   */
  maxTilt: number
  /** Neighbours consulted when estimating the roomy axis. 6 ≈ one hex ring. */
  alignNeighbours: number
  /** Seed for size jitter and per-tile relief. */
  seed: number
}

/** The tunables. Change these to retune the surface. */
export const TILE_LAYOUT_DEFAULTS: TileLayoutOptions = {
  fill: 1.05,
  sizeJitter: 0.06,
  maxTilt: 0,
  alignNeighbours: 6,
  seed: 1337,
}

/** Hard ceiling on a half-extent. The vertex shader takes tan(θ), so θ must stay
 *  well clear of π/2. Real values top out near 0.37 rad; this is a guard rail. */
const MAX_HALF_EXTENT = 0.6

export type TileLayout = {
  count: number
  /** Unit direction of each tile's centre. 3 floats per tile. */
  centers: Float32Array
  /** Angular half-extents (radians) along the tile's own u then v axis. 2 per tile. */
  sizes: Float32Array
  /** Tile rotation within its tangent plane, radians. 1 per tile. */
  rotations: Float32Array
  /** Per-tile random in [0,1). 1 per tile. */
  seeds: Float32Array
}

/** mulberry32 — small, fast, and identical across engines. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Golden-angle (Fibonacci) lattice of `n` unit vectors.
 *
 * y is stepped uniformly because the cylindrical projection of a sphere is
 * area-preserving: equal steps in y are equal steps in area, so the points come
 * out near-uniform with no crowding at the poles. The half-step (2i+1)/n keeps
 * the first and last points off the poles themselves.
 */
export function fibonacciSphere(n: number): Float32Array {
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = i * GOLDEN_ANGLE
    out[i * 3] = r * Math.cos(theta)
    out[i * 3 + 1] = y
    out[i * 3 + 2] = r * Math.sin(theta)
  }
  return out
}

/**
 * Orthonormal tangent frame at a point on the unit sphere.
 *
 * The `ref` swap is the pole guard: cross(up, c) collapses when c is parallel to
 * up, so near the poles we pick a different reference axis. (t, b, c) is
 * right-handed with c pointing outward, which is what makes the tiles' front
 * faces point away from the sphere's centre.
 */
export function tangentBasis(c: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  const ref: Vec3 = Math.abs(c[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0]
  const tx = ref[1] * c[2] - ref[2] * c[1]
  const ty = ref[2] * c[0] - ref[0] * c[2]
  const tz = ref[0] * c[1] - ref[1] * c[0]
  const tl = Math.hypot(tx, ty, tz) || 1
  const tangent: Vec3 = [tx / tl, ty / tl, tz / tl]
  const bitangent: Vec3 = [
    c[1] * tangent[2] - c[2] * tangent[1],
    c[2] * tangent[0] - c[0] * tangent[2],
    c[0] * tangent[1] - c[1] * tangent[0],
  ]
  return { tangent, bitangent }
}

/** Offset of `q` from `c` expressed in the tangent frame, in radians. */
function tangentOffset(
  c: Vec3,
  t: Vec3,
  b: Vec3,
  q: Vec3,
): { u: number; v: number; angle: number } {
  const d = Math.min(1, Math.max(-1, c[0] * q[0] + c[1] * q[1] + c[2] * q[2]))
  const angle = Math.acos(d)
  let dx = q[0] - c[0] * d
  let dy = q[1] - c[1] * d
  let dz = q[2] - c[2] * d
  const l = Math.hypot(dx, dy, dz)
  if (l < 1e-9) return { u: 0, v: 0, angle }
  dx /= l
  dy /= l
  dz /= l
  return {
    u: angle * (dx * t[0] + dy * t[1] + dz * t[2]),
    v: angle * (dx * b[0] + dy * b[1] + dz * b[2]),
    angle,
  }
}

/** Fold an axis angle (mod π) into (−π/2, π/2]. */
function foldAxisAngle(a: number): number {
  const half = Math.PI / 2
  return (((a + half) % Math.PI) + Math.PI) % Math.PI - half
}

/**
 * Place one tile per photo on the sphere.
 *
 * @param aspects width/height of each photo, in the order they should be placed.
 */
export function layoutTiles(
  aspects: readonly number[],
  options: Partial<TileLayoutOptions> = {},
): TileLayout {
  const { fill, sizeJitter, maxTilt, alignNeighbours, seed } = {
    ...TILE_LAYOUT_DEFAULTS,
    ...options,
  }
  const n = aspects.length
  const centers = fibonacciSphere(n)
  const sizes = new Float32Array(n * 2)
  const rotations = new Float32Array(n)
  const seeds = new Float32Array(n)

  const rng = makeRng(seed)
  for (let i = 0; i < n; i++) seeds[i] = rng()

  const at = (i: number): Vec3 => [centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]]

  // Each tile's fair share of the sphere.
  const cellSolidAngle = (4 * Math.PI) / n

  // Nearest neighbours, brute force. n = 162, so this is ~26k dot products.
  // The only thing they feed is the rotation nudge, so with the tilt off the
  // whole search is skipped rather than computed and thrown away.
  const neighbourIdx: number[][] = []
  if (maxTilt > 0) {
    for (let i = 0; i < n; i++) {
      const ci = at(i)
      const ranked: Array<[number, number]> = []
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const cj = at(j)
        const d = ci[0] * cj[0] + ci[1] * cj[1] + ci[2] * cj[2]
        ranked.push([j, -d]) // larger dot = closer, so sort by -d ascending
      }
      ranked.sort((p, q) => p[1] - q[1])
      neighbourIdx.push(ranked.slice(0, alignNeighbours).map(([j]) => j))
    }
  }

  for (let i = 0; i < n; i++) {
    const c = at(i)
    const aspect = aspects[i] > 0 ? aspects[i] : 1

    // --- rotation -----------------------------------------------------------
    // Zero means the tile's own u axis is the local east and its v axis the
    // local north: every photograph sits square on the horizon of the sphere,
    // which is what makes the courses read as courses.
    if (maxTilt > 0) {
      const { tangent, bitangent } = tangentBasis(c)
      // Neighbour directions are axes, not vectors (a neighbour at φ and one at
      // φ+π constrain the same axis), so average them in doubled-angle space:
      // Σ d²·(cos2φ, sin2φ). Half the resulting angle is the direction in which
      // neighbours sit furthest away — the roomy axis of this tile's cell.
      let sx = 0
      let sy = 0
      for (const j of neighbourIdx[i]) {
        const { u, v, angle } = tangentOffset(c, tangent, bitangent, at(j))
        const phi = Math.atan2(v, u)
        const weight = angle * angle
        sx += weight * Math.cos(2 * phi)
        sy += weight * Math.sin(2 * phi)
      }
      let rot = 0.5 * Math.atan2(sy, sx)
      // A portrait wants its *height* along the roomy axis, so turn it a
      // quarter — but only when the budget can actually express a quarter
      // turn. Under a tight clamp the turn would just saturate, leaning every
      // portrait the same way for no reason; upright is the better default.
      if (aspect < 1 && maxTilt >= Math.PI / 4) rot += Math.PI / 2
      rot = foldAxisAngle(rot)
      // Clamp: the alignment is only ever a nudge. Photos stay near the local
      // horizon so the surface reads as laid rather than thrown.
      rotations[i] = Math.max(-maxTilt, Math.min(maxTilt, rot))
    }

    // --- size ---------------------------------------------------------------
    // Native aspect is non-negotiable, so only one degree of freedom is left.
    // patch ≈ (2w)(2h) = 4h²·aspect steradians  ⇒  h = √(share·fill / 4a).
    const jitter = 1 + (seeds[i] * 2 - 1) * sizeJitter
    const h = Math.sqrt((cellSolidAngle * fill) / (4 * aspect)) * jitter
    sizes[i * 2] = Math.min(MAX_HALF_EXTENT, h * aspect)
    sizes[i * 2 + 1] = Math.min(MAX_HALF_EXTENT, h)
  }

  return { count: n, centers, sizes, rotations, seeds }
}

/**
 * Deterministic Fisher–Yates shuffle of an index list.
 *
 * The manifest is in filename order, which clusters aspects and tones. Mixing
 * the assignment spreads portraits, panoramas and dark frames evenly over the
 * surface. Pass seed 0 to keep the manifest order.
 */
export function shuffledIndices(n: number, seed: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  if (seed === 0) return idx
  const rng = makeRng(seed)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = idx[i]
    idx[i] = idx[j]
    idx[j] = tmp
  }
  return idx
}

/**
 * Order the photographs light-to-dark, so that the lattice lays them out as a
 * tone rather than as a scatter.
 *
 * {@link fibonacciSphere} walks y from +1 down to −1, so lattice index *is*
 * latitude: index 0 is the north pole and index n−1 the south. Handing it a
 * list sorted by brightness therefore puts the bright frames at the top of the
 * globe and the dark ones underneath, and — because the sphere spins about
 * that same axis — the gradient stays put while everything else turns.
 *
 * That is worth more than it sounds. Randomly assigned, a near-black frame
 * lands next to a blown-out sky and the eye reads the surface as noise; the
 * photographs fight each other instead of adding up. Sorted, neighbours relate,
 * the globe picks up a light-from-above shading that reinforces its roundness,
 * and nothing about any individual photograph is altered to get it.
 *
 * `tiebreak` is applied before the sort and survives it (the sort is stable),
 * which keeps frames of equal tone off the filename order they arrived in.
 */
export function tonalOrder(
  luminances: readonly number[],
  tiebreak: readonly number[] = [],
): number[] {
  const order = tiebreak.length === luminances.length
    ? tiebreak.slice()
    : Array.from({ length: luminances.length }, (_, i) => i)
  return order.sort((a, b) => luminances[b] - luminances[a])
}

/**
 * Relative luminance of a `#rrggbb` colour, 0–1. Rec. 709 coefficients, on the
 * sRGB values as stored — this is used only to *rank* photographs against each
 * other, never to change how one is drawn.
 */
export function hexLuminance(hex: string): number {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  if (!Number.isFinite(n)) return 0.5
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Camera distance that makes a sphere of `radius` span `fraction` of the
 * viewport's *smaller* side.
 *
 * The silhouette of a sphere seen from distance D has angular radius
 * β = asin(R/D), and a point at angle β lands at tan(β)/tan(fov/2) of the
 * half-viewport. Invert that. Using the smaller side keeps the framing stable
 * when the window goes tall and narrow.
 */
export function distanceForViewportFraction(
  radius: number,
  fovYDegrees: number,
  viewportWidth: number,
  viewportHeight: number,
  fraction: number,
): number {
  const minSide = Math.min(viewportWidth, viewportHeight)
  // The span we want, re-expressed as a fraction of the viewport *height*,
  // because the vertical FOV is what the projection is defined by.
  const spanOfHeight = (minSide * fraction) / Math.max(1, viewportHeight)
  const tanHalfFov = Math.tan((fovYDegrees * Math.PI) / 360)
  const tanBeta = Math.max(1e-4, spanOfHeight * tanHalfFov)
  const sinBeta = Math.min(0.98, tanBeta / Math.sqrt(1 + tanBeta * tanBeta))
  return radius / sinBeta
}
