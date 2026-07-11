<template>
  <div class="invite-stats-page">
    <div class="page-header">
      <div>
        <div class="page-title">邀请统计</div>
        <div class="page-subtitle">邀请得月卡活动数据分析：每满 {{ summary.threshold }} 位有效邀请自动发 1 张 30 天月卡</div>
      </div>
      <div class="page-header-actions">
        <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <!-- 核心指标 -->
    <el-row :gutter="16" class="stat-row">
      <el-col :xs="12" :sm="8" :md="4">
        <el-card class="stat-card" shadow="never">
          <div class="stat-label">累计有效邀请</div>
          <div class="stat-value">{{ summary.totalInvited }}</div>
          <div class="stat-hint">被邀好友去重后总数</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card class="stat-card" shadow="never">
          <div class="stat-label">今日新增</div>
          <div class="stat-value stat-accent">{{ summary.todayCount }}</div>
          <div class="stat-hint">近7天 {{ summary.last7Count }} · 近30天 {{ summary.last30Count }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card class="stat-card" shadow="never">
          <div class="stat-label">参与邀请用户</div>
          <div class="stat-value">{{ summary.totalInviters }}</div>
          <div class="stat-hint">至少邀请成功 1 人</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card class="stat-card" shadow="never">
          <div class="stat-label">达标用户</div>
          <div class="stat-value">{{ summary.reachedThreshold }}</div>
          <div class="stat-hint">已获得至少 1 张月卡</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card class="stat-card stat-gold" shadow="never">
          <div class="stat-label">已发放月卡</div>
          <div class="stat-value">{{ summary.cardsGrantedTotal }}</div>
          <div class="stat-hint">折合 {{ summary.cardsGrantedTotal * 30 }} 天会员</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <el-card class="stat-card" shadow="never">
          <div class="stat-label">达标转化率</div>
          <div class="stat-value">{{ conversionRate }}</div>
          <div class="stat-hint">达标用户 / 参与邀请用户</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 近 30 天趋势 -->
    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <span class="section-title">近 30 天邀请趋势</span>
            <span class="section-hint">按北京时间自然日统计的每日有效邀请数</span>
          </div>
          <el-tag size="small" round type="info">峰值 {{ trendMax }} 人/天</el-tag>
        </div>
      </template>
      <div v-if="trend.length" class="trend-chart">
        <el-tooltip
          v-for="item in trend"
          :key="item.date"
          :content="item.date + '：' + item.count + ' 人'"
          placement="top"
        >
          <div class="trend-col">
            <div class="trend-bar-track">
              <div
                class="trend-bar"
                :class="{ 'trend-bar--empty': item.count === 0 }"
                :style="{ height: trendBarHeight(item.count) }"
              ></div>
            </div>
            <div class="trend-date">{{ item.date.slice(8) }}</div>
          </div>
        </el-tooltip>
      </div>
      <el-empty v-else description="暂无数据" :image-size="60" />
    </el-card>

    <el-row :gutter="16">
      <!-- 邀请进度分布 -->
      <el-col :xs="24" :md="8">
        <el-card class="section-card" shadow="never">
          <template #header>
            <div class="section-header">
              <div>
                <span class="section-title">邀请进度分布</span>
                <span class="section-hint">参与用户按有效邀请数分档</span>
              </div>
            </div>
          </template>
          <div class="dist-list">
            <div v-for="b in distBuckets" :key="b.label" class="dist-item">
              <div class="dist-meta">
                <span class="dist-label">{{ b.label }}</span>
                <span class="dist-count">{{ b.count }} 人</span>
              </div>
              <el-progress
                :percentage="distPercent(b.count)"
                :stroke-width="10"
                :show-text="false"
                :color="b.color"
              />
            </div>
            <el-empty v-if="!summary.totalInviters" description="暂无参与用户" :image-size="60" />
          </div>
        </el-card>
      </el-col>

      <!-- 邀请排行榜 -->
      <el-col :xs="24" :md="16">
        <el-card class="section-card" shadow="never">
          <template #header>
            <div class="section-header">
              <div>
                <span class="section-title">邀请排行榜</span>
                <span class="section-hint">按有效邀请数降序，Top 50</span>
              </div>
            </div>
          </template>
          <el-table :data="leaderboard" v-loading="loading" stripe empty-text="暂无邀请数据" max-height="420" style="width:100%">
            <el-table-column label="排名" width="70" align="center">
              <template #default="{ $index }">
                <span class="rank-badge" :class="'rank-' + ($index + 1)">{{ $index + 1 }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="openid" label="邀请人 OpenID" min-width="240" show-overflow-tooltip />
            <el-table-column prop="validCount" label="有效邀请" width="100" align="center" sortable />
            <el-table-column label="已得月卡" width="100" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.cardsGranted > 0" type="warning" size="small" effect="dark">{{ row.cardsGranted }} 张</el-tag>
                <span v-else class="text-muted">0</span>
              </template>
            </el-table-column>
            <el-table-column label="距下一张" width="100" align="center">
              <template #default="{ row }">还差 {{ row.toNextCard }} 人</template>
            </el-table-column>
            <el-table-column label="最近邀请时间" width="170">
              <template #default="{ row }">{{ formatDate(row.lastInviteAt) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <!-- 月卡发放记录 -->
    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <span class="section-title">月卡发放记录</span>
            <span class="section-hint">邀请奖励自动发放的会员订单（最近 100 条）</span>
          </div>
          <el-tag v-if="rewardOrders.length" size="small" round type="warning">{{ rewardOrders.length }} 条</el-tag>
        </div>
      </template>
      <el-table :data="rewardOrders" v-loading="loading" stripe empty-text="暂无发放记录" max-height="360" style="width:100%">
        <el-table-column prop="orderId" label="订单号" width="220" show-overflow-tooltip />
        <el-table-column prop="openid" label="获卡用户 OpenID" min-width="240" show-overflow-tooltip />
        <el-table-column prop="description" label="说明" min-width="220" show-overflow-tooltip />
        <el-table-column label="时长" width="90" align="center">
          <template #default="{ row }">{{ row.days }} 天</template>
        </el-table-column>
        <el-table-column label="发放时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 邀请明细 -->
    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <span class="section-title">邀请明细</span>
            <span class="section-hint">每条 = 一位好友首次通过邀请链接打开小程序</span>
          </div>
          <div class="records-filter">
            <el-input
              v-model="recordsFilter"
              placeholder="按邀请人 OpenID 筛选"
              clearable
              style="width:280px"
              @keyup.enter="applyRecordsFilter"
              @clear="applyRecordsFilter"
            />
            <el-button type="primary" plain :loading="recordsLoading" @click="applyRecordsFilter">查询</el-button>
          </div>
        </div>
      </template>
      <el-table :data="records" v-loading="recordsLoading" stripe empty-text="暂无邀请记录" style="width:100%">
        <el-table-column prop="invitee" label="被邀人 OpenID" min-width="240" show-overflow-tooltip />
        <el-table-column prop="inviter" label="邀请人 OpenID" min-width="240" show-overflow-tooltip />
        <el-table-column label="邀请时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          layout="total, prev, pager, next, sizes"
          :total="recordsTotal"
          v-model:current-page="recordsPage"
          v-model:page-size="recordsPageSize"
          :page-sizes="[20, 50, 100]"
          @current-change="loadRecords"
          @size-change="onRecordsSizeChange"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { api } from '../api/client'

const loading = ref(false)
const summary = reactive({
  totalInvited: 0,
  totalInviters: 0,
  cardsGrantedTotal: 0,
  reachedThreshold: 0,
  todayCount: 0,
  last7Count: 0,
  last30Count: 0,
  threshold: 15
})
const distribution = reactive({ d1_4: 0, d5_9: 0, d10_14: 0, d15plus: 0 })
const trend = ref([])
const leaderboard = ref([])
const rewardOrders = ref([])

const recordsLoading = ref(false)
const records = ref([])
const recordsTotal = ref(0)
const recordsPage = ref(1)
const recordsPageSize = ref(20)
const recordsFilter = ref('')

const trendMax = computed(() => Math.max(1, ...trend.value.map((t) => t.count)))

const conversionRate = computed(() => {
  if (!summary.totalInviters) return '0%'
  return ((summary.reachedThreshold / summary.totalInviters) * 100).toFixed(1) + '%'
})

const distBuckets = computed(() => [
  { label: '1 - 4 人', count: distribution.d1_4, color: '#909399' },
  { label: '5 - 9 人', count: distribution.d5_9, color: '#409EFF' },
  { label: '10 - 14 人', count: distribution.d10_14, color: '#E6A23C' },
  { label: '≥ 15 人（已达标）', count: distribution.d15plus, color: '#67C23A' }
])

function distPercent(count) {
  if (!summary.totalInviters) return 0
  return Math.round((count / summary.totalInviters) * 100)
}

function trendBarHeight(count) {
  if (!count) return '2px'
  return Math.max(6, Math.round((count / trendMax.value) * 100)) + '%'
}

function formatDate(val) {
  if (!val) return '-'
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  return (
    d.getFullYear() +
    '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0') +
    ' ' + String(d.getHours()).padStart(2, '0') +
    ':' + String(d.getMinutes()).padStart(2, '0')
  )
}

async function loadStats() {
  loading.value = true
  try {
    const res = await api.getInviteStats()
    Object.assign(summary, res.summary || {})
    Object.assign(distribution, res.distribution || {})
    trend.value = res.trend || []
    leaderboard.value = res.leaderboard || []
    rewardOrders.value = res.rewardOrders || []
  } catch (e) {
    ElMessage.error(e.message || '加载邀请统计失败')
  } finally {
    loading.value = false
  }
}

async function loadRecords() {
  recordsLoading.value = true
  try {
    const res = await api.listInviteRecords({
      page: recordsPage.value,
      pageSize: recordsPageSize.value,
      inviter: recordsFilter.value.trim()
    })
    records.value = res.list || []
    recordsTotal.value = res.total || 0
  } catch (e) {
    ElMessage.error(e.message || '加载邀请明细失败')
  } finally {
    recordsLoading.value = false
  }
}

function applyRecordsFilter() {
  recordsPage.value = 1
  loadRecords()
}

function onRecordsSizeChange() {
  recordsPage.value = 1
  loadRecords()
}

function loadAll() {
  loadStats()
  loadRecords()
}

onMounted(loadAll)
</script>

<style scoped>
.invite-stats-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
}

.page-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat-row {
  row-gap: 16px;
}

.stat-card {
  position: relative;
  overflow: hidden;
}

.stat-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.stat-value {
  margin-top: 6px;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

.stat-accent {
  color: var(--el-color-primary);
}

.stat-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.stat-gold .stat-value {
  color: #b8860b;
}

.section-card :deep(.el-card__header) {
  padding: 14px 20px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
}

.section-hint {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 30 天趋势条形图（纯 CSS） */
.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 180px;
  padding: 8px 4px 0;
}

.trend-col {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: default;
}

.trend-bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.trend-bar {
  width: 70%;
  max-width: 22px;
  border-radius: 3px 3px 0 0;
  background: linear-gradient(180deg, var(--el-color-primary-light-3), var(--el-color-primary));
  transition: height 0.3s ease;
}

.trend-bar--empty {
  background: var(--el-fill-color-dark);
}

.trend-date {
  margin-top: 6px;
  font-size: 10px;
  color: var(--el-text-color-secondary);
  transform: scale(0.9);
}

.dist-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dist-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.dist-label {
  font-size: 13px;
}

.dist-count {
  font-size: 13px;
  font-weight: 600;
}

.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 600;
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}

.rank-1 {
  background: #ffd700;
  color: #7a5c00;
}

.rank-2 {
  background: #c0c4cc;
  color: #4a4a4a;
}

.rank-3 {
  background: #e6a23c;
  color: #fff;
}

.text-muted {
  color: var(--el-text-color-secondary);
}

.records-filter {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
