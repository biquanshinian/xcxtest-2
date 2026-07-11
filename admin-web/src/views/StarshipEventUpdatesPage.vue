<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div>事件更新追踪</div>
        <div style="display:flex;gap:8px;">
          <el-select v-model="query.status" placeholder="状态筛选" style="width:140px" clearable @change="load">
            <el-option label="已发布" value="published" />
            <el-option label="草稿" value="draft" />
          </el-select>
          <el-select v-model="query.bilibiliSyncStatus" placeholder="B站同步" style="width:140px" clearable @change="load">
            <el-option label="未同步" value="idle" />
            <el-option label="已入队" value="queued" />
            <el-option label="已合并" value="merged" />
            <el-option label="成功" value="success" />
            <el-option label="失败" value="failed" />
            <el-option label="跳过" value="skipped" />
          </el-select>
          <el-button @click="load">查询</el-button>
          <el-button type="primary" @click="openCreate">新建事件</el-button>
        </div>
      </div>
    </template>

    <el-table :data="list" stripe>
      <el-table-column prop="title" label="标题" min-width="200" />
      <el-table-column label="内容" min-width="240">
        <template #default="scope">
          <span class="content-ellipsis">{{ scope.row.content || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="媒体" width="80" align="center">
        <template #default="scope">
          <span>{{ (scope.row.mediaList || []).length }}项</span>
        </template>
      </el-table-column>
      <el-table-column label="直播" width="100" align="center">
        <template #default="scope">
          <el-tag v-if="scope.row.liveRoomId" type="danger" size="small">{{ scope.row.liveRoomId }}</el-tag>
          <span v-else style="color:var(--t-text-placeholder, #aeaeb2)">-</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default="scope">
          <el-tag :type="scope.row.status === 'published' ? 'success' : 'info'">{{ scope.row.status === 'published' ? '已发布' : '草稿' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="B站同步" width="120" align="center">
        <template #default="scope">
          <el-tag :type="biliTagType(scope.row.bilibiliSyncStatus)" size="small">{{ biliStatusLabel(scope.row.bilibiliSyncStatus) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="B站动态" min-width="140" show-overflow-tooltip>
        <template #default="scope">
          <a
            v-if="scope.row.bilibiliDynamicId"
            :href="`https://t.bilibili.com/${scope.row.bilibiliDynamicId}`"
            target="_blank"
            rel="noopener"
          >{{ scope.row.bilibiliDynamicId }}</a>
          <span v-else-if="scope.row.bilibiliLastError" style="color:var(--el-color-danger);font-size:12px;">{{ scope.row.bilibiliLastError }}</span>
          <span v-else style="color:var(--t-text-placeholder, #aeaeb2)">-</span>
        </template>
      </el-table-column>
      <el-table-column label="发布时间" width="180">
        <template #default="scope">
          <span>{{ scope.row.publishedAt ? formatTime(scope.row.publishedAt) : '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="作者" prop="author" width="100" />
      <el-table-column label="操作" width="220">
        <template #default="scope">
          <el-button size="small" @click="openEdit(scope.row)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="query.pageSize"
        :current-page="query.page"
        @current-change="onPageChange"
      />
    </div>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editing ? '编辑事件更新' : '新建事件更新'" width="720px" @opened="onDialogOpened" @closed="onDialogClosed">
    <el-form :model="form" label-width="90px">
      <el-form-item label="标题">
        <el-input v-model="form.title" placeholder="事件标题" />
      </el-form-item>
      <el-form-item label="内容描述">
        <el-input v-model="form.content" type="textarea" :rows="4" placeholder="事件详情文字描述" />
      </el-form-item>
      <el-form-item label="媒体文件">
        <div class="media-upload-area">
          <div class="media-preview-grid" v-if="form.mediaList.length > 0">
            <div v-for="(media, idx) in form.mediaList" :key="idx" class="media-preview-card">
              <img v-if="media.type === 'image'" :src="media.url" class="media-thumb" />
              <video v-else-if="media.type === 'video'" :src="media.url" class="media-thumb" />
              <div class="media-card-overlay">
                <el-tag size="small" :type="media.type === 'video' ? 'warning' : ''">{{ media.type === 'image' ? '图片' : '视频' }}</el-tag>
                <el-button size="small" type="danger" circle @click="removeMedia(idx)">
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
                </el-button>
              </div>
            </div>
          </div>

          <div v-if="uploadTasks.length > 0" class="upload-tasks">
            <div v-for="(task, idx) in uploadTasks" :key="'t-'+idx" class="upload-task-item">
              <span class="task-name">{{ task.name }}</span>
              <el-progress :percentage="task.percent" :status="task.error ? 'exception' : task.percent >= 100 ? 'success' : ''" :stroke-width="6" style="flex:1" />
              <span v-if="task.error" class="task-error">{{ task.error }}</span>
              <el-button size="small" type="danger" text @click="removeUploadTask(idx)">移除</el-button>
            </div>
          </div>

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
              <span class="drop-zone-title">拖拽或粘贴图片、视频，<em>点击选择文件</em></span>
              <span class="drop-zone-hint">支持 jpg / png / gif / webp / mp4 / mov，自动上传至 COS</span>
            </div>
          </div>

          <div class="url-paste-row">
            <el-input
              v-model="pasteUrl"
              placeholder="或粘贴图片/视频 URL 添加"
              clearable
              @keyup.enter="addMediaByUrl"
            >
              <template #append>
                <el-button @click="addMediaByUrl">添加</el-button>
              </template>
            </el-input>
          </div>

          <input ref="fileInputRef" type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.mov" multiple style="display:none" @change="onFileInputChange" />
        </div>
      </el-form-item>
      <el-divider content-position="left">直播设置（可选）</el-divider>
      <el-form-item label="直播间 ID">
        <el-input v-model="form.liveRoomId" placeholder="B站直播间房间号或链接，如 390508" style="max-width:420px" @change="onLiveRoomIdChange">
          <template #prepend>bilibili</template>
        </el-input>
        <el-text type="info" style="margin-left:12px;white-space:nowrap">支持粘贴完整链接，自动提取房间号</el-text>
      </el-form-item>
      <el-form-item label="直播封面" v-if="form.liveRoomId">
        <el-input v-model="form.liveCover" placeholder="可选，不填则自动从B站获取" clearable />
      </el-form-item>
      <el-form-item label="直播预览" v-if="form.liveRoomId">
        <div class="live-preview-box">
          <el-tag v-if="livePreview.loading">查询中...</el-tag>
          <template v-else-if="livePreview.title">
            <el-tag :type="livePreview.status === 1 ? 'danger' : 'info'">{{ livePreview.status === 1 ? '● 直播中' : '未开播' }}</el-tag>
            <span style="margin-left:8px;color:var(--el-text-color-regular)">{{ livePreview.title }}</span>
          </template>
          <el-button size="small" @click="checkLivePreview" :loading="livePreview.loading" style="margin-left:12px">检测直播状态</el-button>
        </div>
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="form.status">
          <el-radio value="draft">草稿</el-radio>
          <el-radio value="published">发布</el-radio>
        </el-radio-group>
        <el-text v-if="form.status === 'published'" type="info" style="margin-left:12px">发布后前端将自动展示，并记录发布时间</el-text>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="uploadTasks.some(t => !t.error && t.percent < 100)" @click="onSubmit">{{ form.status === 'published' ? '发布' : '保存草稿' }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const COS_PATH_PREFIX = '爱好者追踪图文库/'

const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp']
const ALLOWED_VIDEO_EXTS = ['mp4', 'mov']
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime']
const IMAGE_MAX_SIZE = 10 * 1024 * 1024
const VIDEO_MAX_SIZE = 30 * 1024 * 1024

const list = ref([])
const total = ref(0)
const saving = ref(false)
const dialogVisible = ref(false)
const editing = ref(null)
const isDragActive = ref(false)
const fileInputRef = ref(null)
const uploadTasks = ref([])
const pasteUrl = ref('')

const query = reactive({ page: 1, pageSize: 20, status: '', bilibiliSyncStatus: '' })
const form = reactive({ title: '', content: '', mediaList: [], status: 'draft', liveRoomId: '', livePlatform: 'bilibili', liveCover: '' })
const livePreview = reactive({ loading: false, status: 0, title: '' })

const biliStatusLabel = (s) => {
  const map = {
    idle: '未同步',
    queued: '已入队',
    merged: '已合并',
    success: '成功',
    failed: '失败',
    skipped: '跳过'
  }
  return map[s || 'idle'] || (s || '未同步')
}
const biliTagType = (s) => {
  const map = {
    idle: 'info',
    queued: 'warning',
    merged: 'warning',
    success: 'success',
    failed: 'danger',
    skipped: 'info'
  }
  return map[s || 'idle'] || 'info'
}

const resetForm = () => {
  Object.assign(form, { title: '', content: '', mediaList: [], status: 'draft', liveRoomId: '', livePlatform: 'bilibili', liveCover: '' })
  Object.assign(livePreview, { loading: false, status: 0, title: '' })
  uploadTasks.value = []
  pasteUrl.value = ''
}

const formatTime = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const load = async () => {
  try {
    const data = await api.listStarshipEvents(query)
    list.value = data.list || []
    total.value = data.total || 0
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  }
}

const onPageChange = (page) => { query.page = page; load() }

const openCreate = () => { editing.value = null; resetForm(); dialogVisible.value = true }

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, {
    title: row.title || '',
    content: row.content || '',
    mediaList: (row.mediaList || []).map(m => ({ ...m })),
    status: row.status || 'draft',
    liveRoomId: row.liveRoomId || '',
    livePlatform: row.livePlatform || 'bilibili',
    liveCover: row.liveCover || ''
  })
  Object.assign(livePreview, { loading: false, status: 0, title: '' })
  uploadTasks.value = []
  dialogVisible.value = true
}

const removeMedia = (idx) => { form.mediaList.splice(idx, 1) }

function getFileExt(name) {
  return (name || '').split('.').pop().toLowerCase()
}

function detectMediaType(file) {
  const ext = getFileExt(file.name)
  if (ALLOWED_IMAGE_EXTS.includes(ext) || ALLOWED_IMAGE_MIMES.includes(file.type)) return 'image'
  if (ALLOWED_VIDEO_EXTS.includes(ext) || ALLOWED_VIDEO_MIMES.includes(file.type)) return 'video'
  return null
}

function validateFile(file) {
  const mediaType = detectMediaType(file)
  if (!mediaType) {
    const ext = getFileExt(file.name)
    return { ok: false, error: `不支持的格式「.${ext}」，图片仅支持 jpg/png/gif/webp，视频仅支持 mp4/mov` }
  }
  const maxSize = mediaType === 'video' ? VIDEO_MAX_SIZE : IMAGE_MAX_SIZE
  const maxLabel = mediaType === 'video' ? '30MB' : '10MB'
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

const PROXY_BASE64_LIMIT = 70 * 1024

function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(blob)
  })
}

function compressImageForProxy(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let maxDim = 1600
      let w = img.width
      let h = img.height

      const drawAndTry = async () => {
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w)
            w = maxDim
          } else {
            w = Math.round((w * maxDim) / h)
            h = maxDim
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)

        const tryQuality = (q) => new Promise((res) => {
          canvas.toBlob((blob) => res(blob), 'image/jpeg', q)
        })

        for (let q = 0.7; q >= 0.15; q -= 0.15) {
          const blob = await tryQuality(q)
          if (!blob) continue
          if (blob.size <= PROXY_BASE64_LIMIT) return resolve(blob)
        }
        if (maxDim > 400) {
          maxDim = Math.floor(maxDim / 2)
          w = img.width
          h = img.height
          return drawAndTry()
        }
        const blob = await tryQuality(0.1)
        resolve(blob || new Blob())
      }
      drawAndTry()
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

async function uploadViaProxy(blob, key, contentType, task) {
  const base64Data = await fileToBase64(blob)
  if (base64Data.length * 0.75 > PROXY_BASE64_LIMIT) throw new Error('文件过大，请确保 COS 已配置跨域后重试')
  task.percent = 40
  const result = await api.cosProxyUpload({ key, base64Data, contentType })
  task.percent = 100
  return result.cosUrl
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
    xhr.onerror = () => reject(new Error('CORS'))
    xhr.send(file)
  })
}

function generateKeyForCompressedImage() {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `${COS_PATH_PREFIX}${ts}_${rand}.jpg`
}

function removeUploadTask(idx) {
  uploadTasks.value.splice(idx, 1)
}

function addMediaByUrl() {
  const url = (pasteUrl.value || '').trim()
  if (!url) {
    ElMessage.warning('请输入 URL')
    return
  }
  if (!/^https?:\/\//i.test(url)) {
    ElMessage.warning('请输入有效的 http 或 https 链接')
    return
  }
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase()
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp']
  const videoExts = ['mp4', 'mov']
  let mediaType = 'image'
  if (videoExts.includes(ext)) mediaType = 'video'
  else if (!imageExts.includes(ext)) {
    ElMessage.warning('仅支持 jpg/png/gif/webp/mp4/mov 格式的 URL')
    return
  }
  form.mediaList.push({ type: mediaType, url, thumbnailUrl: '' })
  pasteUrl.value = ''
  ElMessage.success('已添加')
}

async function uploadOneFile(file) {
  const { ok: isValid, mediaType, error } = validateFile(file)
  if (!isValid) {
    ElMessage.error(error)
    return
  }

  const key = generateKey(file)
  const task = reactive({ name: file.name, percent: 0, error: '' })
  uploadTasks.value.push(task)

  try {
    let cosUrl
    try {
      cosUrl = await uploadViaPresign(file, key, task)
    } catch (presignErr) {
      if (mediaType === 'video') {
        task.error = '视频上传失败，请确认管理员已在腾讯云 COS 配置跨域后重试'
        return
      }
      const isCors = (presignErr.message || '').includes('CORS')
      if (isCors || (presignErr.message || '').includes('网络')) {
        try {
          const compressed = await compressImageForProxy(file)
          const proxyKey = generateKeyForCompressedImage()
          cosUrl = await uploadViaProxy(compressed, proxyKey, 'image/jpeg', task)
        } catch (proxyErr) {
          task.error = '上传失败，请确认管理员已在腾讯云 COS 配置跨域后重试'
          return
        }
      } else {
        throw presignErr
      }
    }

    form.mediaList.push({ type: mediaType, url: cosUrl, thumbnailUrl: '' })
    const idx = uploadTasks.value.indexOf(task)
    if (idx >= 0) uploadTasks.value.splice(idx, 1)
  } catch (e) {
    task.error = (e.message || '上传失败').replace(/Exceed max request payload size[^.]*/i, '上传失败，请重试')
  }
}

async function handleFiles(files) {
  for (const file of files) {
    await uploadOneFile(file)
  }
}

function onDrop(e) {
  isDragActive.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (files.length) handleFiles(files)
}

function onPaste(e) {
  if (!dialogVisible.value) return
  const items = e.clipboardData?.items
  if (!items) return
  const files = []
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length) {
    e.preventDefault()
    handleFiles(files)
  }
}

function triggerFilePicker() {
  fileInputRef.value?.click()
}

function onFileInputChange(e) {
  const files = Array.from(e.target?.files || [])
  if (files.length) handleFiles(files)
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function onDialogOpened() {
  document.addEventListener('paste', onPaste)
}

function onDialogClosed() {
  document.removeEventListener('paste', onPaste)
  uploadTasks.value = []
}

onBeforeUnmount(() => {
  document.removeEventListener('paste', onPaste)
})

const WORKER_URL = 'https://spacex-proxy.huyuzetongxue.workers.dev'

function extractBiliRoomId(raw) {
  if (!raw) return ''
  const m = String(raw).match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d+)/)
  return m ? m[1] : String(raw).replace(/\D/g, '')
}

const onLiveRoomIdChange = () => {
  const extracted = extractBiliRoomId(form.liveRoomId)
  if (extracted && extracted !== form.liveRoomId) {
    form.liveRoomId = extracted
    ElMessage.success(`已自动提取房间号: ${extracted}`)
  }
}

const checkLivePreview = async () => {
  const roomId = (form.liveRoomId || '').trim()
  if (!roomId) { ElMessage.warning('请先填写直播间 ID'); return }
  livePreview.loading = true
  livePreview.status = 0
  livePreview.title = ''
  try {
    const res = await fetch(`${WORKER_URL}/live?room_id=${roomId}`)
    const data = await res.json()
    if (data.code === 0) {
      livePreview.status = data.liveStatus || 0
      livePreview.title = data.title || ''
      if (!form.liveCover && data.cover) form.liveCover = data.cover
    } else {
      ElMessage.warning('查询失败，请检查直播间 ID')
    }
  } catch (e) {
    ElMessage.error('网络请求失败: ' + (e.message || ''))
  } finally {
    livePreview.loading = false
  }
}

const onSubmit = async () => {
  if (!form.title.trim()) { ElMessage.warning('请填写标题'); return }
  saving.value = true
  try {
    const payload = {
      title: form.title,
      content: form.content,
      mediaList: form.mediaList.filter(m => m.url),
      status: form.status,
      liveRoomId: (form.liveRoomId || '').trim(),
      livePlatform: form.livePlatform || 'bilibili',
      liveCover: (form.liveCover || '').trim()
    }
    if (editing.value?._id || editing.value?.id) {
      await api.updateStarshipEvent(editing.value._id || editing.value.id, payload)
    } else {
      await api.createStarshipEvent(payload)
    }
    ElMessage.success(form.status === 'published' ? '发布成功' : '保存成功')
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const onDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确认删除该条事件更新吗？', '提示', { type: 'warning' })
    await api.deleteStarshipEvent(row._id || row.id)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

onMounted(load)
</script>

<style scoped>
.content-ellipsis {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

.media-upload-area {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.media-preview-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.media-preview-card {
  position: relative;
  width: 100px;
  height: 100px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  background: var(--el-fill-color-light, #f5f7fa);
}

.media-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.media-card-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.2s;
}

.media-preview-card:hover .media-card-overlay {
  opacity: 1;
}

.upload-tasks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.upload-task-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--el-fill-color-lighter, #fafafa);
  border-radius: 6px;
  font-size: 12px;
}

.task-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-regular, #606266);
}

.task-error {
  color: #FF453A;
  font-size: 11px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drop-zone {
  border: 2px dashed var(--el-border-color, #dcdfe6);
  border-radius: 10px;
  padding: 28px 16px;
  cursor: pointer;
  transition: all 0.25s;
  background: var(--el-fill-color-blank, #fff);
}

.drop-zone:hover {
  border-color: #007AFF;
  background: rgba(0, 122, 255, 0.03);
}

.drop-zone-active {
  border-color: #007AFF;
  background: rgba(0, 122, 255, 0.06);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
}

.drop-zone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-placeholder, #a8abb2);
}

.drop-zone-title {
  font-size: 14px;
  color: var(--el-text-color-secondary, #909399);
}

.drop-zone-title em {
  color: #007AFF;
  font-style: normal;
  font-weight: 500;
}

.drop-zone-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder, #a8abb2);
}

.url-paste-row {
  margin-top: 12px;
}

.live-preview-box {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
