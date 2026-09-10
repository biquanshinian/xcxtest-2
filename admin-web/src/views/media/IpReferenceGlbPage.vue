<template>
  <el-card>
    <template #header>
      <div class="ip-head">
        <span>{{ pageTitle }}</span>
        <div class="ip-head-actions">
          <el-button @click="reload">刷新</el-button>
        </div>
      </div>
    </template>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom:16px;"
      :title="pageHint"
    />

    <div class="ip-grid" :class="{ 'ip-grid--solo': pageKind === 'vehicle' }">
      <el-card v-for="card in cards" :key="card.slug" class="ip-card" shadow="never">
        <div class="ip-card-title">{{ card.label }}</div>
        <el-text size="small" type="info">{{ card.hint }}</el-text>
        <div class="ip-viewer">
          <GlbPreview :src="card.previewUrl" :height="320" />
        </div>
        <el-form label-width="96px" class="ip-form">
          <el-form-item label="COS Key">
            <el-text>{{ card.key }}</el-text>
          </el-form-item>
          <el-form-item label="最高点">
            <el-input-number
              v-model="card.highestPoint"
              :min="0.3"
              :max="5"
              :step="0.01"
              :precision="3"
              :disabled="!card.id"
            />
            <el-text size="small" type="info" style="margin-left:8px;">米（默认 {{ card.defaultHeight }}）</el-text>
            <el-button
              v-if="card.kind !== 'vehicle'"
              style="margin-left:8px;"
              size="small"
              type="primary"
              :loading="card.savingPoint"
              :disabled="!card.id"
              @click="saveHighestPoint(card)"
            >
              保存
            </el-button>
          </el-form-item>
          <template v-if="card.kind === 'vehicle'">
            <el-form-item label="车长">
              <el-input-number
                v-model="card.lengthM"
                :min="1"
                :max="15"
                :step="0.001"
                :precision="3"
                :disabled="!card.id"
              />
              <el-text size="small" type="info" style="margin-left:8px;">米（默认 5.683）</el-text>
            </el-form-item>
            <el-form-item label="车宽">
              <el-input-number
                v-model="card.widthM"
                :min="0.5"
                :max="6"
                :step="0.001"
                :precision="3"
                :disabled="!card.id"
              />
              <el-text size="small" type="info" style="margin-left:8px;">米（不含后视镜，默认 2.032）</el-text>
              <el-button
                style="margin-left:8px;"
                size="small"
                type="primary"
                :loading="card.savingPoint"
                :disabled="!card.id"
                @click="saveHighestPoint(card)"
              >
                保存
              </el-button>
            </el-form-item>
          </template>
          <el-form-item label="启用">
            <el-switch
              v-model="card.enabled"
              :disabled="!card.id"
              @change="() => onToggleEnabled(card)"
            />
          </el-form-item>
          <el-form-item label="模型">
            <el-button type="primary" @click="pickUpload(card)">{{ card.id ? '替换 GLB' : '上传 GLB' }}</el-button>
            <el-button v-if="card.id" type="danger" @click="onDeleteCard(card)">删除</el-button>
            <el-text v-if="card.sizeLabel" size="small" style="margin-left:8px;">{{ card.sizeLabel }}</el-text>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </el-card>

  <input ref="fileRef" type="file" accept=".glb,model/gltf-binary,application/octet-stream" style="display:none" @change="onFileChange" />

  <el-dialog v-model="uploadProgressVisible" title="上传进度" width="480px" :close-on-click-modal="false">
    <el-progress :percentage="uploadPercent" :status="uploadStatus" />
    <el-text size="small" type="info">{{ uploadStatusText }}</el-text>
    <template #footer>
      <el-button :disabled="uploading" @click="uploadProgressVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'
import GlbPreview from '../../components/media/GlbPreview.vue'

const KEY_PREFIX = 'models/reference/'
const GLB_MAX = 50 * 1024 * 1024
const DEFAULT_HEIGHT = 1.88
const CYBER_HEIGHT = 1.794
const CYBER_LENGTH = 5.683
const CYBER_WIDTH = 2.032

const FIGURES = [
  { slug: 'musk', kind: 'ip', label: '马斯克 Q 版', hint: '标尺角色。默认包围盒顶 = 真实身高 1.88 米。', defaultHeight: DEFAULT_HEIGHT },
  { slug: 'astro', kind: 'ip', label: '宇航员 IP', hint: '与马斯克并排、靠近外侧。默认跟马斯克同一标尺等比。', defaultHeight: DEFAULT_HEIGHT },
  {
    slug: 'cyber-pickup',
    kind: 'vehicle',
    label: '赛博皮卡',
    hint: '站在两个 IP 外侧。尺寸按特斯拉 Cybertruck 车主手册：长 5.683 m、宽 2.032 m（不含后视镜）、高 1.794 m（中等气悬）。最高点按车顶对齐。',
    defaultHeight: CYBER_HEIGHT,
    lengthM: CYBER_LENGTH,
    widthM: CYBER_WIDTH
  }
]

const route = useRoute()
const pageKind = computed(() => (route.meta && route.meta.refKind === 'vehicle' ? 'vehicle' : 'ip'))
const pageTitle = computed(() => (pageKind.value === 'vehicle' ? '车辆参照' : 'IP 身高参照'))
const pageHint = computed(() =>
  pageKind.value === 'vehicle'
    ? '赛博皮卡站在 3D 页两个 IP 后面，用来对比火箭真实尺寸。长宽高默认取特斯拉量产皮卡车主手册（长 5.683 m，宽 2.032 m 不含后视镜，高 1.794 m 中等气悬）。最高点按车顶对齐，车长/车宽用于尺寸标注。其它上传、启用、预览规则与 IP 参照相同。长征全系列不放参照。上传后小程序下次刷新映射即可看到（通常几十秒）。'
    : '这两个 Q 版人物站在 3D 页火箭外侧，用来对比真实尺寸。并排时按模型相对比例放大，标尺是马斯克真实身高 1.88 米。可改「最高点」：该角色包围盒顶对齐到这个米数。长征全系列（含家族型号）不放参照；其它已上 3D 的火箭都会放。想让人像游戏一样动：GLB 里要带骨骼和至少一条原地待机动画（idle / stand / breath）；走路位移片段不要当默认。上传后小程序下次刷新映射即可看到（通常几十秒）。'
)

function figuresForPage() {
  return FIGURES.filter((item) => item.kind === pageKind.value)
}

const fileRef = ref(null)
const uploading = ref(false)
const uploadProgressVisible = ref(false)
const uploadPercent = ref(0)
const uploadStatus = ref('')
const uploadStatusText = ref('')
const pendingSlug = ref('')

const cards = reactive([])

function emptyCard(meta) {
  return {
    slug: meta.slug,
    kind: meta.kind || 'ip',
    label: meta.label,
    hint: meta.hint,
    key: `${KEY_PREFIX}${meta.slug}.glb`,
    id: '',
    url: '',
    previewUrl: '',
    enabled: false,
    defaultHeight: meta.defaultHeight || DEFAULT_HEIGHT,
    highestPoint: meta.defaultHeight || DEFAULT_HEIGHT,
    lengthM: meta.lengthM || CYBER_LENGTH,
    widthM: meta.widthM || CYBER_WIDTH,
    sizeLabel: '',
    savingPoint: false
  }
}

function resetCards() {
  const next = figuresForPage().map((item) => emptyCard(item))
  cards.splice(0, cards.length, ...next)
}

function normalizeHighestPoint(raw, fallback) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback != null ? fallback : DEFAULT_HEIGHT
  return Math.round(Math.min(5, Math.max(0.3, n)) * 1000) / 1000
}

function normalizeLengthM(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return CYBER_LENGTH
  return Math.round(Math.min(15, Math.max(1, n)) * 1000) / 1000
}

function normalizeWidthM(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return CYBER_WIDTH
  return Math.round(Math.min(6, Math.max(0.5, n)) * 1000) / 1000
}

function slugOf(key) {
  const m = String(key || '').match(/^models\/reference\/([a-z0-9-]+)\.glb$/i)
  if (!m) return ''
  const slug = m[1].toLowerCase()
  if (slug === 'ip-musk') return 'musk'
  if (slug === 'ip-astro' || slug === 'astronaut') return 'astro'
  if (slug === 'cybertruck' || slug === 'cyber-truck') return 'cyber-pickup'
  return FIGURES.some((item) => item.slug === slug) ? slug : ''
}

function stripVersion(u) {
  const s = String(u || '')
  const i = s.indexOf('?')
  return i >= 0 ? s.slice(0, i) : s
}

function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function assertGlbFile(file) {
  const name = String((file && file.name) || '')
  if (!/\.glb$/i.test(name)) throw new Error('请上传 .glb 文件')
  if (file.size > GLB_MAX) throw new Error('文件超过 50MB')
}

function cardBySlug(slug) {
  return cards.find((item) => item.slug === slug)
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
  for (let guard = 0; guard < 20; guard++) {
    const data = await api.listMediaAssets({ keyPrefix: KEY_PREFIX, page, pageSize })
    const rows = data.list || []
    const hit = rows.find((row) => row.key === fullKey)
    if (hit) return hit
    if (rows.length < pageSize) break
    page += 1
  }
  return null
}

function dimPatch(card, extra = {}) {
  const highestPoint = normalizeHighestPoint(
    extra.highestPoint != null ? extra.highestPoint : card && card.highestPoint,
    card && card.defaultHeight
  )
  const patch = { highestPoint }
  if (card && card.kind === 'vehicle') {
    patch.lengthM = normalizeLengthM(extra.lengthM != null ? extra.lengthM : card.lengthM)
    patch.widthM = normalizeWidthM(extra.widthM != null ? extra.widthM : card.widthM)
  }
  return patch
}

async function upsertAsset(fullKey, baseCosUrl, extra = {}) {
  const cleanBase = stripVersion(baseCosUrl).trim()
  if (!cleanBase) throw new Error('无效的 COS URL')
  const urlWithV = `${cleanBase}?v=${Date.now()}`
  const existing = await findAssetByKey(fullKey)
  const card = extra.card || cardBySlug(extra.slug) || null
  const dims = dimPatch(card, extra)
  if (existing) {
    await api.updateMediaAsset(existing._id, {
      url: urlWithV,
      enabled: true,
      sourceTag: 'manual',
      ...dims
    })
  } else {
    await api.createMediaAsset({
      key: fullKey,
      url: urlWithV,
      sourceTag: 'manual',
      enabled: true,
      ...dims
    })
  }
}

async function attachCosSizes(rows) {
  try {
    const data = await api.cosListFiles({ prefix: KEY_PREFIX, maxKeys: 50 })
    const sizeByKey = {}
    for (const file of data.files || []) {
      if (file && file.key) sizeByKey[file.key] = Number(file.size || 0)
    }
    rows.forEach((row) => {
      if (sizeByKey[row.key] != null) row.size = sizeByKey[row.key]
    })
  } catch {
    /* 大小可缺 */
  }
}

function applyRow(card, row) {
  card.id = row && row._id ? String(row._id) : ''
  card.url = row && row.url ? String(row.url) : ''
  card.previewUrl = card.url
  card.enabled = !!(row && row.enabled)
  card.highestPoint = normalizeHighestPoint(row && row.highestPoint, card.defaultHeight)
  card.lengthM = normalizeLengthM(row && row.lengthM)
  card.widthM = normalizeWidthM(row && row.widthM)
  card.sizeLabel = formatSize(row && row.size)
}

async function reload() {
  try {
    const data = await api.listMediaAssets({
      keyPrefix: KEY_PREFIX,
      page: 1,
      pageSize: 50
    })
    const rows = data.list || []
    await attachCosSizes(rows)
    const bySlug = {}
    rows.forEach((row) => {
      const slug = slugOf(row.key)
      if (slug) bySlug[slug] = row
    })
    cards.forEach((card) => {
      if (bySlug[card.slug]) applyRow(card, bySlug[card.slug])
      else applyRow(card, null)
    })
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  }
}

function pickUpload(card) {
  pendingSlug.value = card.slug
  fileRef.value?.click()
}

async function onFileChange(e) {
  const file = (e.target.files || [])[0]
  e.target.value = ''
  const slug = pendingSlug.value
  pendingSlug.value = ''
  const card = cardBySlug(slug)
  if (!file || !card) return
  uploading.value = true
  uploadProgressVisible.value = true
  uploadPercent.value = 0
  uploadStatus.value = ''
  uploadStatusText.value = `上传 ${card.key} …`
  try {
    assertGlbFile(file)
    const cosUrl = await putToCos(card.key, file)
    uploadPercent.value = 100
    uploadStatus.value = 'success'
    await upsertAsset(card.key, cosUrl, {
      card,
      highestPoint: card.highestPoint || card.defaultHeight,
      lengthM: card.lengthM,
      widthM: card.widthM
    })
    ElMessage.success(card.id ? '已替换参照模型' : '已上传参照模型')
    uploadProgressVisible.value = false
    await reload()
  } catch (err) {
    uploadStatus.value = 'exception'
    ElMessage.error(err.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

async function saveHighestPoint(card) {
  if (!card.id) return
  card.savingPoint = true
  try {
    const dims = dimPatch(card)
    card.highestPoint = dims.highestPoint
    if (card.kind === 'vehicle') {
      card.lengthM = dims.lengthM
      card.widthM = dims.widthM
    }
    await api.updateMediaAsset(card.id, dims)
    ElMessage.success(
      card.kind === 'vehicle'
        ? `已保存 ${card.label} ${dims.lengthM} × ${dims.widthM} × ${dims.highestPoint} 米`
        : `已保存 ${card.label} 最高点 ${dims.highestPoint} 米`
    )
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    card.savingPoint = false
  }
}

async function onToggleEnabled(card) {
  if (!card.id) {
    card.enabled = false
    return
  }
  try {
    await api.updateMediaAsset(card.id, { enabled: !!card.enabled })
    ElMessage.success(card.enabled ? '已启用，3D 页将显示该参照' : '已停用，3D 页不再显示该参照')
  } catch (e) {
    ElMessage.error(e.message || '更新失败')
    card.enabled = !card.enabled
  }
}

async function onDeleteCard(card) {
  if (!card.id) return
  try {
    await ElMessageBox.confirm(`删除 ${card.key}？将同时删除 COS 文件和后台记录。`, card.kind === 'vehicle' ? '删除车辆参照' : '删除 IP 参照', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await api.cosDeleteFile({ key: card.key })
    await api.deleteMediaAsset(card.id)
    ElMessage.success('已删除')
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

watch(pageKind, async () => {
  resetCards()
  await reload()
})

onMounted(() => {
  resetCards()
  reload()
})
</script>

<style scoped>
.ip-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.ip-head-actions {
  display: flex;
  gap: 8px;
}
.ip-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.ip-card {
  border: 1px solid rgba(139, 92, 246, 0.18);
}
.ip-card-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.ip-viewer {
  margin: 12px 0;
  padding: 10px;
  border-radius: 12px;
  background: rgba(7, 8, 12, 0.55);
  border: 1px solid rgba(139, 92, 246, 0.22);
}
.ip-form {
  margin-top: 8px;
}
.ip-grid--solo {
  grid-template-columns: minmax(0, 560px);
}
@media (max-width: 960px) {
  .ip-grid,
  .ip-grid--solo {
    grid-template-columns: 1fr;
  }
}
</style>
