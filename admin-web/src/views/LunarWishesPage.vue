<template>
  <div class="lunar-wishes-page">
    <!-- 统计卡片 -->
    <div class="stats-row" v-if="stats">
      <div class="stat-card">
        <div class="stat-value">{{ stats.total || 0 }}</div>
        <div class="stat-label">总祝福数</div>
      </div>
      <div class="stat-card approved">
        <div class="stat-value">{{ stats.approved || 0 }}</div>
        <div class="stat-label">已通过</div>
      </div>
      <div class="stat-card pending">
        <div class="stat-value">{{ stats.pending || 0 }}</div>
        <div class="stat-label">待审核</div>
      </div>
      <div class="stat-card rejected">
        <div class="stat-value">{{ stats.rejected || 0 }}</div>
        <div class="stat-label">已拒绝</div>
      </div>
    </div>

    <div class="toolbar">
      <el-radio-group v-model="filterStatus" @change="loadData(true)" size="small">
        <el-radio-button label="">全部</el-radio-button>
        <el-radio-button label="approved">已通过</el-radio-button>
        <el-radio-button label="pending">待审核</el-radio-button>
        <el-radio-button label="rejected">已拒绝</el-radio-button>
      </el-radio-group>

      <el-input v-model="searchText" placeholder="搜索名字/内容/登机牌号" clearable
                style="width: 260px;" size="small"
                @clear="loadData(true)" @keyup.enter="loadData(true)">
        <template #append>
          <el-button @click="loadData(true)" size="small">搜索</el-button>
        </template>
      </el-input>

      <div class="toolbar-right">
        <el-button size="small" @click="batchApprove" :disabled="!selectedIds.length"
                   type="success" plain>批量通过 ({{ selectedIds.length }})</el-button>
        <el-button size="small" @click="exportData" :loading="exporting" plain>导出数据</el-button>
        <el-button size="small" @click="loadStats" plain>刷新统计</el-button>
      </div>
    </div>

    <el-table :data="list" v-loading="loading" stripe style="width: 100%"
              @selection-change="onSelectionChange">
      <el-table-column type="selection" width="40" />
      <el-table-column prop="boardingPassId" label="登机牌号" width="130">
        <template #default="{ row }">
          <span style="font-family: monospace; letter-spacing: 1px;">{{ row.boardingPassId }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column prop="wish" label="祝福内容" min-width="260" show-overflow-tooltip />
      <el-table-column prop="location" label="来自" width="100" />
      <el-table-column prop="likes" label="点赞" width="70" align="center" />
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="160">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status !== 'approved'" size="small" type="success"
                     @click="review(row, 'approved')">通过</el-button>
          <el-button v-if="row.status !== 'rejected'" size="small" type="warning"
                     @click="review(row, 'rejected')">拒绝</el-button>
          <el-popconfirm title="确定删除这条祝福？" @confirm="remove(row)">
            <template #reference>
              <el-button size="small" type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-bar" v-if="total > pageSize">
      <el-pagination layout="total, prev, pager, next" :total="total" :page-size="pageSize"
                     v-model:current-page="currentPage" @current-change="onPageChange" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const list = ref([])
const total = ref(0)
const loading = ref(false)
const exporting = ref(false)
const filterStatus = ref('')
const searchText = ref('')
const currentPage = ref(1)
const pageSize = 20
const selectedIds = ref([])
const stats = ref(null)

function statusType(s) {
  if (s === 'approved') return 'success'
  if (s === 'rejected') return 'danger'
  return 'warning'
}

function statusLabel(s) {
  if (s === 'approved') return '已通过'
  if (s === 'rejected') return '已拒绝'
  return '待审核'
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('zh-CN')
}

function onSelectionChange(rows) {
  selectedIds.value = rows.map(r => r._id)
}

async function loadStats() {
  try {
    const res = await api.lunarWishesStats()
    stats.value = res
  } catch (e) {}
}

async function loadData(reset) {
  if (reset) currentPage.value = 1
  loading.value = true
  try {
    const res = await api.listLunarWishes({
      page: currentPage.value - 1,
      pageSize,
      status: filterStatus.value,
      search: searchText.value
    })
    list.value = res.list || []
    total.value = res.total || 0
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.message || ''))
  } finally {
    loading.value = false
  }
}

async function review(row, status) {
  try {
    await api.reviewLunarWish({ wishId: row._id, status })
    ElMessage.success('操作成功')
    row.status = status
    loadStats()
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

async function remove(row) {
  try {
    await api.deleteLunarWish({ wishId: row._id })
    ElMessage.success('已删除')
    loadData(false)
    loadStats()
  } catch (e) {
    ElMessage.error('删除失败')
  }
}

async function batchApprove() {
  if (!selectedIds.value.length) return
  try {
    await api.batchReviewLunarWishes({ wishIds: selectedIds.value, status: 'approved' })
    ElMessage.success(`已批量通过 ${selectedIds.value.length} 条`)
    selectedIds.value = []
    loadData(false)
    loadStats()
  } catch (e) {
    ElMessage.error('批量操作失败')
  }
}

async function exportData() {
  exporting.value = true
  try {
    const res = await api.exportLunarWishes()
    const items = res.data || []
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lunar-wishes-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`导出成功，共 ${items.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

function onPageChange(page) {
  currentPage.value = page
  loadData(false)
}

onMounted(() => {
  loadData(true)
  loadStats()
})
</script>

<style scoped>
.lunar-wishes-page { padding: 0; }

.stats-row {
  display: flex; gap: 16px; margin-bottom: 20px;
}
.stat-card {
  flex: 1; padding: 16px 20px; border-radius: 12px;
  background: var(--t-bg-card, rgba(30,30,30,0.6));
  border: 1px solid var(--t-border-card, rgba(255,255,255,0.08));
}
.stat-value {
  font-size: 28px; font-weight: 700;
  color: var(--t-text-primary, #fff);
  font-variant-numeric: tabular-nums;
}
.stat-label {
  font-size: 12px; margin-top: 4px;
  color: var(--t-text-muted, rgba(255,255,255,0.5));
}
.stat-card.approved .stat-value { color: #34C759; }
.stat-card.pending .stat-value { color: #FF9500; }
.stat-card.rejected .stat-value { color: #FF453A; }

.toolbar {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 16px; flex-wrap: wrap;
}
.toolbar-right { margin-left: auto; display: flex; gap: 8px; }

.pagination-bar { display: flex; justify-content: center; margin-top: 20px; }
</style>
