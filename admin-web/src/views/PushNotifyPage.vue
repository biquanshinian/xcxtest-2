<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>推送通知管理</span>
        <el-button type="primary" @click="openManualPush">手动推送</el-button>
      </div>
    </template>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="订阅用户" name="subscriptions">
        <el-table :data="subscriptions" stripe v-loading="subLoading">
          <el-table-column prop="_openid" label="用户OpenID" min-width="220" show-overflow-tooltip />
          <el-table-column prop="missionName" label="任务名称" min-width="160" />
          <el-table-column label="订阅时间" width="180">
            <template #default="scope">{{ fmt(scope.row.createdAt) }}</template>
          </el-table-column>
          <el-empty v-if="!subLoading && !subscriptions.length" description="暂无订阅用户" />
        </el-table>
        <div style="display:flex;justify-content:flex-end;margin-top:12px;">
          <el-pagination
            background
            layout="total, prev, pager, next"
            :total="subTotal"
            :page-size="subQuery.pageSize"
            :current-page="subQuery.page"
            @current-change="onSubPageChange"
          />
        </div>
      </el-tab-pane>
      <el-tab-pane label="推送历史" name="history">
        <el-table :data="history" stripe v-loading="histLoading">
          <el-table-column label="类型" width="120">
            <template #default="scope">
              <el-tag :type="typeTagStyle(scope.row.type)" size="small">{{ typeLabel(scope.row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="triggeredBy" label="触发者" width="140" />
          <el-table-column label="时间" width="180">
            <template #default="scope">{{ fmt(scope.row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="结果" min-width="240">
            <template #default="scope">{{ formatResult(scope.row) }}</template>
          </el-table-column>
          <el-table-column label="详情" min-width="200" show-overflow-tooltip>
            <template #default="scope">{{ formatDetail(scope.row) }}</template>
          </el-table-column>
          <el-empty v-if="!histLoading && !history.length" description="暂无推送历史" />
        </el-table>
        <div style="display:flex;justify-content:flex-end;margin-top:12px;">
          <el-pagination
            background
            layout="total, prev, pager, next"
            :total="histTotal"
            :page-size="histQuery.pageSize"
            :current-page="histQuery.page"
            @current-change="onHistPageChange"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-dialog v-model="pushDialogVisible" title="手动推送" width="520px">
    <el-form :model="pushForm" label-width="80px">
      <el-form-item label="标题">
        <el-input v-model="pushForm.title" placeholder="请输入推送标题" />
      </el-form-item>
      <el-form-item label="内容">
        <el-input v-model="pushForm.content" type="textarea" :rows="5" placeholder="请输入推送内容" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="pushDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="pushSaving" @click="onSubmitPush">确定推送</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')

const typeLabel = (t) => {
  if (t === 'manual') return '手动'
  if (t === 'auto') return '自动·汇总'
  if (t === 'auto_detail') return '自动·明细'
  return t || '-'
}

const typeTagStyle = (t) => {
  if (t === 'manual') return 'primary'
  if (t === 'auto') return 'success'
  if (t === 'auto_detail') return 'danger'
  return 'info'
}

const formatResult = (row) => {
  const r = row && row.result
  if (!r) return '-'
  if (typeof r === 'string') return r
  if (row.type === 'auto' || (typeof r.sentOk !== 'undefined')) {
    const parts = []
    parts.push(`成功 ${r.sentOk || 0}`)
    parts.push(`失败 ${r.failed || 0}`)
    parts.push(`跳过 ${r.skipped || 0}`)
    if (typeof r.total !== 'undefined') parts.push(`共 ${r.total}`)
    if (r.success === false) parts.unshift('查询失败')
    return parts.join(' / ')
  }
  if (row.type === 'auto_detail') {
    return r.error ? `失败：${r.error}` : '失败'
  }
  return r.message || JSON.stringify(r)
}

const formatDetail = (row) => {
  const p = row && row.payload
  if (!p) return ''
  if (row.type === 'auto_detail') {
    return [p.missionName || p.launchId || '', p.openid ? `openid=${p.openid.slice(0, 8)}...` : '']
      .filter(Boolean).join(' · ')
  }
  if (row.type === 'manual') {
    return p.title || p.content || ''
  }
  return ''
}

const activeTab = ref('subscriptions')
const subscriptions = ref([])
const history = ref([])
const subTotal = ref(0)
const histTotal = ref(0)
const subLoading = ref(false)
const histLoading = ref(false)
const pushDialogVisible = ref(false)
const pushSaving = ref(false)

const subQuery = reactive({ page: 1, pageSize: 20 })
const histQuery = reactive({ page: 1, pageSize: 20 })
const pushForm = reactive({ title: '', content: '' })

const loadSubscriptions = async () => {
  subLoading.value = true
  try {
    const data = await api.listPushSubscriptions(subQuery)
    subscriptions.value = data.list || []
    subTotal.value = data.total || 0
  } catch (e) {
    ElMessage.error(e.message || '加载订阅列表失败')
  } finally {
    subLoading.value = false
  }
}

const loadHistory = async () => {
  histLoading.value = true
  try {
    const data = await api.listPushHistory(histQuery)
    history.value = data.list || []
    histTotal.value = data.total || 0
  } catch (e) {
    ElMessage.error(e.message || '加载推送历史失败')
  } finally {
    histLoading.value = false
  }
}

const onSubPageChange = (page) => {
  subQuery.page = page
  loadSubscriptions()
}

const onHistPageChange = (page) => {
  histQuery.page = page
  loadHistory()
}

const openManualPush = () => {
  pushForm.title = ''
  pushForm.content = ''
  pushDialogVisible.value = true
}

const onSubmitPush = async () => {
  if (!pushForm.title?.trim() && !pushForm.content?.trim()) {
    ElMessage.warning('请至少填写标题或内容')
    return
  }
  pushSaving.value = true
  try {
    await api.triggerPush({ title: pushForm.title, content: pushForm.content })
    ElMessage.success('推送已触发')
    pushDialogVisible.value = false
    loadHistory()
  } catch (e) {
    ElMessage.error(e.message || '推送失败')
  } finally {
    pushSaving.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'subscriptions') loadSubscriptions()
  else loadHistory()
})

onMounted(() => {
  loadSubscriptions()
})
</script>
