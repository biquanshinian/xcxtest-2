<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>系统公告</span>
        <el-button type="primary" @click="openCreate">新建公告</el-button>
      </div>
    </template>

    <el-table :data="list" stripe>
      <el-table-column prop="title" label="标题" min-width="160" />
      <el-table-column prop="type" label="类型" width="100">
        <template #default="scope">
          <el-tag :type="tagType(scope.row.type)">{{ scope.row.type || 'info' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="version" label="版本" width="100" />
      <el-table-column label="强制更新" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.forceUpdate ? 'warning' : 'info'" size="small">
            {{ scope.row.forceUpdate ? '是' : '否' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="维护模式" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.maintenance ? 'danger' : 'info'" size="small">
            {{ scope.row.maintenance ? '是' : '否' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="scope">
          <el-tag :type="scope.row.active ? 'success' : 'info'">
            {{ scope.row.active ? '生效' : '失效' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="scope">{{ fmt(scope.row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="scope">
          <el-button size="small" @click="openEdit(scope.row)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :total="total"
      :page-sizes="[10, 20, 50]"
      layout="total, sizes, prev, pager, next"
      style="margin-top:16px;"
      @current-change="load"
      @size-change="load"
    />

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑公告' : '新建公告'" width="560px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="公告标题" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="4" placeholder="公告内容" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" placeholder="选择类型" style="width:100%;">
            <el-option label="info" value="info" />
            <el-option label="warning" value="warning" />
            <el-option label="error" value="error" />
            <el-option label="success" value="success" />
          </el-select>
        </el-form-item>
        <el-form-item label="版本号">
          <el-input v-model="form.version" placeholder="如 1.2.0" />
        </el-form-item>
        <el-form-item label="强制更新">
          <el-switch v-model="form.forceUpdate" />
        </el-form-item>
        <el-form-item label="维护模式">
          <el-switch v-model="form.maintenance" />
        </el-form-item>
        <el-form-item label="生效">
          <el-switch v-model="form.active" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')
const tagType = (t) => {
  const map = { info: 'primary', warning: 'warning', error: 'danger', success: 'success' }
  return map[t] || 'info'
}

const list = ref([])
const total = ref(0)
const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const query = reactive({ page: 1, pageSize: 20 })

const form = reactive({
  title: '',
  content: '',
  type: 'info',
  version: '',
  forceUpdate: false,
  maintenance: false,
  active: true
})

const load = async () => {
  try {
    const res = await api.listAnnouncements({
      page: query.page,
      pageSize: query.pageSize
    })
    list.value = res?.list ?? []
    total.value = res?.total ?? 0
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  }
}

const resetForm = () => {
  Object.assign(form, {
    title: '',
    content: '',
    type: 'info',
    version: '',
    forceUpdate: false,
    maintenance: false,
    active: true
  })
}

const openCreate = () => {
  editing.value = null
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, {
    title: row.title ?? '',
    content: row.content ?? '',
    type: row.type ?? 'info',
    version: row.version ?? '',
    forceUpdate: !!row.forceUpdate,
    maintenance: !!row.maintenance,
    active: row.active !== false
  })
  dialogVisible.value = true
}

const onSubmit = async () => {
  saving.value = true
  try {
    const id = editing.value?._id ?? editing.value?.id
    if (id) {
      await api.updateAnnouncement(id, { ...form })
      ElMessage.success('更新成功')
    } else {
      await api.createAnnouncement({ ...form })
      ElMessage.success('创建成功')
    }
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
    await ElMessageBox.confirm('确认删除该公告吗？', '提示', { type: 'warning' })
    await api.deleteAnnouncement(row._id ?? row.id)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {}
}

onMounted(load)
</script>
