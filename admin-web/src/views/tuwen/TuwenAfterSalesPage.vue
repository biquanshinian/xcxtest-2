<template>
  <div class="tw-page">
    <div class="tw-hero">
      <div>
        <div class="tw-hero__kicker">共 {{ filtered.length }} 单</div>
        <div class="tw-hero__title">售后</div>
      </div>
      <el-button type="primary" size="small" @click="openEdit()">新建售后</el-button>
    </div>
    <div class="tw-filters">
      <el-input v-model="keyword" size="small" clearable placeholder="即时搜索单号 / 客户 / 问题" class="tw-search" />
    </div>
    <div v-if="loading && !all.length" class="tw-empty">正在读取售后…</div>
    <div v-else-if="!all.length" class="tw-empty">还没有售后工单。</div>
    <div v-else-if="!filtered.length" class="tw-empty">没有符合搜索的售后</div>
    <div v-else class="tw-cards">
      <div v-for="row in filtered" :key="row.id" class="tw-card tw-row">
        <div>
          <div class="tw-card__name">{{ row.ticketNo }} · {{ row.customerName }}</div>
          <div class="tw-muted">{{ AFTER_SALE_STATUSES[row.status] || row.status }} · {{ row.issueType }} · {{ row.orderNo || '未关联订单' }}</div>
        </div>
        <div>
          <el-button size="small" text @click="onPrint(row)">打印</el-button>
          <el-button size="small" text @click="openEdit(row)">编辑</el-button>
          <el-button size="small" text type="danger" @click="onDelete(row)">删除</el-button>
        </div>
      </div>
    </div>

    <el-dialog v-model="visible" :title="form.id ? '编辑售后' : '新建售后'" width="640px" class="tw-as-dialog tw-mobile-dialog">
      <el-form label-position="top">
        <div class="tw-grid">
          <el-form-item label="客户" required><el-input v-model="form.customerName" /></el-form-item>
          <el-form-item label="电话"><el-input v-model="form.phone" /></el-form-item>
          <el-form-item label="关联订单">
            <el-select v-model="form.orderNo" filterable allow-create clearable placeholder="搜索或手填单号" style="width:100%" @change="onRelatedOrder">
              <el-option v-for="o in orders" :key="o.id" :label="`${o.orderNo} · ${o.customerName || '未填客户'}`" :value="o.orderNo" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="form.status" style="width:100%">
              <el-option v-for="(label, key) in AFTER_SALE_STATUSES" :key="key" :label="label" :value="key" />
            </el-select>
          </el-form-item>
          <el-form-item label="问题类型" required>
            <el-select v-model="form.issueType" allow-create filterable style="width:100%">
              <el-option v-for="t in AFTER_SALE_ISSUE_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="跟进人"><el-input v-model="form.assignee" /></el-form-item>
        </div>
        <el-form-item label="问题摘要"><el-input v-model="form.summary" /></el-form-item>
        <el-form-item label="详情"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="处理结果"><el-input v-model="form.result" /></el-form-item>
        <div class="tw-panel__title">保修单印刷字段</div>
        <div class="tw-grid">
          <el-form-item label="公司名称"><el-input v-model="form.companyName" /></el-form-item>
          <el-form-item label="法人"><el-input v-model="form.legalName" /></el-form-item>
          <el-form-item label="工程地址"><el-input v-model="form.projectAddress" /></el-form-item>
          <el-form-item label="设计负责人"><el-input v-model="form.designLead" /></el-form-item>
          <el-form-item label="施工负责人"><el-input v-model="form.constructLead" /></el-form-item>
          <el-form-item label="监督电话"><el-input v-model="form.supervisePhone" /></el-form-item>
          <el-form-item label="开工日期"><TwDatePicker v-model="form.startDate" /></el-form-item>
          <el-form-item label="竣工日期"><TwDatePicker v-model="form.endDate" /></el-form-item>
          <el-form-item label="保修起"><TwDatePicker v-model="form.warrantyFrom" /></el-form-item>
          <el-form-item label="保修止"><TwDatePicker v-model="form.warrantyTo" /></el-form-item>
        </div>
        <el-form-item label="印刷备注"><el-input v-model="form.printNote" type="textarea" :rows="2" /></el-form-item>
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
import { AFTER_SALE_ISSUE_TYPES, AFTER_SALE_STATUSES, matchesKeyword } from '../../utils/tuwen-yewu.js'
import { printAfterSaleSheet } from '../../utils/tuwen-print.js'
import TwDatePicker from './TwDatePicker.vue'

const loading = ref(false)
const saving = ref(false)
const visible = ref(false)
const keyword = ref('')
const all = ref([])
const filtered = computed(() => all.value.filter((row) => matchesKeyword(row, keyword.value, ['ticketNo', 'customerName', 'phone', 'orderNo', 'issueType', 'summary', 'assignee'])))
const orders = ref([])
const settings = ref({})
const form = reactive(emptyForm())

function emptyForm() {
  return {
    customerName: '', phone: '', orderNo: '', status: 'pending', issueType: '',
    assignee: '', summary: '', description: '', result: '',
    companyName: '', legalName: '', projectAddress: '', designLead: '', constructLead: '',
    supervisePhone: '', startDate: '', endDate: '', warrantyFrom: '', warrantyTo: '', printNote: ''
  }
}

function openEdit(row) {
  Object.assign(form, emptyForm(), row || {})
  visible.value = true
}

function onRelatedOrder(orderNo) {
  form.orderNo = orderNo
  const hit = orders.value.find((o) => o.orderNo === orderNo)
  if (!hit) return
  form.customerName = hit.customerName || form.customerName
  form.phone = hit.phone || form.phone
}

async function load() {
  loading.value = true
  try {
    const [data, orderData] = await Promise.all([
      api.listTuwenAfterSales(),
      api.listTuwenOrders({ pageSize: 200 })
    ])
    all.value = (data && data.list) || []
    orders.value = (orderData && orderData.list) || []
  } catch (e) {
    ElMessage.error((e && e.message) || '读取售后失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!form.customerName) return ElMessage.warning('请填写客户名称')
  if (!form.issueType) return ElMessage.warning('请选择或填写问题类型')
  saving.value = true
  try {
    await api.saveTuwenAfterSale({ ...form })
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
    await ElMessageBox.confirm(`删除售后 ${row.ticketNo}？`, '删除售后', { type: 'warning' })
    await api.deleteTuwenAfterSale(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e && e.message) || '删除失败')
  }
}

function onPrint(row) {
  printAfterSaleSheet(row, settings.value)
}

onMounted(async () => {
  try {
    const res = await api.getTuwenSettings()
    settings.value = (res && res.settings) || {}
  } catch { /* ignore */ }
  await load()
})
</script>

<style scoped>
.tw-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
.tw-card__name { font-weight: 600; margin-bottom: 4px; }
.tw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.tw-panel__title { font-size: 13px; font-weight: 600; margin: 8px 0; }
@media (max-width: 640px) { .tw-grid { grid-template-columns: 1fr; } }
</style>
