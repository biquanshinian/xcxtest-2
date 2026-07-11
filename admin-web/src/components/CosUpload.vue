<template>
  <div class="cos-upload-advanced">
    <div v-if="currentUrl" class="adv-preview">
      <div class="adv-preview-card">
        <img v-if="isImage && !imgError" :src="currentUrl" class="adv-preview-thumb" @click="previewVisible = true" @error="imgError = true" />
        <video v-else-if="isVideo" :src="currentUrl" class="adv-preview-thumb" />
        <div v-else-if="isImage && imgError" class="adv-preview-thumb adv-preview-error" @click="imgError = false">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          <span>加载失败</span>
        </div>
        <div v-else class="adv-preview-thumb adv-preview-file">
          <span>{{ decodeURIComponent(currentUrl.split('/').pop()).slice(0, 20) }}</span>
        </div>
        <div class="adv-preview-overlay">
          <el-button size="small" type="danger" circle @click="onClear">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
          </el-button>
        </div>
      </div>
    </div>

    <div v-if="uploadTask" class="adv-task">
      <span class="adv-task-name">{{ uploadTask.name }}</span>
      <el-progress :percentage="uploadTask.percent" :status="uploadTask.error ? 'exception' : uploadTask.percent >= 100 ? 'success' : ''" :stroke-width="6" style="flex:1" />
      <span v-if="uploadTask.error" class="adv-task-error">{{ uploadTask.error }}</span>
    </div>

    <div
      class="adv-drop-zone"
      :class="{ 'adv-drop-zone-active': isDragActive }"
      @dragover.prevent="isDragActive = true"
      @dragleave="isDragActive = false"
      @drop.prevent="onDrop"
      @click="triggerFilePicker"
    >
      <div class="adv-drop-zone-content">
        <svg viewBox="0 0 48 48" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 32l8-8 6 6 8-10 10 12"/><rect x="4" y="4" width="40" height="40" rx="4"/><circle cx="14" cy="16" r="3"/></svg>
        <span class="adv-drop-title">拖拽或粘贴文件，<em>点击选择</em></span>
        <span class="adv-drop-hint">支持 {{ acceptHint }}，自动上传至 COS</span>
      </div>
    </div>

    <div class="adv-url-row">
      <el-input
        v-model="pasteUrl"
        placeholder="或粘贴文件 URL 添加"
        clearable
        size="default"
        @keyup.enter="addByUrl"
      >
        <template #append>
          <el-button @click="addByUrl">添加</el-button>
        </template>
      </el-input>
    </div>

    <input ref="fileInputRef" type="file" :accept="accept" style="display:none" @change="onFileInputChange" />

    <el-dialog v-model="previewVisible" title="预览" width="860px" append-to-body>
      <div style="display:flex;justify-content:center">
        <img :src="currentUrl" style="max-width:100%;max-height:70vh;object-fit:contain" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const props = defineProps({
  modelValue: { type: String, default: '' },
  pathPrefix: { type: String, default: 'admin-uploads/' },
  accept: { type: String, default: 'image/*,video/*' },
  buttonText: { type: String, default: '上传文件' },
  placeholder: { type: String, default: '或粘贴COS文件URL' },
  showInput: { type: Boolean, default: true }
})

const emit = defineEmits(['update:modelValue', 'success'])

const PROXY_BASE64_LIMIT = 70 * 1024
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp']
const VIDEO_EXTS = ['mp4', 'mov']
const IMAGE_MAX = 10 * 1024 * 1024
const VIDEO_MAX = 30 * 1024 * 1024

const currentUrl = ref(props.modelValue || '')
const isDragActive = ref(false)
const fileInputRef = ref(null)
const uploadTask = ref(null)
const pasteUrl = ref('')
const previewVisible = ref(false)
const imgError = ref(false)

watch(() => props.modelValue, (v) => { currentUrl.value = v || '' })
watch(() => currentUrl.value, () => { imgError.value = false })

const acceptHint = computed(() => {
  if (props.accept.includes('image') && props.accept.includes('video')) return 'jpg / png / gif / webp / mp4 / mov'
  if (props.accept.includes('video')) return 'mp4 / mov'
  return 'jpg / png / gif / webp'
})

const isImage = computed(() => /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i.test(currentUrl.value))
const isVideo = computed(() => /\.(mp4|mov|webm)(\?.*)?$/i.test(currentUrl.value))

function getExt(name) { return (name || '').split('.').pop().toLowerCase() }

function detectType(file) {
  const ext = getExt(file.name)
  if (IMAGE_EXTS.includes(ext) || (file.type && file.type.startsWith('image/'))) return 'image'
  if (VIDEO_EXTS.includes(ext) || (file.type && file.type.startsWith('video/'))) return 'video'
  return null
}

function validateFile(file) {
  const mediaType = detectType(file)
  if (!mediaType) return { ok: false, error: `不支持的格式「.${getExt(file.name)}」` }
  const max = mediaType === 'video' ? VIDEO_MAX : IMAGE_MAX
  const label = mediaType === 'video' ? '30MB' : '10MB'
  if (file.size > max) return { ok: false, error: `文件 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过限制(${label})` }
  return { ok: true, mediaType }
}

function generateKey(file) {
  const ext = getExt(file.name) || 'bin'
  return `${props.pathPrefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
}

function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(blob)
  })
}

function compressForProxy(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let maxDim = 1600, w = img.width, h = img.height
      const tryCompress = async () => {
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim }
          else { w = Math.round((w * maxDim) / h); h = maxDim }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        const tryQ = (q) => new Promise((r) => canvas.toBlob((b) => r(b), 'image/jpeg', q))
        for (let q = 0.7; q >= 0.15; q -= 0.15) {
          const blob = await tryQ(q)
          if (blob && blob.size <= PROXY_BASE64_LIMIT) return resolve(blob)
        }
        if (maxDim > 400) { maxDim = Math.floor(maxDim / 2); w = img.width; h = img.height; return tryCompress() }
        resolve(await tryQ(0.1) || new Blob())
      }
      tryCompress()
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')) }
    img.src = url
  })
}

async function uploadViaPresign(file, key, task) {
  const presignData = await api.cosPresign({ key })
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', presignData.uploadUrl, true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) task.percent = Math.round((e.loaded / e.total) * 95) }
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { task.percent = 100; resolve(presignData.cosUrl) } else reject(new Error(`HTTP ${xhr.status}`)) }
    xhr.onerror = () => reject(new Error('CORS'))
    xhr.send(file)
  })
}

async function uploadViaProxy(blob, key, contentType, task) {
  const base64Data = await fileToBase64(blob)
  if (base64Data.length * 0.75 > PROXY_BASE64_LIMIT) throw new Error('文件过大')
  task.percent = 40
  const result = await api.cosProxyUpload({ key, base64Data, contentType })
  task.percent = 100
  return result.cosUrl
}

async function uploadOneFile(file) {
  const { ok, mediaType, error } = validateFile(file)
  if (!ok) { ElMessage.error(error); return }

  const key = generateKey(file)
  const task = { name: file.name, percent: 0, error: '' }
  uploadTask.value = task

  try {
    let cosUrl
    try {
      cosUrl = await uploadViaPresign(file, key, task)
    } catch (presignErr) {
      if (mediaType === 'video') {
        const msg = '视频上传失败，请确认 COS 已配置跨域（PUT 预签名直传）'
        task.error = msg
        ElMessage.error(msg)
        return
      }
      const isCors = (presignErr.message || '').includes('CORS')
      if (isCors || (presignErr.message || '').includes('网络')) {
        try {
          const compressed = await compressForProxy(file)
          const proxyKey = `${props.pathPrefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
          cosUrl = await uploadViaProxy(compressed, proxyKey, 'image/jpeg', task)
        } catch (_e) { task.error = '上传失败，请确认 COS 已配置跨域'; return }
      } else throw presignErr
    }

    currentUrl.value = cosUrl
    emit('update:modelValue', cosUrl)
    emit('success', cosUrl)
    uploadTask.value = null
  } catch (e) {
    task.error = (e.message || '上传失败').replace(/Exceed max request payload size[^.]*/i, '上传失败')
  }
}

function onDrop(e) {
  isDragActive.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (files.length) uploadOneFile(files[0])
}

function onPaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) { e.preventDefault(); uploadOneFile(file); return }
    }
  }
}

function triggerFilePicker() { fileInputRef.value?.click() }

function onFileInputChange(e) {
  const files = Array.from(e.target?.files || [])
  if (files.length) uploadOneFile(files[0])
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function addByUrl() {
  const url = (pasteUrl.value || '').trim()
  if (!url) { ElMessage.warning('请输入 URL'); return }
  if (!/^https?:\/\//i.test(url)) { ElMessage.warning('请输入有效的 http(s) 链接'); return }
  currentUrl.value = url
  emit('update:modelValue', url)
  emit('success', url)
  pasteUrl.value = ''
  ElMessage.success('已添加')
}

function onClear() {
  currentUrl.value = ''
  emit('update:modelValue', '')
}

onMounted(() => { document.addEventListener('paste', onPaste) })
onBeforeUnmount(() => { document.removeEventListener('paste', onPaste) })
</script>

<style scoped>
.cos-upload-advanced {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.adv-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.adv-preview-card {
  position: relative;
  width: 100px;
  height: 100px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  background: var(--el-fill-color-light, #f5f7fa);
}

.adv-preview-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  cursor: pointer;
}

.adv-preview-error, .adv-preview-file {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--el-text-color-placeholder, #a8abb2);
  font-size: 10px;
  cursor: pointer;
}

.adv-preview-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.2s;
}

.adv-preview-card:hover .adv-preview-overlay {
  opacity: 1;
}

.adv-task {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--el-fill-color-lighter, #fafafa);
  border-radius: 6px;
  font-size: 12px;
}

.adv-task-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-regular, #606266);
}

.adv-task-error {
  color: #FF453A;
  font-size: 11px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.adv-drop-zone {
  border: 2px dashed var(--el-border-color, #dcdfe6);
  border-radius: 10px;
  padding: 24px 16px;
  cursor: pointer;
  transition: all 0.25s;
  background: var(--el-fill-color-blank, #fff);
}

.adv-drop-zone:hover {
  border-color: #007AFF;
  background: rgba(0, 122, 255, 0.03);
}

.adv-drop-zone-active {
  border-color: #007AFF;
  background: rgba(0, 122, 255, 0.06);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
}

.adv-drop-zone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-placeholder, #a8abb2);
}

.adv-drop-title {
  font-size: 14px;
  color: var(--el-text-color-secondary, #909399);
}

.adv-drop-title em {
  color: #007AFF;
  font-style: normal;
  font-weight: 500;
}

.adv-drop-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder, #a8abb2);
}

.adv-url-row {
  margin-top: 2px;
}
</style>
