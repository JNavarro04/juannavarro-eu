/**
 * The shader that makes 162 flat photographs behave like one continuous shell.
 *
 * The whole trick lives in the vertex stage. A quad hung tangent to a sphere
 * keeps its corners *off* the surface — they stick out past the radius, and at
 * this tile density those corners are what turn a sphere into a faceted lump.
 * So the quad is subdivided 12×12 and every vertex is pushed back onto radius R
 * before it is projected. Nothing is ever off the shell, so neighbouring tiles
 * can only meet flush and the silhouette is a true circle.
 *
 * Two programs are built from that one piece of maths. The instanced one draws
 * the whole globe in a single call from the packed atlas; the near one draws a
 * handful of tiles at their own resolution when the camera is close enough for
 * the atlas to be visibly upscaled. They share {@link TILE_PLACEMENT_GLSL}
 * verbatim, which is the only reason a tile can be handed from one to the other
 * without moving by a pixel.
 */

/**
 * Where a tile's vertices land on the shell.
 *
 * Shared source, not a copy: the near-tile program and the instanced program
 * compile the identical function, so a photograph drawn either way occupies
 * exactly the same pixels and the swap between them is invisible. The only
 * difference is where the four numbers come from — per-instance attributes on
 * the globe, per-mesh uniforms up close.
 */
const TILE_PLACEMENT_GLSL = /* glsl */ `
  /**
   * @param center  unit direction of the tile's centre
   * @param extent  angular half-extents (radians), tile u then v
   * @param roll    rotation of the tile within its own tangent plane
   * @param quad    position.xy of this vertex, spanning [-0.5, 0.5]
   */
  vec3 tilePlacement(vec3 center, vec2 extent, float roll, vec2 quad) {
    vec3 c = normalize(center);

    // Tangent frame. cross(up, c) degenerates at the poles, so swap the
    // reference axis there. (tangent, bitangent, c) comes out right-handed with
    // c outward, which puts every tile's front face on the outside of the shell.
    vec3 ref = abs(c.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 tangent = normalize(cross(ref, c));
    vec3 bitangent = cross(c, tangent);

    float ca = cos(roll);
    float sa = sin(roll);
    vec3 e1 = tangent * ca + bitangent * sa;
    vec3 e2 = -tangent * sa + bitangent * ca;

    // quad spans [-0.5, 0.5], so theta/phi span the full angular extent.
    float theta = quad.x * 2.0 * extent.x;
    float phi   = quad.y * 2.0 * extent.y;

    // Gnomonic patch: step tan(angle) across the tangent plane, then normalise.
    // tan() (rather than sin()) is what makes the mapping angularly exact —
    // normalize(c + e1*tan(t)) sits at exactly t radians from c — and it maps
    // straight lines to great circles, so two tiles sharing an edge direction
    // share the edge itself instead of crossing it.
    return normalize(c + e1 * tan(theta) + e2 * tan(phi));
  }

  /**
   * Sub-percent relief. Enough to give overlapping tiles a definite stacking
   * order (no z-fighting) and a hint of physical layering; far too little to
   * dent the silhouette. A near tile has to reproduce its twin's wobble exactly
   * or the swap would show as a radial pop.
   */
  float tileRadius(float radius, float relief, float seed) {
    return radius * (1.0 + relief * (seed * 2.0 - 1.0));
  }
`

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE MORPH — the globe opening out into a ring
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * One number, `uFlatten`, runs from the sphere at 0 to the cylinder at 1, and
 * every tile is somewhere between the two on every frame. Nothing switches.
 *
 * The ring is built in VIEW space, not in the sphere's. That is the whole
 * argument for uprightness: a tile's vertical edge is written as the view's own
 * Y axis, and a direction perpendicular to the view axis projects to a vertical
 * line on screen wherever it sits in the frame. So at flatten 1 every
 * photograph has *exactly* zero roll — not nearly zero, and not zero only at
 * the centre of the frame. It also settles what happens to the 20° band tilt:
 * that tilt lives in the model matrix, the ring term never reads the model
 * matrix, so the courses' lean unwinds to level as the mix crosses over. There
 * is no separate tilt to interpolate; it is gone because the ring is not
 * attached to the sphere's axis.
 *
 * Two things are read straight out of `modelViewMatrix`, which costs nothing and
 * keeps the two shader programs in exact agreement with each other and with the
 * scene graph on every frame:
 *
 *   origin — the sphere's centre in view space, `modelViewMatrix[3].xyz`, since
 *            the groups above this mesh only ever rotate. The ring hangs off it,
 *            so the ring is where the globe was.
 *   front  — the local direction that maps to view +Z, i.e. the third row of the
 *            rotation. It is the meridian facing the camera, so the ring turns
 *            with the drag and with the ambient spin *because it is driven by
 *            the same angle the globe is*. The hand-over of rotation is not
 *            interpolated; there is only ever one rotation.
 */
const MORPH_PLACEMENT_GLSL = /* glsl */ `
  /**
   * The morph's own clock, for one tile.
   *
   * Nothing moves on a single schedule: a tile's start is delayed in proportion
   * to how near the poles it is, so the wave begins at the equator and runs
   * outward to both poles, and at half way some photographs have taken their
   * place in the ring while others are still lying on the shell.
   *
   * That direction is not a taste. The ring is a belt around the globe's own
   * waist, so every photograph is converging on the latitudes the equatorial
   * courses already occupy — and if the poles go first they arrive into a band
   * that is still full. Measured over the whole morph, on the real 162, as the
   * share of drawn photograph area covered twice at the worst moment:
   *
   *     equator first   3.7%      ← this
   *     no wave        12.1%
   *     poles first    39.3%
   *
   * Running it from the equator outward means the waist has emptied into the
   * rows before the caps fold in after it, and it is also the direction that
   * keeps the surface *coherent*: at the shipped ring radius the equatorial
   * tiles barely leave the shell — they slide along it into the belt — so what
   * the visitor sees is a globe gathering itself into a ring rather than 162
   * photographs flying between two arrangements.
   *
   * 'ripple' 0 removes the wave and leaves a single schedule for everything,
   * which is what prefers-reduced-motion asks for.
   */
  float morphLocal(float flatten, float ripple, float centerY) {
    float delay = ripple * abs(centerY);
    return clamp((flatten - delay) / max(1e-4, 1.0 - ripple), 0.0, 1.0);
  }

  /** Smootherstep: a tile accelerates out of the shell and decelerates into its
   *  slot, with zero velocity *and* zero acceleration at both ends. */
  float morphEase(float l) {
    return l * l * l * (l * (l * 6.0 - 15.0) + 10.0);
  }

  /**
   * The radial excursion, world units. Zero at both ends of the morph, so
   * neither the globe nor the ring is touched by it.
   *
   * sin(πl)·(bloom + settle·cos(πl)) is one term doing two jobs. Early, cos is
   * positive and the tile is pushed *out*: the globe loosens and expands before
   * it opens. Late, cos has gone negative and — with settle larger than bloom —
   * the tile passes slightly *inside* its final radius and comes back out to it,
   * so it lands rather than stops.
   *
   * It is radial, and that is deliberate: it moves a tile along its own normal
   * and never across the surface, so it cannot change which tile is beside which
   * and cannot open or close a joint. The overshoot is provably incapable of
   * causing an overlap in the finished ring. The per-tile scatter is there so
   * that two tiles converging on the same row cross at different depths and the
   * nearer simply covers the further, instead of the two z-fighting.
   */
  float morphRadial(float l, float seed, float bloom, float settle) {
    float phase = 3.141592653589793 * l;
    return sin(phase) * (bloom + settle * cos(phase)) * (0.7 + 0.6 * seed);
  }

  /**
   * Where a tile's vertex sits on the ring, in view space.
   *
   * @param slot   ring angle, centre height, angular half-width, world half-height
   * @param quad   position.xy of this vertex, spanning [-0.5, 0.5]
   * @param origin the sphere's centre, view space
   * @param front  the local direction facing the camera
   *
   * The tile is bent around the cylinder rather than hung flat against it, for
   * the same reason the sphere's tiles are bent around the shell: neighbours
   * meet flush and the silhouette is a true circle. At ~9° of arc per frame the
   * bend is 0.3% of the radius — the curvature the viewer reads is the ring's,
   * not the tile's.
   */
  vec3 ringPlacement(
    vec4 slot,
    vec2 quad,
    float ringRadius,
    float sphereRadius,
    float relief,
    float seed,
    float radial,
    vec3 origin,
    vec3 front
  ) {
    float angle = slot.x + atan(front.z, front.x) + quad.x * 2.0 * slot.z;
    float r = ringRadius * (1.0 + relief * (seed * 2.0 - 1.0)) + radial;
    // The near face is pinned to the sphere's near point, so the photograph at
    // the centre of the frame keeps its depth — and therefore its size on screen
    // — right through the morph. The camera's dolly goes on meaning the same
    // thing before and after.
    float axisZ = origin.z + sphereRadius - ringRadius;
    return vec3(
      origin.x + r * sin(angle),
      origin.y + slot.y + quad.y * 2.0 * slot.w,
      axisZ + r * cos(angle)
    );
  }

  /** The sphere's centre in view space. The groups above only rotate, so the
   *  model matrix contributes no translation of its own. */
  vec3 morphOrigin(mat4 modelView) {
    return modelView[3].xyz;
  }

  /** The local direction that maps to view +Z: the meridian facing the camera. */
  vec3 morphFront(mat4 modelView) {
    return normalize(vec3(modelView[0][2], modelView[1][2], modelView[2][2]));
  }
`

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE LANDING COMPOSITION — the globe drawing itself together, once
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The morph above is scrubbed by scroll and is reversible. This is neither: it
 * runs on a clock from the first frame of a page load, finishes, and then is
 * not there. Its whole schedule lives in introClock.ts, which is also where the
 * mirrors of the three functions below are; 'uIntro' is how much of it is still
 * to come, 1 at the first frame and 0 for the rest of the page's life.
 *
 * THE ONE THING THAT MATTERS about this block: at 'uIntro' 0 every function here
 * returns exactly zero — not nearly zero — so the globe the visitor is left with
 * is the signed-off globe, joint for joint, and the morph maths this sits in
 * front of computes bit for bit what it computed before any of this existed.
 * The vertex programs below also guard the whole thing behind a uniform branch,
 * so at rest none of it is even executed.
 *
 * The excursion is radial, for the same reason 'morphRadial' is: it moves a tile
 * along its own normal and never across the shell, so it cannot change which
 * tile is beside which and cannot open or close a joint. A tile is therefore
 * incapable of arriving anywhere except its layout position.
 *
 * Included AFTER the morph block in both programs, because it reuses that
 * block's 'morphEase' rather than declaring a second smootherstep.
 */
const INTRO_PLACEMENT_GLSL = /* glsl */ `
  /**
   * The composition's own clock, for one tile.
   *
   * Deliberately the same shape as 'morphLocal': a delay proportional to how
   * near the poles the tile is, so a wave runs from the globe's waist outward
   * and the courses fill in one after another rather than all at once. The
   * per-tile term on top of it staggers the 162 within each course.
   *
   * @param back    how much of the composition is still to come, 1 → 0
   * @param ripple  head start given to the equator, in progress units
   * @param jitter  per-tile random delay, same units
   * @param centerY the tile centre's Y in the sphere's own frame
   * @param seed    the tile's own random, [0,1)
   *
   * The latest tile is delayed by ripple + jitter, so the span is shortened by
   * exactly that and every tile has landed by the time 'back' reaches 0.
   */
  float introLocal(float back, float ripple, float jitter, float centerY, float seed) {
    float t = 1.0 - back;
    float delay = ripple * abs(centerY) + jitter * seed;
    return clamp((t - delay) / max(1e-4, 1.0 - ripple - jitter), 0.0, 1.0);
  }

  /**
   * How far outside the shell this tile still is, world units.
   *
   * Monotonic, with no bloom and no overshoot — unlike the morph's excursion,
   * which has both. A tile leaves its dispersed radius once and decelerates onto
   * the shell. The per-tile scatter is the morph's own (0.7 + 0.6 * seed), so
   * neighbouring tiles do not travel as a rigid sheet.
   */
  float introLift(float ease, float seed, float amount) {
    return amount * (1.0 - ease) * (0.7 + 0.6 * seed);
  }

  /** A tile's opacity as it draws in: 'start' at its furthest, exactly 1 when
   *  it lands. */
  float introAlpha(float ease, float start) {
    return mix(start, 1.0, ease);
  }
`

export const sphereVertexShader = /* glsl */ `
  attribute vec3 iCenter;   // unit direction of this tile's centre
  attribute vec2 iSize;     // angular half-extents (radians), tile u then v
  attribute vec4 iUV;       // atlas rect: origin xy, extent zw, normalised
  attribute vec4 iSlot;     // ring slot: angle, height, angular half-width, half-height
  attribute float iRot;     // tile rotation within its tangent plane
  attribute float iSeed;    // per-tile random, [0,1)
  attribute float iHidden;  // 1 while NearTiles owns this photograph

  uniform float uRadius;
  uniform float uRelief;
  uniform float uFlatten;   // 0 = the globe, 1 = the ring
  uniform float uRing;      // ring radius, world units
  uniform float uRipple;    // head start given to the poles, in flatten units
  uniform float uBloom;     // outward excursion mid-morph, world units
  uniform float uSettle;    // overshoot-and-settle at the end, world units

  uniform float uIntro;       // landing composition still to come: 1 → 0, once
  uniform float uIntroLift;   // how far outside the shell a tile starts, world
  uniform float uIntroAlpha;  // a tile's opacity at its furthest
  uniform float uIntroRipple; // head start given to the equator, progress units
  uniform float uIntroJitter; // per-tile random delay, progress units

  varying vec2 vUv;
  varying vec4 vRect;
  varying float vAlpha;

  ${TILE_PLACEMENT_GLSL}
  ${MORPH_PLACEMENT_GLSL}
  ${INTRO_PLACEMENT_GLSL}

  void main() {
    vUv = uv;
    vRect = iUV;
    vAlpha = 1.0;

    // Handed over to a near tile drawing the same photograph at its own
    // resolution, in the same place. Collapse this quad outside the clip volume
    // rather than draw it underneath: every vertex lands at the same
    // out-of-range clip position, so the triangles are discarded whole and no
    // fragment of this instance is ever shaded.
    if (iHidden > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vec3 dir = tilePlacement(iCenter, iSize, iRot, position.xy);

    // The resting globe, untouched — not merely mix()ed with a weight of zero.
    // This is the state the client signed off; it does not depend on a single
    // line of the maths below being right. It is also where the page spends all
    // but the first second and a half of its life: once the landing composition
    // is spent, 'uIntro' is 0 for ever and this is the only branch that runs.
    if (uFlatten <= 0.0 && uIntro <= 0.0) {
      gl_Position =
        projectionMatrix * modelViewMatrix *
        vec4(dir * tileRadius(uRadius, uRelief, iSeed), 1.0);
      return;
    }

    // The landing composition. Guarded rather than mixed to zero so that a
    // finished page cannot be a rounding error away from the signed-off one:
    // when 'uIntro' is 0 the lift is the literal 0.0 below and vAlpha the
    // literal 1.0 above, and the morph arithmetic that follows is untouched.
    float lift = 0.0;
    if (uIntro > 0.0) {
      float ease =
        morphEase(introLocal(uIntro, uIntroRipple, uIntroJitter, iCenter.y, iSeed));
      lift = introLift(ease, iSeed, uIntroLift);
      vAlpha = introAlpha(ease, uIntroAlpha);
    }

    float local = morphLocal(uFlatten, uRipple, iCenter.y);
    // The composition rides in the morph's own radial term, so a tile that is
    // still drawing in while the visitor has already begun to scroll is carried
    // correctly through both at once. It cannot happen for more than a quarter
    // of a second — see introClock.ts — but it must not tear if it does.
    float radial = morphRadial(local, iSeed, uBloom, uSettle) + lift;

    vec4 shell =
      modelViewMatrix * vec4(dir * (tileRadius(uRadius, uRelief, iSeed) + radial), 1.0);
    vec3 ring = ringPlacement(
      iSlot, position.xy, uRing, uRadius, uRelief, iSeed, radial,
      morphOrigin(modelViewMatrix), morphFront(modelViewMatrix)
    );

    gl_Position = projectionMatrix * mix(shell, vec4(ring, 1.0), morphEase(local));
  }
`

export const sphereFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uAtlas;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec4 vRect;
  varying float vAlpha;

  void main() {
    // Atlas rects are packed with the image origin at top-left; GL's t axis
    // runs the other way, so V is flipped here (the texture is uploaded with
    // flipY off, keeping this the only place the convention is handled).
    vec2 uv = vec2(
      vRect.x + vUv.x * vRect.z,
      vRect.y + (1.0 - vUv.y) * vRect.w
    );

    vec4 texel = texture2D(uAtlas, uv);
    gl_FragColor = vec4(texel.rgb, texel.a * uOpacity);

    // No grading, no tint, no vignette: these are the photographer's edits.
    // The atlas is an sRGB texture so the sample arrives linear; these two
    // chunks put it back into the renderer's output space unchanged.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // The landing composition's per-tile fade, and nothing else.
    //
    // Applied after the encode above, and to colour as well as alpha, so the
    // fragment leaves here PREMULTIPLIED. That is the whole reason the material
    // does not have to switch blending on for the composition: the canvas is
    // composited premultiplied, so a pixel written straight through with GL
    // blending off still shows the page correctly behind a half-faded tile.
    // The material's shader program, render list and depth behaviour are
    // therefore exactly what they were.
    //
    // Doing it the other way round — scaling only alpha, the convention
    // 'uOpacity' above uses — would add (1 - alpha) of white to every tile and
    // clip a bright photograph to flat paper while it faded in.
    //
    // At vAlpha 1, which is every frame after the first second and a half, both
    // multiplies are exact no-ops and this is the shader that shipped.
    gl_FragColor.rgb *= vAlpha;
    gl_FragColor.a *= vAlpha;
  }
`

/**
 * One tile, drawn from its own photograph rather than from the atlas.
 *
 * Same placement function as the instanced program, so the patch curves
 * identically and sits at the identical radius; the four per-tile numbers
 * arrive as uniforms instead of attributes. Because they are uniforms, a caller
 * is free to hand this a centre, size or roll that is *not* the one the layout
 * produced — which is what would let a zoomed-in state present these tiles
 * screen-aligned instead of sphere-tangent without touching the shader.
 */
export const nearTileVertexShader = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec2 uSize;
  uniform vec4 uSlot;
  uniform float uRot;
  uniform float uSeed;
  uniform float uRadius;
  uniform float uRelief;
  uniform float uFlatten;
  uniform float uRing;
  uniform float uRipple;
  uniform float uBloom;
  uniform float uSettle;
  uniform float uIntro;
  uniform float uIntroLift;
  uniform float uIntroAlpha;
  uniform float uIntroRipple;
  uniform float uIntroJitter;

  varying vec2 vUv;
  varying float vAlpha;

  ${TILE_PLACEMENT_GLSL}
  ${MORPH_PLACEMENT_GLSL}
  ${INTRO_PLACEMENT_GLSL}

  void main() {
    vUv = uv;
    vAlpha = 1.0;
    vec3 dir = tilePlacement(uCenter, uSize, uRot, position.xy);

    if (uFlatten <= 0.0 && uIntro <= 0.0) {
      gl_Position =
        projectionMatrix * modelViewMatrix *
        vec4(dir * tileRadius(uRadius, uRelief, uSeed), 1.0);
      return;
    }

    // Bit for bit the instanced program's arithmetic, on the same inputs. A
    // photograph that is being drawn from its own file has to sit exactly where
    // its instanced twin would have: any disagreement here would show as the
    // sharp tiles fanning while everything around them straightened. The landing
    // composition is included in that even though a near tile cannot be in play
    // during it — the camera is at its resting distance, and near tiles do not
    // exist above NEAR_ACTIVATE_SCALE. It is here so the two programs cannot
    // drift apart if that ever stops being true.
    float lift = 0.0;
    if (uIntro > 0.0) {
      float ease =
        morphEase(introLocal(uIntro, uIntroRipple, uIntroJitter, uCenter.y, uSeed));
      lift = introLift(ease, uSeed, uIntroLift);
      vAlpha = introAlpha(ease, uIntroAlpha);
    }

    float local = morphLocal(uFlatten, uRipple, uCenter.y);
    float radial = morphRadial(local, uSeed, uBloom, uSettle) + lift;

    vec4 shell =
      modelViewMatrix * vec4(dir * (tileRadius(uRadius, uRelief, uSeed) + radial), 1.0);
    vec3 ring = ringPlacement(
      uSlot, position.xy, uRing, uRadius, uRelief, uSeed, radial,
      morphOrigin(modelViewMatrix), morphFront(modelViewMatrix)
    );

    gl_Position = projectionMatrix * mix(shell, vec4(ring, 1.0), morphEase(local));
  }
`

/**
 * The near tile's photograph, whole.
 *
 * The V flip and the colour handling are the atlas shader's, unchanged — the
 * derivative is uploaded with flipY off and tagged sRGB exactly like the sheet
 * — so the only thing that differs across the crossfade is how many pixels the
 * photograph was stored at. No sharpening, no saturation, no filter of any kind:
 * a photograph must not change appearance because the camera moved closer.
 */
export const nearTileFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uTile;
  uniform float uOpacity;

  varying vec2 vUv;
  varying float vAlpha;

  void main() {
    vec4 texel = texture2D(uTile, vec2(vUv.x, 1.0 - vUv.y));
    gl_FragColor = vec4(texel.rgb, texel.a * uOpacity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // The atlas program's line, for the same reason. vAlpha is 1 whenever a
    // near tile is on screen at all, so in practice this is two multiplies by
    // one — kept so the two programs stay the same program.
    gl_FragColor.rgb *= vAlpha;
    gl_FragColor.a *= vAlpha;
  }
`
