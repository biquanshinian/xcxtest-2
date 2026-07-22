<template>
  <el-card>
    <template #header>
      <span>数据导出</span>
    </template>

    <el-form :model="form" label-width="120px" style="max-width:560px;">
      <el-form-item label="选择集合">
        <el-select v-model="form.collection" placeholder="请选择" style="width:100%;">
          <el-option
            v-for="opt in collectionOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="最大条数">
        <el-input-number v-model="form.limit" :min="1" :max="1000" />
      </el-form-item>
      <el-form-item label="时间范围">
        <div style="display:flex;align-items:center;gap:12px;">
          <el-date-picker
            v-model="form.startAt"
            type="datetime"
            placeholder="开始时间"
            value-format="x"
            clearable
          />
          <span>至</span>
          <el-date-picker
            v-model="form.endAt"
            type="datetime"
            placeholder="结束时间"
            value-format="x"
            clearable
          />
        </div>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="exporting" @click="onExport">导出</el-button>
      </el-form-item>
    </el-form>

    <el-alert v-if="exportResult !== null" type="success" :closable="false" style="max-width:560px;">
      已导出 {{ exportResult }} 条记录
    </el-alert>
  </el-card>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const collectionOptions = [
  { value: 'space_devs_cache', label: '发射任务' },
  { value: 'news_events', label: '事件' },
  { value: 'news_articles', label: '文章' },
  { value: 'media_assets', label: '媒体素材' },
  { value: 'shop_feed', label: '小店数据' },
  { value: 'starship_event_updates', label: '事件更新' },
  { value: 'road_closure_notice', label: '封路通知' },
  { value: 'operation_logs', label: '操作日志' },
  { value: 'admin_users', label: '管理员' },
  { value: 'push_history', label: '推送记录' },
  { value: 'system_announcements', label: '系统公告' },
  { value: 'user_membership', label: '会员状态' },
  { value: 'membership_orders', label: '会员订单' }
]

const exporting = ref(false)
const exportResult = ref(null)
const form = reactive({
  collection: 'space_devs_cache',
  limit: 200,
  startAt: null,
  endAt: null
})

function escapeCSV(value) {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function toCSV(data) {
  if (!data || data.length === 0) return ''
  const headers = Object.keys(data[0])
  const rows = [headers.join(',')]
  for (const row of data) {
    const values = headers.map((h) => escapeCSV(row[h]))
    rows.push(values.join(','))
  }
  return rows.join('\n')
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const onExport = async () => {
  exporting.value = true
  exportResult.value = null
  try {
    const payload = {
      collection: form.collection,
      limit: form.limit,
      startAt: form.startAt ? Number(form.startAt) : undefined,
      endAt: form.endAt ? Number(form.endAt) : undefined
    }
    const res = await api.exportData(payload)
    const data = res?.data ?? []
    const count = res?.count ?? data.length
    const csv = toCSV(data)
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const opt = collectionOptions.find((o) => o.value === form.collection)
    const label = opt?.label ?? form.collection
    const filename = `${label}_${new Date().toISOString().slice(0, 10)}.csv`
    downloadBlob(blob, filename)
    exportResult.value = count
    ElMessage.success(`已导出 ${count} 条记录`)
  } catch (e) {
    ElMessage.error(e.message || '导出失败')
  } finally {
    exporting.value = false
  }
}
</script>
