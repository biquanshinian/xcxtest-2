<template>
  <div class="tw-page" v-loading="loading">
    <div class="tw-hero">
      <div>
        <div class="tw-hero__kicker">云端工作区 · 今日新单 <TwCountUp :value="data.todayCount || 0" /></div>
        <div class="tw-hero__title-row">
          <div class="tw-hero__title">仪表盘</div>
          <button
            type="button"
            class="tw-eye-btn"
            :aria-pressed="moneyVisible"
            :title="moneyVisible ? '隐藏金额' : '显示金额'"
            :aria-label="moneyVisible ? '隐藏金额' : '显示金额'"
            @click="toggleMoney"
          >
            <el-icon><View v-if="moneyVisible" /><Hide v-else /></el-icon>
          </button>
        </div>
      </div>
      <el-button size="small" class="action-btn" @click="load">刷新</el-button>
    </div>

    <div class="tw-kpis tw-kpis--dash">
      <div class="tw-kpi">
        <div class="tw-kpi__label">记账总金额</div>
        <div class="tw-kpi__value" :class="{ 'is-masked': !moneyVisible }">
          <TwCountUp v-if="moneyVisible" :value="data.receivable" money />
          <span v-else class="tw-count">¥••••••</span>
        </div>
      </div>
      <div class="tw-kpi">
        <div class="tw-kpi__label">累计已收</div>
        <div class="tw-kpi__value is-ok" :class="{ 'is-masked': !moneyVisible }">
          <TwCountUp v-if="moneyVisible" :value="data.paid" money />
          <span v-else class="tw-count">¥••••••</span>
        </div>
      </div>
      <div class="tw-kpi">
        <div class="tw-kpi__label">未结欠款</div>
        <div class="tw-kpi__value is-due" :class="{ 'is-masked': !moneyVisible }">
          <TwCountUp v-if="moneyVisible" :value="data.unpaid" money />
          <span v-else class="tw-count">¥••••••</span>
        </div>
      </div>
      <div class="tw-kpi">
        <div class="tw-kpi__label">订单数</div>
        <div class="tw-kpi__value"><TwCountUp :value="data.orderCount || 0" /></div>
      </div>
      <div class="tw-kpi">
        <div class="tw-kpi__label">客户数</div>
        <div class="tw-kpi__value"><TwCountUp :value="data.customerCount || 0" /></div>
      </div>
    </div>

    <div class="tw-panel">
      <div class="tw-panel__title">状态分布</div>
      <div v-for="(label, key, i) in ORDER_STATUSES" :key="key" class="tw-bar-row">
        <span>{{ label }}</span>
        <div class="tw-bar"><div class="tw-bar__fill" :style="barVar(data.statusCounts && data.statusCounts[key], statusMax, i)"></div></div>
        <TwCountUp :value="(data.statusCounts && data.statusCounts[key]) || 0" />
      </div>
    </div>

    <div class="tw-panel">
      <div class="tw-panel__title">近 14 日营业额</div>
      <div v-if="!(data.trend || []).length" class="tw-muted">暂无数据</div>
      <div v-for="(row, i) in data.trend || []" :key="row.date" class="tw-bar-row">
        <span>{{ String(row.date).slice(5) }}</span>
        <div class="tw-bar"><div class="tw-bar__fill" :style="barVar(row.amount, trendMax, i)"></div></div>
        <TwCountUp v-if="moneyVisible" :value="row.amount" money />
        <span v-else class="tw-count is-masked">¥••••</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Hide, View } from '@element-plus/icons-vue'
import { api } from '../../api/client'
import { ORDER_STATUSES } from '../../utils/tuwen-yewu.js'
import TwCountUp from './TwCountUp.vue'

const MONEY_KEY = 'tuwen-dash-money-visible'
function readMoneyVisible() {
  try {
    return localStorage.getItem(MONEY_KEY) === '1'
  } catch {
    return false
  }
}

const loading = ref(false)
const moneyVisible = ref(readMoneyVisible())

function toggleMoney() {
  moneyVisible.value = !moneyVisible.value
  try {
    localStorage.setItem(MONEY_KEY, moneyVisible.value ? '1' : '0')
  } catch { /* ignore */ }
}
const data = reactive({
  todayCount: 0,
  receivable: 0,
  paid: 0,
  unpaid: 0,
  orderCount: 0,
  customerCount: 0,
  statusCounts: {},
  trend: []
})

const statusMax = computed(() => Math.max(1, ...Object.values(data.statusCounts || {})))
const trendMax = computed(() => Math.max(1, ...(data.trend || []).map((x) => Number(x.amount) || 0)))

function barVar(n, max, i = 0) {
  const r = Math.max(0, Math.min(1, Math.abs(Number(n) || 0) / Math.max(1, Number(max) || 1)))
  return { '--tw-bar': r.toFixed(4), '--tw-bar-delay': `${Math.min(i, 12) * 40}ms` }
}

async function load() {
  const cached = api.peekTuwenDashboard()
  if (cached) {
    Object.assign(data, cached)
    loading.value = false
  } else {
    loading.value = true
  }
  try {
    const res = await api.getTuwenDashboard()
    if (res && res.unchanged) return
    Object.assign(data, res || {})
  } catch (e) {
    if (cached) return
    ElMessage.error((e && e.message) || '读取仪表盘失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
