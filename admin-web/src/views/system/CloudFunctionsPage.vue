<template>
  <div class="cloud-page">
    <h2 class="cloud-title">云函数管理</h2>

    <el-table :data="functions" v-loading="loading" stripe>
      <el-table-column prop="name" label="名称" min-width="180" />
      <el-table-column prop="desc" label="描述" min-width="200" show-overflow-tooltip />
      <el-table-column label="类型" width="120">
        <template #default="{ row }">
          <el-tag :type="getTagType(row.type)" size="default">{{ row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <el-button
            size="small"
            type="primary"
            :disabled="!canTrigger(row)"
            :loading="triggering[row.name]"
            @click="onTrigger(row.name)"
          >
            手动触发
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="cloud-info">
      <el-text type="info" size="small">
        类型说明：timer = 定时触发；http = HTTP 接口；callFunction = 可调用。仅 syncSpaceDevsData / syncSpaceXTweets / sendLaunchReminder 允许手动触发。
      </el-text>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'

const functions = ref([])
const loading = ref(false)
const triggering = reactive({})

function getTagType(type) {
  if (type === 'timer') return 'warning'
  if (type === 'http') return 'primary'
  if (type === 'callable' || type === 'callFunction') return 'success'
  return 'info'
}

const LEGACY_TRIGGER_ALLOW = ['syncSpaceDevsData', 'syncSpaceXTweets', 'sendLaunchReminder']

function canTrigger(row) {
  if (!row) return false
  if (row.canTrigger === true) return true
  if (row.canTrigger === false) return false
  // 旧网关清单没有 canTrigger：只开放原白名单，避免全灰或误点 4001
  return LEGACY_TRIGGER_ALLOW.includes(row.name)
}

async function loadFunctions() {
  loading.value = true
  try {
    functions.value = await api.listCloudFunctions() || []
  } catch (e) {
    ElMessage.error(e.message || '加载云函数列表失败')
  } finally {
    loading.value = false
  }
}

async function onTrigger(name) {
  try {
    let payload = {}
    if (name === 'syncSpaceDevsData') {
      const { value } = await ElMessageBox.prompt(
        '要执行的 action（默认：小时 NET 探针 + 待定排序自愈）',
        '触发 syncSpaceDevsData',
        {
          inputValue: 'syncLaunchNetHourly',
          confirmButtonText: '执行',
          cancelButtonText: '取消',
          inputPlaceholder: 'syncLaunchNetHourly'
        }
      )
      const action = String(value || 'syncLaunchNetHourly').trim() || 'syncLaunchNetHourly'
      payload = { action, force: action === 'syncLaunchNetHourly' }
    } else {
      await ElMessageBox.confirm(`确认手动触发云函数 ${name}？`, '确认', { type: 'warning' })
    }
    triggering[name] = true
    const res = await api.triggerCloudFunction(name, payload)
    ElMessage.success(res && res.message ? res.message : '触发成功')
  } catch (e) {
    if (e !== 'cancel' && e?.action !== 'cancel' && e?.toString?.() !== 'cancel') {
      ElMessage.error(e.message || '触发失败')
    }
  } finally {
    triggering[name] = false
  }
}

onMounted(loadFunctions)
</script>

<style scoped>
.cloud-page {
  padding: 0;
}

.cloud-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 20px 0;
}

.cloud-info {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}
</style>
