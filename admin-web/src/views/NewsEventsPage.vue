<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div>事件管理</div>
        <div style="display:flex;gap:8px;">
          <el-input v-model="query.keyword" placeholder="关键词" style="width:220px" @keyup.enter="load" />
          <el-select v-model="query.published" placeholder="发布状态" style="width:140px" clearable>
            <el-option label="已发布" value="true" />
            <el-option label="未发布" value="false" />
          </el-select>
          <el-button @click="load">查询</el-button>
          <el-button type="primary" @click="openCreate">新建</el-button>
        </div>
      </div>
    </template>

    <el-table :data="list" stripe>
      <el-table-column prop="title" label="标题" min-width="260" />
      <el-table-column prop="date" label="时间" width="180" />
      <el-table-column label="图片" width="80">
        <template #default="scope">
          <img v-if="scope.row.image" :src="scope.row.image" style="width:40px;height:28px;object-fit:cover;border-radius:3px;cursor:pointer;" @click="openPreview(scope.row.image)" />
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="weight" label="权重" width="80" />
      <el-table-column label="发布" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.published ? 'success' : 'info'">{{ scope.row.published ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
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

  <el-dialog v-model="dialogVisible" :title="editing ? '编辑 Event' : '新建 Event'" width="640px">
    <el-form :model="form" label-width="90px">
      <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
      <el-form-item label="摘要"><el-input v-model="form.summary" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="时间"><el-input v-model="form.date" placeholder="ISO 时间" /></el-form-item>
      <el-form-item label="图片">
        <CosUpload v-model="form.image" path-prefix="admin-uploads/news/" accept="image/*" button-text="上传图片" placeholder="图片URL" />
      </el-form-item>
      <el-form-item label="链接"><el-input v-model="form.url" /></el-form-item>
      <el-form-item label="权重"><el-input-number v-model="form.weight" :min="0" :max="9999" /></el-form-item>
      <el-form-item label="发布"><el-switch v-model="form.published" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="previewVisible" title="预览" width="860px">
    <div style="display:flex;justify-content:center">
      <img v-if="previewCurrent" :src="previewCurrent" style="max-width:100%;max-height:70vh;object-fit:contain" />
    </div>
  </el-dialog>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import CosUpload from '../components/CosUpload.vue'

const list = ref([])
const total = ref(0)
const saving = ref(false)
const dialogVisible = ref(false)
const previewVisible = ref(false)
const previewCurrent = ref('')
const editing = ref(null)

const query = reactive({ page: 1, pageSize: 20, keyword: '', published: '' })
const form = reactive({ title: '', summary: '', date: '', image: '', url: '', weight: 0, published: false })

const resetForm = () => {
  Object.assign(form, { title: '', summary: '', date: '', image: '', url: '', weight: 0, published: false })
}

const load = async () => {
  const data = await api.listEvents(query)
  list.value = data.list || []
  total.value = data.total || 0
}

const onPageChange = (page) => {
  query.page = page
  load()
}

const openCreate = () => {
  editing.value = null
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, {
    title: row.title || '',
    summary: row.summary || '',
    date: row.date || '',
    image: row.image || '',
    url: row.url || '',
    weight: Number(row.weight || 0),
    published: !!row.published
  })
  dialogVisible.value = true
}

const openPreview = (url) => {
  previewCurrent.value = url
  previewVisible.value = true
}

const onSubmit = async () => {
  saving.value = true
  try {
    if (editing.value?._id || editing.value?.id) {
      await api.updateEvent(editing.value._id || editing.value.id, form)
    } else {
      await api.createEvent(form)
    }
    ElMessage.success('保存成功')
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
    await ElMessageBox.confirm('确认删除该条 Event 吗？', '提示', { type: 'warning' })
    await api.deleteEvent(row._id || row.id)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {}
}

onMounted(load)
</script>
