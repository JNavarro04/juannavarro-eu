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

export const sphereVertexShader = /* glsl */ `
  attribute vec3 iCenter;   // unit direction of this tile's centre
  attribute vec2 iSize;     // angular half-extents (radians), tile u then v
  attribute vec4 iUV;       // atlas rect: origin xy, extent zw, normalised
  attribute float iRot;     // tile rotation within its tangent plane
  attribute float iSeed;    // per-tile random, [0,1)
  attribute float iHidden;  // 1 while NearTiles owns this photograph

  uniform float uRadius;
  uniform float uRelief;

  varying vec2 vUv;
  varying vec4 vRect;

  ${TILE_PLACEMENT_GLSL}

  void main() {
    vUv = uv;
    vRect = iUV;

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
    gl_Position =
      projectionMatrix * modelViewMatrix *
      vec4(dir * tileRadius(uRadius, uRelief, iSeed), 1.0);
  }
`

export const sphereFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uAtlas;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec4 vRect;

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
  uniform float uRot;
  uniform float uSeed;
  uniform float uRadius;
  uniform float uRelief;

  varying vec2 vUv;

  ${TILE_PLACEMENT_GLSL}

  void main() {
    vUv = uv;
    vec3 dir = tilePlacement(uCenter, uSize, uRot, position.xy);
    gl_Position =
      projectionMatrix * modelViewMatrix *
      vec4(dir * tileRadius(uRadius, uRelief, uSeed), 1.0);
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

  void main() {
    vec4 texel = texture2D(uTile, vec2(vUv.x, 1.0 - vUv.y));
    gl_FragColor = vec4(texel.rgb, texel.a * uOpacity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
