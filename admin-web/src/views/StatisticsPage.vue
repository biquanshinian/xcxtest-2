<template>
  <div class="stats-page">
    <h2 class="stats-header">数据统计分析</h2>

    <div class="stats-grid">
      <div v-for="c in collections" :key="c.key" class="stats-card">
        <div class="stats-card__label">{{ c.label }}</div>
        <div class="stats-card__value">{{ c.total }}</div>
      </div>
    </div>

    <div class="stats-section">
      <div class="stats-section__header">
        <span class="stats-section__title">最近操作日志</span>
        <el-badge :value="todayLogCount" class="stats-badge">今日操作</el-badge>
      </div>
      <el-table :data="recentLogs" stripe empty-text="暂无操作日志">
        <el-table-column prop="operatorName" label="操作者" min-width="120" />
        <el-table-column prop="module" label="模块" min-width="100" />
        <el-table-column prop="action" label="动作" min-width="100" />
        <el-table-column prop="createdAt" label="时间" min-width="180">
          <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const collections = ref([])
const recentLogs = ref([])
const todayLogCount = ref(0)

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')

onMounted(async () => {
  try {
    const data = await api.getStatisticsOverview()
    collections.value = data.collections || []
    recentLogs.value = data.recentLogs || []
    todayLogCount.value = data.todayLogCount ?? 0
  } catch (e) {
    ElMessage.error(e.message || '加载统计数据失败')
  }
})
</script>

<style scoped>
.stats-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.stats-header {
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.stats-card {
  background: rgba(20, 24, 32, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  padding: 20px;
}

.stats-card__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.stats-card__value {
  font-size: 32px;
  font-weight: 700;
  color: #fff;
}

.stats-section {
  background: rgba(20, 24, 32, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 14px;
  padding: 20px;
}

.stats-section__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.stats-section__title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}

.stats-badge {
  margin-left: auto;
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
