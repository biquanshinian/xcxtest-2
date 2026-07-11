<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span>发射数据管理</span>
          <el-input v-model="query.keyword" placeholder="关键词搜索" style="width:220px" clearable @keyup.enter="load" />
          <el-button @click="load">查询</el-button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <el-button type="warning" @click="onClean" :loading="cleanLoading">清理过期缓存</el-button>
          <el-button type="primary" @click="onSync" :loading="syncLoading">同步数据</el-button>
        </div>
      </div>
    </template>

    <el-table :data="list" stripe v-loading="loading" @row-click="onRowClick">
      <el-table-column label="名称" min-width="200">
        <template #default="scope">{{ scope.row.name || scope.row.mission_name || '-' }}</template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="140" />
      <el-table-column prop="status" label="状态" width="120" />
      <el-table-column label="时间" width="180">
        <template #default="scope">{{ fmt(scope.row.net) }}</template>
      </el-table-column>
      <el-table-column label="更新时间" width="180">
        <template #default="scope">{{ fmt(scope.row.updatedAt) }}</template>
      </el-table-column>
      <el-empty v-if="!loading && !list.length" description="暂无发射数据" />
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

  <el-dialog v-model="editDialogVisible" title="编辑发射数据" width="560px">
    <el-form :model="editForm" label-width="120px">
      <el-form-item label="名称"><el-input v-model="editForm.name" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="editForm.description" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="状态"><el-input v-model="editForm.status" /></el-form-item>
      <el-form-item label="翻译名称"><el-input v-model="editForm.translated_name" /></el-form-item>
      <el-form-item label="翻译描述"><el-input v-model="editForm.translated_description" type="textarea" :rows="3" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="editDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')

const list = ref([])
const total = ref(0)
const loading = ref(false)
const syncLoading = ref(false)
const cleanLoading = ref(false)
const editDialogVisible = ref(false)
const saving = ref(false)
const editingId = ref(null)

const query = reactive({ keyword: '', type: '', page: 1, pageSize: 20 })
const editForm = reactive({
  name: '',
  description: '',
  status: '',
  translated_name: '',
  translated_description: ''
})

const load = async () => {
  loading.value = true
  try {
    const data = await api.listLaunchData(query)
    list.value = data.list || []
    total.value = data.total || 0
  } catch (e) {
    ElMessage.error(e.message || '加载数据失败')
  } finally {
    loading.value = false
  }
}

const onPageChange = (page) => {
  query.page = page
  load()
}

const onRowClick = (row) => {
  editingId.value = row._id || row.id
  Object.assign(editForm, {
    name: row.name || row.mission_name || '',
    description: row.description || '',
    status: row.status || '',
    translated_name: row.translated_name || '',
    translated_description: row.translated_description || ''
  })
  editDialogVisible.value = true
}

const onSave = async () => {
  if (!editingId.value) return
  saving.value = true
  try {
    await api.updateLaunchData(editingId.value, { ...editForm })
    ElMessage.success('保存成功')
    editDialogVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const onSync = async () => {
  syncLoading.value = true
  try {
    await api.syncLaunchData()
    ElMessage.success('同步成功')
    load()
  } catch (e) {
    ElMessage.error(e.message || '同步失败')
  } finally {
    syncLoading.value = false
  }
}

const onClean = async () => {
  try {
    await ElMessageBox.confirm(
      '将删除已过期（expiresAt < 现在）以及超过 7 天未更新的缓存文档，是否继续？',
      '清理过期缓存',
      { type: 'warning' }
    )
  } catch (_) {
    return
  }
  cleanLoading.value = true
  try {
    const res = await api.cleanLaunchDataCache()
    ElMessage.success(`已清理 ${res?.removed ?? 0} 条`)
    load()
  } catch (e) {
    ElMessage.error(e.message || '清理失败')
  } finally {
    cleanLoading.value = false
  }
}

onMounted(() => {
  load()
})
</script>
