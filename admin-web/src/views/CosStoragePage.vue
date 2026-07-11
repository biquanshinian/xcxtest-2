<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span>COS 云存储</span>
          <el-tag size="small" type="info">{{ COS_BUCKET }}</el-tag>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <el-button @click="reload">刷新</el-button>
          <el-button type="primary" @click="uploadRef?.click()">上传文件</el-button>
          <el-button @click="createFolderVisible = true">新建文件夹</el-button>
          <el-button size="default" :disabled="!selected.length" type="danger" @click="onBatchDelete">批量删除</el-button>
        </div>
      </div>
    </template>

    <div class="cos-breadcrumb">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item>
          <el-link :underline="false" @click="navigateTo('')">根目录</el-link>
        </el-breadcrumb-item>
        <el-breadcrumb-item v-for="(seg, i) in breadcrumbs" :key="i">
          <el-link :underline="false" @click="navigateTo(seg.prefix)">{{ seg.name }}</el-link>
        </el-breadcrumb-item>
      </el-breadcrumb>
      <el-text type="info" size="small" style="margin-left:auto;">
        {{ folders.length }} 个文件夹，{{ files.length }} 个文件
      </el-text>
    </div>

    <el-table :data="tableData" v-loading="loading" stripe @selection-change="onSelectionChange" empty-text="当前目录为空">
      <el-table-column type="selection" width="46" :selectable="row => row._type === 'file'" />
      <el-table-column label="名称" min-width="280">
        <template #default="{ row }">
          <div style="display:flex;align-items:center;gap:8px;cursor:pointer;" @click="onRowClick(row)">
            <svg v-if="row._type === 'folder'" viewBox="0 0 24 24" width="20" height="20" fill="#FFCC00">
              <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            <img v-else-if="isImageFile(row.name || row.key || '')" :src="row.url" class="cos-file-thumb" @error="e => e.target.style.display='none'" />
            <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="var(--t-text-muted, #8E8E93)">
              <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
            </svg>
            <span :style="{ fontWeight: row._type === 'folder' ? 500 : 400 }">{{ row.name || row.key || '' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="大小" width="120">
        <template #default="{ row }">{{ row._type === 'folder' ? '-' : formatSize(row.size) }}</template>
      </el-table-column>
      <el-table-column label="修改时间" width="180">
        <template #default="{ row }">{{ row.lastModified ? formatDate(row.lastModified) : '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240">
        <template #default="{ row }">
          <template v-if="row._type === 'folder'">
            <el-button size="small" @click="navigateTo(row.prefix)">打开</el-button>
          </template>
          <template v-else>
            <el-button v-if="isImageFile(row.name || row.key || '')" size="small" @click="openPreview(row.url)">预览</el-button>
            <el-button size="small" @click="copyUrl(row.url)">复制链接</el-button>
            <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="hasMore" style="text-align:center;margin-top:16px;">
      <el-button @click="loadMore" :loading="loadingMore">加载更多</el-button>
    </div>
  </el-card>

  <input ref="uploadRef" type="file" multiple style="display:none" @change="onFilesSelected" />

  <el-dialog v-model="createFolderVisible" title="新建文件夹" width="420px">
    <el-input v-model="newFolderName" placeholder="文件夹名称" @keyup.enter="onCreateFolder" />
    <template #footer>
      <el-button @click="createFolderVisible = false">取消</el-button>
      <el-button type="primary" :loading="creatingFolder" @click="onCreateFolder">创建</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="previewVisible" title="预览" width="860px">
    <div style="display:flex;justify-content:center;">
      <img v-if="previewUrl" :src="previewUrl" style="max-width:100%;max-height:70vh;object-fit:contain;" />
    </div>
  </el-dialog>

  <el-dialog v-model="uploadProgressVisible" title="上传进度" width="500px" :close-on-click-modal="false" :close-on-press-escape="false">
    <div v-for="(task, i) in uploadTasks" :key="i" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <el-text size="small" truncated style="max-width:300px;">{{ task.name }}</el-text>
        <el-tag size="small" :type="task.status === 'done' ? 'success' : task.status === 'error' ? 'danger' : 'info'">
          {{ task.status === 'done' ? '完成' : task.status === 'error' ? '失败' : '上传中' }}
        </el-tag>
      </div>
      <el-progress :percentage="task.percent" :status="task.status === 'done' ? 'success' : task.status === 'error' ? 'exception' : undefined" />
    </div>
    <template #footer>
      <el-button :disabled="uploading" @click="uploadProgressVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const COS_BUCKET = 'mars-1397421562'

const currentPrefix = ref('')
const folders = ref([])
const files = ref([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const nextMarker = ref('')
const selected = ref([])
const uploadRef = ref(null)
const uploading = ref(false)

const createFolderVisible = ref(false)
const newFolderName = ref('')
const creatingFolder = ref(false)

const previewVisible = ref(false)
const previewUrl = ref('')

const uploadProgressVisible = ref(false)
const uploadTasks = ref([])

const breadcrumbs = computed(() => {
  const prefix = currentPrefix.value
  if (!prefix) return []
  const parts = prefix.replace(/\/$/, '').split('/')
  return parts.map((name, i) => ({
    name,
    prefix: parts.slice(0, i + 1).join('/') + '/'
  }))
})

function getDisplayName(item, prefix) {
  if (item.name) return item.name
  if (item.key) return item.key.replace(prefix, '').replace(/\/$/, '') || item.key
  return ''
}

const tableData = computed(() => {
  const prefix = currentPrefix.value
  const folderRows = folders.value.map(f => ({
    ...f,
    name: f.name || (f.prefix || '').replace(prefix, '').replace(/\/$/, ''),
    _type: 'folder'
  }))

  const realFiles = []
  const extraFolders = new Set(folderRows.map(f => f.prefix))
  for (const f of files.value) {
    const displayName = getDisplayName(f, prefix)
    if (displayName.includes('/')) {
      const folderPrefix = prefix + displayName.split('/')[0] + '/'
      if (!extraFolders.has(folderPrefix)) {
        extraFolders.add(folderPrefix)
        folderRows.push({
          prefix: folderPrefix,
          name: displayName.split('/')[0],
          _type: 'folder'
        })
      }
    } else {
      realFiles.push({ ...f, name: displayName, _type: 'file' })
    }
  }
  folderRows.sort((a, b) => a.name.localeCompare(b.name))
  return [...folderRows, ...realFiles]
})

function isImageFile(name) {
  return /\.(jpe?g|png|gif|webp|bmp|svg|ico)$/i.test(name || '')
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function fetchFiles(prefix, marker = '') {
  const data = await api.cosListFiles({ prefix, delimiter: '/', maxKeys: 200, marker })
  return data
}

async function reload() {
  loading.value = true
  selected.value = []
  try {
    const data = await fetchFiles(currentPrefix.value)
    folders.value = data.folders || []
    files.value = data.files || []
    hasMore.value = data.isTruncated
    nextMarker.value = data.nextMarker || ''
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!hasMore.value) return
  loadingMore.value = true
  try {
    const data = await fetchFiles(currentPrefix.value, nextMarker.value)
    folders.value.push(...(data.folders || []))
    files.value.push(...(data.files || []))
    hasMore.value = data.isTruncated
    nextMarker.value = data.nextMarker || ''
  } catch (e) {
    ElMessage.error(e.message || '加载更多失败')
  } finally {
    loadingMore.value = false
  }
}

function navigateTo(prefix) {
  currentPrefix.value = prefix
  reload()
}

function onRowClick(row) {
  if (row._type === 'folder') {
    navigateTo(row.prefix)
  } else if (isImageFile(row.name || row.key || '')) {
    openPreview(row.url)
  }
}

function onSelectionChange(rows) {
  selected.value = rows.filter(r => r._type === 'file')
}

function openPreview(url) {
  previewUrl.value = url
  previewVisible.value = true
}

async function copyUrl(url) {
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success('链接已复制')
  } catch {
    const input = document.createElement('input')
    input.value = url
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    ElMessage.success('链接已复制')
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除文件 "${row.name || row.key}" 吗？删除后不可恢复。`, '确认删除', { type: 'warning' })
    await api.cosDeleteFile({ key: row.key })
    ElMessage.success('已删除')
    reload()
  } catch (e) {
    if (e !== 'cancel' && e?.message !== 'cancel') {
      ElMessage.error(e.message || '删除失败')
    }
  }
}

async function onBatchDelete() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 个文件吗？`, '批量删除', { type: 'warning' })
    let successCount = 0
    let failCount = 0
    for (const file of selected.value) {
      try {
        await api.cosDeleteFile({ key: file.key })
        successCount++
      } catch {
        failCount++
      }
    }
    ElMessage.success(`删除完成：成功 ${successCount}，失败 ${failCount}`)
    reload()
  } catch (e) {
    if (e !== 'cancel' && e?.message !== 'cancel') {
      ElMessage.error(e.message || '批量删除失败')
    }
  }
}

async function onCreateFolder() {
  const name = newFolderName.value.trim().replace(/\//g, '')
  if (!name) {
    ElMessage.warning('文件夹名称不能为空')
    return
  }
  creatingFolder.value = true
  try {
    await api.cosCreateFolder({ folderName: name, prefix: currentPrefix.value })
    ElMessage.success(`文件夹 "${name}" 创建成功`)
    newFolderName.value = ''
    createFolderVisible.value = false
    reload()
  } catch (e) {
    ElMessage.error(e.message || '创建文件夹失败')
  } finally {
    creatingFolder.value = false
  }
}

async function onFilesSelected(e) {
  const fileList = Array.from(e.target.files || [])
  if (!fileList.length) return
  e.target.value = ''

  uploading.value = true
  uploadTasks.value = fileList.map(f => ({ name: f.name, percent: 0, status: 'uploading' }))
  uploadProgressVisible.value = true

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i]
    const task = uploadTasks.value[i]
    try {
      const ext = (file.name || '').split('.').pop() || 'bin'
      const ts = Date.now()
      const rand = Math.random().toString(36).slice(2, 8)
      const key = `${currentPrefix.value}${ts}_${rand}.${ext}`

      const presignData = await api.cosPresign({ key })

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', presignData.uploadUrl, true)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) task.percent = Math.round((ev.loaded / ev.total) * 100)
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`HTTP ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.send(file)
      })

      task.percent = 100
      task.status = 'done'
    } catch {
      task.status = 'error'
    }
  }

  uploading.value = false
  const doneCount = uploadTasks.value.filter(t => t.status === 'done').length
  ElMessage.success(`上传完成：${doneCount}/${fileList.length}`)
  reload()
}

onMounted(reload)
</script>

<style scoped>
.cos-breadcrumb {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 8px 12px;
  background: var(--t-bg-input, #f5f7fa);
  border-radius: 8px;
  border: 1px solid var(--t-border-input, #dcdfe6);
}

.cos-file-thumb {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
</style>
