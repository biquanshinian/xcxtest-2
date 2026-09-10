<template>
  <div class="tw-page" v-loading="loading">
    <div class="tw-hero">
      <div>
        <div class="tw-hero__kicker">欠款 <TwCountUp :value="totals.unpaid" money /></div>
        <div class="tw-hero__title">对账单</div>
      </div>
      <div class="tw-hero__actions">
        <el-button size="small" @click="onPreview">打印预览</el-button>
      </div>
    </div>

    <div class="tw-filters">
      <el-autocomplete
        v-model="keyword"
        :fetch-suggestions="suggestCustomers"
        clearable
        highlight-first-item
        size="small"
        placeholder="即时搜索客户 / 单号 / 电话"
        class="tw-search"
      />
      <TwDatePicker v-model="from" size="small" class="tw-date" placeholder="开始日期" @change="load" />
      <TwDatePicker v-model="to" size="small" class="tw-date" placeholder="结束日期" @change="load" />
      <label class="tw-inline"><input v-model="unpaidOnly" type="checkbox" /> 只看欠款</label>
    </div>
    <div class="tw-muted tw-stmt-hint">输入即筛，不必按确定。打印预览按当前表格结果出单，可一键对应该客户全部欠款。</div>

    <div class="tw-kpis">
      <div class="tw-kpi"><div class="tw-kpi__label">明细合计</div><div class="tw-kpi__value"><TwCountUp :value="totals.subtotal" money /></div></div>
      <div class="tw-kpi"><div class="tw-kpi__label">优惠</div><div class="tw-kpi__value"><TwCountUp :value="totals.discount" money /></div></div>
      <div class="tw-kpi"><div class="tw-kpi__label">已收</div><div class="tw-kpi__value is-ok"><TwCountUp :value="totals.paid" money /></div></div>
      <div class="tw-kpi"><div class="tw-kpi__label">欠款</div><div class="tw-kpi__value is-due"><TwCountUp :value="totals.unpaid" money /></div></div>
    </div>

    <div class="tw-panel">
      <div class="tw-panel__title">收款摊分（从早到晚冲当前结果未结订单）{{ uniqueCustomer ? ` · ${uniqueCustomer}` : '' }}</div>
      <div class="tw-filters">
        <el-input v-model.number="collectAmount" type="number" size="small" placeholder="本次收款金额" style="max-width:180px" />
        <el-select v-model="collectMethod" size="small" style="width:120px">
          <el-option v-for="m in PAYMENT_METHODS" :key="m" :label="m" :value="m" />
        </el-select>
        <el-button size="small" type="primary" :loading="collecting" @click="onCollect">登记收款</el-button>
      </div>
    </div>

    <div class="tw-table-wrap tw-panel">
      <table class="tw-table">
        <thead>
          <tr>
            <th>日期</th><th>单号</th><th>客户</th><th>项目</th><th>笔数</th>
            <th>合计</th><th>优惠</th><th>已收</th><th>欠款</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredOrders" :key="row.id">
            <td>{{ row.orderDate }}</td>
            <td><button type="button" class="tw-link" @click="goOrder(row)">{{ row.orderNo }}</button></td>
            <td>{{ row.customerName }}</td>
            <td>{{ row.projectNames || '—' }}</td>
            <td>{{ row.lineCount || 0 }}</td>
            <td>{{ formatMoney(row.subtotal || row.receivable) }}</td>
            <td>{{ formatMoney(row.discount) }}</td>
            <td>{{ formatMoney(row.paid) }}</td>
            <td :class="{ 'is-due': Number(row.balance) > 0 }">{{ formatMoney(row.balance) }}</td>
            <td>{{ row.statusLabel }}</td>
          </tr>
          <tr v-if="!filteredOrders.length"><td colspan="10" class="tw-muted">没有符合筛选的订单</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="previewOpen" class="tw-preview" @click.self="previewOpen = false">
      <div class="tw-preview__bar">
        <div>对账单预览 · {{ printCustomer }} · {{ filteredOrders.length }} 单</div>
        <div class="tw-preview__ops">
          <el-button size="small" type="primary" @click="onPrint">打印</el-button>
          <el-button size="small" :loading="exporting === 'jpg'" @click="onExportJpg">导出图片</el-button>
          <el-button size="small" :loading="exporting === 'xls'" @click="onExportXls">导出表格</el-button>
          <el-button size="small" @click="previewOpen = false">关闭</el-button>
        </div>
      </div>
      <div class="tw-preview__body">
        <div class="tw-preview__stage">
          <div class="tw-preview__sheet" ref="previewSheetEl" v-html="previewHtml"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../../api/client'
import {
  PAYMENT_METHODS,
  filterStatementOrders,
  formatMoney,
  ordersFromStatementPayload,
  statementLinesForOrders,
  statementPrintCustomer,
  statementTotals,
  uniqueStatementParty
} from '../../utils/tuwen-yewu.js'
import { exportStatementExcel, exportStatementJpg, printStatementSheet, statementSheetHtml } from '../../utils/tuwen-print.js'
import TwDatePicker from './TwDatePicker.vue'
import TwCountUp from './TwCountUp.vue'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const collecting = ref(false)
const previewOpen = ref(false)
const previewSheetEl = ref(null)
const exporting = ref('')
const keyword = ref(String(route.query.customer || ''))
const from = ref('')
const to = ref('')
const unpaidOnly = ref(false)
const collectAmount = ref(0)
const collectMethod = ref('微信')
const settings = ref({})
const data = reactive({ orders: [], lines: [], customers: [], subtotal: 0, discount: 0, paid: 0, unpaid: 0 })

const filteredOrders = computed(() => filterStatementOrders(data.orders, {
  q: keyword.value,
  unpaidOnly: unpaidOnly.value
}))
const totals = computed(() => statementTotals(filteredOrders.value))
const party = computed(() => uniqueStatementParty(filteredOrders.value))
const uniqueCustomer = computed(() => (party.value && party.value.customerName) || '')
const collectOrderIds = computed(() => filteredOrders.value
  .filter((o) => Number(o.balance) > 0)
  .map((o) => o.id)
  .filter(Boolean))
const printCustomer = computed(() => statementPrintCustomer(filteredOrders.value, keyword.value))
const printPayload = computed(() => ({
  lines: statementLinesForOrders(data.lines, filteredOrders.value),
  ...totals.value,
  customerName: printCustomer.value,
  from: from.value,
  to: to.value
}))
const previewHtml = computed(() => statementSheetHtml(printPayload.value, settings.value))

function suggestCustomers(q, cb) {
  const k = String(q || '').trim().toLowerCase()
  const names = data.customers || []
  const list = (!k ? names : names.filter((n) => String(n).toLowerCase().includes(k))).slice(0, 30)
  cb(list.map((value) => ({ value })))
}

async function load() {
  loading.value = true
  try {
    const res = await api.getTuwenStatements({ from: from.value, to: to.value })
    Object.assign(data, {
      orders: ordersFromStatementPayload(res),
      lines: res && Array.isArray(res.lines) ? res.lines : [],
      customers: res && Array.isArray(res.customers) ? res.customers : [],
      subtotal: res ? res.subtotal : 0,
      discount: res ? res.discount : 0,
      paid: res ? res.paid : 0,
      unpaid: res ? res.unpaid : 0
    })
  } catch (e) {
    ElMessage.error((e && e.message) || '读取对账单失败')
  } finally {
    loading.value = false
  }
}

async function onCollect() {
  if (!party.value) return ElMessage.warning('请先搜到单一客户再登记收款')
  if (!collectOrderIds.value.length) return ElMessage.warning('当前结果没有可收款的欠款')
  if (!(Number(collectAmount.value) > 0)) return ElMessage.warning('请填写本次收款金额')
  collecting.value = true
  try {
    const res = await api.collectTuwenStatement({
      customer: party.value.customerName,
      customerId: party.value.customerId,
      orderIds: collectOrderIds.value,
      amount: Number(collectAmount.value),
      paymentMethod: collectMethod.value,
      from: from.value,
      to: to.value
    })
    ElMessage.success(`已摊分 ${formatMoney(res.applied)}${res.leftover > 0 ? `，剩余 ${formatMoney(res.leftover)}` : ''}`)
    collectAmount.value = 0
    await load()
  } catch (e) {
    ElMessage.error((e && e.message) || '收款失败')
  } finally {
    collecting.value = false
  }
}

function onPreview() {
  if (!filteredOrders.value.length) return ElMessage.warning('当前没有可打印的订单')
  previewOpen.value = true
}

function onPrint() {
  if (!filteredOrders.value.length) return ElMessage.warning('当前没有可打印的订单')
  printStatementSheet(printPayload.value, settings.value)
}

async function onExportJpg() {
  if (!filteredOrders.value.length) return ElMessage.warning('当前没有可导出的订单')
  exporting.value = 'jpg'
  try {
    const sheet = previewSheetEl.value && (previewSheetEl.value.querySelector('.print-statement') || previewSheetEl.value.firstElementChild)
    await exportStatementJpg(printPayload.value, settings.value, sheet || undefined)
    ElMessage.success('已导出图片')
  } catch (e) {
    ElMessage.error((e && e.message) || '导出图片失败')
  } finally {
    exporting.value = ''
  }
}

async function onExportXls() {
  if (!filteredOrders.value.length) return ElMessage.warning('当前没有可导出的订单')
  exporting.value = 'xls'
  try {
    const res = await exportStatementExcel(printPayload.value, settings.value)
    ElMessage.success(res && res.imageCount ? `已导出表格，含 ${res.imageCount} 张样图` : '已导出表格')
  } catch (e) {
    ElMessage.error((e && e.message) || '导出表格失败')
  } finally {
    exporting.value = ''
  }
}

function goOrder(row) {
  if (row && row.id) router.push(`/tuwen/orders/${row.id}`)
}

onMounted(async () => {
  try {
    const res = await api.getTuwenSettings()
    settings.value = (res && res.settings) || {}
  } catch { /* ignore */ }
  await load()
})
watch(() => route.query.customer, (v) => {
  if (v != null) keyword.value = String(v)
})
</script>

<style scoped>
.tw-date { width: 140px; }
.tw-stmt-hint { margin: -4px 0 10px; font-size: 12px; }
.tw-link {
  border: 0;
  padding: 0;
  background: none;
  color: #8eb6ff;
  cursor: pointer;
  font: inherit;
}
.tw-link:hover { text-decoration: underline; }
</style>
