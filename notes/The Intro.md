---
tags: [intro, animation]
---

# The Intro

The globe composes itself once on page load: tiles begin lifted off the shell at
55% opacity and draw inward over **3 seconds**, in a wave from the waist to both
poles, while the rotation decelerates out of a 6× faster start.

## Time-driven, not scroll-driven — this is the whole point

Everything else on the landing page is scroll-scrubbed and therefore reversible.
The intro is the opposite: it runs on **its own clock**, once, and then it is
over. Because it never reads scroll, scrolling back up *cannot* replay it. The
behaviour Juan asked for falls out of the architecture rather than being
suppressed.

## Once per page load, not per mount

A module-level counter with **no reset path anywhere**. A remount finds whatever
the last frame left. This matters because navigating `/info → /` is a client-side
route change — a naive implementation replays the intro every time you come back.

## It lands exactly on the layout

Verified bit-identical to the resting globe: **max deviation 0** across 27,378
vertices, in both float64 and float32. The motion is purely radial, so it
provably cannot open or close a joint — see [[The Sphere]].

## The snap bug

The first version appeared to snap instantly into place. Cause: a guard meant to
stop a backgrounded tab replaying the intro inferred that from a **400 ms gap
between rendered frames**. But a cold load pauses far longer than that while a
1.9 MB atlas decodes and shaders compile — so it fired on essentially every load
and completed the animation on frame two.

Replaced with the condition it was actually reaching for: complete only when the
document is **genuinely hidden** *and* the composition has already started. A
page opened in a background tab now composes properly when first viewed, which
the old heuristic also got wrong.

**Lesson:** wall-clock heuristics cannot distinguish "tab was hidden" from
"first frame was slow". Ask the platform (`visibilitychange`) instead of guessing.

## Constants

`INTRO_SECONDS 3` · `INTRO_LIFT 0.32` · `INTRO_ALPHA 0.55` · `INTRO_RIPPLE 0.35`
· `INTRO_SPIN_BOOST 5` · `INTRO_YIELD_SECONDS 0.25`

`INTRO_LIFT 0.32` is a **ceiling, not a preference**: scatter peaks at 1.3× the
lift, so the widest tile starts at radius 1.416, which at `VIEWPORT_FRACTION 0.68`
fills 96% of the frame's short axis. Past ~0.4 the opening frames are cropped.

Also required disabling `history.scrollRestoration` — a browser restoring scroll
on reload put the sphere under scroll control immediately, cancelling the intro.

Related: [[The Morph]] · [[Gotchas]]
