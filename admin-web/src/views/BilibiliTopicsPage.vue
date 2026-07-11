<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>B 站话题词库</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <el-button @click="onSeed" :loading="seeding">导入种子词</el-button>
          <el-button type="primary" @click="openCreate">新增词条</el-button>
        </div>
      </div>
    </template>

    <el-tabs v-model="tab" @tab-change="onTabChange">
      <el-tab-pane label="已启用" name="active" />
      <el-tab-pane label="AI 待确认" name="pending" />
      <el-tab-pane label="已禁用" name="disabled" />
      <el-tab-pane label="黑名单" name="blacklist" />
    </el-tabs>

    <template v-if="tab !== 'blacklist'">
      <el-table :data="list" stripe v-loading="loading">
        <el-table-column prop="keyword" label="关键词" min-width="120" />
        <el-table-column prop="topic" label="话题" min-width="120" />
        <el-table-column label="别名" min-width="160">
          <template #default="{ row }">{{ (row.aliases || []).join(', ') || '-' }}</template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="90" />
        <el-table-column prop="hitCount" label="命中" width="80" />
        <el-table-column prop="suggestCount" label="AI建议" width="90" />
        <el-table-column prop="source" label="来源" width="100" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <template v-if="tab === 'pending'">
              <el-button size="small" type="success" @click="onPromote(row)">采纳</el-button>
              <el-button size="small" type="danger" @click="onReject(row)">拒绝</el-button>
            </template>
            <template v-else>
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <template v-else>
      <div style="margin-bottom:12px;display:flex;gap:8px;">
        <el-input v-model="blacklistWord" placeholder="黑名单词" style="width:220px" />
        <el-button type="primary" @click="onAddBlacklist">添加</el-button>
      </div>
      <el-table :data="blacklist" stripe>
        <el-table-column prop="word" label="词" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button size="small" type="danger" @click="onRemoveBlacklist(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑词条' : '新增词条'" width="520px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="关键词"><el-input v-model="form.keyword" /></el-form-item>
        <el-form-item label="话题"><el-input v-model="form.topic" placeholder="发到 B 站的 #话题#" /></el-form-item>
        <el-form-item label="别名">
          <el-input v-model="form.aliasesText" type="textarea" :rows="2" placeholder="逗号分隔，如 Starship, starship" />
        </el-form-item>
        <el-form-item label="优先级"><el-input-number v-model="form.priority" :min="0" :max="999" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
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

const tab = ref('active')
const list = ref([])
const blacklist = ref([])
const loading = ref(false)
const seeding = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const editing = ref(null)
const blacklistWord = ref('')
const form = reactive({
  keyword: '',
  topic: '',
  aliasesText: '',
  priority: 80,
  enabled: true
})

const load = async () => {
  if (tab.value === 'blacklist') {
    const res = await api.listBilibiliTopicBlacklist()
    blacklist.value = res?.list || []
    return
  }
  loading.value = true
  try {
    const res = await api.listBilibiliTopics({ status: tab.value, page: 1, pageSize: 100 })
    list.value = res?.list || []
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const onTabChange = () => load()

const openCreate = () => {
  editing.value = null
  Object.assign(form, { keyword: '', topic: '', aliasesText: '', priority: 80, enabled: true })
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, {
    keyword: row.keyword || '',
    topic: row.topic || '',
    aliasesText: (row.aliases || []).join(', '),
    priority: Number(row.priority || 80),
    enabled: row.enabled !== false
  })
  dialogVisible.value = true
}

const onSubmit = async () => {
  saving.value = true
  try {
    const aliases = form.aliasesText.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    const body = {
      keyword: form.keyword,
      topic: form.topic || form.keyword,
      aliases,
      priority: form.priority,
      enabled: form.enabled,
      status: form.enabled ? 'active' : 'disabled',
      source: 'manual'
    }
    if (editing.value) await api.updateBilibiliTopic(editing.value._id, body)
    else await api.createBilibiliTopic(body)
    ElMessage.success('已保存')
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
    await ElMessageBox.confirm('确认删除该词条？', '删除', { type: 'warning' })
    await api.deleteBilibiliTopic(row._id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

const onPromote = async (row) => {
  try {
    await api.promoteBilibiliTopic(row._id)
    ElMessage.success('已采纳')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  }
}

const onReject = async (row) => {
  try {
    await api.rejectBilibiliTopic(row._id)
    ElMessage.success('已拒绝')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  }
}

const onSeed = async () => {
  seeding.value = true
  try {
    const res = await api.seedBilibiliTopics()
    ElMessage.success(`导入 ${res?.imported || 0} 条`)
    tab.value = 'active'
    await load()
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    seeding.value = false
  }
}

const onAddBlacklist = async () => {
  try {
    await api.addBilibiliTopicBlacklist({ word: blacklistWord.value })
    blacklistWord.value = ''
    ElMessage.success('已添加')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '添加失败')
  }
}

const onRemoveBlacklist = async (row) => {
  try {
    await api.removeBilibiliTopicBlacklist(row._id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

onMounted(load)
</script>
