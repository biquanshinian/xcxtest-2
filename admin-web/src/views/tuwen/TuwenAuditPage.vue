<template>
  <div class="tw-page">
    <div class="tw-hero">
      <div>
        <div class="tw-hero__kicker">共 {{ total }} 条</div>
        <div class="tw-hero__title">操作记录</div>
      </div>
      <el-button size="small" class="action-btn" :loading="loading" @click="load">刷新</el-button>
    </div>
    <div class="tw-filters">
      <el-input v-model="keyword" size="small" clearable placeholder="即时搜索单号 / 客户 / 操作 / 操作人" class="tw-search" @clear="onSearch" />
    </div>
    <div v-if="loading && !list.length" class="tw-empty">正在读取记录…</div>
    <div v-else-if="!list.length" class="tw-empty">{{ keyword.trim() ? '没有符合搜索的记录' : '还没有操作记录。' }}</div>
    <div v-else class="tw-cards">
      <div v-for="row in list" :key="row.id" class="tw-card">
        <div class="tw-card__name">{{ AUDIT_ACTION_LABELS[row.action] || row.action }}</div>
        <div class="tw-muted">
          {{ formatTime(row.at) }}
          <span v-if="row.actorLabel"> · {{ row.actorLabel }}</span>
          <span v-if="row.orderNo"> · {{ row.orderNo }}</span>
          <span v-if="row.customerName"> · {{ row.customerName }}</span>
          <span v-if="row.amount"> · {{ formatMoney(row.amount) }}</span>
          <span v-if="row.detail"> · {{ row.detail }}</span>
        </div>
      </div>
    </div>
    <el-pagination
      v-if="!keyword.trim() && total > query.pageSize"
      v-model:current-page="query.page"
      :page-size="query.pageSize"
      :total="total"
      layout="prev, pager, next"
      class="tw-pager"
      @current-change="load"
    />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../api/client'
import { AUDIT_ACTION_LABELS, debounce, formatMoney, matchesAuditLog } from '../../utils/tuwen-yewu.js'

const loading = ref(false)
const list = ref([])
const total = ref(0)
const keyword = ref('')
const query = reactive({ page: 1, pageSize: 50 })
let loadSeq = 0

function formatTime(raw) {
  return String(raw || '').replace('T', ' ').slice(0, 16)
}

async function load() {
  const seq = ++loadSeq
  const q = keyword.value.trim()
  loading.value = true
  try {
    const data = await api.listTuwenAuditLogs({
      page: q ? 1 : query.page,
      pageSize: q ? 100 : query.pageSize,
      q
    })
    if (seq !== loadSeq) return
    const raw = (data && data.list) || []
    const shown = q ? raw.filter((row) => matchesAuditLog(row, q)) : raw
    list.value = shown
    total.value = q ? shown.length : ((data && data.total) || 0)
  } catch (e) {
    if (seq !== loadSeq) return
    ElMessage.error((e && e.message) || '读取记录失败')
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function onSearch() {
  searchLater.cancel()
  query.page = 1
  load()
}

const searchLater = debounce(() => {
  query.page = 1
  load()
}, 220)

watch(keyword, () => searchLater())
onMounted(load)
onBeforeUnmount(() => searchLater.cancel())
</script>

<style scoped>
.tw-card__name { font-weight: 600; margin-bottom: 4px; }
.tw-pager { margin-top: 16px; justify-content: center; }
</style>
