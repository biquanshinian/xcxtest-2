<template>
  <div>
    <!-- 手动配置 -->
    <el-card style="margin-bottom: 20px">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>手动 SpaceX 发射统计配置</span>
          <el-button type="warning" :loading="syncing" @click="onSync">从官网同步</el-button>
        </div>
      </template>
      <el-form :model="form" label-width="140px" style="max-width: 720px">
        <el-form-item label="是否启用">
          <el-switch v-model="form.isActive" />
        </el-form-item>
        <el-form-item label="已完成发射">
          <el-input-number v-model="form.totalLaunches" :min="0" />
        </el-form-item>
        <el-form-item label="总着陆次数">
          <el-input-number v-model="form.totalLandings" :min="0" />
        </el-form-item>
        <el-form-item label="总复飞次数">
          <el-input-number v-model="form.totalReflights" :min="0" />
        </el-form-item>
        <el-form-item label="备注文案">
          <el-input v-model="form.message" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="0" :max="999" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- API 自动同步数据 -->
    <el-card>
      <template #header>
        <span>官网自动同步数据（{{ autoList.length }} 条）</span>
      </template>
      <el-empty v-if="autoList.length === 0" description="暂无同步数据，点击「从官网同步」获取" />
      <el-table v-else :data="autoList" style="width: 100%" stripe>
        <el-table-column prop="source" label="数据源" width="140">
          <template #default="{ row }">
            <el-tag type="warning" size="small">{{ row.source || 'spacex_official' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="isActive" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'info'" size="small">
              {{ row.isActive ? '有效' : '无数据' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="已完成" width="90" prop="totalLaunches" />
        <el-table-column label="着陆" width="90" prop="totalLandings" />
        <el-table-column label="复飞" width="90" prop="totalReflights" />
        <el-table-column label="即将发射" width="90">
          <template #default="{ row }">{{ (row.upcoming || []).length }}</template>
        </el-table-column>
        <el-table-column label="同步时间" width="170">
          <template #default="{ row }">{{ formatTime(row.syncedAt || row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-popconfirm title="确定删除？" @confirm="onDeleteItem(row._id)">
              <template #reference>
                <el-button type="danger" size="small" text>删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const saving = ref(false)
const syncing = ref(false)
const autoList = ref([])

const form = reactive({
  isActive: false,
  totalLaunches: 0,
  totalLandings: 0,
  totalReflights: 0,
  message: '',
  priority: 0
})

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

const load = async () => {
  try {
    const data = await api.getSpaceXStats()
    if (data && data.manual) Object.assign(form, data.manual)
    autoList.value = data?.autoSynced || []
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.message || ''))
  }
}

const onSave = async () => {
  saving.value = true
  try {
    await api.updateSpaceXStats(form)
    ElMessage.success('保存成功')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const onSync = async () => {
  syncing.value = true
  try {
    await api.syncSpaceXStats()
    ElMessage.success('同步完成')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

const onDeleteItem = async (id) => {
  try {
    await api.deleteSpaceXStatsItem(id)
    ElMessage.success('删除成功')
    await load()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

onMounted(load)
</script>
