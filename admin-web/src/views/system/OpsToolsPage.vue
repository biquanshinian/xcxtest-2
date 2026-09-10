<template>
  <div class="ops-page">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom:16px;"
      title="运维保留入口。简报开关请走「全局配置 → enableBriefing」；推文同步请走「推文监控」。"
    />

    <el-card v-if="canSyncAgencies" style="margin-bottom:16px;">
      <template #header>
        <div class="ops-head">
          <span>发射商同步</span>
          <el-button type="primary" :loading="agencyLoading" @click="onSyncAgencies">同步发射商</el-button>
        </div>
      </template>
      <el-text type="info" size="small">调用 syncSpaceDevsData.syncAgencies，补齐机构档案。无发射数据权限时请走「发射数据」页。</el-text>
    </el-card>

    <el-card style="margin-bottom:16px;">
      <template #header>
        <div class="ops-head">
          <span>发射回放</span>
          <el-button @click="loadReplays" :loading="replayLoading">刷新</el-button>
        </div>
      </template>
      <el-table :data="replays" stripe v-loading="replayLoading" style="margin-bottom:16px;">
        <el-table-column prop="_id" label="launchId" min-width="220" show-overflow-tooltip />
        <el-table-column prop="missionName" label="任务" min-width="160" show-overflow-tooltip />
        <el-table-column label="更新" width="180">
          <template #default="scope">{{ fmt(scope.row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="scope">
            <el-button type="danger" link @click="onDeleteReplay(scope.row)">删除</el-button>
          </template>
        </el-table-column>
        <el-empty v-if="!replayLoading && !replays.length" description="暂无回放成品" />
      </el-table>
      <el-text type="info" size="small">队列最近 {{ queue.length }} 条（只读）</el-text>
      <el-table :data="queue" stripe size="small" style="margin-top:8px;">
        <el-table-column prop="launchId" label="launchId" min-width="200" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="120" />
        <el-table-column prop="kind" label="类型" width="80" />
        <el-table-column prop="lastError" label="错误" min-width="200" show-overflow-tooltip />
      </el-table>
    </el-card>

    <el-card>
      <template #header>B 站发文下线收尾</template>
      <el-form label-width="80px">
        <el-form-item label="强制">
          <el-switch v-model="decommissionForce" />
          <el-text type="info" size="small" style="margin-left:8px;">已下线过也再跑一遍</el-text>
        </el-form-item>
        <el-form-item>
          <el-button type="danger" :loading="decommissionLoading" @click="onDecommission">执行下线</el-button>
        </el-form-item>
      </el-form>
      <pre v-if="decommissionResult" class="ops-pre">{{ decommissionResult }}</pre>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, auth } from '../../api/client'

const canSyncAgencies = auth.hasPermission('launch_data')

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')

const agencyLoading = ref(false)
const replayLoading = ref(false)
const replays = ref([])
const queue = ref([])
const decommissionForce = ref(false)
const decommissionLoading = ref(false)
const decommissionResult = ref('')

const onSyncAgencies = async () => {
  agencyLoading.value = true
  try {
    await api.syncAgencies()
    ElMessage.success('发射商同步已触发')
  } catch (e) {
    ElMessage.error(e.message || '同步失败')
  } finally {
    agencyLoading.value = false
  }
}

const loadReplays = async () => {
  replayLoading.value = true
  try {
    const data = await api.listMissionReplays({ limit: 30 })
    replays.value = (data && data.replays) || []
    queue.value = (data && data.queue) || []
  } catch (e) {
    ElMessage.error(e.message || '加载回放失败')
  } finally {
    replayLoading.value = false
  }
}

const onDeleteReplay = async (row) => {
  const id = row && (row._id || row.launchId)
  if (!id) return
  try {
    await ElMessageBox.confirm(`删除回放 ${id}（含 COS 文件，下轮可重抓）？`, '删除回放', { type: 'warning' })
  } catch (_) {
    return
  }
  try {
    await api.deleteMissionReplay(id)
    ElMessage.success('已删除')
    loadReplays()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

const onDecommission = async () => {
  try {
    await ElMessageBox.confirm('将清理 B 站发文队列与配置，确认继续？', '下线收尾', { type: 'warning' })
  } catch (_) {
    return
  }
  decommissionLoading.value = true
  try {
    const data = await api.decommissionBilibiliPublish({ force: decommissionForce.value })
    decommissionResult.value = JSON.stringify(data || {}, null, 2)
    ElMessage.success((data && data.skipped) ? '已下线过，已跳过' : '已执行')
  } catch (e) {
    ElMessage.error(e.message || '执行失败')
  } finally {
    decommissionLoading.value = false
  }
}

onMounted(loadReplays)
</script>

<style scoped>
.ops-page {
  padding: 0;
}
.ops-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.ops-pre {
  margin: 0;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 12px;
  overflow: auto;
  max-height: 240px;
}
</style>
