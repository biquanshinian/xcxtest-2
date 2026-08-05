<template>
  <el-card>
    <template #header>
      <div class="hdr">
        <span>策略引擎</span>
        <div class="acts">
          <el-button @click="onSeed" :loading="seeding">导入种子策略</el-button>
          <el-button type="primary" @click="openCreate">新建</el-button>
        </div>
      </div>
    </template>
    <el-table :data="list" stripe v-loading="loading">
      <el-table-column prop="key" label="Key" width="140" />
      <el-table-column prop="name" label="名称" width="140" />
      <el-table-column prop="promptKey" label="提示词" width="140" />
      <el-table-column prop="themeId" label="排版" width="100" />
      <el-table-column prop="structureHint" label="结构逻辑" min-width="220" show-overflow-tooltip />
      <el-table-column prop="priority" label="优先级" width="90" />
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="visible" :title="editing ? '编辑策略' : '新建策略'" width="640px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="Key"><el-input v-model="form.key" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="提示词 Key"><el-input v-model="form.promptKey" placeholder="rewrite_deep / create_from_data" /></el-form-item>
        <el-form-item label="排版主题">
          <el-select v-model="form.themeId">
            <el-option label="clean" value="clean" />
            <el-option label="diary" value="diary" />
            <el-option label="brief" value="brief" />
          </el-select>
        </el-form-item>
        <el-form-item label="结构逻辑"><el-input v-model="form.structureHint" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="标题风格"><el-input v-model="form.titleHint" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="优先级"><el-input-number v-model="form.priority" :min="0" :max="999" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const list = ref([])
const loading = ref(false)
const seeding = ref(false)
const saving = ref(false)
const visible = ref(false)
const editing = ref(null)
const form = reactive({
  key: '', name: '', promptKey: 'create_from_data', themeId: 'clean',
  structureHint: '', titleHint: '', priority: 50, enabled: true
})

const load = async () => {
  loading.value = true
  try {
    const res = await api.listOaStrategies({ pageSize: 100 })
    list.value = res?.list || []
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const openCreate = () => {
  editing.value = null
  Object.assign(form, {
    key: '', name: '', promptKey: 'create_from_data', themeId: 'clean',
    structureHint: '', titleHint: '', priority: 50, enabled: true
  })
  visible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, {
    key: row.key || '',
    name: row.name || '',
    promptKey: row.promptKey || '',
    themeId: row.themeId || 'clean',
    structureHint: row.structureHint || '',
    titleHint: row.titleHint || '',
    priority: row.priority ?? 50,
    enabled: row.enabled !== false
  })
  visible.value = true
}

const onSubmit = async () => {
  saving.value = true
  try {
    if (editing.value) await api.updateOaStrategy(editing.value._id, { ...form })
    else await api.createOaStrategy({ ...form })
    visible.value = false
    load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const onDelete = async (row) => {
  try {
    await ElMessageBox.confirm('删除该策略？', '提示', { type: 'warning' })
    await api.deleteOaStrategy(row._id)
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

const onSeed = async () => {
  // 默认只补缺失，避免覆盖手工调过的策略；用户可显式选择覆盖重置
  let overwrite = false
  try {
    await ElMessageBox.confirm(
      '「仅补缺失」只导入库里没有的种子策略，不动已有条目；「覆盖重置」会把种子同名策略全部重置为默认内容。',
      '导入种子策略',
      {
        distinguishCancelAndClose: true,
        confirmButtonText: '仅补缺失',
        cancelButtonText: '覆盖重置',
        type: 'info'
      }
    )
  } catch (action) {
    if (action !== 'cancel') return
    try {
      await ElMessageBox.confirm('确认用种子内容覆盖同名策略？手工修改将丢失。', '覆盖重置', {
        type: 'warning',
        confirmButtonText: '确认覆盖',
        cancelButtonText: '取消'
      })
      overwrite = true
    } catch (e2) {
      return
    }
  }
  seeding.value = true
  try {
    const res = await api.seedOaStrategies({ overwrite })
    ElMessage.success(
      overwrite
        ? `已覆盖重置：新增 ${res?.created || 0}，更新 ${res?.updated || 0}`
        : `已补缺失：新增 ${res?.created || 0}，跳过已有 ${res?.skipped || 0}`
    )
    load()
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    seeding.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.hdr { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
.acts { display:flex; gap:8px; }
</style>
