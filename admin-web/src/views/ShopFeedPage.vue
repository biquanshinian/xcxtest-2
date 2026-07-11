<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>小店数据（shop_feed）</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <el-input v-model="query.keyword" placeholder="关键词/商品ID" style="width:240px" @keyup.enter="reload" />
          <el-select v-model="query.enabled" placeholder="启用" clearable style="width:100px"><el-option label="启用" value="true" /><el-option label="禁用" value="false" /></el-select>
          <el-button @click="reload">查询</el-button>
          <el-button type="primary" @click="openCreate">新建</el-button>
          <el-button @click="toggleOnlyUnconfigured">{{ onlyUnconfigured ? '查看全部' : '仅看未配置项' }}</el-button>
          <el-button @click="loadMore" :disabled="!hasMore">下一批</el-button>
          <el-button @click="onExport">导出</el-button>
        </div>
      </div>
    </template>

    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <el-button size="small" :disabled="!selectedIds.length" @click="openBatchDialog">批量修改</el-button>
      <el-button size="small" type="danger" :disabled="!selectedIds.length" @click="onBatchDelete">批量删除</el-button>
      <el-upload :auto-upload="false" :show-file-list="false" accept=".csv" :on-change="onImportFile"><el-button size="small">导入CSV</el-button></el-upload>
      <el-text type="info">已选 {{ selectedIds.length }} 项，已加载 {{ list.length }}/{{ total }}</el-text>
    </div>

    <el-table :data="list" stripe @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column prop="_id" label="ID" min-width="170" show-overflow-tooltip />
      <el-table-column prop="title" label="标题" min-width="130" show-overflow-tooltip />
      <el-table-column prop="productId" label="商品ID" min-width="130" show-overflow-tooltip />
      <el-table-column prop="appid" label="小店AppID" min-width="150" show-overflow-tooltip />
      <el-table-column label="对接状态" width="120"><template #default="s"><el-tag :type="getLinkStatus(s.row).ok ? 'success' : 'warning'">{{ getLinkStatus(s.row).label }}</el-tag></template></el-table-column>
      <el-table-column prop="order" label="排序" width="80" />
      <el-table-column label="启用" width="90"><template #default="s"><el-switch :model-value="!!s.row.enabled" @change="(v)=>onQuickToggle(s.row,v)" /></template></el-table-column>
      <el-table-column label="操作" width="160"><template #default="s">
        <el-button size="small" @click="openEdit(s.row)">编辑</el-button>
        <el-button size="small" type="danger" @click="onDelete(s.row)">删除</el-button>
      </template></el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editing ? '编辑小店数据' : '新建小店数据'" width="760px">
    <el-form :model="form" label-width="110px">
      <el-form-item v-if="editing" label="ID"><el-input v-model="form._id" disabled /></el-form-item>
      <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="form.desc" type="textarea" :rows="2" /></el-form-item>
      <el-form-item label="排序"><el-input-number v-model="form.order" :min="0" /></el-form-item>
      <el-form-item label="宽高比"><el-input-number v-model="form.aspectRatio" :min="0.2" :step="0.01" :precision="2" /></el-form-item>
      <el-form-item label="封面图">
        <CosUpload v-model="form.coverFileID" path-prefix="admin-uploads/shop/" accept="image/*" button-text="上传封面" placeholder="封面图URL" />
      </el-form-item>
      <el-form-item label="小店AppID"><el-input v-model="form.appid" placeholder="默认可留空" /></el-form-item>
      <el-form-item label="商品ID"><el-input v-model="form.productId" placeholder="必填：store-product product-id" /></el-form-item>
      <el-form-item label="推广链接"><el-input v-model="form.productPromotionLink" placeholder="可选：product-promotion-link" /></el-form-item>
      <el-form-item label="媒体ID"><el-input v-model="form.mediaId" placeholder="可选：media-id" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="batchDialogVisible" title="批量修改" width="520px">
    <el-form :model="batchForm" label-width="100px">
      <el-form-item label="启用"><el-select v-model="batchForm.enabled" clearable placeholder="不修改" style="width:100%"><el-option label="启用" :value="true" /><el-option label="禁用" :value="false" /></el-select></el-form-item>
      <el-form-item label="小店AppID"><el-input v-model="batchForm.appid" placeholder="不修改可留空" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="batchDialogVisible=false">取消</el-button><el-button type="primary" :loading="batchSaving" @click="onBatchSubmit">确认</el-button></template>
  </el-dialog>
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
const saving = ref(false)
const batchSaving = ref(false)
const editing = ref(null)
const onlyUnconfigured = ref(false)

const query = reactive({ page: 1, pageSize: 20, keyword: '', enabled: '' })
const form = reactive({ _id: '', title: '', desc: '', order: 0, aspectRatio: 0.94, coverFileID: '', appid: '', productId: '', productPromotionLink: '', mediaId: '', enabled: true })
const batchForm = reactive({ enabled: undefined, appid: '' })

const hasMore = computed(() => list.value.length < total.value)

const getProductId = (row) => String((row && (row.productId || row.productID || row.product_id)) || '').trim()
const getLinkStatus = (row) => {
  const productId = getProductId(row)
  if (!productId) return { ok: false, label: '未配置商品ID' }
  return { ok: true, label: '可展示' }
}

const load = async (append = false) => {
  const data = await api.listShopFeed(query)
  let rows = data.list || []
  if (onlyUnconfigured.value) {
    rows = rows.filter((row) => !getProductId(row))
  }

  total.value = onlyUnconfigured.value ? rows.length : Number(data.total || 0)

  if (append) {
    const map = new Map(list.value.map((i) => [i._id, i]))
    rows.forEach((i) => map.set(i._id, i))
    list.value = Array.from(map.values())
  } else {
    list.value = rows
  }
}

const reload = async () => { query.page = 1; await load(false) }
const toggleOnlyUnconfigured = async () => {
  onlyUnconfigured.value = !onlyUnconfigured.value
  await reload()
}
const loadMore = async () => { if (!hasMore.value) return; query.page += 1; await load(true) }
const onSelectionChange = (rows) => { selectedIds.value = (rows || []).map((i) => i._id) }

const resetForm = () => {
  Object.assign(form, { _id: '', title: '', desc: '', order: 0, aspectRatio: 0.94, coverFileID: '', appid: '', productId: '', productPromotionLink: '', mediaId: '', enabled: true })
}

const openCreate = () => {
  editing.value = null
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, { _id: row._id || '', title: row.title || '', desc: row.desc || '', order: Number(row.order || 0), aspectRatio: Number(row.aspectRatio || 0.94), coverFileID: row.coverFileID || '', appid: row.appid || row.storeAppid || '', productId: row.productId || row.productID || row.product_id || '', productPromotionLink: row.productPromotionLink || row.product_promotion_link || '', mediaId: row.mediaId || row.media_id || '', enabled: !!row.enabled })
  dialogVisible.value = true
}

const onSubmit = async () => {
  saving.value = true
  try {
    const payload = { title: form.title.trim(), desc: form.desc.trim(), order: Number(form.order || 0), aspectRatio: Number(form.aspectRatio || 0.94), coverFileID: form.coverFileID.trim(), appid: form.appid.trim(), productId: form.productId.trim(), productPromotionLink: form.productPromotionLink.trim(), mediaId: form.mediaId.trim(), enabled: form.enabled }
    if (editing.value?._id) {
      await api.updateShopFeed(editing.value._id, payload)
    } else {
      await api.createShopFeed(payload)
    }
    dialogVisible.value = false
    ElMessage.success('保存成功')
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const onDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确认删除该条小店数据吗？', '提示', { type: 'warning' })
    await api.deleteShopFeed(row._id)
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
    let okN = 0; let failN = 0
    for (const id of selectedIds.value) {
      try { await api.deleteShopFeed(id); okN += 1 } catch (e) { failN += 1 }
    }
    ElMessage.success(`删除完成：成功 ${okN}，失败 ${failN}`)
    await reload()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '批量删除失败')
  }
}

const onQuickToggle = async (row, enabled) => {
  try {
    await api.updateShopFeed(row._id, { enabled: !!enabled })
    row.enabled = !!enabled
  } catch (e) {
    ElMessage.error(e.message || '更新失败')
  }
}

const openBatchDialog = () => {
  batchForm.enabled = undefined
  batchForm.appid = ''
  batchDialogVisible.value = true
}

const onBatchSubmit = async () => {
  const patch = {}
  if (typeof batchForm.enabled === 'boolean') patch.enabled = batchForm.enabled
  if (batchForm.appid.trim()) patch.appid = batchForm.appid.trim()
  if (!Object.keys(patch).length) return ElMessage.warning('至少填写一个字段')
  batchSaving.value = true
  try {
    const res = await api.batchUpdateShopFeed({ ids: selectedIds.value, patch })
    batchDialogVisible.value = false
    ElMessage.success(`任务${res.jobId || '-'}：成功${res.updated || 0}，失败${res.failed || 0}`)
    await reload()
  } catch (e) {
    ElMessage.error(e.message || '批量失败')
  } finally {
    batchSaving.value = false
  }
}

const onImportFile = async (file) => {
  const text = await file.raw.text()
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return ElMessage.warning('CSV 无数据')
  const head = lines[0].split(',').map((s) => s.replace(/^"|"$/g, ''))
  const idx = Object.fromEntries(head.map((h, i) => [h, i]))
  const getValue = (cols, key) => String(cols[idx[key]] || '').replace(/^"|"$/g, '').replaceAll('""', '"')

  let okCount = 0
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].match(/("[^"]*(?:""[^"]*)*"|[^,]+)/g) || []
    const id = getValue(cols, '_id')
    if (!id) continue
    await api.updateShopFeed(id, {
      title: getValue(cols, 'title'),
      desc: getValue(cols, 'desc'),
      order: Number(getValue(cols, 'order') || 0),
      aspectRatio: Number(getValue(cols, 'aspectRatio') || 0.94),
      coverFileID: getValue(cols, 'coverFileID'),
      appid: getValue(cols, 'appid'),
      productId: getValue(cols, 'productId'),
      productPromotionLink: getValue(cols, 'productPromotionLink'),
      mediaId: getValue(cols, 'mediaId'),
      enabled: getValue(cols, 'enabled') === 'true'
    })
    okCount += 1
  }

  ElMessage.success(`导入完成 ${okCount} 条`)
  await reload()
}

const onExport = () => {
  const header = ['_id', 'title', 'desc', 'order', 'aspectRatio', 'enabled', 'appid', 'productId', 'productPromotionLink', 'mediaId', 'coverFileID']
  const rows = list.value.map((r) => [r._id, r.title, r.desc, String(r.order || 0), String(r.aspectRatio || 0.94), String(!!r.enabled), r.appid || r.storeAppid || '', r.productId || r.productID || r.product_id || '', r.productPromotionLink || r.product_promotion_link || '', r.mediaId || r.media_id || '', r.coverFileID || ''])
  const csv = [header.join(','), ...rows.map((arr) => arr.map((v) => `"${String(v || '').replaceAll('"', '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'shop_feed_export.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(reload)
</script>
