<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>操作日志</span>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <el-radio-group v-model="exportTimeFormat" size="small">
            <el-radio-button label="local">本地时间</el-radio-button>
            <el-radio-button label="utc">UTC</el-radio-button>
          </el-radio-group>

          <el-select
            v-model="selectedPresetName"
            placeholder="筛选方案"
            clearable
            style="width: 220px"
            @change="applySelectedPreset"
          >
            <el-option-group label="模板方案（只读）">
              <el-option v-for="name in templatePresetNames" :key="`tpl-${name}`" :label="labelWithPin(name)" :value="name" />
            </el-option-group>
            <el-option-group label="个人方案">
              <el-option v-for="name in personalPresetNames" :key="`personal-${name}`" :label="labelWithPin(name)" :value="name" />
            </el-option-group>
          </el-select>

          <el-input v-model="presetNameInput" placeholder="方案名" style="width: 150px" />
          <el-button @click="saveFilterPreset">保存方案</el-button>
          <el-button
            :disabled="!selectedPresetName || isTemplatePreset(selectedPresetName) || !presetNameInput"
            @click="renameFilterPreset"
          >重命名</el-button>
          <el-button
            :disabled="!selectedPresetName"
            @click="togglePinPreset"
          >{{ isPinned(selectedPresetName) ? '取消置顶' : '置顶方案' }}</el-button>
          <el-button :disabled="!canMovePinnedPreset('up')" @click="movePinnedPreset('up')">置顶上移</el-button>
          <el-button :disabled="!canMovePinnedPreset('down')" @click="movePinnedPreset('down')">置顶下移</el-button>
          <el-button
            :disabled="!selectedPresetName || isTemplatePreset(selectedPresetName)"
            @click="deleteFilterPreset"
          >删除方案</el-button>
          <el-button @click="resetToDefaultPreset">恢复默认</el-button>

          <el-button @click="exportPresetsJson">导出方案</el-button>
          <el-upload :auto-upload="false" :show-file-list="false" accept="application/json,.json" :on-change="importPresetsJson">
            <el-button>导入方案</el-button>
          </el-upload>

          <el-select v-model="exportScope" size="small" style="width: 130px">
            <el-option label="当前页" value="page" />
            <el-option label="全量" value="full" />
          </el-select>
          <el-button @click="exportCsv">导出CSV</el-button>
        </div>
      </div>
    </template>

    <div class="stats-bar">
      <div class="stats-text">
        <el-text type="info">
          总计 <strong>{{ stats.total }}</strong> 条 ·
          近 24h <strong>{{ stats.last24hCount }}</strong> 条
          <template v-if="stats.last24hTopModule">
            · 高频模块 <strong>{{ stats.last24hTopModule }}</strong>（{{ stats.last24hTopCount }} 次）
          </template>
        </el-text>
      </div>
      <div class="stats-actions">
        <el-input-number
          v-model="cleanDays"
          :min="7"
          :max="365"
          :step="7"
          size="small"
          style="width: 130px;"
        />
        <el-text type="info" size="small">天前的日志</el-text>
        <el-button size="small" type="warning" :loading="cleanLoading" @click="onClean">清理</el-button>
        <el-button size="small" :loading="statsLoading" @click="loadStats">刷新统计</el-button>
      </div>
    </div>

    <el-form :inline="true" :model="filters" style="margin-bottom: 12px;">
      <el-form-item label="模块">
        <el-select v-model="filters.module" placeholder="全部模块" clearable filterable style="width: 180px">
          <el-option v-for="m in moduleOptions" :key="m" :label="m" :value="m" />
        </el-select>
      </el-form-item>
      <el-form-item label="动作">
        <el-select v-model="filters.action" placeholder="全部动作" clearable filterable style="width: 160px">
          <el-option v-for="a in actionOptions" :key="a" :label="a" :value="a" />
        </el-select>
      </el-form-item>
      <el-form-item label="操作人">
        <el-input v-model="filters.operatorName" placeholder="用户名" clearable style="width: 160px" />
      </el-form-item>
      <el-form-item label="目标ID">
        <el-input v-model="filters.targetId" placeholder="目标ID" clearable style="width: 180px" />
      </el-form-item>
      <el-form-item label="时间范围">
        <el-date-picker
          v-model="filtersRange"
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          value-format="x"
          style="width: 360px"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="list" stripe>
      <el-table-column prop="module" label="模块" width="180" />
      <el-table-column prop="action" label="动作" width="120" />
      <el-table-column prop="operatorName" label="操作人" width="120" />
      <el-table-column prop="targetId" label="目标ID" min-width="180" />
      <el-table-column label="时间" width="180">
        <template #default="scope">{{ fmt(scope.row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="详情" width="120">
        <template #default="scope">
          <el-button size="small" @click="showDetail(scope.row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.pageSize" :current-page="query.page" @current-change="onPageChange" />
    </div>
  </el-card>

  <el-dialog v-model="dialogVisible" title="日志详情" width="760px">
    <el-descriptions :column="2" border>
      <el-descriptions-item label="模块">{{ current.module }}</el-descriptions-item>
      <el-descriptions-item label="动作">{{ current.action }}</el-descriptions-item>
      <el-descriptions-item label="操作人">{{ current.operatorName }}</el-descriptions-item>
      <el-descriptions-item label="时间">{{ fmt(current.createdAt) }}</el-descriptions-item>
      <el-descriptions-item label="目标ID" :span="2">{{ current.targetId || '-' }}</el-descriptions-item>
    </el-descriptions>

    <el-divider />
    <div style="font-weight:600;margin-bottom:6px">Before</div>
    <pre class="code">{{ pretty(current.before) }}</pre>
    <div style="font-weight:600;margin:10px 0 6px">After</div>
    <pre class="code">{{ pretty(current.after) }}</pre>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const LOG_FILTER_PRESETS_KEY = 'admin_logs_filter_presets_v3'
const LOG_PINNED_PRESETS_KEY = 'admin_logs_pinned_presets_v1'
const LOG_EXPORT_TIME_FORMAT_KEY = 'admin_logs_export_time_format_v1'
const LOG_EXPORT_SCOPE_KEY = 'admin_logs_export_scope_v1'
const DEFAULT_PRESET_NAME = '__DEFAULT__'
const TEMPLATE_PRESET_NAMES = [DEFAULT_PRESET_NAME, '最近24小时', '近7天高风险操作']

const list = ref([])
const total = ref(0)
const stats = reactive({ total: 0, last24hCount: 0, last24hTopModule: '', last24hTopCount: 0 })
const cleanDays = ref(60)
const cleanLoading = ref(false)
const statsLoading = ref(false)
const query = reactive({ page: 1, pageSize: 20 })
const filters = reactive({ module: '', action: '', operatorName: '', targetId: '', startAt: 0, endAt: 0 })
const filtersRange = ref([])
const dialogVisible = ref(false)
const current = ref({})
const exportTimeFormat = ref(localStorage.getItem(LOG_EXPORT_TIME_FORMAT_KEY) || 'local')
const exportScope = ref(localStorage.getItem(LOG_EXPORT_SCOPE_KEY) || 'full')

const presetsMap = ref({})
const pinnedPresets = ref([])
const selectedPresetName = ref('')
const presetNameInput = ref('')

const moduleSet = ref(new Set())
const actionSet = ref(new Set())

const isTemplatePreset = (name) => TEMPLATE_PRESET_NAMES.includes(name)
const isPinned = (name) => !!name && pinnedPresets.value.includes(name)
const labelWithPin = (name) => (isPinned(name) ? `📌 ${name}` : name)
const sortByPinThenName = (names = []) => {
  return [...names].sort((a, b) => {
    const ap = isPinned(a) ? 1 : 0
    const bp = isPinned(b) ? 1 : 0
    if (ap !== bp) return bp - ap

    if (ap === 1 && bp === 1) {
      const ai = pinnedPresets.value.indexOf(a)
      const bi = pinnedPresets.value.indexOf(b)
      if (ai !== bi) return ai - bi
    }

    return String(a).localeCompare(String(b), 'zh-Hans-CN')
  })
}

const moduleOptions = computed(() => Array.from(moduleSet.value).sort())
const actionOptions = computed(() => Array.from(actionSet.value).sort())
const templatePresetNames = computed(() => sortByPinThenName(TEMPLATE_PRESET_NAMES.filter((name) => !!presetsMap.value[name])))
const personalPresetNames = computed(() => sortByPinThenName(Object.keys(presetsMap.value || {}).filter((name) => !TEMPLATE_PRESET_NAMES.includes(name))))

const fmt = (t) => (t ? new Date(Number(t)).toLocaleString() : '-')
const fmtUtc = (t) => (t ? new Date(Number(t)).toISOString() : '-')
const pretty = (obj) => JSON.stringify(obj || null, null, 2)

watch(exportTimeFormat, (v) => {
  localStorage.setItem(LOG_EXPORT_TIME_FORMAT_KEY, v || 'local')
})

watch(exportScope, (v) => {
  localStorage.setItem(LOG_EXPORT_SCOPE_KEY, v || 'full')
})

const fillOptionsFromList = (rows = []) => {
  const nextModule = new Set(moduleSet.value)
  const nextAction = new Set(actionSet.value)
  rows.forEach((r) => {
    if (r?.module) nextModule.add(r.module)
    if (r?.action) nextAction.add(r.action)
  })
  moduleSet.value = nextModule
  actionSet.value = nextAction
}

const snapshotFilters = () => ({
  module: filters.module,
  action: filters.action,
  operatorName: filters.operatorName,
  targetId: filters.targetId,
  startAt: filters.startAt,
  endAt: filters.endAt,
  filtersRange: filtersRange.value || []
})

const applyFiltersSnapshot = (p = {}) => {
  filters.module = p.module || ''
  filters.action = p.action || ''
  filters.operatorName = p.operatorName || ''
  filters.targetId = p.targetId || ''
  filters.startAt = Number(p.startAt || 0)
  filters.endAt = Number(p.endAt || 0)
  filtersRange.value = Array.isArray(p.filtersRange) ? p.filtersRange : []
}

const load = async () => {
  const data = await api.listLogs({ ...query, ...filters })
  list.value = data.list || []
  total.value = data.total || 0
  fillOptionsFromList(list.value)
}

const loadStats = async () => {
  statsLoading.value = true
  try {
    const data = await api.getLogsStats()
    stats.total = data.total || 0
    stats.last24hCount = data.last24hCount || 0
    stats.last24hTopModule = data.last24hTopModule || ''
    stats.last24hTopCount = data.last24hTopCount || 0
  } catch (e) {
    /* 静默：统计失败不影响列表 */
  } finally {
    statsLoading.value = false
  }
}

const onClean = async () => {
  const days = Number(cleanDays.value || 60)
  try {
    await ElMessageBox.confirm(
      `将永久删除 ${days} 天前的所有操作日志，此操作不可恢复。是否继续？`,
      '清理确认',
      { type: 'warning', confirmButtonText: '确认清理', cancelButtonText: '取消' }
    )
  } catch (_) {
    return
  }
  cleanLoading.value = true
  try {
    const res = await api.cleanLogs(days)
    ElMessage.success(`已清理 ${res?.removed ?? 0} 条`)
    await Promise.all([load(), loadStats()])
  } catch (e) {
    ElMessage.error(e.message || '清理失败')
  } finally {
    cleanLoading.value = false
  }
}

const onPageChange = (page) => {
  query.page = page
  load()
}

const onSearch = () => {
  if (filtersRange.value && filtersRange.value.length === 2) {
    filters.startAt = Number(filtersRange.value[0] || 0)
    filters.endAt = Number(filtersRange.value[1] || 0)
  } else {
    filters.startAt = 0
    filters.endAt = 0
  }
  query.page = 1
  load()
}

const onReset = () => {
  applyFiltersSnapshot({})
  query.page = 1
  load()
}

const ensureDefaultPresets = () => {
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000

  if (!presetsMap.value[DEFAULT_PRESET_NAME]) {
    presetsMap.value[DEFAULT_PRESET_NAME] = {
      module: '',
      action: '',
      operatorName: '',
      targetId: '',
      startAt: 0,
      endAt: 0,
      filtersRange: []
    }
  }

  if (!presetsMap.value['最近24小时']) {
    presetsMap.value['最近24小时'] = {
      module: '',
      action: '',
      operatorName: '',
      targetId: '',
      startAt: now - dayMs,
      endAt: now,
      filtersRange: [String(now - dayMs), String(now)]
    }
  }

  if (!presetsMap.value['近7天高风险操作']) {
    presetsMap.value['近7天高风险操作'] = {
      module: '',
      action: 'delete',
      operatorName: '',
      targetId: '',
      startAt: now - 7 * dayMs,
      endAt: now,
      filtersRange: [String(now - 7 * dayMs), String(now)]
    }
  }
}

const loadPresets = () => {
  try {
    const raw = localStorage.getItem(LOG_FILTER_PRESETS_KEY)
    presetsMap.value = raw ? (JSON.parse(raw) || {}) : {}
  } catch (e) {
    presetsMap.value = {}
  }

  try {
    const rawPinned = localStorage.getItem(LOG_PINNED_PRESETS_KEY)
    pinnedPresets.value = rawPinned ? (JSON.parse(rawPinned) || []) : []
  } catch (e) {
    pinnedPresets.value = []
  }

  ensureDefaultPresets()
}

const persistPresets = () => {
  ensureDefaultPresets()
  localStorage.setItem(LOG_FILTER_PRESETS_KEY, JSON.stringify(presetsMap.value || {}))
  localStorage.setItem(LOG_PINNED_PRESETS_KEY, JSON.stringify(pinnedPresets.value || []))
}

const saveFilterPreset = async () => {
  const name = (presetNameInput.value || selectedPresetName.value || '').trim()
  if (!name) {
    ElMessage.warning('请输入方案名')
    return
  }
  if (isTemplatePreset(name)) {
    ElMessage.warning('模板方案名保留，不可覆盖')
    return
  }

  if (presetsMap.value[name]) {
    try {
      await ElMessageBox.confirm(`方案「${name}」已存在，是否覆盖？`, '覆盖确认', {
        type: 'warning',
        confirmButtonText: '覆盖',
        cancelButtonText: '取消'
      })
    } catch (e) {
      return
    }
  }

  presetsMap.value = {
    ...presetsMap.value,
    [name]: snapshotFilters()
  }
  persistPresets()
  selectedPresetName.value = name
  presetNameInput.value = ''
  ElMessage.success('筛选方案已保存')
}

const renameFilterPreset = () => {
  const oldName = (selectedPresetName.value || '').trim()
  const newName = (presetNameInput.value || '').trim()
  if (!oldName || isTemplatePreset(oldName)) {
    ElMessage.warning('模板方案不可重命名')
    return
  }
  if (!newName) {
    ElMessage.warning('请输入新方案名')
    return
  }
  if (isTemplatePreset(newName)) {
    ElMessage.warning('不能重命名为模板方案名')
    return
  }
  if (!presetsMap.value[oldName]) {
    ElMessage.warning('原方案不存在')
    return
  }

  const next = { ...presetsMap.value }
  next[newName] = next[oldName]
  delete next[oldName]
  presetsMap.value = next

  if (isPinned(oldName)) {
    pinnedPresets.value = pinnedPresets.value.filter((n) => n !== oldName)
    if (!pinnedPresets.value.includes(newName)) pinnedPresets.value.push(newName)
  }

  persistPresets()
  selectedPresetName.value = newName
  presetNameInput.value = ''
  ElMessage.success('方案重命名成功')
}

const applySelectedPreset = async (name) => {
  if (!name || !presetsMap.value[name]) return
  applyFiltersSnapshot(presetsMap.value[name])
  query.page = 1
  await load()
}

const deleteFilterPreset = () => {
  const name = selectedPresetName.value
  if (!name || isTemplatePreset(name)) {
    ElMessage.warning('模板方案不可删除')
    return
  }
  const next = { ...presetsMap.value }
  delete next[name]
  presetsMap.value = next
  pinnedPresets.value = pinnedPresets.value.filter((n) => n !== name)
  persistPresets()
  selectedPresetName.value = ''
  ElMessage.success('筛选方案已删除')
}

const togglePinPreset = () => {
  const name = selectedPresetName.value
  if (!name) {
    ElMessage.warning('请先选择方案')
    return
  }
  if (isPinned(name)) {
    pinnedPresets.value = pinnedPresets.value.filter((n) => n !== name)
    ElMessage.success('已取消置顶')
  } else {
    pinnedPresets.value = [...pinnedPresets.value.filter((n) => n !== name), name]
    ElMessage.success('已置顶方案')
  }
  persistPresets()
}

const canMovePinnedPreset = (direction) => {
  const name = selectedPresetName.value
  if (!name || !isPinned(name)) return false
  const idx = pinnedPresets.value.indexOf(name)
  if (idx < 0) return false
  if (direction === 'up') return idx > 0
  if (direction === 'down') return idx < pinnedPresets.value.length - 1
  return false
}

const movePinnedPreset = (direction) => {
  const name = selectedPresetName.value
  if (!name || !isPinned(name)) {
    ElMessage.warning('请先选择置顶方案')
    return
  }

  const list = [...pinnedPresets.value]
  const idx = list.indexOf(name)
  if (idx < 0) return

  const swapWith = direction === 'up' ? idx - 1 : idx + 1
  if (swapWith < 0 || swapWith >= list.length) return

  ;[list[idx], list[swapWith]] = [list[swapWith], list[idx]]
  pinnedPresets.value = list
  persistPresets()
  ElMessage.success('置顶顺序已更新')
}

const resetToDefaultPreset = async () => {
  selectedPresetName.value = DEFAULT_PRESET_NAME
  applyFiltersSnapshot(presetsMap.value[DEFAULT_PRESET_NAME] || {})
  query.page = 1
  await load()
  ElMessage.success('已恢复默认筛选')
}

const exportPresetsJson = () => {
  try {
    const exportData = { ...presetsMap.value }
    TEMPLATE_PRESET_NAMES.forEach((name) => delete exportData[name])

    const data = JSON.stringify(exportData, null, 2)
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `log_filter_presets_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('筛选方案导出成功')
  } catch (e) {
    ElMessage.error('筛选方案导出失败')
  }
}

const importPresetsJson = async (file) => {
  try {
    const rawFile = file.raw
    if (!rawFile) return
    const text = await rawFile.text()
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      ElMessage.error('导入文件格式错误')
      return
    }

    const next = { ...presetsMap.value }
    Object.keys(parsed).forEach((name) => {
      if (!isTemplatePreset(name)) {
        next[name] = parsed[name]
      }
    })

    presetsMap.value = next
    persistPresets()
    ElMessage.success('筛选方案导入成功')
  } catch (e) {
    ElMessage.error('筛选方案导入失败')
  }
}

const showDetail = (row) => {
  current.value = row
  dialogVisible.value = true
}

const csvEscape = (value) => {
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

const fetchAllLogsByPagination = async () => {
  const pageSize = 500
  let page = 1
  let totalCount = 0
  let allRows = []

  while (true) {
    const data = await api.listLogs({ ...filters, page, pageSize })
    const chunk = data.list || []
    totalCount = Number(data.total || 0)
    allRows = allRows.concat(chunk)

    if (!chunk.length) break
    if (allRows.length >= totalCount) break
    page += 1
  }

  return allRows
}

const exportCsv = async () => {
  try {
    let rows = []

    if (exportScope.value === 'page') {
      rows = list.value || []
    } else {
      rows = await fetchAllLogsByPagination()
    }

    if (!rows.length) {
      ElMessage.warning('当前筛选结果无数据')
      return
    }

    const headers = ['createdAt', 'module', 'action', 'operatorName', 'targetId', 'before', 'after']
    const lines = [headers.join(',')]

    rows.forEach((r) => {
      const timeCell = exportTimeFormat.value === 'utc' ? fmtUtc(r.createdAt) : fmt(r.createdAt)
      const line = [
        timeCell,
        r.module,
        r.action,
        r.operatorName,
        r.targetId,
        JSON.stringify(r.before || null),
        JSON.stringify(r.after || null)
      ].map(csvEscape).join(',')
      lines.push(line)
    })

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `operation_logs_${Date.now()}_${exportTimeFormat.value}_${exportScope.value}.csv`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`导出成功（${rows.length}条）`)
  } catch (e) {
    ElMessage.error(e.message || '导出失败')
  }
}

onMounted(async () => {
  loadPresets()
  persistPresets()
  selectedPresetName.value = DEFAULT_PRESET_NAME
  applyFiltersSnapshot(presetsMap.value[DEFAULT_PRESET_NAME] || {})
  await Promise.all([load(), loadStats()])
})
</script>

<style scoped>
.stats-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin-bottom: 12px;
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(168,85,247,0.18) 100%),
    rgba(18, 21, 38, 0.55);
  border: 1px solid rgba(139, 92, 246, 0.22);
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  box-shadow: 0 4px 16px rgba(2, 6, 23, 0.35);
}
.stats-text strong {
  background: linear-gradient(135deg, #C4B5FD, #A78BFA);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 700;
  margin: 0 4px;
  font-variant-numeric: tabular-nums;
}
.stats-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.code {
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 8px;
  max-height: 240px;
  overflow: auto;
  font-size: 12px;
}
</style>
