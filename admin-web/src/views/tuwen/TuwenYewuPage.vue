<template>
  <div class="tw-page tw-orders">
    <div class="tw-hero tw-hero--compact">
      <div>
        <div class="tw-hero__title">订单</div>
      </div>
      <div class="tw-hero__actions">
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" size="small" @click="goNew">新建订单</el-button>
      </div>
    </div>

    <div class="tw-panel tw-filter-card">
      <div class="tw-filters">
        <el-input v-model="keyword" size="small" clearable placeholder="即时搜索单号 / 客户 / 电话 / 项目" class="tw-search" @clear="onSearch" />
        <label class="tw-inline">开单从 <TwDatePicker v-model="from" size="small" class="tw-date" placeholder="开始日期" @change="onSearch" /></label>
        <label class="tw-inline">到 <TwDatePicker v-model="to" size="small" class="tw-date" placeholder="结束日期" @change="onSearch" /></label>
        <label class="tw-inline"><input v-model="expandAll" type="checkbox" @change="onExpandAll" /> 全部展开明细</label>
      </div>
      <div class="tw-chips">
        <span class="tw-muted">状态</span>
        <button
          v-for="chip in statusChips"
          :key="chip.value"
          type="button"
          class="tw-chip"
          :class="{ 'is-on': status === chip.value }"
          @click="setStatus(chip.value)"
        >{{ chip.label }}</button>
      </div>
    </div>

    <div v-if="selectedIds.length" class="tw-batch">
      <span>已选 {{ selectedIds.length }}（已收款单不可改状态）</span>
      <el-select v-model="batchStatus" size="small" class="tw-status">
        <el-option v-for="(label, key) in ORDER_STATUSES" :key="key" :label="label" :value="key" />
      </el-select>
      <el-button size="small" type="primary" :loading="batching" @click="applyBatch">批量改状态</el-button>
      <el-button size="small" text @click="selectedIds = []">取消</el-button>
    </div>

    <div v-if="loading && !list.length" class="tw-empty">正在读取云端订单…</div>
    <div v-else-if="!list.length" class="tw-empty">还没有订单。点右上角新建，或到设置里导入备份。</div>

    <div v-else class="tw-list-card">
      <div class="orders-list-head-desktop">
        <label class="is-center"><input type="checkbox" :checked="allSelectableChecked" :disabled="!selectableIds.length" @change="togglePage($event.target.checked)" /></label>
        <span></span>
        <span></span>
        <span>订单号</span>
        <span>客户</span>
        <span>状态</span>
        <span class="is-right">应收</span>
        <span class="is-right">未结</span>
        <span>更新</span>
        <span>操作</span>
      </div>
      <draggable :list="list" item-key="id" handle=".tw-order-drag" :animation="150" @end="persistSort">
        <template #item="{ element: row }">
          <div class="tw-order-item">
            <div class="orders-list-row-desktop">
              <label class="is-center" :title="row.paidLocked ? '已收款订单不可批量改状态' : '选择本行'">
                <input v-model="selectedIds" type="checkbox" :value="row.id" :disabled="!!row.paidLocked" />
              </label>
              <button type="button" class="tw-order-drag" title="拖动排序">⋮⋮</button>
              <button type="button" class="tw-ghost" @click="toggleExpand(row.id)">{{ expanded[row.id] ? '▾' : '▸' }}</button>
              <button type="button" class="tw-link" @click="goEdit(row.id)">{{ row.orderNo }}</button>
              <span class="tw-ellipsis">{{ row.customerName || '未填客户' }}</span>
              <el-tag size="small" :type="rowTagType(row)">{{ row.statusLabel }}</el-tag>
              <span class="is-right">{{ formatMoney(row.receivable) }}</span>
              <span class="is-right" :class="row.balance > 0 ? 'is-due' : 'is-ok'">{{ row.balance > 0 ? formatMoney(row.balance) : '已结' }}</span>
              <span class="tw-muted">{{ formatTime(row.updatedAt) }}</span>
              <div class="tw-ops">
                <button type="button" class="tw-mini-btn is-pay" :disabled="!canPay(row)" :title="payTitle(row)" @click="openPay(row)">收款</button>
                <button type="button" class="tw-mini-btn" title="复制为新订单：保留客户与明细，新单号" @click="onCopy(row.id)">复制订单</button>
                <button type="button" class="tw-mini-btn" @click="goStatement(row)">对账单</button>
                <button type="button" class="tw-mini-btn" @click="goEdit(row.id)">编辑</button>
                <button type="button" class="tw-mini-btn is-danger" @click="onDelete(row)">删除</button>
              </div>
            </div>
            <div class="orders-list-row-mobile">
              <div class="tw-m-top">
                <button type="button" class="tw-order-drag" title="拖动排序">⋮⋮</button>
                <label :title="row.paidLocked ? '已收款订单不可批量改状态' : '选择本行'">
                  <input v-model="selectedIds" type="checkbox" :value="row.id" :disabled="!!row.paidLocked" />
                </label>
                <button type="button" class="tw-ghost" @click="toggleExpand(row.id)">{{ expanded[row.id] ? '收起' : '展开' }}</button>
                <button type="button" class="tw-link" @click="goEdit(row.id)">{{ row.orderNo }}</button>
                <el-tag size="small" :type="rowTagType(row)">{{ row.statusLabel }}</el-tag>
              </div>
              <div class="tw-m-name">{{ row.customerName || '未填客户' }}</div>
              <div class="tw-m-money">
                <span>应收 {{ formatMoney(row.receivable) }}</span>
                <span :class="row.balance > 0 ? 'is-due' : 'is-ok'">{{ row.balance > 0 ? `未结 ${formatMoney(row.balance)}` : '已收款' }}</span>
              </div>
              <div class="tw-ops">
                <button type="button" class="tw-mini-btn is-pay" :disabled="!canPay(row)" :title="payTitle(row)" @click="openPay(row)">收款</button>
                <button type="button" class="tw-mini-btn" @click="onCopy(row.id)">复制订单</button>
                <button type="button" class="tw-mini-btn" @click="goStatement(row)">对账单</button>
                <button type="button" class="tw-mini-btn" @click="goEdit(row.id)">编辑</button>
                <button type="button" class="tw-mini-btn is-danger" @click="onDelete(row)">删除</button>
              </div>
            </div>
            <div v-if="expanded[row.id]" class="tw-expand">
              <table v-if="(row.lines || []).length" class="tw-mini-table">
                <thead>
                  <tr>
                    <th v-for="col in expandCols" :key="col.key" :class="expandTdClass(col)">{{ col.label }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(line, i) in row.lines" :key="line.id || i">
                    <td v-for="col in expandCols" :key="col.key" :class="expandTdClass(col)">
                      <img v-if="col.key === 'sample' && line.sampleImageUrl" :src="line.sampleImageUrl" alt="" />
                      <template v-else>{{ expandCell(line, col, i) }}</template>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="tw-muted">无明细</div>
            </div>
          </div>
        </template>
      </draggable>
    </div>

    <el-pagination
      v-if="total > query.pageSize"
      v-model:current-page="query.page"
      :page-size="query.pageSize"
      :total="total"
      layout="prev, pager, next"
      class="tw-pager"
      @current-change="load"
    />

    <el-dialog v-model="payOpen" title="收款" width="420px" append-to-body class="tw-mobile-dialog">
      <p class="tw-muted">订单号：{{ payTarget.orderNo }}　客户：{{ payTarget.customerName }}　未结 {{ formatMoney(payTarget.balance) }}</p>
      <el-form label-position="top">
        <el-form-item label="本次收款金额（元）">
          <el-input v-model="payForm.amount" type="number" />
        </el-form-item>
        <el-form-item label="付款方式">
          <el-select v-model="payForm.method" style="width:100%" clearable placeholder="请选择">
            <el-option v-for="m in RECEIVE_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="payForm.remark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="附图（可粘贴）">
          <TwSampleCell v-model="payForm.image" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="payOpen = false">取消</el-button>
        <el-button type="primary" :loading="paying" :disabled="!payTarget.id" @click="confirmPay">确认收款</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import draggable from 'vuedraggable'
import { api } from '../../api/client'
import TwDatePicker from './TwDatePicker.vue'
import TwSampleCell from './TwSampleCell.vue'
import {
  ORDER_STATUSES,
  PAID_FILTER,
  RECEIVE_METHODS,
  columnAlignClass,
  debounce,
  formatMoney,
  formatQty,
  isCancelled,
  lineAreaM2,
  mmToDimension,
  statusTagType,
  visibleLineColumnsOf
} from '../../utils/tuwen-yewu.js'

const router = useRouter()
const loading = ref(false)
const batching = ref(false)
const list = ref([])
const total = ref(0)
const keyword = ref('')
const status = ref('all')
const from = ref('')
const to = ref('')
const selectedIds = ref([])
const batchStatus = ref('producing')
const expanded = reactive({})
const expandAll = ref(false)
const query = reactive({ page: 1, pageSize: 200 })
const settings = ref({})
const payOpen = ref(false)
const paying = ref(false)
const payTarget = reactive({ id: '', orderNo: '', customerName: '', balance: 0 })
const payForm = reactive({ amount: '', method: '微信', remark: '', image: '' })
let loadSeq = 0
const searchNow = () => {
  query.page = 1
  load()
}
const searchLater = debounce(searchNow, 220)

const statusChips = [
  { value: 'all', label: '全部' },
  ...Object.keys(ORDER_STATUSES).map((value) => ({ value, label: ORDER_STATUSES[value] })),
  { value: PAID_FILTER, label: '已收款' }
]

const expandCols = computed(() => visibleLineColumnsOf(settings.value).filter((c) => c.key !== 'actions'))
const selectableIds = computed(() => list.value.filter((r) => !r.paidLocked).map((r) => r.id))
const allSelectableChecked = computed(() => selectableIds.value.length > 0 && selectableIds.value.every((id) => selectedIds.value.includes(id)))

function formatTime(raw) {
  const s = String(raw || '')
  if (!s) return ''
  return s.replace('T', ' ').slice(0, 16)
}

function rowTagType(row) {
  if (row.displayStatus === 'paid' || row.statusLabel === '已收款') return 'success'
  return statusTagType(row.status)
}

function expandTdClass(col) {
  return columnAlignClass(col && col.align)
}

function expandCell(line, col, i) {
  const key = col && typeof col === 'object' ? col.key : col
  if (key === 'seq') return i + 1
  if (key === 'outsource') return line.outsource ? '是' : ''
  if (key === 'code') return line.code || ''
  if (key === 'projectName') return line.projectName || ''
  if (key === 'productName') return line.productName || ''
  if (key === 'spec') return line.spec || ''
  if (key === 'material') return line.material || ''
  if (key === 'widthMm') {
    const v = mmToDimension(line.widthMm, settings.value)
    return v ? formatQty(v, settings.value.dimensionDecimals || 2) : ''
  }
  if (key === 'heightMm') {
    const v = mmToDimension(line.heightMm, settings.value)
    return v ? formatQty(v, settings.value.dimensionDecimals || 2) : ''
  }
  if (key === 'area') {
    const v = lineAreaM2(line)
    return v ? formatQty(v, settings.value.areaDecimals || 3) : ''
  }
  if (key === 'qty') return line.qty
  if (key === 'unit') return line.unitLabel || ''
  if (key === 'unitPrice') return formatMoney(line.unitPrice)
  if (key === 'amount') return formatMoney(line.amount)
  if (key === 'sample') return ''
  if (key === 'remark') return line.remark || ''
  return ''
}

function applyList(data) {
  list.value = (data && data.list) || []
  total.value = (data && data.total) || 0
  if (data && data.settings) settings.value = data.settings
  const keep = new Set(list.value.filter((r) => !r.paidLocked).map((r) => r.id))
  selectedIds.value = selectedIds.value.filter((id) => keep.has(id))
  if (expandAll.value) {
    list.value.forEach((row) => { expanded[row.id] = true })
  }
}

async function load() {
  const seq = ++loadSeq
  const q = {
    q: keyword.value.trim(),
    status: status.value === 'all' ? '' : status.value,
    from: from.value,
    to: to.value,
    page: query.page,
    pageSize: query.pageSize
  }
  const cached = api.peekTuwenOrders(q)
  if (cached) {
    applyList(cached)
    loading.value = false
  } else {
    loading.value = true
  }
  try {
    const data = await api.listTuwenOrders(q)
    if (seq !== loadSeq) return
    if (data && data.unchanged) return
    applyList(data)
  } catch (e) {
    if (seq !== loadSeq) return
    if (cached) return
    ElMessage.error((e && e.message) || '读取订单失败')
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function loadSettings() {
  try {
    const data = await api.getTuwenSettings()
    settings.value = (data && data.settings) || {}
  } catch {
    settings.value = {}
  }
}

function onSearch() {
  searchLater.cancel()
  searchNow()
}

function setStatus(value) {
  status.value = value
  onSearch()
}

function goNew() {
  router.push('/tuwen/orders/new')
}

function goEdit(id) {
  router.push(`/tuwen/orders/${encodeURIComponent(id)}`)
}

function goStatement(row) {
  router.push({ path: '/tuwen/statements', query: { customer: row.customerName || '' } })
}

function canPay(row) {
  return !!row && !row.paidLocked && !isCancelled(row)
}

function payTitle(row) {
  if (!row) return ''
  if (isCancelled(row)) return '已取消订单不能收款'
  if (row.paidLocked) return '本单已收款，无需再次收款'
  if (!(Number(row.balance) > 0)) return '预付款已结清，点此确认收款并锁单'
  return `登记收款，未结 ${formatMoney(row.balance)}`
}

function openPay(row) {
  if (!canPay(row)) return
  payTarget.id = row.id
  payTarget.orderNo = row.orderNo || ''
  payTarget.customerName = row.customerName || ''
  payTarget.balance = Number(row.balance) || 0
  payForm.amount = String(payTarget.balance || '')
  payForm.method = '微信'
  payForm.remark = ''
  payForm.image = ''
  payOpen.value = true
}

async function confirmPay() {
  const amount = Number(payForm.amount)
  if (payTarget.balance > 0 && !(amount > 0)) {
    ElMessage.warning('请填写大于 0 的金额')
    return
  }
  paying.value = true
  try {
    await api.payTuwenOrder(payTarget.id, {
      amount,
      paymentMethod: payForm.method,
      remark: payForm.remark,
      images: payForm.image ? [payForm.image] : []
    })
    payOpen.value = false
    ElMessage.success('已登记收款')
    await load()
  } catch (e) {
    ElMessage.error((e && e.message) || '收款失败')
  } finally {
    paying.value = false
  }
}

function toggleExpand(id) {
  expanded[id] = !expanded[id]
}

function onExpandAll() {
  list.value.forEach((row) => { expanded[row.id] = expandAll.value })
}

function togglePage(on) {
  if (on) selectedIds.value = [...selectableIds.value]
  else selectedIds.value = []
}

async function persistSort() {
  try {
    await api.sortTuwenOrders(list.value.map((r) => r.id))
  } catch (e) {
    ElMessage.error((e && e.message) || '排序保存失败')
  }
}

async function applyBatch() {
  if (!selectedIds.value.length || !batchStatus.value) return
  batching.value = true
  try {
    const res = await api.batchTuwenOrderStatus(selectedIds.value, batchStatus.value)
    ElMessage.success(`已更新 ${res.changed || 0} 单`)
    selectedIds.value = []
    await load()
  } catch (e) {
    ElMessage.error((e && e.message) || '批量更新失败')
  } finally {
    batching.value = false
  }
}

async function onCopy(id) {
  try {
    const res = await api.copyTuwenOrder(id)
    ElMessage.success(`已复制为 ${res.order.orderNo}`)
    if (res.order && res.order.id) goEdit(res.order.id)
  } catch (e) {
    ElMessage.error((e && e.message) || '复制失败')
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除订单「${row.orderNo || ''}」？\n客户：${row.customerName || ''}\n删除后不可恢复。`, '删除订单', { type: 'warning' })
    await api.deleteTuwenOrder(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error((e && e.message) || '删除失败')
  }
}

watch(keyword, () => {
  query.page = 1
  searchLater()
})

onMounted(async () => {
  await load()
  if (!settings.value || !Object.keys(settings.value).length) await loadSettings()
})
onBeforeUnmount(() => searchLater.cancel())
</script>
