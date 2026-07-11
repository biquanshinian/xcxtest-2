<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>开屏动画设置</span>
        <el-button type="primary" :loading="saving" @click="onSave">保存配置</el-button>
      </div>
    </template>

    <el-form :model="form" label-width="120px" style="max-width:720px;">
      <el-form-item label="启用开屏动画">
        <el-switch v-model="form.enabled" />
      </el-form-item>

      <el-form-item label="倒计时秒数">
        <el-input-number v-model="form.countdownSeconds" :min="1" :max="30" :step="1" />
        <span style="margin-left:8px;color:var(--t-text-muted);font-size:12px;">用户首次进入小程序时展示的秒数</span>
      </el-form-item>

      <el-form-item label="开屏媒体池">
        <div class="splash-upload-area">
          <div class="splash-pool-hint">
            最多 {{ MEDIA_MAX }} 个（图片/视频均可）。小程序每次冷启动会<strong>随机</strong>展示其中一条。视频保存后自动压缩预览。
            <span style="margin-left:8px;">已上传 {{ form.mediaItems.length }} / {{ MEDIA_MAX }}</span>
          </div>

          <div v-if="form.mediaItems.length" class="splash-media-grid">
            <div v-for="(item, idx) in form.mediaItems" :key="item.id" class="splash-preview">
              <video
                v-if="item.mediaType === 'video'"
                :src="item.previewUrl || item.mediaUrl"
                class="splash-preview-media"
                controls
                :poster="item.posterUrl || undefined"
              />
              <img v-else class="splash-preview-media" :src="item.mediaUrl" />
              <div class="splash-preview-actions">
                <el-tag size="small" :type="item.mediaType === 'video' ? 'warning' : ''">
                  {{ idx + 1 }}. {{ item.mediaType === 'video' ? '视频' : '图片' }}
                </el-tag>
                <el-tag v-if="item.mediaType === 'video' && item.previewStatus === 'ready'" size="small" type="success">预览就绪</el-tag>
                <el-tag v-else-if="item.mediaType === 'video' && (item.previewStatus === 'processing' || item.previewStatus === 'pending')" size="small" type="info">转码中</el-tag>
                <el-tag v-else-if="item.mediaType === 'video' && item.previewStatus === 'failed'" size="small" type="danger">转码失败</el-tag>
                <el-button size="small" type="danger" @click="removeMediaAt(idx)">移除</el-button>
              </div>
            </div>
          </div>

          <div v-if="uploadTasks.length" class="upload-tasks">
            <div v-for="(task, i) in uploadTasks" :key="i" class="upload-task-row">
              <span class="task-name">{{ task.name }}</span>
              <el-progress
                :percentage="task.percent"
                :status="task.error ? 'exception' : task.percent >= 100 ? 'success' : ''"
                :stroke-width="6"
                style="flex:1"
              />
              <span v-if="task.error" class="task-error">{{ task.error }}</span>
            </div>
          </div>

          <div v-if="form.mediaItems.length < MEDIA_MAX" class="splash-source-area">
            <div
              class="drop-zone"
              :class="{ 'drop-zone-active': isDragActive }"
              @dragover.prevent="isDragActive = true"
              @dragleave="isDragActive = false"
              @drop.prevent="onDrop"
              @click="triggerFilePicker"
            >
              <div class="drop-zone-content">
                <svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 32l8-8 6 6 8-10 10 12"/><rect x="4" y="4" width="40" height="40" rx="4"/><circle cx="14" cy="16" r="3"/></svg>
                <span class="drop-zone-title">拖拽或点击继续添加（可多选）</span>
                <span class="drop-zone-hint">要求 9:16 竖版，图片 ≤ 3MB，视频 ≤ 20MB · jpg/png/webp/mp4/mov</span>
              </div>
            </div>

            <div class="source-divider">
              <span class="source-divider-text">或</span>
            </div>

            <div class="cos-pick-zone" @click="openCosPicker">
              <div class="drop-zone-content">
                <svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="40" height="32" rx="4"/><path d="M20 8V6a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M16 24h16M16 30h10"/></svg>
                <span class="drop-zone-title">从 COS 桶选择</span>
                <span class="drop-zone-hint">浏览已上传到 COS 的图片或视频文件</span>
              </div>
            </div>
          </div>

          <div v-else class="splash-pool-full">已达上限 {{ MEDIA_MAX }} 个，请先移除后再添加</div>

          <div v-if="form.mediaItems.some(i => i.mediaType === 'video')" class="splash-preview-tip" style="margin-top:12px;">
            <el-button size="small" :loading="refreshingPreview" @click="refreshPreviewStatus">刷新全部预览状态</el-button>
            <span style="margin-left:8px;">视频转码通常 1–3 分钟</span>
          </div>

          <input
            ref="fileInputRef"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.mp4,.mov"
            multiple
            style="display:none"
            @change="onFileInputChange"
          />
        </div>
      </el-form-item>
    </el-form>
  </el-card>

  <el-dialog v-model="cosPickerVisible" title="从 COS 桶选择文件" width="800px" :close-on-click-modal="false">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item>
          <el-link :underline="false" @click="cosNavigateTo('')">根目录</el-link>
        </el-breadcrumb-item>
        <el-breadcrumb-item v-for="(seg, i) in cosBreadcrumbs" :key="i">
          <el-link :underline="false" @click="cosNavigateTo(seg.prefix)">{{ seg.name }}</el-link>
        </el-breadcrumb-item>
      </el-breadcrumb>
      <el-text type="info" size="small" style="margin-left:auto;">仅显示图片和视频文件</el-text>
    </div>

    <el-table :data="cosTableData" v-loading="cosLoading" stripe :max-height="400" empty-text="当前目录为空" highlight-current-row @row-click="onCosRowClick">
      <el-table-column label="名称" min-width="280">
        <template #default="{ row }">
          <div style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <svg v-if="row._type === 'folder'" viewBox="0 0 24 24" width="20" height="20" fill="#FFCC00">
              <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            <img v-else-if="isCosImageFile(row.name || row.key || '')" :src="row.url" style="width:32px;height:32px;object-fit:cover;border-radius:4px;" @error="e => e.target.style.display='none'" />
            <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="#FF9500">
              <path d="M8 5v14l11-7z"/>
            </svg>
            <span>{{ row.name || row.key || '' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="大小" width="100">
        <template #default="{ row }">{{ row._type === 'folder' ? '-' : cosFormatSize(row.size) }}</template>
      </el-table-column>
    </el-table>

    <div v-if="cosHasMore" style="text-align:center;margin-top:12px;">
      <el-button size="small" @click="cosLoadMore" :loading="cosLoadingMore">加载更多</el-button>
    </div>

    <template #footer>
      <el-button @click="cosPickerVisible = false">取消</el-button>
      <el-button type="primary" :disabled="!cosSelectedFile" @click="onCosConfirm">
        确认选择{{ cosSelectedFile ? ` (${cosSelectedFile.name || cosSelectedFile.key})` : '' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { onMounted, reactive, ref, watchEffect } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const COS_PATH_PREFIX = '开屏动画/'
const MEDIA_MAX = 10
const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp']
const ALLOWED_VIDEO_EXTS = ['mp4', 'mov']
const IMAGE_MAX_SIZE = 3 * 1024 * 1024
const VIDEO_MAX_SIZE = 20 * 1024 * 1024

const form = reactive({
  enabled: false,
  countdownSeconds: 5,
  mediaItems: []
})

const saving = ref(false)
const refreshingPreview = ref(false)
const isDragActive = ref(false)
const uploadTasks = ref([])
const fileInputRef = ref(null)

function newId() {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function applySplashData(data) {
  if (!data) return
  form.enabled = !!data.enabled
  form.countdownSeconds = data.countdownSeconds || 5
  let items = Array.isArray(data.mediaItems) ? data.mediaItems : []
  if (!items.length && data.mediaUrl) {
    items = [{
      id: 'legacy',
      mediaType: data.mediaType || 'image',
      mediaUrl: data.mediaUrl,
      previewUrl: data.previewUrl || '',
      posterUrl: data.posterUrl || '',
      previewStatus: data.previewStatus || ''
    }]
  }
  form.mediaItems = items.slice(0, MEDIA_MAX).map((it) => ({
    id: it.id || newId(),
    mediaType: it.mediaType || 'image',
    mediaUrl: it.mediaUrl || '',
    previewUrl: it.previewUrl || '',
    posterUrl: it.posterUrl || '',
    previewStatus: it.previewStatus || ''
  }))
}

onMounted(async () => {
  try {
    const data = await api.getStarshipSplash()
    applySplashData(data)
  } catch (e) {
    ElMessage.error('加载配置失败: ' + (e.message || ''))
  }
})

function getFileExt(name) {
  return (name || '').split('.').pop().toLowerCase()
}

function detectMediaType(file) {
  const ext = getFileExt(file.name)
  if (ALLOWED_IMAGE_EXTS.includes(ext)) return 'image'
  if (ALLOWED_VIDEO_EXTS.includes(ext)) return 'video'
  return null
}

function validateFile(file) {
  const mediaType = detectMediaType(file)
  if (!mediaType) {
    return { ok: false, error: '不支持的格式，图片仅支持 jpg/png/webp，视频仅支持 mp4/mov' }
  }
  const maxSize = mediaType === 'video' ? VIDEO_MAX_SIZE : IMAGE_MAX_SIZE
  const maxLabel = mediaType === 'video' ? '20MB' : '3MB'
  if (file.size > maxSize) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1)
    return { ok: false, error: `文件 ${sizeMB}MB 超过${mediaType === 'video' ? '视频' : '图片'}限制(${maxLabel})` }
  }
  return { ok: true, mediaType }
}

function generateKey(file) {
  const ext = getFileExt(file.name) || 'bin'
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `${COS_PATH_PREFIX}${ts}_${rand}.${ext}`
}

async function uploadViaPresign(file, key, task) {
  const presignData = await api.cosPresign({ key })
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', presignData.uploadUrl, true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) task.percent = Math.round((e.loaded / e.total) * 95)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        task.percent = 100
        resolve(presignData.cosUrl)
      } else reject(new Error(`HTTP ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('上传失败，请确认 COS 跨域配置'))
    xhr.send(file)
  })
}

function pushMediaItem(mediaType, cosUrl) {
  if (form.mediaItems.length >= MEDIA_MAX) {
    ElMessage.warning(`最多上传 ${MEDIA_MAX} 个开屏媒体`)
    return false
  }
  form.mediaItems.push({
    id: newId(),
    mediaType,
    mediaUrl: cosUrl,
    previewUrl: '',
    posterUrl: '',
    previewStatus: mediaType === 'video' ? 'pending' : ''
  })
  return true
}

async function uploadOneFile(file) {
  if (form.mediaItems.length >= MEDIA_MAX) {
    ElMessage.warning(`最多上传 ${MEDIA_MAX} 个开屏媒体`)
    return
  }
  const { ok, mediaType, error } = validateFile(file)
  if (!ok) {
    ElMessage.error(error)
    return
  }

  const key = generateKey(file)
  const task = reactive({ name: file.name, percent: 0, error: '' })
  uploadTasks.value.push(task)

  try {
    const cosUrl = await uploadViaPresign(file, key, task)
    pushMediaItem(mediaType, cosUrl)
    const idx = uploadTasks.value.indexOf(task)
    if (idx >= 0) uploadTasks.value.splice(idx, 1)
  } catch (e) {
    task.error = e.message || '上传失败'
  }
}

function removeMediaAt(idx) {
  form.mediaItems.splice(idx, 1)
}

function triggerFilePicker() {
  fileInputRef.value?.click()
}

function onFileInputChange(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  handleFiles(files)
}

function onDrop(e) {
  isDragActive.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  handleFiles(files)
}

async function handleFiles(files) {
  for (const file of files) {
    if (form.mediaItems.length >= MEDIA_MAX) {
      ElMessage.warning(`已达上限 ${MEDIA_MAX} 个`)
      break
    }
    await uploadOneFile(file)
  }
}

async function refreshPreviewStatus() {
  refreshingPreview.value = true
  try {
    const data = await api.getStarshipSplash()
    applySplashData(data)
    const videos = form.mediaItems.filter((i) => i.mediaType === 'video')
    const ready = videos.filter((i) => i.previewStatus === 'ready').length
    if (!videos.length) {
      ElMessage.info('当前没有视频')
    } else if (ready === videos.length) {
      ElMessage.success(`全部 ${ready} 个视频预览已就绪`)
    } else {
      ElMessage.info(`预览就绪 ${ready}/${videos.length}，其余仍在转码或失败`)
    }
  } catch (e) {
    ElMessage.error('刷新失败: ' + (e.message || ''))
  } finally {
    refreshingPreview.value = false
  }
}

async function onSave() {
  saving.value = true
  try {
    const data = await api.updateStarshipSplash({
      enabled: form.enabled,
      countdownSeconds: form.countdownSeconds,
      mediaItems: form.mediaItems.map((it) => ({
        id: it.id,
        mediaType: it.mediaType,
        mediaUrl: it.mediaUrl,
        previewUrl: it.previewUrl || '',
        posterUrl: it.posterUrl || '',
        previewStatus: it.previewStatus || ''
      }))
    })
    if (data && typeof data === 'object') {
      applySplashData(data)
    }
    const pending = form.mediaItems.some(
      (i) => i.mediaType === 'video' && i.previewStatus !== 'ready' && i.previewStatus !== 'failed'
    )
    if (pending) {
      ElMessage.success('已保存，正在生成压缩预览（约 1–3 分钟）')
    } else {
      ElMessage.success('保存成功')
    }
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.message || ''))
  } finally {
    saving.value = false
  }
}

const COS_MEDIA_EXTS = /\.(jpg|jpeg|png|webp|mp4|mov)$/i
const cosPickerVisible = ref(false)
const cosLoading = ref(false)
const cosLoadingMore = ref(false)
const cosPrefix = ref('')
const cosFolders = ref([])
const cosFiles = ref([])
const cosMarker = ref('')
const cosHasMore = ref(false)
const cosSelectedFile = ref(null)
const cosBreadcrumbs = ref([])

function cosFormatSize(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function isCosImageFile(name) {
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(name)
}

function isCosMediaFile(name) {
  return COS_MEDIA_EXTS.test(name)
}

function buildCosBreadcrumbs(prefix) {
  if (!prefix) return []
  const parts = prefix.replace(/\/$/, '').split('/')
  return parts.map((name, i) => ({
    name,
    prefix: parts.slice(0, i + 1).join('/') + '/'
  }))
}

async function cosLoadFiles(prefix, marker = '') {
  cosLoading.value = !marker
  cosLoadingMore.value = !!marker
  try {
    const res = await api.cosListFiles({ prefix, marker, maxKeys: 200 })
    const folders = (res.folders || []).map(f => ({ ...f, _type: 'folder' }))
    const files = (res.files || []).filter(f => isCosMediaFile(f.name || f.key || '')).map(f => ({ ...f, _type: 'file' }))
    if (marker) {
      cosFolders.value = [...cosFolders.value, ...folders]
      cosFiles.value = [...cosFiles.value, ...files]
    } else {
      cosFolders.value = folders
      cosFiles.value = files
    }
    cosMarker.value = res.nextMarker || ''
    cosHasMore.value = !!res.nextMarker
  } catch (e) {
    ElMessage.error('加载 COS 文件列表失败')
  } finally {
    cosLoading.value = false
    cosLoadingMore.value = false
  }
}

const cosTableData = ref([])
watchEffect(() => {
  cosTableData.value = [...cosFolders.value, ...cosFiles.value]
})

function openCosPicker() {
  if (form.mediaItems.length >= MEDIA_MAX) {
    ElMessage.warning(`最多上传 ${MEDIA_MAX} 个开屏媒体`)
    return
  }
  cosSelectedFile.value = null
  cosPrefix.value = '开屏动画/'
  cosBreadcrumbs.value = buildCosBreadcrumbs('开屏动画/')
  cosPickerVisible.value = true
  cosLoadFiles('开屏动画/')
}

function cosNavigateTo(prefix) {
  cosSelectedFile.value = null
  cosPrefix.value = prefix
  cosBreadcrumbs.value = buildCosBreadcrumbs(prefix)
  cosLoadFiles(prefix)
}

function cosLoadMore() {
  cosLoadFiles(cosPrefix.value, cosMarker.value)
}

function onCosRowClick(row) {
  if (row._type === 'folder') {
    cosNavigateTo(row.prefix)
    return
  }
  cosSelectedFile.value = row
}

function onCosConfirm() {
  const file = cosSelectedFile.value
  if (!file || !file.url) return
  if (form.mediaItems.length >= MEDIA_MAX) {
    ElMessage.warning(`最多上传 ${MEDIA_MAX} 个开屏媒体`)
    return
  }
  const name = file.name || file.key || ''
  const isVideo = /\.(mp4|mov)$/i.test(name)
  pushMediaItem(isVideo ? 'video' : 'image', file.url)
  cosPickerVisible.value = false
  ElMessage.success('已添加: ' + name + (isVideo ? '（保存后自动压缩）' : ''))
}
</script>

<style scoped>
.splash-upload-area {
  width: 100%;
}

.splash-pool-hint {
  font-size: 12px;
  color: var(--t-text-muted, #888);
  line-height: 1.6;
  margin-bottom: 12px;
}

.splash-media-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.splash-preview {
  position: relative;
  display: inline-block;
  max-width: 160px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--t-border-card, rgba(0,0,0,0.08));
}

.splash-preview-media {
  display: block;
  width: 160px;
  max-height: 284px;
  object-fit: contain;
  background: #000;
}

.splash-preview-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  padding: 6px 8px;
  gap: 6px;
}

.splash-preview-tip {
  font-size: 12px;
  line-height: 1.5;
  color: var(--t-text-muted, #888);
}

.splash-pool-full {
  padding: 12px;
  font-size: 13px;
  color: var(--t-text-muted, #888);
  background: rgba(0,0,0,0.03);
  border-radius: 8px;
}

.upload-tasks {
  margin-bottom: 12px;
}

.upload-task-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.task-name {
  font-size: 13px;
  color: var(--t-text-secondary, #666);
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-error {
  font-size: 12px;
  color: #FF453A;
}

.splash-source-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drop-zone,
.cos-pick-zone {
  border: 1px dashed var(--t-border-card, rgba(0,0,0,0.15));
  border-radius: 10px;
  padding: 20px 16px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}

.drop-zone:hover,
.cos-pick-zone:hover,
.drop-zone-active {
  border-color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.04);
}

.drop-zone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--t-text-secondary, #666);
  text-align: center;
}

.drop-zone-title {
  font-size: 14px;
  font-weight: 500;
}

.drop-zone-hint {
  font-size: 12px;
  color: var(--t-text-muted, #999);
}

.source-divider {
  display: flex;
  align-items: center;
  justify-content: center;
}

.source-divider-text {
  font-size: 12px;
  color: var(--t-text-muted, #999);
}
</style>
