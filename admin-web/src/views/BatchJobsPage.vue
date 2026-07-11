<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div>批量任务中心</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <el-select v-model="query.module" clearable placeholder="模块" style="width:180px" @change="load">
            <el-option label="media_assets" value="media_assets" />
            <el-option label="media_feed" value="media_feed" />
          </el-select>
          <el-switch v-model="onlyRunning" active-text="仅进行中" @change="load" />
          <el-switch v-model="onlyFailed" active-text="仅失败" @change="load" />
          <el-switch v-model="autoRefresh" active-text="自动轮询" @change="onAutoRefreshChange" />
          <el-button @click="load">刷新</el-button>
        </div>
      </div>
    </template>

    <el-table :data="list" stripe>
      <el-table-column prop="_id" label="任务ID" min-width="220" show-overflow-tooltip />
      <el-table-column prop="module" label="模块" width="140" />
      <el-table-column prop="action" label="动作" width="120" />
      <el-table-column label="状态" width="140">
        <template #default="scope">
          <el-tag :type="statusType(scope.row.status)">{{ scope.row.status || '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="进度" min-width="180">
        <template #default="scope">
          <el-progress :percentage="calcPercent(scope.row)" :status="scope.row.failed ? 'exception' : undefined" />
        </template>
      </el-table-column>
      <el-table-column label="统计" min-width="220">
        <template #default="scope">
          总{{ scope.row.total || 0 }} / 成功{{ scope.row.success || 0 }} / 失败{{ scope.row.failed || 0 }}
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="scope">{{ formatTime(scope.row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="340">
        <template #default="scope">
          <el-button size="small" @click="viewDetail(scope.row)">详情</el-button>
          <el-button size="small" :disabled="!(scope.row.errors || []).length" @click="exportErrors(scope.row)">导出失败</el-button>
          <el-button size="small" :disabled="!(scope.row.errors || []).length" @click="copyFailedIds(scope.row)">复制失败ID</el-button>
          <el-button size="small" :disabled="!(scope.row.errors || []).length" @click="copyFailedIdsAsJson(scope.row)">复制JSON</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="query.pageSize"
        :current-page="query.page"
        @current-change="onPageChange"
      />
    </div>
  </el-card>

  <el-dialog v-model="detailVisible" title="任务详情" width="860px">
    <div v-if="detail">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="任务ID">{{ detail._id }}</el-descriptions-item>
        <el-descriptions-item label="模块">{{ detail.module }}</el-descriptions-item>
        <el-descriptions-item label="动作">{{ detail.action }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ detail.status }}</el-descriptions-item>
        <el-descriptions-item label="总数">{{ detail.total || 0 }}</el-descriptions-item>
        <el-descriptions-item label="已处理">{{ detail.processed || 0 }}</el-descriptions-item>
        <el-descriptions-item label="成功">{{ detail.success || 0 }}</el-descriptions-item>
        <el-descriptions-item label="失败">{{ detail.failed || 0 }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">失败明细（前100）</el-divider>
      <el-table :data="detail.errors || []" stripe max-height="360">
        <el-table-column prop="id" label="记录ID" min-width="220" show-overflow-tooltip />
        <el-table-column prop="message" label="错误信息" min-width="480" show-overflow-tooltip />
      </el-table>
    </div>
  </el-dialog>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const list = ref([])
const total = ref(0)
const detailVisible = ref(false)
const detail = ref(null)
const autoRefresh = ref(true)
const onlyRunning = ref(false)
const onlyFailed = ref(false)
let timer = null
let detailTimer = null

const query = reactive({ page: 1, pageSize: 20, module: '' })

const formatTime = (ts) => {
  if (!ts) return '-'
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString()
}

const calcPercent = (row) => {
  const totalNum = Number(row?.total || 0)
  if (!totalNum) return 0
  const processed = Number(row?.processed || 0)
  return Math.min(100, Math.round((processed / totalNum) * 100))
}

const statusType = (status) => {
  if (status === 'success') return 'success'
  if (status === 'partial_success') return 'warning'
  if (status === 'running') return 'info'
  return 'danger'
}

const rankStatus = (status) => {
  if (status === 'running') return 1
  if (status === 'partial_success') return 2
  if (status === 'success') return 3
  return 4
}

const load = async () => {
  try {
    const data = await api.listBatchJobs(query)
    const rows = data.list || []
    const sortedRows = rows.sort((a, b) => {
      const ra = rankStatus(a.status)
      const rb = rankStatus(b.status)
      if (ra !== rb) return ra - rb
      return Number(b.createdAt || 0) - Number(a.createdAt || 0)
    })

    let filtered = sortedRows
    if (onlyRunning.value) {
      filtered = filtered.filter((i) => i.status === 'running')
    }
    if (onlyFailed.value) {
      filtered = filtered.filter((i) => Number(i.failed || 0) > 0 || i.status === 'failed')
    }

    list.value = filtered
    total.value = filtered.length
  } catch (e) {
    ElMessage.error(e.message || '加载任务失败')
  }
}

const onPageChange = (page) => {
  query.page = page
  load()
}

const refreshDetail = async () => {
  if (!detail.value?._id) return
  try {
    const data = await api.getBatchJob(detail.value._id)
    detail.value = data
    const done = ['success', 'partial_success', 'failed', 'cancelled'].includes(data?.status)
    if (done && detailTimer) {
      clearInterval(detailTimer)
      detailTimer = null
    }
  } catch (e) {}
}

const startDetailPolling = () => {
  if (!detail.value?._id) return
  if (detailTimer) clearInterval(detailTimer)
  detailTimer = setInterval(() => {
    refreshDetail()
  }, 3000)
}

const viewDetail = async (row) => {
  try {
    const data = await api.getBatchJob(row._id)
    detail.value = data
    detailVisible.value = true
    startDetailPolling()
  } catch (e) {
    ElMessage.error(e.message || '加载详情失败')
  }
}

const exportErrors = (row) => {
  const errors = row.errors || []
  if (!errors.length) return
  const header = ['id', 'message']
  const csv = [header.join(',')]
  errors.forEach((i) => {
    csv.push([i.id, i.message].map((v) => `"${String(v || '').replaceAll('"', '""')}"`).join(','))
  })
  const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `batch_job_errors_${row._id}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

const copyFailedIds = async (row) => {
  const errors = row.errors || []
  const ids = errors.map((i) => i.id).filter(Boolean)
  if (!ids.length) return
  try {
    await navigator.clipboard.writeText(ids.join('\n'))
    ElMessage.success(`已复制 ${ids.length} 个失败ID`)
  } catch (e) {
    ElMessage.error('复制失败，请检查浏览器权限')
  }
}

const copyFailedIdsAsJson = async (row) => {
  const errors = row.errors || []
  const ids = errors.map((i) => i.id).filter(Boolean)
  if (!ids.length) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(ids))
    ElMessage.success(`已复制 ${ids.length} 个失败ID(JSON)`)
  } catch (e) {
    ElMessage.error('复制失败，请检查浏览器权限')
  }
}

const clearTimer = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

const setupTimer = () => {
  clearTimer()
  if (!autoRefresh.value) return
  timer = setInterval(() => {
    load()
  }, 5000)
}

const onAutoRefreshChange = () => {
  setupTimer()
}

watch(detailVisible, (val) => {
  if (!val && detailTimer) {
    clearInterval(detailTimer)
    detailTimer = null
  }
})

onMounted(async () => {
  await load()
  setupTimer()
})

onBeforeUnmount(() => {
  clearTimer()
  if (detailTimer) {
    clearInterval(detailTimer)
    detailTimer = null
  }
})
</script>
