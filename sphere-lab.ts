// TEMPORARY render harness. Delete with sphere-lab.html when done.
// Mirrors SphereStage + PhotoSphere exactly, but renders on demand from a JS
// call instead of a rAF loop, because the review pane never composites frames.
import * as THREE from 'three'
import { MANIFEST, PHOTOS, atlasUrl } from './src/lib/photos'
import {
  distanceForViewportFraction,
  hexLuminance,
  layoutTiles,
  planBands,
  shuffledIndices,
  tonalOrder,
  type TileLayoutOverrides,
} from './src/lib/sphereMath'
import {
  sphereFragmentShader,
  sphereVertexShader,
} from './src/components/Sphere/shaders'
import {
  AXIS_TILT_X,
  AXIS_TILT_Z,
  BAND_AXIS_TILT_DEG,
  RELIEF,
  SPHERE_FOV,
  SPHERE_RADIUS,
  TILE_SEGMENTS,
  VIEWPORT_FRACTION,
  PLACEMENT_SEED,
} from './src/components/Sphere/PhotoSphere'

const W = 1440
const H = 900
const ATLAS = 'desktop' as const

const canvas = document.createElement('canvas')
canvas.width = W * 2
canvas.height = H * 2
canvas.style.width = `${W}px`
canvas.style.height = `${H}px`
document.body.appendChild(canvas)

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
})
renderer.setPixelRatio(2)
renderer.setSize(W, H, false)
renderer.toneMapping = THREE.NoToneMapping

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(SPHERE_FOV, W / H, 0.1, 100)
const axis = new THREE.Group()
const spin = new THREE.Group()
axis.add(spin)
scene.add(axis)

let mesh: THREE.InstancedMesh | null = null
let texture: THREE.Texture | null = null

function buildGeometry(overrides: TileLayoutOverrides): THREE.BufferGeometry {
  const base = new THREE.PlaneGeometry(1, 1, TILE_SEGMENTS, TILE_SEGMENTS)
  const order = tonalOrder(
    PHOTOS.map((p) => hexLuminance(p.color)),
    shuffledIndices(PHOTOS.length, PLACEMENT_SEED),
  )
  const placed = order.map((i) => PHOTOS[i])
  const layout = layoutTiles(placed.map((p) => p.aspect), overrides)
  const atlasSize = MANIFEST.atlas[ATLAS].sheet
  const uv = new Float32Array(layout.count * 4)
  const inset = 0.5 / atlasSize
  for (let i = 0; i < layout.count; i++) {
    const rect = placed[i].atlas[ATLAS]
    uv[i * 4] = rect.u + inset
    uv[i * 4 + 1] = rect.v + inset
    uv[i * 4 + 2] = rect.w - inset * 2
    uv[i * 4 + 3] = rect.h - inset * 2
  }
  base.setAttribute('iCenter', new THREE.InstancedBufferAttribute(layout.centers, 3))
  base.setAttribute('iSize', new THREE.InstancedBufferAttribute(layout.sizes, 2))
  base.setAttribute('iRot', new THREE.InstancedBufferAttribute(layout.rotations, 1))
  base.setAttribute('iSeed', new THREE.InstancedBufferAttribute(layout.seeds, 1))
  base.setAttribute('iUV', new THREE.InstancedBufferAttribute(uv, 4))
  return base
}

type Shot = {
  overrides?: TileLayoutOverrides
  spinAngle?: number
  tiltX?: number
  tiltZ?: number
  relief?: number
  bg?: string
}

function draw(opts: Shot = {}): string {
  if (!texture) throw new Error('atlas not ready')
  if (mesh) {
    mesh.geometry.dispose()
    spin.remove(mesh)
  }
  const geometry = buildGeometry(opts.overrides ?? {})
  const material = new THREE.ShaderMaterial({
    vertexShader: sphereVertexShader,
    fragmentShader: sphereFragmentShader,
    uniforms: {
      uAtlas: { value: texture },
      uRadius: { value: SPHERE_RADIUS },
      uRelief: { value: opts.relief ?? RELIEF },
      uOpacity: { value: 1 },
    },
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  })
  mesh = new THREE.InstancedMesh(geometry, material, PHOTOS.length)
  mesh.frustumCulled = false
  const identity = new THREE.Matrix4()
  for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, identity)
  spin.add(mesh)

  axis.rotation.set(opts.tiltX ?? AXIS_TILT_X, 0, opts.tiltZ ?? AXIS_TILT_Z)
  spin.rotation.y = opts.spinAngle ?? 0
  camera.position.set(
    0,
    0,
    distanceForViewportFraction(SPHERE_RADIUS, SPHERE_FOV, W, H, VIEWPORT_FRACTION),
  )
  camera.lookAt(0, 0, 0)
  renderer.setClearColor(new THREE.Color(opts.bg ?? '#f4f6f7'), 1)
  renderer.render(scene, camera)
  return canvas.toDataURL('image/png')
}

async function post(name: string, data: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:5199/${name}`, { method: 'POST', body: data })
  return res.text()
}

declare global {
  interface Window {
    lab: {
      ready: boolean
      shot: (name: string, opts?: Shot) => Promise<string>
      plan: (overrides?: TileLayoutOverrides) => unknown
      info: () => unknown
    }
  }
}

window.lab = {
  ready: false,
  shot: async (name, opts) => post(name, draw(opts)),
  plan: (overrides) => {
    const order = tonalOrder(
      PHOTOS.map((p) => hexLuminance(p.color)),
      shuffledIndices(PHOTOS.length, PLACEMENT_SEED),
    )
    const aspects = order.map((i) => PHOTOS[i].aspect)
    const merged = { ...(overrides?.bands ?? {}) }
    return planBands(aspects, { ...planDefaults, ...merged })
  },
  info: () => ({
    bandTiltDeg: BAND_AXIS_TILT_DEG,
    axisTiltX: AXIS_TILT_X,
    axisTiltZ: AXIS_TILT_Z,
    distance: distanceForViewportFraction(SPHERE_RADIUS, SPHERE_FOV, W, H, VIEWPORT_FRACTION),
  }),
}

import { BAND_LAYOUT_DEFAULTS } from './src/lib/sphereMath'
const planDefaults = BAND_LAYOUT_DEFAULTS

new THREE.TextureLoader().load(atlasUrl(ATLAS), (t) => {
  t.colorSpace = THREE.SRGBColorSpace
  t.flipY = false
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy())
  t.needsUpdate = true
  texture = t
  window.lab.ready = true
})
