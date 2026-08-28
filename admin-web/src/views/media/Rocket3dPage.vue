<template>
  <el-card>
    <template #header>
      <div class="r3d-head">
        <span>火箭 3D 模型</span>
        <div class="r3d-head-actions">
          <el-button @click="reload">刷新</el-button>
          <el-button :loading="scanning" @click="onScanCos">扫描 COS</el-button>
          <el-button type="primary" @click="openUpload">上传 GLB</el-button>
        </div>
      </div>
    </template>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom:14px;"
      title="上传/启用后，对应任务详情显示 3D 入口；停用或删除后入口消失（小程序下次刷新映射，通常几十秒内）。上传「长征火箭全系列」后，所有尚未单独上传模型的长征任务都会显示 3D 入口；已单独上传的长征型号优先用专用文件。GLB 可内嵌 PNG/JPEG 贴图，真机用画布 createImage 加载；建议不超过 50MB。有人捐赠模型时，可填写「捐赠注明」，将显示在后台列表和小程序 3D 页。"
    />

    <div class="r3d-viewer-card">
      <div class="r3d-viewer-head">
        <div>
          <div class="r3d-viewer-title">3D 预览{{ activePreviewLabel ? ` · ${activePreviewLabel}` : '' }}</div>
          <el-text size="small" type="info">点击下方表格行或「预览」加载模型；拖动旋转，滚轮缩放</el-text>
        </div>
      </div>
      <GlbPreview :src="activePreviewUrl" :height="420" />
    </div>

    <el-table
      :data="list"
      v-loading="loading"
      stripe
      highlight-current-row
      row-key="key"
      empty-text="暂无 3D 模型，请上传或扫描 COS"
      :row-class-name="({ row }) => (row.key === activeKey ? 'r3d-row-active' : '')"
      @row-click="selectRow"
    >
      <el-table-column label="型号" width="160">
        <template #default="{ row }">
          <div class="r3d-slug">{{ slugOf(row.key) || '-' }}</div>
          <el-text size="small" type="info">{{ labelOf(row.key) }}</el-text>
        </template>
      </el-table-column>
      <el-table-column label="COS Key" prop="key" min-width="220" show-overflow-tooltip />
      <el-table-column label="大小" width="110">
        <template #default="{ row }">{{ formatSize(row.size) }}</template>
      </el-table-column>
      <el-table-column label="捐赠注明" min-width="200">
        <template #default="{ row }">
          <el-button link type="primary" @click="openCreditEditor(row)">
            {{ row.credit ? row.credit : '填写注明' }}
          </el-button>
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
      <el-table-column label="操作" width="340" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openPreview(row)">预览</el-button>
          <el-button size="small" @click="copyUrl(row.url)">复制链接</el-button>
          <el-button size="small" type="primary" @click="onReplaceClick(row)">替换</el-button>
          <el-button size="small" type="danger" @click="onDeleteRow(row)">删除</el-button>
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

  <input ref="fileRef" type="file" accept=".glb,model/gltf-binary,application/octet-stream" style="display:none" @change="onFileChange" />
  <input ref="replaceFileRef" type="file" accept=".glb,model/gltf-binary,application/octet-stream" style="display:none" @change="onReplaceFileChange" />

  <el-dialog v-model="uploadVisible" title="上传 3D 模型（GLB）" width="720px" @closed="resetUploadForm">
    <el-form label-width="96px">
      <el-form-item label="火箭型号">
        <el-select
          v-model="uploadForm.slug"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入 slug，如 falcon-9"
          style="width:100%;"
        >
          <el-option v-for="item in knownRockets" :key="item.slug" :label="item.label" :value="item.slug" />
        </el-select>
        <el-text v-if="uploadForm.slug === 'long-march-series'" size="small" type="warning" style="display:block;margin-top:6px;">
          启用后，所有尚未单独上传 3D 模型的长征系列任务都会显示入口；已有专用型号文件的不会被覆盖。
        </el-text>
      </el-form-item>
      <el-form-item label="COS Key">
        <el-text>{{ previewKey }}</el-text>
      </el-form-item>
      <el-form-item label="捐赠注明">
        <el-input
          v-model="uploadForm.credit"
          maxlength="80"
          show-word-limit
          placeholder="选填，例如：模型由张三捐赠"
        />
      </el-form-item>
      <el-form-item label="模型文件">
        <el-button @click="pickLocalFile">选择 GLB</el-button>
        <el-text v-if="pendingFile" size="small" style="margin-left:8px;">{{ pendingFile.name }}（{{ formatSize(pendingFile.size) }}）</el-text>
      </el-form-item>
      <el-form-item v-if="pendingPreviewUrl" label="预览">
        <GlbPreview :src="pendingPreviewUrl" :height="320" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="uploadVisible = false">取消</el-button>
      <el-button type="primary" :loading="uploading" :disabled="!pendingFile" @click="confirmUpload">确认上传</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="uploadProgressVisible" title="上传进度" width="480px" :close-on-click-modal="false">
    <el-progress :percentage="uploadPercent" :status="uploadStatus" />
    <el-text size="small" type="info">{{ uploadStatusText }}</el-text>
    <template #footer>
      <el-button :disabled="uploading || replaceUploading" @click="uploadProgressVisible = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="creditVisible" title="捐赠注明" width="480px">
    <el-form label-width="96px">
      <el-form-item label="型号">
        <el-text>{{ creditForm.slug || '-' }}</el-text>
      </el-form-item>
      <el-form-item label="注明">
        <el-input
          v-model="creditForm.credit"
          maxlength="80"
          show-word-limit
          placeholder="选填，例如：模型由张三捐赠"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="creditVisible = false">取消</el-button>
      <el-button type="primary" :loading="creditSaving" @click="saveCredit">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'
import GlbPreview from '../../components/media/GlbPreview.vue'

const KEY_PREFIX = 'models/rockets/'
const GLB_MAX = 50 * 1024 * 1024

const knownRockets = [
  { slug: 'starship', label: '星舰 / Starship' },
  { slug: 'falcon-9', label: '猎鹰 9 / Falcon 9' },
  { slug: 'falcon-heavy', label: '猎鹰重型 / Falcon Heavy' },
  { slug: 'electron', label: '电子号 / Electron' },
  { slug: 'new-glenn', label: '新格伦 / New Glenn' },
  { slug: 'new-shepard', label: '新谢泼德 / New Shepard' },
  { slug: 'sls', label: 'SLS' },
  { slug: 'vulcan', label: '火神 / Vulcan' },
  { slug: 'zhuque-2e', label: '朱雀二号改 / ZhuQue-2E' },
  { slug: 'zhuque-3', label: '朱雀三号 / ZhuQue-3' },
  { slug: 'ceres-1', label: '谷神星一号 / Ceres-1' },
  { slug: 'ceres-2', label: '谷神星二号 / Ceres-2' },
  { slug: 'long-march-series', label: '长征火箭全系列 / Long March Family' },
  { slug: 'long-march-2c', label: '长征二号丙' },
  { slug: 'long-march-2d', label: '长征二号丁' },
  { slug: 'long-march-2f', label: '长征二号F' },
  { slug: 'long-march-3be', label: '长征三号乙/E' },
  { slug: 'long-march-4b', label: '长征四号乙' },
  { slug: 'long-march-4c', label: '长征四号丙' },
  { slug: 'long-march-5', label: '长征五号' },
  { slug: 'long-march-5b', label: '长征五号B' },
  { slug: 'long-march-6a', label: '长征六号甲' },
  { slug: 'long-march-7a', label: '长征七号甲/改' },
  { slug: 'long-march-8a', label: '长征八号甲' },
  { slug: 'long-march-11', label: '长征十一号' },
  { slug: 'long-march-12', label: '长征十二号' },
  { slug: 'gravity-1', label: '引力一号' },
  { slug: 'kuaizhou-11', label: '快舟十一号' },
  { slug: 'jielong-3', label: '捷龙三号' },
  { slug: 'hyperbola-1', label: '双曲线一号' },
  { slug: 'vega-c', label: 'Vega C' },
  { slug: 'ariane-6', label: '阿里安 6' },
  { slug: 'soyuz-2', label: '联盟号 / Soyuz-2' },
  { slug: 'soyuz-5', label: '联盟 5 / Soyuz-5' }
]

const labelMap = Object.fromEntries(knownRockets.map((r) => [r.slug, r.label]))

const loading = ref(false)
const scanning = ref(false)
const list = ref([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 20 })

const fileRef = ref(null)
const replaceFileRef = ref(null)
const uploadVisible = ref(false)
const uploading = ref(false)
const replaceUploading = ref(false)
const replaceRow = ref(null)
const uploadProgressVisible = ref(false)
const uploadPercent = ref(0)
const uploadStatus = ref('')
const uploadStatusText = ref('')
const uploadForm = reactive({ slug: 'starship', credit: '' })
const pendingFile = ref(null)
const pendingPreviewUrl = ref('')
const activeKey = ref('')
const activePreviewUrl = ref('')
const activePreviewLabel = ref('')
const creditVisible = ref(false)
const creditSaving = ref(false)
const creditForm = reactive({ id: '', slug: '', credit: '' })

const previewKey = computed(() => {
  const slug = normalizeSlug(uploadForm.slug)
  return slug ? `${KEY_PREFIX}${slug}.glb` : `${KEY_PREFIX}?.glb`
})

function slugOf(key) {
  const m = String(key || '').match(/^models\/rockets\/([a-z0-9-]+)\.glb$/i)
  return m ? m[1].toLowerCase() : ''
}

function labelOf(key) {
  const slug = slugOf(key)
  return slug ? (labelMap[slug] || slug) : ''
}

function revokePendingPreview() {
  if (pendingPreviewUrl.value && pendingPreviewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(pendingPreviewUrl.value)
  }
  pendingPreviewUrl.value = ''
}

function selectRow(row) {
  if (!row) return
  activeKey.value = row.key
  activePreviewUrl.value = String(row.url || '')
  activePreviewLabel.value = labelOf(row.key) || slugOf(row.key)
}

function openPreview(row) {
  selectRow(row)
}

function normalizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\.glb$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
}

function stripVersion(u) {
  const s = String(u || '')
  const i = s.indexOf('?')
  return i >= 0 ? s.slice(0, i) : s
}

function normalizeCredit(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function fmt(ts) {
  if (!ts) return '-'
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return '-'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function assertGlbFile(file) {
  const name = String(file && file.name || '')
  if (!/\.glb$/i.test(name)) throw new Error('请上传 .glb 文件')
  if (file.size > GLB_MAX) throw new Error('文件超过 50MB')
}

async function putToCos(fullKey, file) {
  const presign = await api.cosPresign({ key: fullKey })
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', presign.uploadUrl, true)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
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
  return presign.cosUrl || stripVersion(presign.url || '')
}

async function findAssetByKey(fullKey) {
  let page = 1
  const pageSize = 100
  for (let guard = 0; guard < 40; guard++) {
    const data = await api.listMediaAssets({ keyPrefix: KEY_PREFIX, page, pageSize })
    const rows = data.list || []
    const hit = rows.find((row) => row.key === fullKey)
    if (hit) return hit
    if (rows.length < pageSize) break
    page += 1
  }
  return null
}

async function upsertAsset(fullKey, baseCosUrl, extra = {}) {
  const cleanBase = stripVersion(baseCosUrl).trim()
  if (!cleanBase) throw new Error('无效的 COS URL')
  const urlWithV = `${cleanBase}?v=${Date.now()}`
  const existing = await findAssetByKey(fullKey)
  const hasCredit = Object.prototype.hasOwnProperty.call(extra, 'credit')
  const credit = hasCredit ? normalizeCredit(extra.credit) : undefined
  if (existing) {
    const patch = {
      url: urlWithV,
      enabled: true,
      sourceTag: 'manual'
    }
    if (hasCredit && (credit || extra.allowEmptyCredit)) {
      patch.credit = credit || ''
    }
    await api.updateMediaAsset(existing._id, patch)
  } else {
    const payload = {
      key: fullKey,
      url: urlWithV,
      sourceTag: 'manual',
      enabled: true
    }
    if (credit) payload.credit = credit
    await api.createMediaAsset(payload)
  }
}

async function attachCosSizes(rows) {
  try {
    const data = await api.cosListFiles({ prefix: KEY_PREFIX, maxKeys: 200 })
    const sizeByKey = {}
    for (const file of data.files || []) {
      if (file && file.key) sizeByKey[file.key] = Number(file.size || 0)
    }
    rows.forEach((row) => {
      if (sizeByKey[row.key] != null) row.size = sizeByKey[row.key]
    })
  } catch {
    /* 列表仍可用，大小列显示为 - */
  }
}

async function reload() {
  loading.value = true
  try {
    const data = await api.listMediaAssets({
      keyPrefix: KEY_PREFIX,
      page: query.page,
      pageSize: query.pageSize
    })
    const rows = data.list || []
    await attachCosSizes(rows)
    list.value = rows
    total.value = Number(data.total || 0)
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function onScanCos() {
  scanning.value = true
  try {
    const data = await api.cosListFiles({ prefix: KEY_PREFIX, maxKeys: 200 })
    const files = (data.files || []).filter((f) => /\.glb$/i.test(f.key || f.name || ''))
    let added = 0
    for (const file of files) {
      const key = file.key
      if (!slugOf(key)) continue
      const existing = await findAssetByKey(key)
      if (existing) continue
      await api.createMediaAsset({
        key,
        url: `${stripVersion(file.url)}?v=${Date.now()}`,
        sourceTag: 'cos-scan',
        enabled: true
      })
      added += 1
    }
    ElMessage.success(added ? `已登记 ${added} 个 COS 模型` : 'COS 上没有未登记的 GLB')
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '扫描失败')
  } finally {
    scanning.value = false
  }
}

function openUpload() {
  uploadForm.slug = 'starship'
  uploadForm.credit = ''
  pendingFile.value = null
  revokePendingPreview()
  uploadVisible.value = true
}

function resetUploadForm() {
  uploadForm.slug = 'starship'
  uploadForm.credit = ''
  pendingFile.value = null
  revokePendingPreview()
}

function pickLocalFile() {
  fileRef.value?.click()
}

function onFileChange(e) {
  const file = (e.target.files || [])[0]
  e.target.value = ''
  if (!file) return
  try {
    assertGlbFile(file)
  } catch (err) {
    ElMessage.error(err.message || '请选择 GLB')
    return
  }
  pendingFile.value = file
  revokePendingPreview()
  pendingPreviewUrl.value = URL.createObjectURL(file)
}

async function confirmUpload() {
  const file = pendingFile.value
  const slug = normalizeSlug(uploadForm.slug)
  if (!isValidSlug(slug)) {
    ElMessage.warning('请填写合法型号 slug，例如 falcon-9')
    return
  }
  if (!file) {
    ElMessage.warning('请先选择 GLB 文件')
    return
  }
  uploadForm.slug = slug
  const fullKey = `${KEY_PREFIX}${slug}.glb`
  uploadVisible.value = false
  uploading.value = true
  uploadProgressVisible.value = true
  uploadPercent.value = 0
  uploadStatus.value = ''
  uploadStatusText.value = `上传 ${fullKey} …`
  try {
    assertGlbFile(file)
    const cosUrl = await putToCos(fullKey, file)
    uploadPercent.value = 100
    uploadStatus.value = 'success'
    await upsertAsset(fullKey, cosUrl, { credit: uploadForm.credit })
    ElMessage.success('已上传，对应任务详情将显示 3D 入口')
    uploadProgressVisible.value = false
    await reload()
  } catch (err) {
    uploadStatus.value = 'exception'
    ElMessage.error(err.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

function onReplaceClick(row) {
  replaceRow.value = row
  replaceFileRef.value?.click()
}

async function onReplaceFileChange(e) {
  const file = (e.target.files || [])[0]
  e.target.value = ''
  const row = replaceRow.value
  replaceRow.value = null
  if (!file || !row) return
  replaceUploading.value = true
  uploading.value = true
  uploadProgressVisible.value = true
  uploadPercent.value = 0
  uploadStatus.value = ''
  uploadStatusText.value = `替换 ${row.key} …`
  try {
    assertGlbFile(file)
    const cosUrl = await putToCos(row.key, file)
    uploadPercent.value = 100
    uploadStatus.value = 'success'
    await upsertAsset(row.key, cosUrl)
    ElMessage.success('已替换模型')
    uploadProgressVisible.value = false
    await reload()
  } catch (err) {
    uploadStatus.value = 'exception'
    ElMessage.error(err.message || '替换失败')
  } finally {
    uploading.value = false
    replaceUploading.value = false
  }
}

async function openCreditEditor(row) {
  creditForm.id = row._id
  creditForm.slug = slugOf(row.key)
  creditForm.credit = String(row.credit || '')
  creditVisible.value = true
}

async function saveCredit() {
  if (!creditForm.id) return
  creditSaving.value = true
  try {
    const credit = normalizeCredit(creditForm.credit)
    await api.updateMediaAsset(creditForm.id, { credit })
    const row = list.value.find((item) => item._id === creditForm.id)
    if (row) row.credit = credit
    creditVisible.value = false
    ElMessage.success(credit ? '已保存注明' : '已清空注明')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    creditSaving.value = false
  }
}

async function onToggleEnabled(row) {
  try {
    await api.updateMediaAsset(row._id, { enabled: !!row.enabled })
    ElMessage.success(row.enabled ? '已启用' : '已停用（任务详情不再显示 3D 入口）')
  } catch (e) {
    ElMessage.error(e.message || '更新失败')
    row.enabled = !row.enabled
  }
}

async function copyUrl(url) {
  const text = stripVersion(url)
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

async function onDeleteRow(row) {
  try {
    await ElMessageBox.confirm(`删除 ${row.key}？将同时删除 COS 文件和后台记录。`, '删除 3D 模型', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await api.cosDeleteFile({ key: row.key })
    await api.deleteMediaAsset(row._id)
    ElMessage.success('已删除')
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

onMounted(reload)
</script>

<style scoped>
.r3d-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.r3d-head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.r3d-slug {
  font-weight: 600;
  letter-spacing: 0.02em;
}
.r3d-viewer-card {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(7, 8, 12, 0.55);
  border: 1px solid rgba(139, 92, 246, 0.22);
}
.r3d-viewer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}
.r3d-viewer-title {
  font-weight: 600;
  margin-bottom: 2px;
}
:deep(.r3d-row-active) td {
  background: rgba(139, 92, 246, 0.12) !important;
}
</style>
