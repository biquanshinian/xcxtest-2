<template>
  <div class="tw-page">
    <div class="tw-hero">
      <div>
        <div class="tw-hero__kicker">共 {{ filtered.length }} 笔</div>
        <div class="tw-hero__title">支出</div>
      </div>
      <el-button type="primary" size="small" @click="openEdit()">登记支出</el-button>
    </div>
    <div class="tw-filters">
      <el-input v-model="keyword" size="small" clearable placeholder="即时搜索分类 / 备注" class="tw-search" />
      <TwDatePicker v-model="from" size="small" class="tw-date" placeholder="开始日期" @change="load" />
      <TwDatePicker v-model="to" size="small" class="tw-date" placeholder="结束日期" @change="load" />
    </div>
    <div v-if="loading && !all.length" class="tw-empty">正在读取支出…</div>
    <div v-else-if="!all.length" class="tw-empty">还没有支出记录。</div>
    <div v-else-if="!filtered.length" class="tw-empty">没有符合搜索的支出</div>
    <div v-else class="tw-cards">
      <div v-for="row in filtered" :key="row.id" class="tw-card tw-row">
        <div>
          <div class="tw-card__name">{{ row.category }} · {{ formatMoney(row.amount) }}</div>
          <div class="tw-muted">{{ row.expenseDate }} {{ row.note ? `· ${row.note}` : '' }}</div>
        </div>
        <div>
          <el-button size="small" text @click="openEdit(row)">编辑</el-button>
          <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
        </div>
      </div>
    </div>

    <el-dialog v-model="visible" :title="form.id ? '编辑支出' : '登记支出'" width="480px" class="tw-mobile-dialog">
      <el-form label-position="top">
        <el-form-item label="日期"><TwDatePicker v-model="form.expenseDate" /></el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" allow-create filterable style="width:100%">
            <el-option v-for="c in labels" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额（可为负冲正）"><el-input v-model.number="form.amount" type="number" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" /></el-form-item>
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
import { formatMoney, matchesKeyword, monthRange, todayDate } from '../../utils/tuwen-yewu.js'
import TwDatePicker from './TwDatePicker.vue'

const range = monthRange()
const loading = ref(false)
const saving = ref(false)
const visible = ref(false)
const from = ref(range.from)
const to = ref(range.to)
const keyword = ref('')
const all = ref([])
const filtered = computed(() => all.value.filter((row) => matchesKeyword(row, keyword.value, ['category', 'note', 'expenseDate', 'amount'])))
const labels = ref(['房租物业', '材料采购', '人工提成', '水电杂费'])
const form = reactive(emptyForm())

function emptyForm() {
  return { expenseDate: todayDate(), category: labels.value[0] || '材料采购', amount: 0, note: '' }
}

function openEdit(row) {
  Object.assign(form, emptyForm(), row || {})
  visible.value = true
}

async function load() {
  loading.value = true
  try {
    const data = await api.listTuwenExpenses({ from: from.value, to: to.value })
    all.value = (data && data.list) || []
    if (Array.isArray(data && data.labels) && data.labels.length) labels.value = data.labels
  } catch (e) {
    ElMessage.error((e && e.message) || '读取支出失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!form.category) return ElMessage.warning('请选择支出分类')
  if (!Number.isFinite(Number(form.amount)) || Number(form.amount) === 0) return ElMessage.warning('请填写有效金额')
  saving.value = true
  try {
    await api.saveTuwenExpense({ ...form })
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
    await ElMessageBox.confirm('删除这笔支出？', '删除支出', { type: 'warning' })
    await api.deleteTuwenExpense(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e && e.message) || '删除失败')
  }
}

onMounted(load)
</script>

<style scoped>
.tw-date { width: 140px; }
.tw-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
.tw-card__name { font-weight: 600; margin-bottom: 4px; }
</style>
