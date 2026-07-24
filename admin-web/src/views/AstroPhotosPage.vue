<template>
  <div class="astro-photos-page">
    <div class="stats-row" v-if="stats">
      <div class="stat-card">
        <div class="stat-value">{{ stats.total || 0 }}</div>
        <div class="stat-label">总投稿</div>
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

      <el-input
        v-model="searchText"
        placeholder="搜索作者/地点/设备/简介"
        clearable
        style="width: 260px;"
        size="small"
        @clear="loadData(true)"
        @keyup.enter="loadData(true)"
      >
        <template #append>
          <el-button @click="loadData(true)" size="small">搜索</el-button>
        </template>
      </el-input>

      <div class="toolbar-right">
        <el-button
          size="small"
          @click="batchApprove"
          :disabled="!selectedIds.length"
          type="success"
          plain
        >批量通过 ({{ selectedIds.length }})</el-button>
        <el-button
          size="small"
          @click="batchReject"
          :disabled="!selectedIds.length"
          type="warning"
          plain
        >批量拒绝</el-button>
        <el-button size="small" @click="loadStats" plain>刷新统计</el-button>
      </div>
    </div>

    <el-table
      :data="list"
      v-loading="loading"
      stripe
      style="width: 100%"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="40" />
      <el-table-column label="封面" width="100">
        <template #default="{ row }">
          <el-image
            v-if="row.coverUrl"
            :src="row.coverUrl"
            :preview-src-list="previewList(row)"
            fit="cover"
            style="width: 72px; height: 72px; border-radius: 8px;"
          />
          <span v-else style="color:#909399;font-size:12px;">无图</span>
        </template>
      </el-table-column>
      <el-table-column prop="authorName" label="作者" width="120" />
      <el-table-column prop="location" label="地点" width="140" show-overflow-tooltip />
      <el-table-column prop="deviceModel" label="设备型号" width="140" show-overflow-tooltip />
      <el-table-column prop="shotAt" label="拍摄时间" width="120" />
      <el-table-column label="上传者" width="120" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="openid-cell">{{ row._openid || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="张数" width="70" align="center">
        <template #default="{ row }">{{ (row.photos || []).length }}</template>
      </el-table-column>
      <el-table-column prop="intro" label="简介" min-width="220" show-overflow-tooltip />
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="编辑" width="80" align="center">
        <template #default="{ row }">
          <el-tag v-if="Number(row.editCount) > 0" type="info" size="small">已改</el-tag>
          <span v-else style="color:#909399;font-size:12px;">—</span>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="160">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status !== 'approved'"
            size="small"
            type="success"
            @click="review(row, 'approved')"
          >通过</el-button>
          <el-button
            v-if="row.status !== 'rejected'"
            size="small"
            type="warning"
            @click="review(row, 'rejected')"
          >拒绝</el-button>
          <el-popconfirm title="确定删除这条投稿？将同时删除 COS 图片" @confirm="remove(row)">
            <template #reference>
              <el-button size="small" type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-bar" v-if="total > pageSize">
      <el-pagination
        layout="total, prev, pager, next"
        :total="total"
        :page-size="pageSize"
        v-model:current-page="currentPage"
        @current-change="onPageChange"
      />
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

function previewList(row) {
  const photos = Array.isArray(row.photos) ? row.photos : []
  const urls = photos.map((p) => p && p.url).filter(Boolean)
  if (urls.length) return urls
  return row.coverUrl ? [row.coverUrl] : []
}

function onSelectionChange(rows) {
  selectedIds.value = rows.map((r) => r._id)
}

async function loadStats() {
  try {
    stats.value = await api.astroPhotosStats()
  } catch (e) {}
}

async function loadData(reset) {
  if (reset) currentPage.value = 1
  loading.value = true
  try {
    const res = await api.listAstroPhotos({
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
    await api.reviewAstroPhoto({ photoId: row._id, status })
    ElMessage.success('操作成功')
    row.status = status
    loadStats()
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

async function remove(row) {
  try {
    await api.deleteAstroPhoto({ photoId: row._id })
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
    await api.batchReviewAstroPhotos({ photoIds: selectedIds.value, status: 'approved' })
    ElMessage.success(`已批量通过 ${selectedIds.value.length} 条`)
    selectedIds.value = []
    loadData(false)
    loadStats()
  } catch (e) {
    ElMessage.error('批量操作失败')
  }
}

async function batchReject() {
  if (!selectedIds.value.length) return
  try {
    await api.batchReviewAstroPhotos({ photoIds: selectedIds.value, status: 'rejected' })
    ElMessage.success(`已批量拒绝 ${selectedIds.value.length} 条`)
    selectedIds.value = []
    loadData(false)
    loadStats()
  } catch (e) {
    ElMessage.error('批量操作失败')
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
.astro-photos-page { padding: 0; }

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

.openid-cell {
  font-size: 12px;
  color: var(--t-text-muted, rgba(255,255,255,0.45));
  word-break: break-all;
}
</style>
