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

/**
 * Which arrangement the sphere is laid out with.
 *
 * `fibonacci` — one golden-angle spiral, tiles sized to their share of the
 * sphere. Isotropic, seamless, organic; joints are whatever is left over.
 *
 * `bands` — horizontal courses of constant latitude, each solved to fill its
 * own circumference exactly, so the joint is designed rather than residual.
 *
 * See the comparison in {@link BAND_LAYOUT_DEFAULTS} for why the default is
 * what it is. Changing this line changes the whole surface.
 */
export type LayoutMode = 'fibonacci' | 'bands'

/** The shipped arrangement. */
export const LAYOUT: LayoutMode = 'bands'

export type TileLayoutOptions = {
  /** Which arrangement to build. Defaults to {@link LAYOUT}. */
  layout: LayoutMode
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
  layout: LAYOUT,
  fill: 1.05,
  sizeJitter: 0.06,
  maxTilt: 0,
  alignNeighbours: 6,
  seed: 1337,
}

/** Tunables for the `bands` arrangement. See {@link BAND_LAYOUT_DEFAULTS}. */
export type BandLayoutOptions = {
  /**
   * The grout, in radians of arc. The same number between two frames in a
   * course and between two courses, so the white reads as one grid rather than
   * as two.
   *
   * This is the whole point of the arrangement. A course is solved to fill its
   * own circumference, so what is left between two photographs is a width that
   * was chosen rather than whatever a lattice happened to leave over. At the
   * shipped radius one radian of arc is about 306 px, so 0.026 is an eight-pixel
   * joint at the middle of the disc.
   */
  joint: number
  /** Longitude offset of alternate courses, in mean tile widths. 0.5 is a
   *  running bond: no vertical joint ever lines up with the one above it. */
  bond: number
  /** Deterministic wobble on that offset, same units. Keeps the bond from
   *  reading as a repeat when six courses are visible at once. */
  bondJitter: number
  /** Fewest tiles in a course, so the courses nearest the poles still read as
   *  courses rather than as two or three lonely frames around the axis. */
  minPerBand: number
  /**
   * Which parallel a course is solved to fill: 0 its centre line, 1 the edge
   * nearer the pole.
   *
   * A course is a band of latitude, and the parallel along its pole-facing edge
   * is shorter than the one through its middle — by h·cot θ, which is nothing
   * at the equator and everything near the pole. So tiles sized to fill the
   * middle exactly have a little less room than they need at that edge, and two
   * neighbours can graze each other at the corner nearest the pole.
   *
   * Measured at joint 0.024, over the whole sphere and over the part of it the
   * camera can actually reach:
   *
   *   0.0  82.5% covered, 0.24% double  (on screen 83.0% / 0.21%)  ← default
   *   0.5  79%   covered, 0.00% double, but the joint stops being one number:
   *        the slack that buys the guarantee is spread along each course, and
   *        the polar courses end up with 25px joints against the equator's 7px
   *   1.0  76%   covered, 0.00% double, and worse on the same count
   *
   * So 0 it is. The quarter of a percent that overlaps is corner grazing in the
   * three courses closest to each pole, and those sit within a few degrees of
   * the silhouette where a tile is a couple of pixels tall. Buying it out costs
   * the one thing the arrangement exists for — a joint that is the same width
   * everywhere.
   */
  edgeFit: number
  /**
   * `uniform` gives every tile in a course the same height and lets the widths
   * follow each photo's aspect, so a course's top and bottom are two clean
   * parallels and every joint along it is identical.
   *
   * `tallest` gives every tile the same width and lets the heights follow the
   * aspect, with the course as tall as its squarest photograph. The loss is not
   * grout — it is a ragged strip of white above and below every frame that is
   * not the tallest, which is exactly the missing-photo look the courses were
   * meant to remove. Kept only so the comparison is reproducible.
   */
  heightMode: 'uniform' | 'tallest'
  /** Seed for the bond wobble and the within-course shuffle. */
  seed: number
}

/**
 * Tunables for the band arrangement.
 *
 * Measured on the real 162-photo manifest, 250k sample directions, against the
 * `fibonacci` lattice this replaced (fill 1.05):
 *
 *   fibonacci  88.6% covered, 14.58% double-covered, joints 0 to 20 px
 *   bands      82.5% covered,  0.24% double-covered, every joint 7.3 px
 *
 * The bands cover less and that is the whole point. The six points the lattice
 * had over them were bought by letting photographs lie across one another —
 * fifteen percent of the sphere was one frame cutting through another. Here
 * that number is a quarter of a percent, all of it corner grazing in the
 * courses nearest the poles, which the framing keeps behind the silhouette.
 */
export const BAND_LAYOUT_DEFAULTS: BandLayoutOptions = {
  joint: 0.024,
  bond: 0.5,
  bondJitter: 0.18,
  minPerBand: 4,
  edgeFit: 0,
  heightMode: 'uniform',
  seed: 1337,
}

/** Overrides accepted by {@link layoutTiles}; `bands` nests its own partial. */
export type TileLayoutOverrides = Partial<TileLayoutOptions> & {
  bands?: Partial<BandLayoutOptions>
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
  options: TileLayoutOverrides = {},
): TileLayout {
  const mode = options.layout ?? TILE_LAYOUT_DEFAULTS.layout
  return mode === 'bands'
    ? layoutBandTiles(aspects, { ...BAND_LAYOUT_DEFAULTS, ...options.bands })
    : layoutFibonacciTiles(aspects, options)
}

function layoutFibonacciTiles(
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

/* ── Latitude bands ─────────────────────────────────────────────────────────
   Brickwork on a globe. Instead of scattering tiles and hoping the leftovers
   look like grout, the sphere is cut into horizontal courses and each course is
   solved to fill its own circumference exactly: sum of tile widths, plus one
   joint per tile, equals 2π·sin θ. The joint stops being an accident.        */

/** One course. `theta` is the colatitude of its centre line, `h` the angular
 *  half-height shared by every tile in it. */
export type Band = {
  /** Index of this course's first photo in the placement order. */
  start: number
  count: number
  theta: number
  h: number
}

export type BandPlan = {
  bands: Band[]
  /** Grout, radians of arc. Along a course and between courses alike. */
  joint: number
  /** Colatitude of the small white disc left at each pole. See {@link planBands}. */
  capGap: number
  /** How many courses the sphere ended up with. */
  bandCount: number
}

/**
 * Largest-remainder apportionment: hands out `total` whole items in proportion
 * to `weights`, and the result always sums to `total` exactly. Rounding each
 * share independently does not, and a photo lost to rounding is a hole.
 */
function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const exact = weights.map((w) => (total * w) / sum)
  const counts = exact.map((x) => Math.floor(x))
  const order = exact
    .map((x, i): [number, number] => [i, x - Math.floor(x)])
    .sort((a, b) => b[1] - a[1])
  let left = total - counts.reduce((a, b) => a + b, 0)
  for (let k = 0; left > 0; k++, left--) counts[order[k % order.length][0]] += 1
  return counts
}

/**
 * Fit `bandCount` courses of one shared tile height onto the sphere.
 *
 * Everything follows from that one height. The course pitch is 2h + joint, so
 * the courses are evenly spaced by construction — which is the thing the eye
 * actually reads on a globe. What each course can *hold* is then fixed: at
 * colatitude θ a course has 2π·sin θ of arc, the photographs in it are h·aspect
 * wide, and they each need a joint. So the count per course falls out of the
 * circumference and the height falls out of the count, and the two are settled
 * against each other by a few passes.
 *
 * `capacity` is measured at the parallel `edgeFit` selects, not at the course's
 * centre line. That is the whole no-overlap guarantee: a course is never asked
 * to hold more than its *shortest* parallel can take, so two frames cannot
 * cross at the corner nearest the pole.
 */
function fitStack(
  aspects: readonly number[],
  bandCount: number,
  options: BandLayoutOptions,
): { theta: number[]; h: number[]; counts: number[]; starts: number[]; capGap: number } | null {
  const n = aspects.length
  if (options.minPerBand * bandCount > n) return null

  // Running sum of aspects. A course is a contiguous slice of the placement
  // order, so the total width of everything in it is one subtraction.
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + (aspects[i] > 0 ? aspects[i] : 1)

  /** Arc a course consumes per unit of tile height, joints excluded. */
  const widthPerHeight = (k: number, counts: readonly number[]): number => {
    let start = 0
    for (let i = 0; i < k; i++) start += counts[i]
    const end = start + counts[k]
    if (options.heightMode === 'uniform') return 2 * (prefix[end] - prefix[start])
    let min = Number.POSITIVE_INFINITY
    for (let i = start; i < end; i++) {
      const a = aspects[i] > 0 ? aspects[i] : 1
      if (a < min) min = a
    }
    return 2 * counts[k] * (Number.isFinite(min) ? min : 1)
  }

  const theta: number[] = []
  const h: number[] = []
  for (let k = 0; k < bandCount; k++) {
    theta.push(((k + 0.5) * Math.PI) / bandCount)
    h.push(Math.PI / (4 * bandCount))
  }
  let counts = apportion(n, theta.map((t) => Math.sin(t)))
  let capGap = 0

  /** Tile height that makes course `k` fill its parallel exactly. */
  const heightOf = (k: number, cs: readonly number[]): number => {
    const toward = theta[k] < Math.PI / 2 ? -1 : 1
    const fit = theta[k] + toward * options.edgeFit * h[k]
    const circumference =
      2 * Math.PI * Math.sin(Math.max(1e-4, Math.min(Math.PI - 1e-4, fit)))
    return Math.max(
      1e-4,
      (circumference - cs[k] * options.joint) / Math.max(1e-6, widthPerHeight(k, cs)),
    )
  }

  for (let pass = 0; pass < 80; pass++) {
    for (let k = 0; k < bandCount; k++) {
      // `fit` moves with h, so step halfway to stop it ringing near the poles.
      h[k] = 0.5 * h[k] + 0.5 * heightOf(k, counts)
    }
    let stacked = 0
    for (const hk of h) stacked += 2 * hk
    capGap = (Math.PI - stacked - (bandCount - 1) * options.joint) / 2
    if (capGap < -1e-9) return null
    let t = capGap
    for (let k = 0; k < bandCount; k++) {
      theta[k] = t + h[k]
      t += 2 * h[k] + options.joint
    }

    // Even out the course heights. Each course is exactly full at the joint it
    // was given, so the only thing left that can vary is how *tall* it is: a
    // course that drew four panoramas is wider per photograph and so ends up
    // shorter than its neighbours. Sliding the boundary between two courses
    // trades one photograph between them, which evens the two heights without
    // moving a photograph out of the tonal order — the courses are contiguous
    // slices of it, so the boundary is all there is to move.
    for (let sweep = 0; sweep < 200; sweep++) {
      let changed = false
      for (let k = 0; k < bandCount - 1; k++) {
        const before = Math.abs(heightOf(k, counts) - heightOf(k + 1, counts))
        for (const step of [1, -1]) {
          const from = step === 1 ? k : k + 1
          if (counts[from] <= options.minPerBand) continue
          counts[k] -= step
          counts[k + 1] += step
          if (Math.abs(heightOf(k, counts) - heightOf(k + 1, counts)) < before - 1e-12) {
            changed = true
            break
          }
          counts[k] += step
          counts[k + 1] -= step
        }
      }
      if (!changed) break
    }
  }

  const starts: number[] = []
  let cursor = 0
  for (const count of counts) {
    starts.push(cursor)
    cursor += count
  }
  return { theta, h, counts, starts, capGap: Math.max(0, capGap) }
}

/**
 * Lay the photographs out in courses.
 *
 * Brickwork on a globe. The sphere is cut into evenly spaced bands of latitude
 * and each band is filled with whole photographs at their native aspects,
 * separated by a joint of a chosen width. No photograph is ever sized to its
 * "share" of the sphere and then left to sort out the difference with its
 * neighbours, so no two photographs lie across each other anywhere.
 *
 * The course count is chosen, not assumed: every count from a dozen or so down
 * is fitted, and the one that lets the photographs be *largest* wins. Fewer
 * courses means taller tiles but more of them crowded into each ring; more
 * courses means shorter tiles with room to spare. The optimum is a real one and
 * it moves with the photo count, the joint, and the mix of aspect ratios.
 *
 * What is left over becomes a small white disc at each pole — the one place a
 * band arrangement cannot tile, since a rectangle has corners and a pole does
 * not. At the shipped framing the poles sit a few degrees *behind* the
 * silhouette, so that disc is never in view; {@link BandPlan.capGap} is how
 * much margin there is before it would be.
 */
export function planBands(
  aspects: readonly number[],
  options: BandLayoutOptions = BAND_LAYOUT_DEFAULTS,
): BandPlan {
  const n = aspects.length
  const aspectSum = aspects.reduce((a, x) => a + (x > 0 ? x : 1), 0)

  // Upper bound on the search. Photographs alone would fill the sphere at
  // h = √(π/Σa) — a tile of half-height h and aspect a covers 4·a·h² steradians
  // — and the joint only makes the courses taller, so no more courses than that
  // can ever fit.
  const bareHeight = Math.sqrt(Math.PI / Math.max(1e-6, aspectSum))
  const ceiling = Math.max(4, Math.round(Math.PI / (2 * bareHeight)) + 4)

  let best: ReturnType<typeof fitStack> = null
  let bestCount = 3
  for (let b = ceiling; b >= 3; b--) {
    const trial = fitStack(aspects, b, options)
    if (!trial) continue
    if (!best || trial.capGap < best.capGap) {
      best = trial
      bestCount = b
    }
  }
  const solved = best ?? {
    theta: [Math.PI / 2],
    h: [0.1],
    counts: [n],
    starts: [0],
    capGap: 0,
  }

  const bands: Band[] = solved.counts.map((count, k) => ({
    start: solved.starts[k],
    count,
    theta: solved.theta[k],
    h: solved.h[k],
  }))
  return { bands, joint: options.joint, capGap: solved.capGap, bandCount: bestCount }
}

function layoutBandTiles(
  aspects: readonly number[],
  options: BandLayoutOptions,
): TileLayout {
  const n = aspects.length
  const centers = new Float32Array(n * 3)
  const sizes = new Float32Array(n * 2)
  const rotations = new Float32Array(n)
  const seeds = new Float32Array(n)

  const rng = makeRng(options.seed)
  for (let i = 0; i < n; i++) seeds[i] = rng()

  const plan = planBands(aspects, options)

  for (let k = 0; k < plan.bands.length; k++) {
    const band = plan.bands[k]
    const { start, count, theta, h } = band
    if (count === 0) continue

    // Order within a course. The slice arrives sorted by tone, which also means
    // sorted by whatever the shoot happened to be — so the panoramas and the
    // portraits arrive in clumps. A seeded shuffle inside the course spreads
    // the shapes without moving a single photograph out of its tonal band.
    const order = shuffledIndices(count, options.seed + k * 7919).map((j) => start + j)

    // `uniform`: one height, widths follow each photo's aspect.
    // `tallest`:  one width, set by the course's squarest photo, heights follow.
    let minAspect = Number.POSITIVE_INFINITY
    for (const i of order) {
      const a = aspects[i] > 0 ? aspects[i] : 1
      if (a < minAspect) minAspect = a
    }
    if (!Number.isFinite(minAspect)) minAspect = 1
    const widths = order.map((i) => {
      const a = aspects[i] > 0 ? aspects[i] : 1
      return options.heightMode === 'uniform' ? h * a : h * minAspect
    })
    let arc = 0
    for (const w of widths) arc += 2 * w
    arc += count * plan.joint

    // Longitude is handed out in proportion to arc, normalised so the ring
    // closes on itself exactly. Anything the solver could not spend — the slack
    // that `edgeFit` leaves along a course's equator-facing edge — comes back
    // here as extra longitude per joint, spread evenly over every joint in the
    // course. The remainder widens the grout; it never lets a frame overrun.
    const perArc = (2 * Math.PI) / Math.max(1e-6, arc)

    // Running bond, so no vertical joint sits above another. The wobble is
    // there because five courses of perfect half-offset start to read as a
    // pattern rather than as masonry.
    const meanTile = (2 * Math.PI) / count
    const wobble = options.bondJitter * (rng() * 2 - 1)
    const lambda0 = (options.bond * (k % 2) + wobble) * meanTile

    let cum = 0
    for (let t = 0; t < order.length; t++) {
      const i = order[t]
      const w = widths[t]
      const lambda = lambda0 + perArc * (cum + w + plan.joint / 2)
      cum += 2 * w + plan.joint

      const sinT = Math.sin(theta)
      centers[i * 3] = sinT * Math.cos(lambda)
      centers[i * 3 + 1] = Math.cos(theta)
      centers[i * 3 + 2] = sinT * Math.sin(lambda)

      // Height follows the width for `tallest`, so those tiles keep their aspect
      // and leave the course's slack above and below them.
      const a = aspects[i] > 0 ? aspects[i] : 1
      const tileH = options.heightMode === 'uniform' ? h : w / a
      sizes[i * 2] = Math.min(MAX_HALF_EXTENT, w)
      sizes[i * 2 + 1] = Math.min(MAX_HALF_EXTENT, tileH)
      // Every tile square on the local horizon: that is what makes a course
      // read as a course.
      rotations[i] = 0
    }
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
