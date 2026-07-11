<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>星舰建设进度（media_assets）</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <el-input v-model="query.keyword" placeholder="搜索 _id / key" style="width:200px" @keyup.enter="reload" />
          <el-input v-model="query.keyPrefix" placeholder="路径前缀" style="width:200px" @keyup.enter="reload" />
          <el-select v-model="query.enabled" placeholder="启用状态" style="width:120px" clearable>
            <el-option label="启用" value="true" />
            <el-option label="禁用" value="false" />
          </el-select>
          <el-button @click="reload">查询</el-button>
          <el-button type="primary" @click="openCreate">新建</el-button>
          <el-button @click="loadMore" :disabled="!hasMore">下一批</el-button>
          <el-button @click="onExport">导出当前页</el-button>
        </div>
      </div>
    </template>

    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <el-button size="small" :disabled="!selectedIds.length" @click="openBatchDialog">批量修改</el-button>
      <el-button size="small" type="danger" :disabled="!selectedIds.length" @click="onBatchDelete">批量删除</el-button>
      <el-button size="small" :disabled="!selectedIds.length" @click="checkSelectedUrls">检查链接</el-button>
      <el-upload :auto-upload="false" :show-file-list="false" accept=".csv" :on-change="onImportFile">
        <el-button size="small">导入CSV（当前页覆盖）</el-button>
      </el-upload>
      <el-text type="info">已选 {{ selectedIds.length }} 项，已加载 {{ list.length }}/{{ total }}</el-text>
    </div>

    <el-table :data="list" stripe @selection-change="onSelectionChange">
      <el-table-column type="selection" width="46" />
      <el-table-column prop="_id" label="ID" min-width="180" show-overflow-tooltip />
      <el-table-column label="预览" width="90">
        <template #default="s">
          <el-image v-if="s.row.url" :src="s.row.url" :preview-src-list="[s.row.url]" fit="cover" style="width:56px;height:56px;border-radius:6px;cursor:pointer;" preview-teleported />
          <span v-else style="color:var(--t-text-muted)">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="key" label="对象路径" min-width="200" show-overflow-tooltip />
      <el-table-column prop="url" label="URL" min-width="180" show-overflow-tooltip />
      <el-table-column label="链接" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.urlOk === false ? 'danger' : scope.row.urlOk === true ? 'success' : 'info'">
            {{ scope.row.urlOk === false ? '失效' : scope.row.urlOk === true ? '正常' : '-' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="90"><template #default="s"><el-switch :model-value="!!s.row.enabled" @change="(v)=>onQuickToggle(s.row,v)" /></template></el-table-column>
      <el-table-column label="操作" width="160"><template #default="s">
        <el-button size="small" @click="openEdit(s.row)">编辑</el-button>
        <el-button size="small" type="danger" @click="onDelete(s.row)">删除</el-button>
      </template></el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editing ? '编辑素材' : '新建素材'" width="700px">
    <el-form :model="form" label-width="90px">
      <el-form-item v-if="editing" label="ID"><el-input v-model="form._id" disabled /></el-form-item>
      <el-form-item label="路径"><el-input v-model="form.key" placeholder="COS对象路径，如 starship/image01.jpg" /></el-form-item>
      <el-form-item label="文件上传">
        <CosUpload v-model="form.url" path-prefix="admin-uploads/assets/" accept="image/*,video/*" button-text="上传文件" placeholder="文件URL" @success="onUploadSuccess" />
      </el-form-item>
      <el-form-item label="来源"><el-input v-model="form.sourceTag" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="batchDialogVisible" title="批量修改" width="520px">
    <el-form :model="batchForm" label-width="100px">
      <el-form-item label="启用"><el-select v-model="batchForm.enabled" clearable placeholder="不修改" style="width:100%"><el-option label="启用" :value="true" /><el-option label="禁用" :value="false" /></el-select></el-form-item>
      <el-form-item label="sourceTag"><el-input v-model="batchForm.sourceTag" placeholder="留空不改" /></el-form-item>
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

const query = reactive({ page: 1, pageSize: 20, keyword: '', keyPrefix: '', enabled: '', sourceTag: '' })
const form = reactive({ _id: '', key: '', url: '', sourceTag: '', enabled: true })
const batchForm = reactive({ enabled: undefined, sourceTag: '' })

const hasMore = computed(() => list.value.length < total.value)

const load = async (append = false) => {
  const data = await api.listMediaAssets(query)
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

const reload = async () => {
  query.page = 1
  await load(false)
}

const loadMore = async () => {
  if (!hasMore.value) return
  query.page += 1
  await load(true)
}

const onSelectionChange = (rows) => { selectedIds.value = (rows || []).map((i) => i._id) }

const resetForm = () => {
  Object.assign(form, { _id: '', key: '', url: '', sourceTag: '', enabled: true })
}

const openCreate = () => {
  editing.value = null
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, { _id: row._id || '', key: row.key || '', url: row.url || '', sourceTag: row.sourceTag || '', enabled: !!row.enabled })
  dialogVisible.value = true
}

const onUploadSuccess = (cosUrl) => {
  if (!form.key) {
    const urlPath = new URL(cosUrl).pathname
    form.key = decodeURIComponent(urlPath.replace(/^\//, ''))
  }
}

const onSubmit = async () => {
  if (!form.key?.trim()) return ElMessage.error('路径不能为空')
  if (form.url && !/^https?:\/\//i.test(form.url)) return ElMessage.error('URL 必须是 http(s)')
  saving.value = true
  try {
    const payload = { key: form.key.trim(), url: form.url.trim(), sourceTag: form.sourceTag.trim(), enabled: form.enabled }
    if (editing.value?._id) {
      await api.updateMediaAsset(editing.value._id, payload)
    } else {
      await api.createMediaAsset(payload)
    }
    dialogVisible.value = false
    ElMessage.success('保存成功')
    await reload()
  } catch (e) { ElMessage.error(e.message || '保存失败') } finally { saving.value = false }
}

const onDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确认删除该条素材数据吗？', '提示', { type: 'warning' })
    await api.deleteMediaAsset(row._id)
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
      try { await api.deleteMediaAsset(id); okN += 1 } catch (e) { failN += 1 }
    }
    ElMessage.success(`删除完成：成功 ${okN}，失败 ${failN}`)
    await reload()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '批量删除失败')
  }
}

const onQuickToggle = async (row, enabled) => {
  try { await api.updateMediaAsset(row._id, { enabled: !!enabled }); row.enabled = !!enabled } catch (e) { ElMessage.error(e.message || '更新失败') }
}

const openBatchDialog = () => { batchForm.enabled = undefined; batchForm.sourceTag = ''; batchDialogVisible.value = true }

const onBatchSubmit = async () => {
  const patch = {}
  if (typeof batchForm.enabled === 'boolean') patch.enabled = batchForm.enabled
  if (batchForm.sourceTag.trim()) patch.sourceTag = batchForm.sourceTag.trim()
  if (!Object.keys(patch).length) return ElMessage.warning('至少填写一个字段')
  batchSaving.value = true
  try {
    const res = await api.batchUpdateMediaAssets({ ids: selectedIds.value, patch })
    batchDialogVisible.value = false
    ElMessage.success(`任务${res.jobId || '-'}：成功${res.updated || 0}，失败${res.failed || 0}`)
    await reload()
  } catch (e) { ElMessage.error(e.message || '批量失败') } finally { batchSaving.value = false }
}

const checkSelectedUrls = async () => {
  const set = new Set(selectedIds.value)
  const targets = list.value.filter((i) => set.has(i._id) && /^https?:\/\//i.test(i.url || ''))
  await Promise.all(targets.map(async (row) => {
    try { const r = await fetch(row.url, { method: 'HEAD' }); row.urlOk = r.ok } catch (e) { row.urlOk = false }
  }))
  ElMessage.success('链接检测完成')
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
    await api.updateMediaAsset(id, { key: get('key'), url: get('url'), sourceTag: get('sourceTag'), enabled: get('enabled') === 'true' })
    okCount += 1
  }
  ElMessage.success(`导入完成 ${okCount} 条`)
  await reload()
}

const onExport = () => {
  const header = ['_id', 'key', 'url', 'sourceTag', 'enabled', 'updatedAt']
  const rows = list.value.map((r) => [r._id, r.key, r.url, r.sourceTag, String(!!r.enabled), String(r.updatedAt || 0)])
  const csv = [header.join(','), ...rows.map((arr) => arr.map((v) => `"${String(v || '').replaceAll('"', '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'media_assets_export.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(reload)
</script>
