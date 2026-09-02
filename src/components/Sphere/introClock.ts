/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE LANDING COMPOSITION — the one motion here that is not scroll-scrubbed
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything else about this sphere is an absolute function of scroll position,
 * and therefore reversible: scroll down and the globe opens into a ring, scroll
 * back up and it closes again, frame for frame. This is the opposite of that,
 * and the two must never be confused for one another.
 *
 * The composition runs on its own clock from the moment the sphere is first
 * drawn, finishes on its own, and then does not exist:
 *
 *   ONCE.     The clock is MODULE state, not component state. It survives an
 *             unmount, a route change and a remount, so /info → / finds it
 *             already spent and shows the resting globe. Only a genuine page
 *             load — which evaluates this module again — starts it over.
 *             Scrolling back to the top later can never replay it, because
 *             nothing here reads scroll position at all.
 *
 *   YIELDS.   The visitor is never waited for. The instant the scroll or a drag
 *             moves the drive off its resting values, the composition runs out
 *             its remainder over {@link INTRO_YIELD_SECONDS} instead of
 *             {@link INTRO_SECONDS} and is gone. It is always monotonic — it
 *             never reverses, never pauses and never snaps — and it never
 *             touches the drive, so there is nothing for the choreography to
 *             fight with.
 *
 *   OFF.      Under prefers-reduced-motion the caller calls {@link skipIntro}
 *             before the first frame and the assembled globe is simply there.
 *             This is unprompted motion, so it is removed rather than shortened.
 *
 * The gesture itself is quiet: the shell starts a little wider than it ends,
 * every tile pushed out along its own normal by {@link INTRO_LIFT} (scattered
 * per tile), somewhat transparent, and draws in to exactly where the layout puts
 * it while the idle spin decelerates out of a faster start. A wave runs from the
 * globe's waist out to both poles, so it composes course by course rather than
 * all at once.
 *
 * Radial, and deliberately so — the same argument `morphRadial` makes in
 * shaders.ts. Moving a tile along its own normal cannot change which tile is
 * beside which and cannot open or close a joint, so the signed-off banded layout
 * with its even 8.6px joints is arrived at exactly, not approached.
 *
 * The three functions in the middle of this file are line-for-line mirrors of
 * the GLSL in shaders.ts, in the same way sphereMath.ts mirrors the morph. They
 * are what lets the composition be measured without a renderer.
 *
 * Nothing in here imports anything. That is on purpose: it is what lets the
 * once-per-page-load guarantee be driven directly, from Node, without React,
 * three.js or a DOM.
 */

/* ── Tunables ───────────────────────────────────────────────────────────────
   The whole gesture is these nine numbers. INTRO_LIFT and INTRO_SECONDS are the
   two that decide whether it reads as restrained or as a showreel; the rest
   shape it.                                                                  */

/** How long the composition takes, seconds, when nobody interrupts it. */
export const INTRO_SECONDS = 1.6

/**
 * How long it takes to run out its remainder once the visitor has taken over.
 *
 * Short enough to be out of the way before the scroll has done anything the eye
 * can read, long enough not to be a snap. Well under {@link INTRO_SECONDS}, so
 * yielding can only ever speed the composition up.
 */
export const INTRO_YIELD_SECONDS = 0.25

/**
 * How far outside the shell a tile starts, world units against SPHERE_RADIUS 1,
 * before the per-tile scatter widens it to 0.7–1.3× of this.
 *
 * Sub-tile, on the same argument MORPH_BLOOM makes: the globe should look like
 * it loosens, not like it assembles out of debris. A course is 0.209 world tall
 * on average, so 0.12 moves a typical tile 0.57 of its own height and the widest
 * excursion in the set 0.75 of one — measured, not guessed. On screen the
 * silhouette is about 16% wider at the first frame than at the last, and it has
 * given most of that back before the canvas has finished its own 700ms fade.
 *
 * This is the taste knob. Raise it and the globe visibly gathers; past about
 * 0.2 the tiles start reading as separate objects flying in.
 */
export const INTRO_LIFT = 0.12

/**
 * The head start the equator gets over the poles, in composition-progress units.
 *
 * The same quantity, the same units and the same direction as MORPH_RIPPLE — a
 * tile's delay is proportional to how near the poles it is, so the wave begins
 * at the waist and runs outward. The courses are the sphere's parallels, so what
 * the eye reads is the globe filling in band by band along its own tilted axis.
 */
export const INTRO_RIPPLE = 0.35

/**
 * Per-tile random delay on top of that, in the same units.
 *
 * The ripple alone staggers thirteen courses; this staggers the 162. Small, so
 * that a course still arrives as a course rather than dissolving into noise.
 */
export const INTRO_JITTER = 0.12

/** A tile's opacity at the moment it is furthest out. It fades to exactly 1 as
 *  it lands. Not zero: the globe should be present from the first frame, only
 *  not yet settled. */
export const INTRO_ALPHA = 0.55

/**
 * Extra multiples of SPIN_SPEED the idle spin carries at the first frame,
 * decaying to none by the last.
 *
 * At 5 the globe turns about 15° over the whole composition against the 4° it
 * would have drifted anyway — plainly a deceleration, nowhere near a spin.
 */
export const INTRO_SPIN_BOOST = 5

/**
 * A gap in drawn frames longer than this completes the composition instead of
 * resuming it, seconds.
 *
 * The reason it exists: rendering stops when the sphere unmounts and when the
 * tab is backgrounded, and coming back to a half-composed globe that then
 * finishes would read as exactly the replay this must never do. Comfortably
 * longer than a dropped frame or React StrictMode's synchronous double mount,
 * both of which must be allowed to carry on.
 */
export const INTRO_GAP_SECONDS = 0.4

/**
 * How far a drive value must move off its resting reading before the visitor
 * counts as having taken over.
 *
 * At scroll 0 with no drag the choreography writes distanceScale 1 and spin,
 * tilt and flatten 0 exactly, so in principle any deviation at all is the
 * visitor. The epsilon is there so that a damped value settling back through
 * the last thousandth of its range cannot hold the composition open.
 */
export const INTRO_YIELD_EPSILON = 0.002

/** Longest frame the clock will accept, seconds. The same clamp the ambient
 *  spin uses, and for the same reason: a slow first frame — shader compile,
 *  texture upload — must not swallow the animation it is meant to introduce. */
export const INTRO_MAX_FRAME_SECONDS = 0.1

/* ── The maths ──────────────────────────────────────────────────────────────
   Mirrors of the GLSL in shaders.ts, function for function. If one of these and
   its twin over there ever disagree the composition will not land on the
   layout, which is the one thing it is not allowed to do.                     */

/** Smootherstep: zero velocity *and* zero acceleration at both ends, so a tile
 *  accelerates off its start and decelerates into its slot with no overshoot.
 *  Identical to `morphEase` in shaders.ts, which is what the GLSL calls. */
export function introEase(l: number): number {
  return l * l * l * (l * (l * 6 - 15) + 10)
}

/**
 * The composition's own clock, for one tile.
 *
 * @param remaining how much of the composition is still to come: 1 at the first
 *                  frame of a page load, 0 once the globe has settled.
 * @param ripple    head start given to the equator, progress units.
 * @param jitter    per-tile random delay, progress units.
 * @param centerY   the tile centre's Y in the sphere's own frame, [-1, 1].
 * @param seed      the tile's own random, [0, 1).
 *
 * The latest-starting tile is delayed by `ripple + jitter`, so the span is
 * shortened by the same amount and *every* tile reaches 1 by the time
 * `remaining` reaches 0. Nothing is left in flight at the end.
 */
export function introLocal(
  remaining: number,
  ripple: number,
  jitter: number,
  centerY: number,
  seed: number,
): number {
  const t = 1 - remaining
  const delay = ripple * Math.abs(centerY) + jitter * seed
  const l = (t - delay) / Math.max(1e-4, 1 - ripple - jitter)
  return l < 0 ? 0 : l > 1 ? 1 : l
}

/**
 * The radial excursion, world units. Exactly zero at `ease` 1, so the finished
 * globe is the resting globe and not a very close approximation of it.
 *
 * Monotonic — there is no bloom and no overshoot here, unlike `morphRadial`. A
 * tile leaves its dispersed radius and arrives, once, decelerating.
 */
export function introLift(ease: number, seed: number, amount: number): number {
  return amount * (1 - ease) * (0.7 + 0.6 * seed)
}

/** A tile's opacity as it draws in. Exactly 1 at `ease` 1. Mirrors GLSL
 *  mix(start, 1.0, ease), in the form the spec defines it. */
export function introAlpha(ease: number, start: number): number {
  return start * (1 - ease) + ease
}

/** What the ambient spin is multiplied by. 1 + the boost at the first frame,
 *  exactly 1 once the composition is spent — so the resting drift is the
 *  shipped SPIN_SPEED and not a hair off it. */
export function introSpinScale(remaining: number): number {
  return 1 + INTRO_SPIN_BOOST * introEase(remaining)
}

/**
 * Has the visitor taken the sphere over?
 *
 * Read from the drive rather than from scroll or pointer events, because the
 * drive is the one place every input has already been resolved into: scroll,
 * drag, momentum and the choreography's own easing all arrive here. It is read
 * only — the composition never writes to the drive, so there is nothing for the
 * choreography to fight with.
 *
 * A page restored mid-scroll on reload also lands here on its first frame,
 * which is right: there is no resting globe to compose onto.
 */
export function introYields(
  distanceScale: number,
  spin: number,
  tilt: number,
  flatten: number,
): boolean {
  return (
    Math.abs(distanceScale - 1) > INTRO_YIELD_EPSILON ||
    Math.abs(spin) > INTRO_YIELD_EPSILON ||
    Math.abs(tilt) > INTRO_YIELD_EPSILON ||
    flatten > INTRO_YIELD_EPSILON
  )
}

/* ── The clock ──────────────────────────────────────────────────────────────
   Module state, and the whole once-per-page-load guarantee. There is no reset,
   no restart and no way to wind it back; the only thing that sets `remaining`
   to 1 is this module being evaluated, which happens exactly once per page
   load. A remount finds whatever the last frame left behind.                  */

let remaining = 1
let lastStamp = -1
let lastWall = -1

/** Milliseconds, monotonic where it can be. Not imported from anywhere so that
 *  this module stays runnable outside a browser. */
function wallClock(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/** How much of the composition is still to come, without advancing it: 1 before
 *  the first frame, 0 once it is finished and for the rest of the page's life. */
export function introRemaining(): number {
  return remaining
}

/** Finish the composition now, without playing it. Called before the first
 *  frame under prefers-reduced-motion. Idempotent. */
export function skipIntro(): void {
  remaining = 0
}

/**
 * Advance the composition by one rendered frame and return what is left.
 *
 * @param stamp    the renderer's own clock for this frame, seconds. Every
 *                 caller in the same frame passes the same number and the
 *                 second one gets the first one's answer back unchanged — which
 *                 is how the instanced globe and the near tiles are guaranteed
 *                 to place a photograph in the same place rather than a frame
 *                 apart, whichever of them r3f calls first.
 * @param delta    seconds since the previous frame, clamped internally.
 * @param yielding true once the visitor has taken over. See {@link introYields}.
 *
 * Monotonic in every case: the value returned is never larger than the one
 * before it, and once it reaches 0 it stays there.
 */
export function advanceIntro(stamp: number, delta: number, yielding: boolean): number {
  if (remaining <= 0) return 0
  if (stamp === lastStamp) return remaining

  const wall = wallClock()
  if (lastWall >= 0 && wall - lastWall > INTRO_GAP_SECONDS * 1000) {
    // Nothing was drawn for a while: the sphere was unmounted or the tab was in
    // the background. Finish rather than resume — see INTRO_GAP_SECONDS.
    remaining = 0
  } else {
    const frame =
      delta > INTRO_MAX_FRAME_SECONDS ? INTRO_MAX_FRAME_SECONDS : delta > 0 ? delta : 0
    const next = remaining - frame / (yielding ? INTRO_YIELD_SECONDS : INTRO_SECONDS)
    remaining = next > 0 ? next : 0
  }

  lastStamp = stamp
  lastWall = wall
  return remaining
}
