<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span>管理员用户</span>
          <el-switch v-model="softDelete" active-text="软删除" inactive-text="硬删除" />
          <el-switch v-model="includeDeleted" active-text="显示已删除" inactive-text="隐藏已删除" @change="onIncludeDeletedChange" />
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <el-button :disabled="!hasSelection" @click="onBatchSoftDelete">批量软删除</el-button>
          <el-button type="success" :disabled="!hasDeletedSelection" @click="onBatchRestore">批量恢复</el-button>
          <el-button type="primary" @click="openCreate">新建用户</el-button>
        </div>
      </div>
    </template>

    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <el-upload
        :auto-upload="false"
        :show-file-list="false"
        accept=".csv,text/csv"
        :on-change="onRetryCsvSelect"
      >
        <el-button>导入失败CSV</el-button>
      </el-upload>
      <el-switch v-model="retryOnlyPrecheckPassed" active-text="仅重试预检通过" inactive-text="重试全部导入" />
      <el-switch v-model="retryRunFilteredOnly" active-text="仅执行当前筛选" inactive-text="执行全部导入" />
      <el-select v-model="replayStrategy" size="small" style="width:170px;">
        <el-option label="回放策略：覆盖当前" value="replace" />
        <el-option label="回放策略：追加导入" value="append" />
        <el-option label="回放策略：仅更新失败" value="merge-failed" />
      </el-select>
      <el-button @click="runRetryDryRun" :disabled="!retryCandidates.length">Dry-run 仅预检</el-button>
      <el-button type="warning" :disabled="!retryCandidates.length" @click="onRunRetryFromCsv">一键重试</el-button>
      <el-button :disabled="!retryCandidates.length" @click="clearRetryCandidates">清空导入</el-button>
      <el-button :disabled="!retryCandidates.length" @click="exportPrecheckFailedOnly">导出预检失败</el-button>
      <el-button :disabled="!lastRetryReportText" @click="copyRetryReport">复制失败报告</el-button>
      <span style="color:#909399;font-size:12px;">已导入 {{ retryCandidates.length }} 条重试任务</span>
    </div>

    <div v-if="retryCandidates.length" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
      <span style="color:#606266;font-size:12px;">预检筛选：</span>
      <el-radio-group v-model="retryPreviewFilter" size="small">
        <el-radio-button label="all">全部</el-radio-button>
        <el-radio-button label="passed">通过</el-radio-button>
        <el-radio-button label="failed">失败</el-radio-button>
      </el-radio-group>
      <el-button size="small" :type="retryPreviewFilter === 'failed' ? 'primary' : 'default'" @click="showRetryFailedOnly">只看失败项</el-button>
      <span style="color:#909399;font-size:12px;">当前显示 {{ filteredRetryCandidates.length }} 条</span>
    </div>

    <el-table v-if="retryCandidates.length" :data="filteredRetryCandidates" size="small" border style="margin-bottom:12px;">
      <el-table-column prop="_id" label="用户ID" min-width="160" />
      <el-table-column prop="username" label="用户名" width="140" />
      <el-table-column prop="retryMethod" label="方法" width="90" />
      <el-table-column prop="retryPath" label="重试路径" min-width="220" />
      <el-table-column label="预检" width="110">
        <template #default="scope">
          <el-tag :type="scope.row.precheckState === 'passed' ? 'success' : (scope.row.precheckState === 'failed' ? 'danger' : 'info')">
            {{ scope.row.precheckState === 'passed' ? '通过' : (scope.row.precheckState === 'failed' ? '失败' : '未执行') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="预检信息" min-width="200">
        <template #default="scope">{{ scope.row.precheckMessage || '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="scope">
          <el-button size="small" type="danger" text @click="removeRetryCandidate(scope.row)">移除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-card v-if="retryBatchLogs.length" shadow="never" style="margin-bottom:12px;">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span>最近重试批次</span>
          <el-button size="small" @click="clearRetryBatchLogs">清空日志</el-button>
        </div>
      </template>
      <el-table :data="retryBatchLogs" size="small" border>
        <el-table-column prop="batchId" label="批次号" min-width="180" />
        <el-table-column prop="action" label="动作" width="120" />
        <el-table-column prop="scopeCount" label="范围" width="80" />
        <el-table-column prop="passCount" label="通过" width="80" />
        <el-table-column prop="failCount" label="失败" width="80" />
        <el-table-column prop="executeCount" label="执行" width="80" />
        <el-table-column prop="durationMs" label="耗时(ms)" width="100" />
        <el-table-column label="时间" width="180">
          <template #default="scope">{{ fmt(scope.row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="300">
          <template #default="scope">
            <el-button size="small" text @click="replayRetryBatchLog(scope.row)">回放失败</el-button>
            <el-button size="small" text @click="copyRetryBatchLog(scope.row)">复制报告</el-button>
            <el-button size="small" text @click="exportRetryBatchLog(scope.row)">导出失败</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-table :data="list" stripe @selection-change="onSelectionChange">
      <el-table-column type="selection" width="55" />
      <el-table-column prop="username" label="用户名" width="180" />
      <el-table-column prop="role" label="角色" width="140" />
      <el-table-column label="权限模块" min-width="200">
        <template #default="scope">
          <span v-if="scope.row.role === 'super_admin'" style="color:#67c23a;font-size:12px;">全部权限</span>
          <span v-else-if="!scope.row.permissions || scope.row.permissions.length === 0" style="color:#909399;font-size:12px;">无权限</span>
          <span v-else style="font-size:12px;color:var(--t-text-secondary, #606266);">{{ scope.row.permissions.length }} 个模块</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="scope">
          <el-tag :type="statusTagType(scope.row.status)">{{ scope.row.status || 'unknown' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最近登录" width="180">
        <template #default="scope">{{ fmt(scope.row.lastLoginAt) }}</template>
      </el-table-column>
      <el-table-column label="更新时间" width="180">
        <template #default="scope">{{ fmt(scope.row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="360">
        <template #default="scope">
          <el-button size="small" @click="openEdit(scope.row)">编辑</el-button>
          <el-button
            v-if="scope.row.status === 'deleted'"
            size="small"
            type="success"
            @click="onRestore(scope.row)"
          >恢复</el-button>
          <el-button
            v-else
            size="small"
            type="danger"
            :disabled="isDeleteDisabled(scope.row)"
            @click="onDelete(scope.row)"
          >删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
    </div>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editing ? '编辑用户' : '新建用户'" width="720px">
    <el-form :model="form" label-width="90px">
      <el-form-item label="用户名">
        <el-input v-model="form.username" :disabled="!!editing" />
      </el-form-item>
      <el-form-item label="密码">
        <el-input v-model="form.password" type="password" show-password placeholder="编辑时留空表示不修改" />
      </el-form-item>
      <el-form-item label="角色">
        <el-select v-model="form.role" style="width:100%">
          <el-option label="viewer" value="viewer" />
          <el-option label="reviewer" value="reviewer" />
          <el-option label="editor" value="editor" />
          <el-option label="super_admin" value="super_admin" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="form.status" style="width:100%">
          <el-option label="active" value="active" />
          <el-option label="disabled" value="disabled" />
          <el-option label="deleted" value="deleted" />
        </el-select>
      </el-form-item>
      <el-form-item label="功能权限" v-if="form.role !== 'super_admin'">
        <div style="margin-bottom:8px;display:flex;gap:8px;">
          <el-button size="small" @click="selectAllPerms">全选</el-button>
          <el-button size="small" @click="deselectAllPerms">全不选</el-button>
        </div>
        <el-checkbox-group v-model="form.permissions">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px;">
            <el-checkbox v-for="(label, key) in permModules" :key="key" :label="key" :value="key">{{ label }}</el-checkbox>
          </div>
        </el-checkbox-group>
        <div style="color:#909399;font-size:12px;margin-top:8px;">super_admin 角色自动拥有全部权限</div>
      </el-form-item>
      <el-form-item v-else label="功能权限">
        <span style="color:#67c23a;font-size:13px;">super_admin 自动拥有全部权限</span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, auth } from '../api/client'

const RETRY_BATCH_LOG_KEY = 'users_retry_batch_logs_v1'
const RETRY_BATCH_LOG_MAX = 20

const list = ref([])
const total = ref(0)
const includeDeleted = ref(false)
const query = reactive({ page: 1, pageSize: 20 })
const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const softDelete = ref(true)
const form = reactive({ username: '', password: '', role: 'viewer', status: 'active', permissions: [] })

const permModules = ref({})
const loadPermModules = async () => {
  try {
    permModules.value = await api.getPermissionModules()
  } catch (e) {
    permModules.value = {}
  }
}

const selectAllPerms = () => { form.permissions = Object.keys(permModules.value) }
const deselectAllPerms = () => { form.permissions = [] }
const selectedRows = ref([])
const retryCandidates = ref([])
const retryOnlyPrecheckPassed = ref(true)
const retryRunFilteredOnly = ref(false)
const lastRetryReportText = ref('')
const retryPreviewFilter = ref('all')
const retryBatchLogs = ref([])
const replayStrategy = ref('replace')

const hasSelection = computed(() => selectedRows.value.length > 0)
const hasDeletedSelection = computed(() => selectedRows.value.some((r) => r.status === 'deleted'))
const filteredRetryCandidates = computed(() => {
  if (retryPreviewFilter.value === 'passed') {
    return retryCandidates.value.filter((item) => item.precheckState === 'passed')
  }
  if (retryPreviewFilter.value === 'failed') {
    return retryCandidates.value.filter((item) => item.precheckState === 'failed')
  }
  return retryCandidates.value
})

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')

const loadRetryBatchLogs = () => {
  try {
    const raw = localStorage.getItem(RETRY_BATCH_LOG_KEY)
    if (!raw) {
      retryBatchLogs.value = []
      return
    }
    const parsed = JSON.parse(raw)
    retryBatchLogs.value = Array.isArray(parsed) ? parsed.slice(0, RETRY_BATCH_LOG_MAX) : []
  } catch (e) {
    retryBatchLogs.value = []
  }
}

const persistRetryBatchLogs = () => {
  try {
    localStorage.setItem(RETRY_BATCH_LOG_KEY, JSON.stringify(retryBatchLogs.value.slice(0, RETRY_BATCH_LOG_MAX)))
  } catch (e) {
    // ignore storage error
  }
}

const appendRetryBatchLog = (payload) => {
  const next = [{
    ...payload,
    createdAt: payload.createdAt || Date.now(),
    batchId: payload.batchId || `retry_${Date.now()}`
  }, ...retryBatchLogs.value]
  retryBatchLogs.value = next.slice(0, RETRY_BATCH_LOG_MAX)
  persistRetryBatchLogs()
}

const clearRetryBatchLogs = () => {
  retryBatchLogs.value = []
  persistRetryBatchLogs()
  ElMessage.success('批次日志已清空')
}

const copyRetryBatchLog = async (row) => {
  if (!row?.reportText) {
    ElMessage.warning('该批次暂无报告可复制')
    return
  }
  try {
    await navigator.clipboard.writeText(row.reportText)
    ElMessage.success('批次报告已复制')
  } catch (e) {
    ElMessage.error('复制失败，请手动复制')
  }
}

const exportRetryBatchLog = (row) => {
  if (!row || !Array.isArray(row.failedItems) || !row.failedItems.length) {
    ElMessage.warning('该批次无失败项可导出')
    return
  }
  downloadFailedItemsCsv(`retry_batch_${row.batchId}_failed`, row.failedItems)
  ElMessage.success(`已导出批次失败项（${row.failedItems.length}）`)
}

const replayRetryBatchLog = async (row) => {
  if (!row || !Array.isArray(row.failedItems) || !row.failedItems.length) {
    ElMessage.warning('该批次无失败项可回放')
    return
  }

  const replayItems = row.failedItems
    .map((entry) => {
      const item = entry?.item || {}
      const userId = String(item._id || item.userId || '').trim()
      const retryMethod = String(item.retryMethod || '').trim().toUpperCase()
      const retryPath = String(item.retryPath || '').trim()
      const retryBodyRaw = item.retryBody == null ? '{}' : String(item.retryBody)

      if (!userId || !retryMethod || !retryPath) return null

      let retryBody = '{}'
      try {
        const parsed = JSON.parse(retryBodyRaw || '{}')
        retryBody = JSON.stringify(parsed && typeof parsed === 'object' ? parsed : {})
      } catch (e) {
        retryBody = retryBodyRaw || '{}'
      }

      return {
        _id: userId,
        username: String(item.username || '').trim(),
        retryMethod,
        retryPath,
        retryBody,
        precheckState: 'pending',
        precheckMessage: ''
      }
    })
    .filter(Boolean)

  if (!replayItems.length) {
    ElMessage.warning('回放数据格式异常，无法装载')
    return
  }

  const methodGrouped = replayItems.reduce((acc, item) => {
    const method = item.retryMethod || 'UNKNOWN'
    acc[method] = (acc[method] || 0) + 1
    return acc
  }, {})

  const methodSummary = Object.entries(methodGrouped)
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => `${method}: ${count}`)
    .join('，')

  const strategyLabelMap = {
    replace: '覆盖当前',
    append: '追加导入',
    'merge-failed': '仅更新失败'
  }
  const strategy = replayStrategy.value || 'replace'
  const strategyLabel = strategyLabelMap[strategy] || strategyLabelMap.replace

  try {
    await ElMessageBox.confirm(
      `来源批次：${row.batchId || '-'}\n失败项：${row.failedItems.length} 条\n可回放有效项：${replayItems.length} 条\n方法分布：${methodSummary || '-'}\n回放策略：${strategyLabel}\n\n确认装载到当前重试面板？`,
      '回放前预览确认',
      {
        type: 'warning',
        confirmButtonText: '确认装载',
        cancelButtonText: '取消',
        dangerouslyUseHTMLString: false
      }
    )
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e.message || '回放确认失败')
    return
  }

  const current = retryCandidates.value || []
  let nextCandidates = replayItems

  if (strategy === 'append') {
    const map = new Map()
    current.forEach((item) => {
      const key = `${item._id}__${item.retryMethod}__${item.retryPath}`
      map.set(key, { ...item, precheckState: 'pending', precheckMessage: '' })
    })
    replayItems.forEach((item) => {
      const key = `${item._id}__${item.retryMethod}__${item.retryPath}`
      map.set(key, item)
    })
    nextCandidates = Array.from(map.values())
  } else if (strategy === 'merge-failed') {
    const replayMap = new Map()
    replayItems.forEach((item) => {
      const key = `${item._id}__${item.retryMethod}__${item.retryPath}`
      replayMap.set(key, item)
    })

    nextCandidates = current.map((item) => {
      const key = `${item._id}__${item.retryMethod}__${item.retryPath}`
      if (item.precheckState === 'failed' && replayMap.has(key)) {
        return replayMap.get(key)
      }
      return {
        ...item,
        precheckState: 'pending',
        precheckMessage: ''
      }
    })

    const existingKeys = new Set(nextCandidates.map((item) => `${item._id}__${item.retryMethod}__${item.retryPath}`))
    replayItems.forEach((item) => {
      const key = `${item._id}__${item.retryMethod}__${item.retryPath}`
      if (!existingKeys.has(key)) {
        nextCandidates.push(item)
      }
    })
  } else {
    nextCandidates = replayItems
  }

  retryCandidates.value = nextCandidates
  retryPreviewFilter.value = 'all'
  lastRetryReportText.value = row.reportText || ''
  ElMessage.success(`已按【${strategyLabel}】回放 ${replayItems.length} 条，当前待重试 ${nextCandidates.length} 条`)
}

const statusTagType = (status) => {
  if (status === 'active') return 'success'
  if (status === 'disabled') return 'warning'
  if (status === 'deleted') return 'danger'
  return 'info'
}

const load = async () => {
  const data = await api.listUsers({ ...query, includeDeleted: includeDeleted.value })
  list.value = data.list || []
  total.value = data.total || 0
  selectedRows.value = []
}

const onPageChange = (page) => {
  query.page = page
  load()
}

const onIncludeDeletedChange = () => {
  query.page = 1
  load()
}

const onSelectionChange = (rows) => {
  selectedRows.value = rows || []
}

const openCreate = () => {
  editing.value = null
  Object.assign(form, { username: '', password: '', role: 'viewer', status: 'active', permissions: [] })
  dialogVisible.value = true
}

const openEdit = (row) => {
  editing.value = row
  Object.assign(form, { username: row.username, password: '', role: row.role || 'viewer', status: row.status || 'active', permissions: [...(row.permissions || [])] })
  dialogVisible.value = true
}

const isDeleteDisabled = (row) => {
  const me = auth.getUser() || {}
  return row.role === 'super_admin' || row.username === me.username || row._id === me.id
}

const onRestore = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确认恢复用户 ${row.username}？恢复后状态将变为 active。`,
      '恢复确认',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' }
    )
    await api.restoreUser(row._id)
    ElMessage.success('恢复成功')
    await load()
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e.message || '恢复失败')
  }
}

const onDelete = async (row) => {
  if (isDeleteDisabled(row)) return

  try {
    const modeLabel = softDelete.value ? '软删除' : '硬删除'
    await ElMessageBox.confirm(
      `确认${modeLabel}用户 ${row.username}？${softDelete.value ? '软删除可追溯，状态会变为 deleted。' : '硬删除后不可恢复。'}`,
      '删除确认',
      { type: 'warning', confirmButtonText: `确认${modeLabel}`, cancelButtonText: '取消' }
    )

    await api.deleteUser(row._id, { softDelete: !!softDelete.value })
    ElMessage.success(`${modeLabel}成功`)
    await load()
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e.message || '删除失败')
  }
}

const buildExportFileName = (scene, count = 0) => {
  const now = new Date()
  const pad = (v) => String(v).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `users_${scene}_n${count}_${stamp}.csv`
}

const downloadFailedItemsCsv = (scene, failedItems = []) => {
  if (!failedItems.length) return

  const headers = ['userId', 'username', 'status', 'role', 'errorMessage', 'retryMethod', 'retryPath', 'retryBody']
  const csvEscape = (value) => {
    const text = value == null ? '' : String(value)
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }

  const lines = [headers.join(',')]
  failedItems.forEach(({ item, error }) => {
    const retryMethod = item?.retryMethod || (scene.includes('restore') ? 'POST' : 'DELETE')
    const retryPath = item?.retryPath || (retryMethod === 'POST' ? `/users/${item?._id || ''}/restore` : `/users/${item?._id || ''}`)
    const retryBody = item?.retryBody || (retryMethod === 'POST' ? '{}' : JSON.stringify({ softDelete: true }))

    const line = [
      item?._id || '',
      item?.username || '',
      item?.status || '',
      item?.role || '',
      (error && (error.message || error.errMsg)) || item?.precheckMessage || 'unknown error',
      retryMethod,
      retryPath,
      retryBody
    ].map(csvEscape).join(',')
    lines.push(line)
  })

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = buildExportFileName(scene, failedItems.length)
  a.click()
  URL.revokeObjectURL(url)
}

const runWithConcurrency = async (items, worker, limit = 4, onProgress) => {
  const queue = [...items]
  const errors = []
  let done = 0

  const runners = new Array(Math.max(1, limit)).fill(null).map(async () => {
    while (queue.length) {
      const item = queue.shift()
      if (!item) break
      try {
        await worker(item)
      } catch (e) {
        errors.push({ item, error: e })
      } finally {
        done += 1
        if (typeof onProgress === 'function') onProgress(done, items.length)
      }
    }
  })

  await Promise.all(runners)
  return errors
}

const onBatchSoftDelete = async () => {
  const candidates = selectedRows.value.filter((row) => !isDeleteDisabled(row) && row.status !== 'deleted')
  if (!candidates.length) {
    ElMessage.warning('当前选择中没有可软删除用户')
    return
  }

  try {
    await ElMessageBox.confirm(`确认批量软删除 ${candidates.length} 个用户？`, '批量软删除确认', {
      type: 'warning',
      confirmButtonText: '确认',
      cancelButtonText: '取消'
    })

    const progressMsg = ElMessage({ type: 'info', message: `正在批量软删除 0/${candidates.length}...`, duration: 0 })
    const errors = await runWithConcurrency(
      candidates,
      (row) => api.deleteUser(row._id, { softDelete: true }),
      4,
      (done, totalCount) => {
        progressMsg.message = `正在批量软删除 ${done}/${totalCount}...`
      }
    )
    progressMsg.close()

    if (errors.length > 0) {
      ElMessage.warning(`批量软删除完成，失败 ${errors.length} 项，已下载失败明细`)
      downloadFailedItemsCsv('batch_soft_delete_failed', errors)
    } else {
      ElMessage.success(`批量软删除完成（${candidates.length}）`)
    }
    await load()
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e.message || '批量软删除失败')
  }
}

const onBatchRestore = async () => {
  const candidates = selectedRows.value.filter((row) => row.status === 'deleted')
  if (!candidates.length) {
    ElMessage.warning('当前选择中没有可恢复用户')
    return
  }

  try {
    await ElMessageBox.confirm(`确认批量恢复 ${candidates.length} 个用户？`, '批量恢复确认', {
      type: 'warning',
      confirmButtonText: '确认',
      cancelButtonText: '取消'
    })

    const progressMsg = ElMessage({ type: 'info', message: `正在批量恢复 0/${candidates.length}...`, duration: 0 })
    const errors = await runWithConcurrency(
      candidates,
      (row) => api.restoreUser(row._id),
      4,
      (done, totalCount) => {
        progressMsg.message = `正在批量恢复 ${done}/${totalCount}...`
      }
    )
    progressMsg.close()

    if (errors.length > 0) {
      ElMessage.warning(`批量恢复完成，失败 ${errors.length} 项，已下载失败明细`)
      downloadFailedItemsCsv('batch_restore_failed', errors)
    } else {
      ElMessage.success(`批量恢复完成（${candidates.length}）`)
    }
    await load()
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e.message || '批量恢复失败')
  }
}

const parseCsvLine = (line = '') => {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

const onRetryCsvSelect = async (file) => {
  try {
    const rawFile = file?.raw
    if (!rawFile) return
    const text = await rawFile.text()
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) {
      ElMessage.warning('CSV内容为空')
      return
    }

    const headers = parseCsvLine(lines[0]).map((h) => String(h || '').trim())
    const idx = {
      userId: headers.indexOf('userId'),
      username: headers.indexOf('username'),
      retryMethod: headers.indexOf('retryMethod'),
      retryPath: headers.indexOf('retryPath'),
      retryBody: headers.indexOf('retryBody')
    }

    if (idx.userId < 0 || idx.retryMethod < 0 || idx.retryPath < 0) {
      ElMessage.error('CSV缺少必需列：userId/retryMethod/retryPath')
      return
    }

    const rows = lines.slice(1).map((line) => parseCsvLine(line)).filter((cells) => cells.length > 0)
    const parsed = rows.map((cells) => ({
      _id: String(cells[idx.userId] || '').trim(),
      username: idx.username >= 0 ? String(cells[idx.username] || '').trim() : '',
      retryMethod: String(cells[idx.retryMethod] || '').trim().toUpperCase(),
      retryPath: String(cells[idx.retryPath] || '').trim(),
      retryBody: idx.retryBody >= 0 ? String(cells[idx.retryBody] || '').trim() : '{}',
      precheckState: 'pending',
      precheckMessage: ''
    })).filter((r) => r._id && r.retryMethod && r.retryPath)

    if (!parsed.length) {
      ElMessage.warning('未解析到可重试数据')
      return
    }

    retryCandidates.value = parsed
    ElMessage.success(`已导入 ${parsed.length} 条重试任务`)
  } catch (e) {
    ElMessage.error(e.message || 'CSV导入失败')
  }
}

const clearRetryCandidates = () => {
  retryCandidates.value = []
  lastRetryReportText.value = ''
}

const removeRetryCandidate = (row) => {
  const index = retryCandidates.value.findIndex((item) => item === row || item._id === row?._id)
  if (index >= 0) retryCandidates.value.splice(index, 1)
}

const showRetryFailedOnly = () => {
  retryPreviewFilter.value = 'failed'
}

const precheckRetryCandidate = async (candidate) => {
  const user = await api.getUserById(candidate._id, { includeDeleted: true })
  if (!user || !user._id) {
    throw new Error('用户不存在')
  }

  if (candidate.retryMethod === 'POST' && candidate.retryPath.includes('/restore')) {
    if (user.status !== 'deleted') {
      throw new Error(`用户当前状态为 ${user.status || 'unknown'}，无需恢复`)
    }
  }

  if (candidate.retryMethod === 'DELETE' && user.role === 'super_admin') {
    throw new Error('不允许重试删除 super_admin 用户')
  }

  return user
}

const runPrecheckForCandidates = async (candidates) => {
  const precheckMsg = ElMessage({ type: 'info', message: `正在预检查 0/${candidates.length}...`, duration: 0 })
  const prepared = []
  const precheckFailures = []

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]
    try {
      await precheckRetryCandidate(candidate)
      candidate.precheckState = 'passed'
      candidate.precheckMessage = '通过'
      prepared.push(candidate)
    } catch (e) {
      candidate.precheckState = 'failed'
      candidate.precheckMessage = e.message || '预检查失败'
      precheckFailures.push({ item: candidate, error: e })
    } finally {
      precheckMsg.message = `正在预检查 ${i + 1}/${candidates.length}...`
    }
  }

  precheckMsg.close()
  retryCandidates.value = [...retryCandidates.value]

  return { prepared, precheckFailures }
}

const executeRetryCandidate = async (candidate) => {
  if (candidate.retryMethod === 'POST' && candidate.retryPath.includes('/restore')) {
    return api.restoreUser(candidate._id)
  }

  if (candidate.retryMethod === 'DELETE') {
    let body = { softDelete: true }
    try {
      const parsed = JSON.parse(candidate.retryBody || '{}')
      if (parsed && typeof parsed === 'object') body = parsed
    } catch (e) {
      body = { softDelete: true }
    }
    return api.deleteUser(candidate._id, body)
  }

  throw new Error(`不支持的重试方法: ${candidate.retryMethod}`)
}

const buildRetryFailureReport = (failedItems = []) => {
  if (!failedItems.length) return ''

  const grouped = failedItems.reduce((acc, item) => {
    const msg = (item?.error && (item.error.message || item.error.errMsg)) || 'unknown error'
    acc[msg] = (acc[msg] || 0) + 1
    return acc
  }, {})

  const lines = ['重试失败分组统计：']
  Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .forEach(([msg, count]) => {
      lines.push(`- ${msg}: ${count}`)
    })

  lines.push('')
  lines.push(`总失败数: ${failedItems.length}`)
  return lines.join('\n')
}

const copyRetryReport = async () => {
  if (!lastRetryReportText.value) {
    ElMessage.warning('暂无失败报告可复制')
    return
  }
  try {
    await navigator.clipboard.writeText(lastRetryReportText.value)
    ElMessage.success('失败报告已复制')
  } catch (e) {
    ElMessage.error('复制失败，请手动复制')
  }
}

const exportPrecheckFailedOnly = async () => {
  const candidates = retryCandidates.value || []
  if (!candidates.length) {
    ElMessage.warning('请先导入失败CSV')
    return
  }

  const hasPrechecked = candidates.some((item) => item.precheckState === 'passed' || item.precheckState === 'failed')
  const { precheckFailures } = hasPrechecked
    ? {
      precheckFailures: candidates
        .filter((item) => item.precheckState === 'failed')
        .map((item) => ({ item, error: new Error(item.precheckMessage || '预检查失败') }))
    }
    : await runPrecheckForCandidates(candidates)

  if (!precheckFailures.length) {
    ElMessage.success('没有预检失败项可导出')
    return
  }

  downloadFailedItemsCsv('retry_precheck_failed_only', precheckFailures)
  ElMessage.success(`已导出预检失败项（${precheckFailures.length}）`)
}

const runRetryDryRun = async () => {
  const candidates = retryCandidates.value || []
  if (!candidates.length) {
    ElMessage.warning('请先导入失败CSV')
    return
  }

  const startedAt = Date.now()
  const { prepared, precheckFailures } = await runPrecheckForCandidates(candidates)
  const report = buildRetryFailureReport(precheckFailures)
  lastRetryReportText.value = report

  appendRetryBatchLog({
    action: 'dry-run',
    scopeCount: candidates.length,
    passCount: prepared.length,
    failCount: precheckFailures.length,
    executeCount: 0,
    durationMs: Date.now() - startedAt,
    reportText: report,
    failedItems: precheckFailures
  })

  ElMessage.success(`Dry-run完成：通过 ${prepared.length}，失败 ${precheckFailures.length}`)
}

const onRunRetryFromCsv = async () => {
  const allCandidates = retryCandidates.value || []
  if (!allCandidates.length) {
    ElMessage.warning('请先导入失败CSV')
    return
  }

  const scopedCandidates = retryRunFilteredOnly.value ? filteredRetryCandidates.value : allCandidates
  if (!scopedCandidates.length) {
    ElMessage.warning('当前执行范围为空，请调整筛选条件')
    return
  }

  try {
    const startedAt = Date.now()
    const { prepared, precheckFailures } = await runPrecheckForCandidates(scopedCandidates)
    const passCount = prepared.length
    const failCount = precheckFailures.length
    const runBase = retryOnlyPrecheckPassed.value ? prepared : scopedCandidates
    const runCandidates = retryOnlyPrecheckPassed.value ? prepared : runBase

    await ElMessageBox.confirm(
      `本次范围 ${scopedCandidates.length} 条；预检通过 ${passCount} 条，预检失败 ${failCount} 条。将执行 ${runCandidates.length} 条重试，确认继续？`,
      '批量重试确认',
      {
        type: 'warning',
        confirmButtonText: '确认重试',
        cancelButtonText: '取消'
      }
    )

    if (!runCandidates.length) {
      const report = buildRetryFailureReport(precheckFailures)
      lastRetryReportText.value = report
      appendRetryBatchLog({
        action: 'retry',
        scopeCount: scopedCandidates.length,
        passCount,
        failCount,
        executeCount: 0,
        durationMs: Date.now() - startedAt,
        reportText: report,
        failedItems: precheckFailures
      })
      ElMessage.warning('无可执行重试项（预检全部失败）')
      if (precheckFailures.length) {
        downloadFailedItemsCsv('retry_precheck_failed', precheckFailures)
      }
      return
    }

    const progressMsg = ElMessage({ type: 'info', message: `正在重试 0/${runCandidates.length}...`, duration: 0 })
    const executeErrors = await runWithConcurrency(
      runCandidates,
      executeRetryCandidate,
      4,
      (done, totalCount) => {
        progressMsg.message = `正在重试 ${done}/${totalCount}...`
      }
    )
    progressMsg.close()

    const mergedFailures = [...precheckFailures, ...executeErrors]
    const report = buildRetryFailureReport(mergedFailures)
    if (mergedFailures.length) {
      lastRetryReportText.value = report
      ElMessage.warning(`重试完成，失败 ${mergedFailures.length} 项，已下载失败明细`)
      downloadFailedItemsCsv('retry_failed', mergedFailures)
    } else {
      lastRetryReportText.value = ''
      ElMessage.success(`重试完成（${runCandidates.length}）`)
    }

    appendRetryBatchLog({
      action: 'retry',
      scopeCount: scopedCandidates.length,
      passCount,
      failCount,
      executeCount: runCandidates.length,
      durationMs: Date.now() - startedAt,
      reportText: report,
      failedItems: mergedFailures
    })

    retryCandidates.value = [...retryCandidates.value]
    await load()
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e.message || '批量重试失败')
  }
}

const onSubmit = async () => {
  saving.value = true
  try {
    if (editing.value?._id) {
      const payload = { role: form.role, status: form.status, permissions: form.permissions }
      if (form.password) payload.password = form.password

      if (editing.value.status !== 'disabled' && form.status === 'disabled') {
        await ElMessageBox.confirm(
          `确认禁用用户 ${editing.value.username}？禁用后该用户将被立即强制下线。`,
          '高风险操作确认',
          { type: 'warning', confirmButtonText: '确认禁用', cancelButtonText: '取消' }
        )
      }

      await api.updateUser(editing.value._id, payload)
    } else {
      await api.createUser({ username: form.username, password: form.password, role: form.role, status: form.status, permissions: form.permissions })
    }

    ElMessage.success('保存成功')
    dialogVisible.value = false
    await load()
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadRetryBatchLogs()
  loadPermModules()
  load()
})
</script>
