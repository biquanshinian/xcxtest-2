<template>
  <div class="tw-page">
    <div class="tw-hero">
      <div>
        <div class="tw-hero__kicker">共 {{ filtered.length }} 家</div>
        <div class="tw-hero__title">供应商</div>
      </div>
      <el-button type="primary" size="small" @click="openEdit()">新建供应商</el-button>
    </div>
    <div class="tw-filters">
      <el-input v-model="keyword" size="small" clearable placeholder="即时搜索名称 / 联系人 / 电话" class="tw-search" />
    </div>
    <div v-if="loading && !all.length" class="tw-empty">正在读取供应商…</div>
    <div v-else-if="!all.length" class="tw-empty">还没有供应商。</div>
    <div v-else-if="!filtered.length" class="tw-empty">没有符合搜索的供应商</div>
    <div v-else class="tw-cards">
      <div v-for="row in filtered" :key="row.id" class="tw-card tw-row">
        <div>
          <div class="tw-card__name">{{ row.name }}</div>
          <div class="tw-muted">{{ row.contact || '—' }} · {{ row.phone || '无电话' }}</div>
        </div>
        <div>
          <el-button size="small" text @click="openEdit(row)">编辑</el-button>
          <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
        </div>
      </div>
    </div>

    <el-dialog v-model="visible" :title="form.id ? '编辑供应商' : '新建供应商'" width="480px" class="tw-mobile-dialog">
      <el-form label-position="top">
        <el-form-item label="名称" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="联系人"><el-input v-model="form.contact" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="form.phone" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="form.address" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'
import { matchesKeyword } from '../../utils/tuwen-yewu.js'

const loading = ref(false)
const saving = ref(false)
const visible = ref(false)
const keyword = ref('')
const all = ref([])
const filtered = computed(() => all.value.filter((row) => matchesKeyword(row, keyword.value, ['name', 'contact', 'phone', 'address', 'note'])))
const form = reactive(emptyForm())

function emptyForm() {
  return { name: '', contact: '', phone: '', address: '', note: '' }
}

function openEdit(row) {
  Object.assign(form, emptyForm(), row || {})
  visible.value = true
}

async function load() {
  loading.value = true
  try {
    const data = await api.listTuwenSuppliers()
    all.value = (data && data.list) || []
  } catch (e) {
    ElMessage.error((e && e.message) || '读取供应商失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!String(form.name || '').trim()) return ElMessage.warning('请填写供应商名称')
  saving.value = true
  try {
    await api.saveTuwenSupplier({ ...form })
    visible.value = false
    ElMessage.success('已保存')
    await load()
  } catch (e) {
    ElMessage.error((e && e.message) || '保存失败')
  } finally {
    saving.value = false
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`删除供应商 ${row.name}？`, '删除供应商', { type: 'warning' })
    await api.deleteTuwenSupplier(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e && e.message) || '删除失败')
  }
}

onMounted(load)
</script>

<style scoped>
.tw-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
.tw-card__name { font-weight: 600; margin-bottom: 4px; }
</style>
