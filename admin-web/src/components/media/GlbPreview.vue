<template>
  <div ref="wrapRef" class="glb-preview" :style="{ height: height + 'px' }">
    <canvas ref="canvasRef" class="glb-preview-canvas" />
    <div v-if="status" class="glb-preview-status">{{ status }}</div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  src: { type: String, default: '' },
  unmirror: { type: Boolean, default: false },
  height: { type: Number, default: 380 }
})

const canvasRef = ref(null)
const wrapRef = ref(null)
const status = ref('')

let renderer = null
let scene = null
let camera = null
let controls = null
let modelRoot = null
let raf = 0
let autoRotate = false
let resizeObs = null
let THREE = null
let OrbitControls = null
let GLTFLoader = null

function disposeObject(root) {
  if (!root) return
  root.traverse((child) => {
    if (child.geometry && child.geometry.dispose) child.geometry.dispose()
    const mats = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : []
    mats.forEach((m) => {
      if (!m) return
      Object.keys(m).forEach((key) => {
        const val = m[key]
        if (val && val.isTexture && val.dispose) val.dispose()
      })
      if (m.dispose) m.dispose()
    })
  })
}

function prepareModel(object) {
  object.traverse((child) => {
    if (!child.isMesh || !child.material) return
    const list = Array.isArray(child.material) ? child.material : [child.material]
    list.forEach((m) => {
      if (!m) return
      if (m.map) {
        if (THREE.SRGBColorSpace && m.map.colorSpace !== undefined) m.map.colorSpace = THREE.SRGBColorSpace
        m.map.needsUpdate = true
        if (m.color && m.color.r + m.color.g + m.color.b < 0.35) m.color.setRGB(1, 1, 1)
      }
      if (typeof m.metalness === 'number') m.metalness = 0
      if (typeof m.roughness === 'number') m.roughness = Math.max(0.72, m.roughness)
      m.side = THREE.DoubleSide
      m.needsUpdate = true
    })
  })
  if (props.unmirror && object.scale) object.scale.x = -Math.abs(object.scale.x || 1)
}

function fitCamera(object) {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const dist = maxDim * 2.1
  camera.near = Math.max(dist / 100, 0.01)
  camera.far = dist * 40
  camera.position.set(center.x + dist * 0.55, center.y + dist * 0.28, center.z + dist)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  if (controls) {
    controls.target.copy(center)
    controls.minDistance = maxDim * 0.6
    controls.maxDistance = maxDim * 8
    controls.update()
  }
}

function resize() {
  if (!renderer || !wrapRef.value) return
  const w = Math.max(1, wrapRef.value.clientWidth)
  const h = Math.max(1, wrapRef.value.clientHeight)
  renderer.setSize(w, h, false)
  if (camera) {
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
}

function scheduleLayout() {
  const run = () => {
    resize()
    if (modelRoot) fitCamera(modelRoot)
  }
  nextTick(() => {
    run()
    requestAnimationFrame(run)
  })
  setTimeout(run, 80)
  setTimeout(run, 360)
}

function tick() {
  raf = requestAnimationFrame(tick)
  if (autoRotate && modelRoot) modelRoot.rotation.y += 0.002
  if (controls) controls.update()
  if (renderer && scene && camera) renderer.render(scene, camera)
}

async function loadLib() {
  if (THREE) return
  const three = await import('three')
  const controlsMod = await import('three/examples/jsm/controls/OrbitControls.js')
  const loaderMod = await import('three/examples/jsm/loaders/GLTFLoader.js')
  THREE = three
  OrbitControls = controlsMod.OrbitControls
  GLTFLoader = loaderMod.GLTFLoader
}

function setupScene() {
  const canvas = canvasRef.value
  if (!canvas) throw new Error('预览画布未就绪')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  if (renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace
  }
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
  scene.add(new THREE.AmbientLight(0xffffff, 0.95))
  const key = new THREE.DirectionalLight(0xffffff, 1.2)
  key.position.set(4, 8, 6)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x8ec5ff, 0.5)
  fill.position.set(-6, 2, -4)
  scene.add(fill)
  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.enablePan = false
  controls.addEventListener('start', () => {
    autoRotate = false
  })
  resize()
  window.addEventListener('resize', resize)
  if (wrapRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => {
      resize()
    })
    resizeObs.observe(wrapRef.value)
  }
  tick()
}

function rewriteCosUrl(url) {
  const raw = String(url || '')
  if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return raw
  if (!import.meta.env.DEV) return raw
  try {
    const parsed = new URL(raw)
    if (!/\.myqcloud\.com$/i.test(parsed.hostname)) return raw
    return `/cos-proxy${parsed.pathname}${parsed.search}`
  } catch {
    return raw
  }
}

async function fetchBuffer(url, onProgress) {
  const res = await fetch(rewriteCosUrl(url), { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const total = Number(res.headers.get('content-length') || 0)
  if (!res.body || !total) return await res.arrayBuffer()
  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    if (onProgress) onProgress(Math.min(99, Math.round((received / total) * 100)))
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i], offset)
    offset += chunks[i].byteLength
  }
  return out.buffer
}

async function loadModel(url) {
  if (!url || !GLTFLoader) return
    status.value = '加载中…'
    autoRotate = false
  try {
    const buffer = await fetchBuffer(url, (p) => {
      status.value = '下载模型 ' + p + '%'
    })
    status.value = '解析模型…'
    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject)
    })
    if (modelRoot) {
      scene.remove(modelRoot)
      disposeObject(modelRoot)
    }
    modelRoot = gltf.scene
    prepareModel(modelRoot)
    scene.add(modelRoot)
    scheduleLayout()
    status.value = ''
  } catch (err) {
    const msg = String((err && err.message) || err || '')
    status.value = /Failed to fetch|CORS|NetworkError|HTTP /i.test(msg)
      ? '无法加载模型（跨域或链接失效）。可在上传弹窗里选择本地 GLB 预览。'
      : '模型解析失败'
  }
}

watch(
  () => [props.src, props.unmirror],
  () => {
    if (!THREE) return
    if (!props.src) {
      if (modelRoot && scene) {
        scene.remove(modelRoot)
        disposeObject(modelRoot)
        modelRoot = null
      }
      status.value = '点击表格中的型号即可预览 3D'
      return
    }
    loadModel(props.src)
  }
)

onMounted(async () => {
  try {
    await loadLib()
    setupScene()
    scheduleLayout()
    if (props.src) await loadModel(props.src)
    else status.value = '点击表格中的型号即可预览 3D'
  } catch (err) {
    status.value = err.message || '3D 预览初始化失败'
  }
})

onBeforeUnmount(() => {
  if (resizeObs) {
    resizeObs.disconnect()
    resizeObs = null
  }
  window.removeEventListener('resize', resize)
  if (raf) cancelAnimationFrame(raf)
  if (controls && controls.dispose) controls.dispose()
  if (modelRoot) disposeObject(modelRoot)
  if (renderer && renderer.dispose) renderer.dispose()
  renderer = null
  scene = null
  camera = null
  controls = null
  modelRoot = null
})
</script>

<style scoped>
.glb-preview {
  position: relative;
  width: 100%;
  min-height: 240px;
  border-radius: 10px;
  overflow: hidden;
  background: #07080c;
}
.glb-preview-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.glb-preview-status {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.78);
  font-size: 13px;
  pointer-events: none;
  text-align: center;
  padding: 16px;
}
</style>
