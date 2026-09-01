/**
 * The shader that makes 162 flat photographs behave like one continuous shell.
 *
 * The whole trick lives in the vertex stage. A quad hung tangent to a sphere
 * keeps its corners *off* the surface — they stick out past the radius, and at
 * this tile density those corners are what turn a sphere into a faceted lump.
 * So the quad is subdivided 12×12 and every vertex is pushed back onto radius R
 * before it is projected. Nothing is ever off the shell, so neighbouring tiles
 * can only meet flush and the silhouette is a true circle.
 */

export const sphereVertexShader = /* glsl */ `
  attribute vec3 iCenter;   // unit direction of this tile's centre
  attribute vec2 iSize;     // angular half-extents (radians), tile u then v
  attribute vec4 iUV;       // atlas rect: origin xy, extent zw, normalised
  attribute float iRot;     // tile rotation within its tangent plane
  attribute float iSeed;    // per-tile random, [0,1)

  uniform float uRadius;
  uniform float uRelief;

  varying vec2 vUv;
  varying vec4 vRect;

  void main() {
    vec3 c = normalize(iCenter);

    // Tangent frame. cross(up, c) degenerates at the poles, so swap the
    // reference axis there. (tangent, bitangent, c) comes out right-handed with
    // c outward, which puts every tile's front face on the outside of the shell.
    vec3 ref = abs(c.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 tangent = normalize(cross(ref, c));
    vec3 bitangent = cross(c, tangent);

    float ca = cos(iRot);
    float sa = sin(iRot);
    vec3 e1 = tangent * ca + bitangent * sa;
    vec3 e2 = -tangent * sa + bitangent * ca;

    // position.xy spans [-0.5, 0.5], so theta/phi span the full angular extent.
    float theta = position.x * 2.0 * iSize.x;
    float phi   = position.y * 2.0 * iSize.y;

    // Gnomonic patch: step tan(angle) across the tangent plane, then normalise.
    // tan() (rather than sin()) is what makes the mapping angularly exact —
    // normalize(c + e1*tan(t)) sits at exactly t radians from c — and it maps
    // straight lines to great circles, so two tiles sharing an edge direction
    // share the edge itself instead of crossing it.
    vec3 dir = normalize(c + e1 * tan(theta) + e2 * tan(phi));

    // Sub-percent relief. Enough to give overlapping tiles a definite stacking
    // order (no z-fighting) and a hint of physical layering; far too little to
    // dent the silhouette.
    float radius = uRadius * (1.0 + uRelief * (iSeed * 2.0 - 1.0));

    vUv = uv;
    vRect = iUV;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(dir * radius, 1.0);
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
