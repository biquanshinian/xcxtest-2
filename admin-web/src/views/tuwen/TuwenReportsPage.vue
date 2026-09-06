<template>
  <div class="tw-page" v-loading="loading">
    <div class="tw-hero">
      <div>
        <div class="tw-hero__kicker">{{ from }} ~ {{ to }}</div>
        <div class="tw-hero__title">报表</div>
      </div>
      <el-button size="small" class="action-btn" @click="load">刷新</el-button>
    </div>
    <div class="tw-filters">
      <TwDatePicker v-model="from" size="small" class="tw-date" placeholder="开始日期" @change="load" />
      <TwDatePicker v-model="to" size="small" class="tw-date" placeholder="结束日期" @change="load" />
    </div>
    <div class="tw-kpis">
      <div class="tw-kpi"><div class="tw-kpi__label">收入</div><div class="tw-kpi__value"><TwCountUp :value="data.income" money /></div></div>
      <div class="tw-kpi"><div class="tw-kpi__label">支出</div><div class="tw-kpi__value"><TwCountUp :value="data.expenseTotal" money /></div></div>
      <div class="tw-kpi"><div class="tw-kpi__label">结余</div><div class="tw-kpi__value"><TwCountUp :value="data.remainder" money /></div></div>
    </div>

    <div class="tw-panel">
      <div class="tw-panel__title">支出分类</div>
      <div v-for="(row, i) in data.expenseByCategory || []" :key="row.name" class="tw-bar-row">
        <span>{{ row.name }}</span>
        <div class="tw-bar"><div class="tw-bar__fill" :style="barVar(row.amount, expenseMax, i)"></div></div>
        <TwCountUp :value="row.amount" money />
      </div>
    </div>

    <div class="tw-panel tw-table-wrap">
      <div class="tw-panel__title">耗材 / 项目</div>
      <table class="tw-table">
        <thead><tr><th>名称</th><th>数量</th><th>金额</th></tr></thead>
        <tbody>
          <tr v-for="row in data.materials || []" :key="row.name">
            <td>{{ row.name }}</td><td>{{ row.qty }}</td><td>{{ formatMoney(row.amount) }}</td>
          </tr>
          <tr v-if="!(data.materials || []).length"><td colspan="3" class="tw-muted">无</td></tr>
        </tbody>
      </table>
    </div>

    <div class="tw-panel tw-table-wrap">
      <div class="tw-panel__title">客户营业额</div>
      <table class="tw-table">
        <thead><tr><th>客户</th><th>单数</th><th>金额</th></tr></thead>
        <tbody>
          <tr v-for="row in data.customers || []" :key="row.name">
            <td>{{ row.name }}</td><td>{{ row.orderCount }}</td><td>{{ formatMoney(row.amount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="tw-panel tw-table-wrap">
      <div class="tw-panel__title">业务员工作量</div>
      <table class="tw-table">
        <thead><tr><th>业务员</th><th>单数</th><th>金额</th></tr></thead>
        <tbody>
          <tr v-for="row in data.staff || []" :key="row.name">
            <td>{{ row.name }}</td><td>{{ row.orderCount }}</td><td>{{ formatMoney(row.amount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../api/client'
import { formatMoney, monthRange } from '../../utils/tuwen-yewu.js'
import TwDatePicker from './TwDatePicker.vue'
import TwCountUp from './TwCountUp.vue'

const range = monthRange()
const loading = ref(false)
const from = ref(range.from)
const to = ref(range.to)
const data = reactive({ income: 0, expenseTotal: 0, remainder: 0, expenseByCategory: [], materials: [], customers: [], staff: [] })

const expenseMax = computed(() => Math.max(1, ...(data.expenseByCategory || []).map((x) => Number(x.amount) || 0)))

function barVar(n, max, i = 0) {
  const r = Math.max(0, Math.min(1, Math.abs(Number(n) || 0) / Math.max(1, Number(max) || 1)))
  return { '--tw-bar': r.toFixed(4), '--tw-bar-delay': `${Math.min(i, 12) * 40}ms` }
}

async function load() {
  loading.value = true
  try {
    const res = await api.getTuwenReports({ from: from.value, to: to.value })
    Object.assign(data, res || {})
  } catch (e) {
    ElMessage.error((e && e.message) || '读取报表失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.tw-date { width: 140px; }
.tw-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
</style>
