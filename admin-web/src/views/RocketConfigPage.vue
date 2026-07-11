<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>火箭配置图（COS + media_assets）</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <el-button @click="reload">刷新列表</el-button>
          <el-button type="primary" @click="openUpload">上传图片 / GIF</el-button>
          <el-button type="warning" @click="openBatchUpload">批量上传</el-button>
          <el-button @click="openMatchTester">命中预览</el-button>
          <el-button type="success" :loading="syncing" @click="onSyncCosIndex">同步 COS → 数据库</el-button>
        </div>
      </div>
    </template>

    <div style="margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <el-text type="info" size="small">共 {{ total }} 条（当前前缀：火箭配置图/）</el-text>
    </div>

    <el-table :data="list" v-loading="loading" stripe empty-text="暂无记录">
      <el-table-column label="预览" width="100">
        <template #default="{ row }">
          <img
            v-if="row.url && !brokenThumbs[row._id]"
            :src="row.url"
            class="rocket-thumb"
            referrerpolicy="no-referrer"
            loading="lazy"
            alt=""
            @error="brokenThumbs[row._id] = true"
          />
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="Key" prop="key" min-width="220" show-overflow-tooltip />
      <el-table-column label="访问 URL" min-width="260" show-overflow-tooltip>
        <template #default="{ row }">{{ displayBaseUrl(row.url) }}</template>
      </el-table-column>
      <el-table-column label="来源" width="130">
        <template #default="{ row }">
          <el-tag size="small" :type="row.sourceTag === 'manual' ? 'success' : 'info'">{{ row.sourceTag || '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="90">
        <template #default="{ row }">
          <el-switch v-model="row.enabled" @change="() => onToggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="170">
        <template #default="{ row }">{{ fmt(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" @click="onReplaceClick(row)">替换</el-button>
          <el-button size="small" @click="openEdit(row)">改 URL</el-button>
          <el-button size="small" type="danger" @click="onDeleteRow(row)">删记录</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:16px;display:flex;justify-content:flex-end;">
      <el-pagination
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="reload"
      />
    </div>
  </el-card>

  <input ref="fileRef" type="file" accept="image/jpeg,image/png,image/webp,image/gif,.gif,.webp,.jpg,.jpeg,.png" style="display:none" @change="onFileChange" />
  <input ref="batchFileRef" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,.gif,.webp,.jpg,.jpeg,.png" style="display:none" @change="onBatchFileChange" />
  <input ref="replaceFileRef" type="file" accept="image/jpeg,image/png,image/webp,image/gif,.gif,.webp,.jpg,.jpeg,.png" style="display:none" @change="onReplaceFileChange" />

  <el-dialog v-model="uploadVisible" title="上传到 COS 并写入 media_assets" width="520px" @closed="resetUploadForm">
    <el-form label-width="96px">
      <el-form-item label="COS Key">
        <el-input v-model="uploadForm.objectKey" placeholder="例如：Starship.gif（将保存为 火箭配置图/…）" />
      </el-form-item>
      <el-form-item label="说明">
        <el-text size="small" type="info">Key 只需文件名部分；请勿包含「火箭配置图/」前缀（会自动补上）。GIF 体积建议控制在合理范围。</el-text>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="uploadVisible = false">取消</el-button>
      <el-button type="primary" :loading="uploading" @click="confirmPickFile">选择文件并开始上传</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="uploadProgressVisible" title="上传进度" width="480px" :close-on-click-modal="false">
    <el-progress :percentage="uploadPercent" :status="uploadStatus" />
    <el-text size="small" type="info">{{ uploadStatusText }}</el-text>
    <template #footer>
      <el-button :disabled="uploading || replaceUploading" @click="uploadProgressVisible = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="editVisible" title="修改访问 URL" width="560px">
    <el-input v-model="editUrl" type="textarea" :rows="3" placeholder="HTTPS 完整地址（保存时会自动追加 ?v= 时间戳以便客户端重新缓存）" />
    <template #footer>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :loading="editSaving" @click="saveEditUrl">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="batchVisible" title="批量上传到 COS" width="560px">
    <el-form label-width="96px">
      <el-form-item label="说明">
        <el-text size="small" type="info">
          批量选择本地图片 / GIF 文件，每个文件直接以「火箭配置图/原文件名」作为 COS Key 上传并写入 media_assets（manual）。
          请先调整文件名为目标火箭名（如 <code>Falcon 9 Block 5.gif</code>），以便小程序模糊匹配命中。
        </el-text>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="batchVisible = false">取消</el-button>
      <el-button type="primary" @click="confirmPickBatch">选择多个文件</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="batchProgressVisible" title="批量上传进度" width="560px" :close-on-click-modal="false">
    <div v-for="(t, i) in batchTasks" :key="i" style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px;">{{ t.name }}</span>
        <span :style="{ color: t.status === 'error' ? '#f56c6c' : t.status === 'done' ? '#67c23a' : '#909399' }">{{ t.statusText }}</span>
      </div>
      <el-progress :percentage="t.percent" :status="t.status === 'done' ? 'success' : (t.status === 'error' ? 'exception' : '')" />
    </div>
    <template #footer>
      <el-button :disabled="batchUploading" @click="batchProgressVisible = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="replaceConfirmVisible" title="确认替换火箭配置图" width="600px" :close-on-click-modal="false">
    <el-alert
      v-if="replaceCtx && replaceCtx.extChanged"
      type="warning"
      show-icon
      :closable="false"
      style="margin-bottom:12px;"
    >
      <template #title>
        新文件后缀（<code>{{ replaceCtx.newExt || '无' }}</code>）与原 Key 后缀（<code>{{ replaceCtx.oldExt || '无' }}</code>）不一致，请选择处理方式。
      </template>
    </el-alert>
    <el-alert
      v-else
      type="info"
      show-icon
      :closable="false"
      style="margin-bottom:12px;"
    >
      <template #title>
        将<strong>覆盖</strong> COS 上同 Key 的原文件，操作不可回退。
      </template>
    </el-alert>

    <el-descriptions v-if="replaceCtx" :column="1" border size="small" style="margin-bottom:12px;">
      <el-descriptions-item label="原 Key">
        <code>{{ replaceCtx.oldKey }}</code>
      </el-descriptions-item>
      <el-descriptions-item label="新文件">
        {{ replaceCtx.fileName }}（{{ formatFileSize(replaceCtx.fileSize) }}）
      </el-descriptions-item>
      <el-descriptions-item v-if="replaceCtx.extChanged" label="若选「新建新 Key」">
        <code>{{ replaceCtx.suggestedNewKey }}</code>
      </el-descriptions-item>
    </el-descriptions>

    <el-radio-group v-if="replaceCtx && replaceCtx.extChanged" v-model="replaceMode" style="display:flex;flex-direction:column;gap:8px;">
      <el-radio value="keep">
        保持原 Key 不变（URL 不变，仅 ?v= 翻新）
        <div style="color:#909399;font-size:12px;margin-left:24px;">最简单，不会产生孤儿文件。但 URL 后缀和真实内容不一致。</div>
      </el-radio>
      <el-radio value="rename">
        新建新 Key 并禁用旧记录（推荐）
        <div style="color:#909399;font-size:12px;margin-left:24px;">URL 与内容一致。COS 上旧文件不会自动删除，下次「同步 COS → 数据库」可清理孤儿。</div>
      </el-radio>
    </el-radio-group>

    <template #footer>
      <el-button @click="cancelReplace">取消</el-button>
      <el-button type="primary" :loading="replaceUploading" @click="confirmReplace">确认替换</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="matchVisible" title="按火箭名命中预览（与小程序端使用相同的 fuzzy 规则）" width="640px">
    <el-form label-width="96px">
      <el-form-item label="火箭名">
        <el-input v-model="matchInput" placeholder="例如：Falcon 9 Block 5、Long March 8A、KSLV-II" @keyup.enter="runMatch" />
      </el-form-item>
      <el-form-item label="">
        <el-button type="primary" @click="runMatch">查找命中</el-button>
      </el-form-item>
      <el-form-item label="结果">
        <div v-if="!matchResult" style="color:#909399;">输入火箭名并查找</div>
        <div v-else>
          <div v-if="matchResult.ok">
            <el-tag type="success" size="small">命中 score {{ matchResult.score }}</el-tag>
            <div style="margin-top:6px;">Key: <code>{{ matchResult.key }}</code></div>
            <div>URL: <a :href="matchResult.url" target="_blank">{{ matchResult.url }}</a></div>
            <img :src="matchResult.url" referrerpolicy="no-referrer" loading="lazy" alt="" style="margin-top:8px;max-width:200px;max-height:200px;border:1px solid #dcdfe6;border-radius:6px;" />
          </div>
          <div v-else>
            <el-tag type="warning" size="small">未命中</el-tag>
            <div style="margin-top:6px;color:#909399;">小程序端会用默认占位图。建议为该火箭上传一张同名文件。</div>
          </div>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="matchVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const PREFIX = '火箭配置图/'
const loading = ref(false)
const syncing = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 50 })
const brokenThumbs = reactive({})

const fileRef = ref(null)
const uploadVisible = ref(false)
const uploading = ref(false)
const uploadProgressVisible = ref(false)
const uploadPercent = ref(0)
const uploadStatus = ref('')
const uploadStatusText = ref('')
const uploadForm = reactive({ objectKey: '', pendingFile: null })

const editVisible = ref(false)
const editSaving = ref(false)
const editRow = ref(null)
const editUrl = ref('')

const batchFileRef = ref(null)
const batchVisible = ref(false)
const batchProgressVisible = ref(false)
const batchUploading = ref(false)
const batchTasks = ref([])

const matchVisible = ref(false)
const matchInput = ref('')
const matchResult = ref(null)

const replaceFileRef = ref(null)
const replaceConfirmVisible = ref(false)
const replaceUploading = ref(false)
const replaceCtx = ref(null)
const replaceMode = ref('rename')

function displayBaseUrl(url) {
  const u = String(url || '')
  const q = u.indexOf('?')
  return q >= 0 ? u.slice(0, q) : u
}

function stripVersion(u) {
  const s = String(u || '')
  const i = s.indexOf('?')
  return i >= 0 ? s.slice(0, i) : s
}

function fmt(ts) {
  if (!ts) return '-'
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function sanitizeObjectSegment(name) {
  return String(name || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[^\w\u4e00-\u9fa5\-_.()+\s]/g, '_')
    .replace(/\s+/g, ' ')
}

async function findAssetByKey(fullKey) {
  let page = 1
  const pageSize = 100
  for (let guard = 0; guard < 40; guard++) {
    const data = await api.listMediaAssets({ keyPrefix: PREFIX, page, pageSize })
    const rows = data.list || []
    const hit = rows.find((row) => row.key === fullKey)
    if (hit) return hit
    if (rows.length < pageSize) break
    page += 1
  }
  return null
}

async function upsertRocketMedia(fullKey, baseCosUrl) {
  const cleanBase = stripVersion(baseCosUrl).trim()
  if (!cleanBase) throw new Error('无效的 COS URL')
  const urlWithV = `${cleanBase}?v=${Date.now()}`
  const existing = await findAssetByKey(fullKey)
  if (existing) {
    await api.updateMediaAsset(existing._id, {
      url: urlWithV,
      enabled: true,
      sourceTag: 'manual'
    })
  } else {
    await api.createMediaAsset({
      key: fullKey,
      url: urlWithV,
      sourceTag: 'manual',
      enabled: true
    })
  }
}

async function reload() {
  loading.value = true
  try {
    const data = await api.listMediaAssets({
      keyPrefix: PREFIX,
      page: query.page,
      pageSize: query.pageSize
    })
    list.value = data.list || []
    total.value = Number(data.total || 0)
    Object.keys(brokenThumbs).forEach((k) => { delete brokenThumbs[k] })
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function onSyncCosIndex() {
  syncing.value = true
  try {
    const data = await api.syncRocketMediaCosIndex()
    ElMessage.success(
      `同步完成：新增 ${data.added ?? 0}，更新 ${data.updated ?? 0}，移除 ${data.removed ?? 0}（跳过 manual ${data.skippedManual ?? 0}）`
    )
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

function openUpload() {
  uploadForm.objectKey = ''
  uploadForm.pendingFile = null
  uploadVisible.value = true
}

function resetUploadForm() {
  uploadForm.objectKey = ''
  uploadForm.pendingFile = null
}

function confirmPickFile() {
  fileRef.value?.click()
}

async function onFileChange(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  if (!files.length) return
  const file = files[0]
  uploadForm.pendingFile = file
  uploadVisible.value = false

  let segment = uploadForm.objectKey.trim()
  if (!segment) segment = sanitizeObjectSegment(file.name)
  if (!segment) {
    ElMessage.warning('请填写 COS Key 文件名')
    uploadVisible.value = true
    return
  }
  segment = sanitizeObjectSegment(segment)
  if (!segment) {
    ElMessage.warning('文件名无效')
    uploadVisible.value = true
    return
  }
  const fullKey = `${PREFIX}${segment}`

  uploading.value = true
  uploadProgressVisible.value = true
  uploadPercent.value = 0
  uploadStatus.value = ''
  uploadStatusText.value = `上传 ${fullKey} …`

  try {
    const presign = await api.cosPresign({ key: fullKey })

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', presign.uploadUrl, true)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) uploadPercent.value = Math.round((ev.loaded / ev.total) * 100)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`HTTP ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error('网络错误'))
      xhr.send(file)
    })

    uploadPercent.value = 100
    uploadStatus.value = 'success'
    await upsertRocketMedia(fullKey, presign.cosUrl)
    ElMessage.success('已上传并写入 media_assets（manual）')
    uploadProgressVisible.value = false
    await reload()
  } catch (err) {
    uploadStatus.value = 'exception'
    ElMessage.error(err.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

async function onToggleEnabled(row) {
  try {
    await api.updateMediaAsset(row._id, { enabled: !!row.enabled })
    ElMessage.success('已更新')
  } catch (e) {
    ElMessage.error(e.message || '更新失败')
    row.enabled = !row.enabled
  }
}

function openEdit(row) {
  editRow.value = row
  editUrl.value = displayBaseUrl(row.url)
  editVisible.value = true
}

async function saveEditUrl() {
  const base = stripVersion(editUrl.value.trim())
  if (!base) {
    ElMessage.warning('URL 不能为空')
    return
  }
  editSaving.value = true
  try {
    await api.updateMediaAsset(editRow.value._id, {
      url: `${base}?v=${Date.now()}`,
      sourceTag: 'manual'
    })
    ElMessage.success('已保存')
    editVisible.value = false
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    editSaving.value = false
  }
}

async function onDeleteRow(row) {
  try {
    await ElMessageBox.confirm(`确定删除 media_assets 记录「${row.key}」吗？（不会删除 COS 上的文件）`, '确认', {
      type: 'warning'
    })
    await api.deleteMediaAsset(row._id)
    ElMessage.success('已删除记录')
    await reload()
  } catch (e) {
    if (e !== 'cancel' && e?.message !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

function formatFileSize(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / 1024 / 1024).toFixed(2)} MB`
}

function getKeyExtension(k) {
  const m = String(k || '').match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ''
}

function getFileExtension(name) {
  const m = String(name || '').match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ''
}

let _replaceTargetRow = null
let _replaceTargetFile = null

function onReplaceClick(row) {
  _replaceTargetRow = row
  _replaceTargetFile = null
  replaceFileRef.value?.click()
}

function onReplaceFileChange(e) {
  const file = (e.target.files || [])[0]
  e.target.value = ''
  if (!file) return
  if (!_replaceTargetRow) return

  const oldKey = _replaceTargetRow.key || ''
  const oldExt = getKeyExtension(oldKey)
  const newExt = getFileExtension(file.name)
  const extChanged = !!newExt && newExt !== oldExt

  const segment = sanitizeObjectSegment(file.name) || `unnamed-${Date.now()}`
  const suggestedNewKey = `${PREFIX}${segment}`

  _replaceTargetFile = file
  replaceCtx.value = {
    rowId: _replaceTargetRow._id,
    oldKey,
    oldExt,
    newExt,
    extChanged,
    fileName: file.name,
    fileSize: file.size,
    suggestedNewKey
  }
  replaceMode.value = extChanged ? 'rename' : 'keep'
  replaceConfirmVisible.value = true
}

function cancelReplace() {
  replaceConfirmVisible.value = false
  replaceCtx.value = null
  _replaceTargetRow = null
  _replaceTargetFile = null
}

async function confirmReplace() {
  const ctx = replaceCtx.value
  const file = _replaceTargetFile
  const row = _replaceTargetRow
  if (!ctx || !file || !row) {
    cancelReplace()
    return
  }

  const targetKey = ctx.extChanged && replaceMode.value === 'rename'
    ? ctx.suggestedNewKey
    : ctx.oldKey

  try {
    replaceUploading.value = true
    uploadProgressVisible.value = true
    uploadPercent.value = 0
    uploadStatus.value = ''
    uploadStatusText.value = '取签名…'

    const presign = await api.cosPresign({ key: targetKey })

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', presign.uploadUrl, true)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) uploadPercent.value = Math.round((ev.loaded / ev.total) * 100)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`HTTP ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error('网络错误'))
      xhr.send(file)
    })

    uploadPercent.value = 100
    uploadStatusText.value = '写入数据库…'
    await upsertRocketMedia(targetKey, presign.cosUrl)

    if (ctx.extChanged && replaceMode.value === 'rename' && row._id && targetKey !== ctx.oldKey) {
      try {
        await api.updateMediaAsset(row._id, { enabled: false })
      } catch (errDisable) {
        ElMessage.warning('新文件已上传，但禁用旧记录失败：' + (errDisable?.message || '未知错误'))
      }
    }

    uploadStatus.value = 'success'
    uploadStatusText.value = '替换完成'
    ElMessage.success('替换成功')
    replaceConfirmVisible.value = false
    replaceCtx.value = null
    _replaceTargetRow = null
    _replaceTargetFile = null
    await reload()
  } catch (err) {
    uploadStatus.value = 'exception'
    uploadStatusText.value = '替换失败'
    ElMessage.error(err?.message || '替换失败')
  } finally {
    replaceUploading.value = false
  }
}

function openBatchUpload() {
  batchVisible.value = true
}

function confirmPickBatch() {
  batchFileRef.value?.click()
}

async function uploadOneBatchTask(task) {
  try {
    task.status = 'uploading'
    task.statusText = '取签名…'
    const presign = await api.cosPresign({ key: task.fullKey })

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', presign.uploadUrl, true)
      xhr.setRequestHeader('Content-Type', task.file.type || 'application/octet-stream')
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) task.percent = Math.round((ev.loaded / ev.total) * 100)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`HTTP ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error('网络错误'))
      xhr.send(task.file)
    })

    task.percent = 100
    task.statusText = '写入数据库…'
    await upsertRocketMedia(task.fullKey, presign.cosUrl)
    task.status = 'done'
    task.statusText = '完成'
  } catch (err) {
    task.status = 'error'
    task.statusText = err?.message || '失败'
  }
}

async function onBatchFileChange(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  if (!files.length) return
  batchVisible.value = false

  batchTasks.value = files.map((file) => {
    const segment = sanitizeObjectSegment(file.name) || `unnamed-${Date.now()}`
    return {
      file,
      name: file.name,
      fullKey: `${PREFIX}${segment}`,
      percent: 0,
      status: 'pending',
      statusText: '排队…'
    }
  })
  batchProgressVisible.value = true
  batchUploading.value = true

  const CONCURRENCY = 3
  let cursor = 0
  async function worker() {
    while (cursor < batchTasks.value.length) {
      const i = cursor++
      await uploadOneBatchTask(batchTasks.value[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batchTasks.value.length) }, () => worker()))

  batchUploading.value = false
  const success = batchTasks.value.filter((t) => t.status === 'done').length
  const fail = batchTasks.value.length - success
  if (fail === 0) ElMessage.success(`全部 ${success} 个文件上传完成`)
  else ElMessage.warning(`完成 ${success} 个，失败 ${fail} 个`)
  await reload()
}

function openMatchTester() {
  matchInput.value = ''
  matchResult.value = null
  matchVisible.value = true
}

function normalizeRocketNameForFileMatch(s) {
  if (!s || typeof s !== 'string') return ''
  return s
    .replace(/[\u00A0\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, ' ')
    .replace(/／/g, '/')
    .toLowerCase()
    .replace(/[._/\\]+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactRocketMatchStr(s) {
  return normalizeRocketNameForFileMatch(s).replace(/\s+/g, '')
}

function stemFromKey(k) {
  if (!k) return ''
  let stem = k.replace(/^火箭配置图\//i, '').replace(/\.(jpe?g|png|webp|gif)$/i, '').trim()
  stem = stem.replace(/\s*rocket\s*launch\s*$/i, '').trim()
  return stem
}

async function fetchAllRocketAssets() {
  let page = 1
  const pageSize = 100
  const out = []
  for (let guard = 0; guard < 40; guard++) {
    const data = await api.listMediaAssets({ keyPrefix: PREFIX, page, pageSize })
    const rows = data.list || []
    out.push(...rows)
    if (rows.length < pageSize) break
    page += 1
  }
  return out.filter((r) => r.enabled !== false && r.key && r.url)
}

async function runMatch() {
  const raw = String(matchInput.value || '').trim()
  if (!raw) {
    matchResult.value = null
    return
  }
  const all = await fetchAllRocketAssets()
  const rocketNorm = normalizeRocketNameForFileMatch(raw)
  const rocketCompact = compactRocketMatchStr(raw)
  const FUZZY_MIN = 340000
  let best = null
  for (const row of all) {
    const stem = stemFromKey(row.key)
    if (!stem) continue
    const stemNorm = normalizeRocketNameForFileMatch(stem)
    const stemCompact = compactRocketMatchStr(stem)
    let score = 0
    if (stemNorm === rocketNorm) score = 1000000
    else if (rocketCompact.length >= 3 && stemCompact === rocketCompact) score = 960000
    else if (rocketNorm.length >= 3 && stemNorm.startsWith(rocketNorm + ' ')) score = 820000
    else if (stemNorm.length >= 3 && rocketNorm.startsWith(stemNorm + ' ')) score = 750000
    else if (rocketNorm.length >= 3 && stemNorm.includes(rocketNorm)) score = 620000 + rocketNorm.length * 80
    else if (stemNorm.length >= 3 && rocketNorm.includes(stemNorm)) score = 550000 + stemNorm.length * 80
    if (score < FUZZY_MIN) continue
    if (!best || score > best.score) best = { score, key: row.key, url: stripVersion(row.url) }
  }
  matchResult.value = best ? { ok: true, ...best } : { ok: false }
}

onMounted(reload)
</script>

<style scoped>
.rocket-thumb {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: 6px;
  background: var(--t-bg-input, #f5f7fa);
  border: 1px solid var(--t-border-input, #dcdfe6);
}
</style>
