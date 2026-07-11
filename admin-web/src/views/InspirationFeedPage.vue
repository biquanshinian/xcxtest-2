<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>灵感流照片集（media_feed）</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <el-input v-model="query.keyword" placeholder="关键词" style="width:220px" @keyup.enter="reload" />
          <el-select v-model="query.type" placeholder="类型" clearable style="width:110px"><el-option label="图片" value="image" /><el-option label="视频" value="video" /></el-select>
          <el-select v-model="query.auditStatus" placeholder="审核" clearable style="width:120px"><el-option label="approved" value="approved" /><el-option label="pending" value="pending" /><el-option label="rejected" value="rejected" /></el-select>
          <el-select v-model="query.enabled" placeholder="启用" clearable style="width:100px"><el-option label="启用" value="true" /><el-option label="禁用" value="false" /></el-select>
          <el-button @click="reload">查询</el-button>
          <el-button type="primary" @click="openCreate">新建</el-button>
          <el-button @click="loadMore" :disabled="!hasMore">下一批</el-button>
          <el-button @click="onExport">导出</el-button>
        </div>
      </div>
    </template>

    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <el-button size="small" :disabled="!selectedIds.length" @click="openBatchDialog">批量修改</el-button>
      <el-button size="small" type="danger" :disabled="!selectedIds.length" @click="onBatchDelete">批量删除</el-button>
      <el-button size="small" :disabled="!selectedIds.length" @click="checkSelectedMedia">检测链接</el-button>
      <el-upload :auto-upload="false" :show-file-list="false" accept=".csv" :on-change="onImportFile"><el-button size="small">导入CSV</el-button></el-upload>
      <el-text type="info">已选 {{ selectedIds.length }} 项，已加载 {{ list.length }}/{{ total }}</el-text>
    </div>

    <el-table :data="list" stripe @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column prop="_id" label="ID" min-width="170" show-overflow-tooltip />
      <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
      <el-table-column prop="type" label="类型" width="80" />
      <el-table-column label="预览" width="90">
        <template #default="s">
          <el-image v-if="previewUrl(s.row)" :src="previewUrl(s.row)" :preview-src-list="[previewUrl(s.row)]" fit="cover" style="width:56px;height:56px;border-radius:6px;cursor:pointer;" preview-teleported />
          <span v-else style="color:var(--t-text-muted)">-</span>
        </template>
      </el-table-column>
      <el-table-column label="链接" width="90"><template #default="s"><el-tag :type="s.row.urlOk === false ? 'danger' : s.row.urlOk === true ? 'success' : 'info'">{{ s.row.urlOk === false ? '失效' : s.row.urlOk === true ? '正常' : '-' }}</el-tag></template></el-table-column>
      <el-table-column label="启用" width="90"><template #default="s"><el-switch :model-value="!!s.row.enabled" @change="(v)=>onQuickToggle(s.row,v)" /></template></el-table-column>
      <el-table-column label="操作" width="160"><template #default="s">
        <el-button size="small" @click="openEdit(s.row)">编辑</el-button>
        <el-button size="small" type="danger" @click="onDelete(s.row)">删除</el-button>
      </template></el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editing ? '编辑媒体' : '新建媒体'" width="760px">
    <el-form :model="form" label-width="100px">
      <el-form-item v-if="editing" label="ID"><el-input v-model="form._id" disabled /></el-form-item>
      <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="form.desc" type="textarea" :rows="2" /></el-form-item>
      <el-form-item label="类型"><el-select v-model="form.type" style="width:100%"><el-option label="图片" value="image" /><el-option label="视频" value="video" /></el-select></el-form-item>
      <el-form-item label="排序"><el-input-number v-model="form.order" :min="0" /></el-form-item>
      <el-form-item label="封面图">
        <CosUpload v-model="form.coverFileID" path-prefix="灵感流照片集/" accept="image/*" button-text="上传封面" placeholder="封面图URL" />
      </el-form-item>
      <el-form-item label="媒体文件">
        <CosUpload
          v-model="form.fileID"
          path-prefix="灵感流照片集/"
          :accept="form.type === 'video' ? 'video/*' : 'image/*'"
          button-text="上传媒体"
          placeholder="媒体文件URL"
          @success="onMainMediaUploaded"
        />
        <div class="form-hint">媒体上传到 COS 成功后将<strong>自动写入 media_feed</strong>（新建自动生成标题；编辑则更新当前条）。仍可在弹窗内改标题等后点「保存」再次提交。</div>
      </el-form-item>
      <el-form-item label="previewImages(JSON)"><el-input v-model="form.previewImagesText" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="sourceTag"><el-input v-model="form.sourceTag" /></el-form-item>
      <el-form-item label="auditStatus"><el-input v-model="form.auditStatus" /></el-form-item>
      <el-form-item label="小店AppID"><el-input v-model="form.appid" placeholder="默认可留空" /></el-form-item>
      <el-form-item label="商品ID"><el-input v-model="form.productId" placeholder="store-product 的 product-id" /></el-form-item>
      <el-form-item label="推广链接"><el-input v-model="form.productPromotionLink" placeholder="可选：product-promotion-link" /></el-form-item>
      <el-form-item label="媒体ID"><el-input v-model="form.mediaId" placeholder="可选：media-id" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="batchDialogVisible" title="批量修改" width="520px">
    <el-form :model="batchForm" label-width="100px">
      <el-form-item label="启用"><el-select v-model="batchForm.enabled" clearable placeholder="不修改" style="width:100%"><el-option label="启用" :value="true" /><el-option label="禁用" :value="false" /></el-select></el-form-item>
      <el-form-item label="类型"><el-select v-model="batchForm.type" clearable placeholder="不修改" style="width:100%"><el-option label="image" value="image" /><el-option label="video" value="video" /></el-select></el-form-item>
      <el-form-item label="sourceTag"><el-input v-model="batchForm.sourceTag" /></el-form-item>
      <el-form-item label="auditStatus"><el-input v-model="batchForm.auditStatus" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="batchDialogVisible=false">取消</el-button><el-button type="primary" :loading="batchSaving" @click="onBatchSubmit">确认</el-button></template>
  </el-dialog>

  <el-dialog v-model="previewVisible" title="预览" width="860px"><div style="display:flex;justify-content:center;"><img v-if="previewCurrent" :src="previewCurrent" style="max-width:100%;max-height:70vh;object-fit:contain;" /><el-empty v-else description="无预览" /></div></el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import CosUpload from '../components/CosUpload.vue'

const list = ref([])
const total = ref(0)
const selectedIds = ref([])
const dialogVisible = ref(false)
const batchDialogVisible = ref(false)
const previewVisible = ref(false)
const previewCurrent = ref('')
const saving = ref(false)
const batchSaving = ref(false)
const editing = ref(null)

const query = reactive({ page: 1, pageSize: 20, keyword: '', type: '', enabled: '', auditStatus: '', sourceTag: '' })
const form = reactive({ _id: '', title: '', desc: '', type: 'image', order: 0, coverFileID: '', fileID: '', previewImagesText: '[]', sourceTag: 'inspiration', auditStatus: 'approved', appid: '', productId: '', productPromotionLink: '', mediaId: '', enabled: true })
const batchForm = reactive({ enabled: undefined, type: '', sourceTag: '', auditStatus: '' })

const hasMore = computed(() => list.value.length < total.value)

const load = async (append = false) => {
  const data = await api.listMediaFeed(query)
  const rows = (data.list || []).map((x) => ({ ...x, urlOk: x.urlOk }))
  total.value = Number(data.total || 0)
  if (append) {
    const map = new Map(list.value.map((i) => [i._id, i]))
    rows.forEach((i) => map.set(i._id, i))
    list.value = Array.from(map.values())
  } else {
    list.value = rows
  }
}
const reload = async () => { query.page = 1; await load(false) }
const loadMore = async () => { if (!hasMore.value) return; query.page += 1; await load(true) }
const onSelectionChange = (rows) => { selectedIds.value = (rows || []).map((i) => i._id) }

const resetForm = () => {
  Object.assign(form, { _id: '', title: '', desc: '', type: 'image', order: 0, coverFileID: '', fileID: '', previewImagesText: '[]', sourceTag: 'inspiration', auditStatus: 'approved', appid: '', productId: '', productPromotionLink: '', mediaId: '', enabled: true })
}

const openCreate = () => {
  editing.value = null
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, { _id: row._id || '', title: row.title || '', desc: row.desc || '', type: row.type || 'image', order: Number(row.order || 0), coverFileID: row.coverFileID || '', fileID: row.fileID || '', previewImagesText: JSON.stringify(Array.isArray(row.previewImages) ? row.previewImages : [], null, 2), sourceTag: row.sourceTag || '', auditStatus: row.auditStatus || 'approved', appid: row.appid || row.storeAppid || '', productId: row.productId || row.productID || row.product_id || '', productPromotionLink: row.productPromotionLink || row.product_promotion_link || '', mediaId: row.mediaId || row.media_id || '', enabled: !!row.enabled })
  dialogVisible.value = true
}

function mainMediaUrlLooksLikeImage(url) {
  if (!url || typeof url !== 'string') return false
  const path = url.split('?')[0].toLowerCase()
  return /\.(jpe?g|png|gif|webp|bmp)(\b|$)/i.test(path)
}

function titleFromMediaUrl(url) {
  try {
    const path = decodeURIComponent(String(url).split('?')[0])
    const name = path.split('/').pop() || ''
    const base = name.replace(/\.[^.]+$/, '').replace(/[+_]/g, ' ').trim()
    return base || `灵感流_${Date.now()}`
  } catch (e) {
    return `灵感流_${Date.now()}`
  }
}

function parsePreviewFlexible() {
  try {
    const p = JSON.parse(form.previewImagesText || '[]')
    return Array.isArray(p) ? p : []
  } catch (e) {
    return []
  }
}

function buildMediaFeedPayload() {
  const fileUrl = (form.fileID || '').trim()
  const nextType = form.type
  const pi = parsePreviewFlexible()
  const finalPreview = nextType === 'image' ? (pi.length ? pi : (fileUrl ? [fileUrl] : [])) : pi
  const titleBase = (form.title || '').trim() || (fileUrl ? titleFromMediaUrl(fileUrl) : '') || `灵感流_${Date.now()}`
  return {
    title: titleBase,
    desc: form.desc.trim(),
    type: nextType,
    order: Number(form.order || 0),
    coverFileID: form.coverFileID.trim(),
    fileID: fileUrl,
    previewImages: finalPreview,
    sourceTag: form.sourceTag.trim(),
    auditStatus: form.auditStatus.trim(),
    appid: form.appid.trim(),
    productId: form.productId.trim(),
    productPromotionLink: form.productPromotionLink.trim(),
    mediaId: form.mediaId.trim(),
    enabled: form.enabled,
    ...(nextType === 'video' ? { aspectRatio: 0.68 } : {})
  }
}

async function persistUploadedMainMedia() {
  saving.value = true
  try {
    const payload = buildMediaFeedPayload()
    if (!payload.fileID) throw new Error('缺少媒体文件地址')
    const id = editing.value?._id || form._id
    if (id) {
      await api.updateMediaFeed(id, payload)
      ElMessage.success('媒体已同步到数据库')
    } else {
      const res = await api.createMediaFeed(payload)
      const newId = res?.id
      if (newId) {
        form._id = newId
        editing.value = { _id: newId }
      }
      ElMessage.success('已自动写入 media_feed')
    }
    form.previewImagesText = JSON.stringify(payload.previewImages || [], null, 2)
    form.title = payload.title
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '自动入库失败，请手动点保存')
  } finally {
    saving.value = false
  }
}

async function onMainMediaUploaded(url) {
  if (!url || typeof url !== 'string') return
  const u = url.trim()
  const isVid = mainMediaUrlLooksLikeVideo(u)
  const isImg = mainMediaUrlLooksLikeImage(u)
  if (!isVid && !isImg) {
    ElMessage.warning('文件已在 COS，请点击「保存」将链接写入数据库（未自动识别扩展名）')
    return
  }
  form.type = isVid ? 'video' : 'image'
  form.fileID = u
  if (!(form.title || '').trim()) form.title = titleFromMediaUrl(u)
  await persistUploadedMainMedia()
}

const parsePreview = () => { try { const p = JSON.parse(form.previewImagesText || '[]'); return Array.isArray(p) ? p : [] } catch (e) { return null } }

const onSubmit = async () => {
  if (!form.title?.trim()) return ElMessage.error('标题不能为空')
  const previewImages = parsePreview()
  if (previewImages === null) return ElMessage.error('previewImages 不是合法 JSON')
  saving.value = true
  try {
    const payload = { title: form.title.trim(), desc: form.desc.trim(), type: form.type, order: Number(form.order || 0), coverFileID: form.coverFileID.trim(), fileID: form.fileID.trim(), previewImages, sourceTag: form.sourceTag.trim(), auditStatus: form.auditStatus.trim(), appid: form.appid.trim(), productId: form.productId.trim(), productPromotionLink: form.productPromotionLink.trim(), mediaId: form.mediaId.trim(), enabled: form.enabled }
    if (editing.value?._id) {
      await api.updateMediaFeed(editing.value._id, payload)
    } else {
      await api.createMediaFeed(payload)
    }
    dialogVisible.value = false
    ElMessage.success('保存成功')
    await reload()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { saving.value = false }
}

const onDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确认删除该条媒体数据吗？', '提示', { type: 'warning' })
    await api.deleteMediaFeed(row._id)
    ElMessage.success('删除成功')
    await reload()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

const onBatchDelete = async () => {
  if (!selectedIds.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedIds.value.length} 条数据吗？`, '批量删除', { type: 'warning' })
    let ok = 0; let fail = 0
    for (const id of selectedIds.value) {
      try { await api.deleteMediaFeed(id); ok += 1 } catch (e) { fail += 1 }
    }
    ElMessage.success(`删除完成：成功 ${ok}，失败 ${fail}`)
    await reload()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '批量删除失败')
  }
}

const onQuickToggle = async (row, enabled) => { try { await api.updateMediaFeed(row._id, { enabled: !!enabled }); row.enabled = !!enabled } catch (e) { ElMessage.error(e.message || '更新失败') } }
const openBatchDialog = () => { batchForm.enabled = undefined; batchForm.type = ''; batchForm.sourceTag = ''; batchForm.auditStatus = ''; batchDialogVisible.value = true }

const onBatchSubmit = async () => {
  const patch = {}
  if (typeof batchForm.enabled === 'boolean') patch.enabled = batchForm.enabled
  if (batchForm.type) patch.type = batchForm.type
  if (batchForm.sourceTag.trim()) patch.sourceTag = batchForm.sourceTag.trim()
  if (batchForm.auditStatus.trim()) patch.auditStatus = batchForm.auditStatus.trim()
  if (!Object.keys(patch).length) return ElMessage.warning('至少填写一个字段')
  batchSaving.value = true
  try {
    const res = await api.batchUpdateMediaFeed({ ids: selectedIds.value, patch })
    batchDialogVisible.value = false
    ElMessage.success(`任务${res.jobId || '-'}：成功${res.updated || 0}，失败${res.failed || 0}`)
    await reload()
  } catch (e) { ElMessage.error(e.message || '批量失败') } finally { batchSaving.value = false }
}

const previewUrl = (row) => (Array.isArray(row.previewImages) && row.previewImages[0]) || row.coverFileID || row.fileID || ''
const openPreview = (url) => { previewCurrent.value = url || ''; previewVisible.value = true }

const checkSelectedMedia = async () => {
  const set = new Set(selectedIds.value)
  const targets = list.value.filter((i) => set.has(i._id)).map((i) => ({ row: i, url: previewUrl(i) })).filter((x) => /^https?:\/\//i.test(x.url || ''))
  await Promise.all(targets.map(async ({ row, url }) => { try { const r = await fetch(url, { method: 'HEAD' }); row.urlOk = r.ok } catch (e) { row.urlOk = false } }))
  ElMessage.success('检测完成')
}

const onImportFile = async (file) => {
  const text = await file.raw.text()
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return ElMessage.warning('CSV 无数据')
  const head = lines[0].split(',').map((s) => s.replace(/^"|"$/g, ''))
  const idx = Object.fromEntries(head.map((h, i) => [h, i]))
  let okCount = 0
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].match(/("[^"]*(?:""[^"]*)*"|[^,]+)/g) || []
    const get = (k) => String(cols[idx[k]] || '').replace(/^"|"$/g, '').replaceAll('""', '"')
    const id = get('_id')
    if (!id) continue
    let previewImages = []
    try { previewImages = JSON.parse(get('previewImages') || '[]') } catch (e) {}
    await api.updateMediaFeed(id, { title: get('title'), desc: get('desc'), type: get('type') || 'image', order: Number(get('order') || 0), coverFileID: get('coverFileID'), fileID: get('fileID'), previewImages: Array.isArray(previewImages) ? previewImages : [], sourceTag: get('sourceTag'), auditStatus: get('auditStatus'), appid: get('appid'), productId: get('productId'), productPromotionLink: get('productPromotionLink'), mediaId: get('mediaId'), enabled: get('enabled') === 'true' })
    okCount += 1
  }
  ElMessage.success(`导入完成 ${okCount} 条`)
  await reload()
}

const onExport = () => {
  const header = ['_id', 'title', 'desc', 'type', 'order', 'enabled', 'auditStatus', 'sourceTag', 'appid', 'productId', 'productPromotionLink', 'mediaId', 'coverFileID', 'fileID', 'previewImages']
  const rows = list.value.map((r) => [r._id, r.title, r.desc, r.type, String(r.order || 0), String(!!r.enabled), r.auditStatus, r.sourceTag, r.appid || r.storeAppid || '', r.productId || r.productID || r.product_id || '', r.productPromotionLink || r.product_promotion_link || '', r.mediaId || r.media_id || '', r.coverFileID, r.fileID, JSON.stringify(Array.isArray(r.previewImages) ? r.previewImages : [])])
  const csv = [header.join(','), ...rows.map((arr) => arr.map((v) => `"${String(v || '').replaceAll('"', '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'media_feed_export.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(reload)
</script>

<style scoped>
.form-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.5;
}
.form-hint code {
  font-size: 11px;
  background: var(--el-fill-color-light, #f5f7fa);
  padding: 0 4px;
  border-radius: 4px;
}
</style>
