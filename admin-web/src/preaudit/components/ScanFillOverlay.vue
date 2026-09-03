<template>
  <teleport to="body">
    <div class="pa-scan" tabindex="-1" @keydown.esc.prevent="close">
      <video
        ref="videoEl"
        class="pa-scan-video"
        autoplay
        muted
        playsinline
        webkit-playsinline
      />
      <div class="pa-scan-mask">
        <div class="pa-scan-top">
          <div class="pa-scan-title">{{ title || '扫一扫填数据' }}</div>
          <div class="pa-scan-sub">把纸放进 A4 框。横版点下面切换；倒着拍也能认。图不保存、也不上传。</div>
        </div>
        <div class="pa-scan-mid">
          <div ref="frameEl" class="pa-scan-frame" :class="{ 'is-landscape': landscape }" aria-hidden="true">
            <i class="tl" /><i class="tr" /><i class="bl" /><i class="br" />
          </div>
          <div class="pa-scan-orient">
            <button type="button" class="pa-scan-orient-btn" :class="{ on: !landscape }" @click="setLandscape(false)">竖版 A4</button>
            <button type="button" class="pa-scan-orient-btn" :class="{ on: landscape }" @click="setLandscape(true)">横版 A4</button>
          </div>
        </div>
        <div class="pa-scan-bottom">
          <div class="pa-scan-status">{{ status }}</div>
          <div class="pa-scan-bar">
            <el-button type="primary" :loading="busy" :disabled="!!busy || !live" @click="scanNow">
              点一下识别
            </el-button>
            <el-button :disabled="busy" @click="pickShot">拍照识别</el-button>
            <el-button @click="close">完成</el-button>
          </div>
        </div>
      </div>
      <input ref="shotEl" type="file" accept="image/*" capture="environment" hidden @change="onShot" />
    </div>
  </teleport>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { parsedFieldScore, recognizeImageOriented } from '../lib/ocr.js'
import {
  cameraErrorText,
  captureVideoFrame,
  hasParsedValue,
  notifyScanSuccess,
  openRearCamera,
  orientationsForScan,
  resetScanFeedback,
  stabilizeParsed,
  stopStream,
  unlockScanFeedback
} from '../lib/scan-fill.js'

const props = defineProps({
  title: { type: String, default: '' },
  kind: { type: String, default: 'doc' },
  fields: { type: Array, default: () => ['date', 'amount'] }
})

const emit = defineEmits(['close', 'hit'])

const videoEl = ref(null)
const frameEl = ref(null)
const shotEl = ref(null)
const busy = ref(false)
const live = ref(false)
const landscape = ref(false)
const status = ref('正在打开摄像头…')
const memo = Object.create(null)

let stream = null
let timer = 0
let attempts = 0
let closed = false
const MAX_AUTO = 5
const AUTO_MS = 2400

function close() {
  closed = true
  clearTimeout(timer)
  stopStream(stream)
  stream = null
  live.value = false
  emit('close')
}

function setLandscape(next) {
  landscape.value = !!next
}

async function bindStream(next) {
  stream = next
  const video = videoEl.value
  if (!video) throw new Error('摄像头画面还没好')
  video.srcObject = next
  video.setAttribute('playsinline', 'true')
  video.setAttribute('webkit-playsinline', 'true')
  video.muted = true
  await video.play()
  live.value = true
}

async function startCamera() {
  try {
    await bindStream(await openRearCamera())
    unlockScanFeedback()
    status.value = '对准日期和金额，会自动识别'
    scheduleAuto(900)
  } catch (err) {
    live.value = false
    status.value = cameraErrorText(err)
  }
}

function scheduleAuto(ms) {
  clearTimeout(timer)
  if (closed || attempts >= MAX_AUTO) return
  timer = setTimeout(() => runScan(false), ms)
}

async function blobFromVideo() {
  return captureVideoFrame(videoEl.value, frameEl.value, landscape.value)
}

async function recognizeBlob(blob, manual) {
  const url = URL.createObjectURL(blob)
  try {
    return await recognizeImageOriented(url, props.kind, {
      allowLocal: !!manual,
      fields: props.fields,
      orientations: orientationsForScan(manual, attempts)
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function fieldsComplete(parsed) {
  const need = (props.fields || []).filter((f) => f && f !== 'people')
  if (!need.length) return hasParsedValue(parsed)
  return parsedFieldScore(parsed, need) >= need.length
}

function emitStable(result, manual) {
  const complete = fieldsComplete(result && result.parsed)
  const stable = stabilizeParsed(result.parsed, props.fields, memo, manual || complete)
  if (!hasParsedValue(stable) && !manual) {
    status.value = attempts >= MAX_AUTO
      ? '还没认稳，对准后再点识别'
      : '正在认，可切换横竖版，倒着拍也会换方向试'
    return false
  }
  if (!hasParsedValue(stable) && manual) {
    status.value = '这帧没认出日期或金额，再对准一次'
    ElMessage.warning(status.value)
    return false
  }
  emit('hit', {
    engine: result.engine,
    text: result.text,
    parsed: Object.assign({}, result.parsed, stable),
    manual
  })
  status.value = '已认到，请看核验信息是否正确'
  notifyScanSuccess()
  return true
}

async function runScan(manual) {
  if (closed || busy.value) return
  if (!manual && !live.value) return
  busy.value = true
  if (!manual) attempts += 1
  status.value = manual ? '正在按各个方向识别…' : '正在识别…'
  try {
    const blob = await blobFromVideo()
    const result = await recognizeBlob(blob, manual)
    if (closed) return
    emitStable(result, manual)
  } catch (err) {
    if (closed) return
    status.value = (err && err.message) || '识别失败'
    if (manual) ElMessage.error(status.value)
    if (/识别太勤|今天识别次数|云识别较忙/.test(status.value)) {
      attempts = MAX_AUTO
    }
  } finally {
    busy.value = false
    if (!closed && !manual && attempts < MAX_AUTO) scheduleAuto(AUTO_MS)
    else if (!closed && attempts >= MAX_AUTO && !manual) {
      if (!/识别太勤|今天识别次数|云识别较忙/.test(status.value)) status.value = '还没认全，对准后点识别，或改用手填'
    }
  }
}

function scanNow() {
  unlockScanFeedback()
  runScan(true)
}

function pickShot() {
  unlockScanFeedback()
  if (shotEl.value) shotEl.value.click()
}

async function onShot(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file || busy.value || closed) return
  busy.value = true
  status.value = '正在按各个方向识别拍照…'
  try {
    const result = await recognizeBlob(file, true)
    if (closed) return
    emitStable(result, true)
  } catch (err) {
    if (closed) return
    status.value = (err && err.message) || '识别失败'
    ElMessage.error(status.value)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  resetScanFeedback()
  unlockScanFeedback()
  startCamera()
  if (typeof document !== 'undefined') document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  closed = true
  clearTimeout(timer)
  stopStream(stream)
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>
