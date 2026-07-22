<template>
  <div class="dash">
    <!-- 核心模块卡片 -->
    <div class="dash-grid">
      <div
        v-for="item in sortedCards"
        :key="item.key"
        class="dash-card"
        :class="[`dash-card--${item.color}`, { 'dash-card--dragging': dragKey === item.key, 'dash-card--over': dragOverKey === item.key && dragKey !== item.key }]"
        draggable="true"
        @dragstart="onDragStart($event, item.key)"
        @dragover.prevent="onDragOver(item.key)"
        @dragenter.prevent
        @drop.prevent="onDrop(item.key)"
        @dragend="onDragEnd"
        @click="onCardClick(item)"
      >
        <div class="dash-card__bar" />
        <div class="dash-card__body">
          <div class="dash-card__header">
            <span class="dash-card__label">{{ item.label }}</span>
            <span class="dash-card__badge" :class="{ 'dash-card__badge--off': item.badgeType === 'off' }" v-if="item.badge">{{ item.badge }}</span>
          </div>
          <div class="dash-card__value">{{ item.value }}</div>
          <div class="dash-card__hint">{{ item.hint }}</div>
        </div>
        <div class="dash-card__arrow">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z"/></svg>
        </div>
      </div>
    </div>

    <!-- 最近事件动态 -->
    <div class="dash-section">
      <div class="dash-section__header">
        <span class="dash-section__title">最近事件动态</span>
        <span class="dash-section__action" @click="$router.push('/starship-event-updates')">查看全部</span>
      </div>
      <div v-if="recentEvents.length === 0" class="dash-empty">暂无事件数据</div>
      <div v-else class="dash-timeline">
        <div v-for="(evt, idx) in recentEvents" :key="idx" class="dash-timeline__item">
          <div class="dash-timeline__dot" />
          <div class="dash-timeline__content">
            <div class="dash-timeline__title">{{ evt.title || '无标题' }}</div>
            <div class="dash-timeline__meta">
              <span v-if="evt.author" class="dash-timeline__author">{{ evt.author }}</span>
              <span class="dash-timeline__time">{{ formatTime(evt.publishedAt) }}</span>
            </div>
            <div v-if="evt.content" class="dash-timeline__desc">{{ truncate(evt.content, 80) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 系统状态 -->
    <div class="dash-section">
      <div class="dash-section__header">
        <span class="dash-section__title">系统状态</span>
      </div>
      <div class="dash-status-grid">
        <div class="dash-status-item">
          <div class="dash-status-dot dash-status-dot--ok" />
          <span class="dash-status-label">自动同步</span>
          <span class="dash-status-value">运行中</span>
        </div>
        <div class="dash-status-item">
          <div class="dash-status-dot dash-status-dot--ok" />
          <span class="dash-status-label">数据库</span>
          <span class="dash-status-value">正常</span>
        </div>
        <div class="dash-status-item">
          <div class="dash-status-dot" :class="stats.starshipEventUpdates > 25 ? 'dash-status-dot--warn' : 'dash-status-dot--ok'" />
          <span class="dash-status-label">事件容量</span>
          <span class="dash-status-value">{{ stats.starshipEventUpdates }} / 30</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const router = useRouter()

const stats = reactive({
  events: 0, articles: 0, carousel: 0,
  shopFeed: 0, mediaAssets: 0, spaceDevsCache: 0,
  roadClosure: 0, starshipEventUpdates: 0,
  cosFileCount: 0, splashEnabled: false, splashCountdown: 0
})
const recentEvents = ref([])

const CARD_DEFS = {
  starshipEventUpdates: { label: '事件更新追踪', hint: '自动同步 SpaceX / Starlink 推文', route: '/starship-event-updates', color: 'blue', badge: 'LIVE', statKey: 'starshipEventUpdates' },
  mediaAssets: { label: '星舰建设进度', hint: '建设进度媒体素材库', route: '/starship-progress', color: 'cyan', statKey: 'mediaAssets' },
  carousel: { label: '轮播图', hint: '首页轮播图管理', route: '/carousel', color: 'purple', statKey: 'carousel' },
  roadClosure: { label: '封路通知', hint: '博卡奇卡封路信息', route: '/road-closure', color: 'orange', statKey: 'roadClosure' },
  starshipStatus: { label: '星舰状态', hint: '星舰发射准备状态总览', route: '/starship-status', color: 'red', fixedValue: '查看' },
  cosStorage: { label: 'COS云存储', hint: 'COS 对象存储文件管理', route: '/cos-storage', color: 'teal', statKey: 'cosFileCount' },
  splashScreen: { label: '开屏动画', hint: '开屏动画配置管理', route: '/splash-screen', color: 'pink', statKey: 'splashCountdown' },
  launchData: { label: '发射数据', hint: '发射任务数据管理', route: '/launch-data', color: 'blue', statKey: 'spaceDevsCache' },
  tweetMonitor: { label: '推文监控', hint: 'SpaceX推文同步监控', route: '/tweet-monitor', color: 'cyan', fixedValue: '查看' },
  pushNotify: { label: '推送通知', hint: '订阅消息与推送管理', route: '/push-notify', color: 'orange', fixedValue: '管理' },
  statistics: { label: '数据统计', hint: '全局数据统计分析', route: '/statistics', color: 'green', fixedValue: '查看' }
}

const DEFAULT_ORDER = ['starshipEventUpdates', 'mediaAssets', 'carousel', 'roadClosure', 'starshipStatus', 'cosStorage', 'splashScreen', 'launchData', 'tweetMonitor', 'pushNotify', 'statistics']
const STORAGE_KEY = 'dash_card_order'

function loadOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (Array.isArray(saved) && saved.every(k => CARD_DEFS[k])) {
      const missing = DEFAULT_ORDER.filter(k => !saved.includes(k))
      if (missing.length === 0 && saved.length === DEFAULT_ORDER.length) return saved
      return [...saved.filter(k => CARD_DEFS[k]), ...missing]
    }
  } catch {}
  return [...DEFAULT_ORDER]
}

function saveOrder(order) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
}

const cardOrder = ref(loadOrder())

const sortedCards = computed(() =>
  cardOrder.value.map(key => {
    const def = CARD_DEFS[key]
    const card = { key, ...def, value: def.fixedValue ?? stats[def.statKey] ?? 0 }
    if (key === 'splashScreen') {
      card.value = stats.splashCountdown ? stats.splashCountdown + 's' : '—'
      card.badge = stats.splashEnabled ? '已开启' : '已关闭'
      card.badgeType = stats.splashEnabled ? 'on' : 'off'
    }
    return card
  })
)

const dragKey = ref(null)
const dragOverKey = ref(null)
let didDrag = false

function onDragStart(e, key) {
  dragKey.value = key
  didDrag = false
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', key)
}

function onDragOver(key) {
  if (dragKey.value && dragKey.value !== key) {
    dragOverKey.value = key
    didDrag = true
  }
}

function onDrop(targetKey) {
  if (!dragKey.value || dragKey.value === targetKey) return
  const order = [...cardOrder.value]
  const fromIdx = order.indexOf(dragKey.value)
  const toIdx = order.indexOf(targetKey)
  if (fromIdx < 0 || toIdx < 0) return
  order.splice(fromIdx, 1)
  order.splice(toIdx, 0, dragKey.value)
  cardOrder.value = order
  saveOrder(order)
  dragOverKey.value = null
}

function onDragEnd() {
  dragKey.value = null
  dragOverKey.value = null
}

function onCardClick(item) {
  if (didDrag) { didDrag = false; return }
  router.push(item.route)
}

const formatTime = (ts) => {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const truncate = (text, len) => {
  if (!text) return ''
  return text.length > len ? text.substring(0, len) + '…' : text
}

const load = async () => {
  try {
    const data = await api.dashboardOverview()
    Object.assign(stats, data.contentStats || {})
    recentEvents.value = data.recentEvents || []
  } catch (e) {
    ElMessage.error('仪表盘加载失败: ' + (e.message || ''))
  }
}

onMounted(load)
</script>

<style scoped>
/* ===== Layout ===== */
.dash {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ===== Core Cards Grid ===== */
.dash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.dash-card {
  position: relative;
  display: flex;
  align-items: stretch;
  background: rgba(20, 24, 32, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.25s ease;
  backdrop-filter: blur(12px);
}

.dash-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.dash-card--dragging {
  opacity: 0.4;
  transform: scale(0.97);
  box-shadow: none !important;
}

.dash-card--over {
  border-color: #8B5CF6 !important;
  box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.35), 0 8px 28px rgba(139, 92, 246, 0.25) !important;
  transform: translateY(-2px);
}

/* color bar on left */
.dash-card__bar {
  width: 4px;
  flex-shrink: 0;
  border-radius: 4px 0 0 4px;
}

.dash-card--blue .dash-card__bar { background: linear-gradient(180deg, #007AFF, #0A84FF); }
.dash-card--blue:hover { border-color: rgba(0, 122, 255, 0.3); box-shadow: 0 8px 32px rgba(0, 122, 255, 0.12); }

.dash-card--cyan .dash-card__bar { background: linear-gradient(180deg, #32D7E0, #5AC8FA); }
.dash-card--cyan:hover { border-color: rgba(90, 200, 250, 0.3); box-shadow: 0 8px 32px rgba(90, 200, 250, 0.1); }

.dash-card--purple .dash-card__bar { background: linear-gradient(180deg, #5856D6, #AF52DE); }
.dash-card--purple:hover { border-color: rgba(88, 86, 214, 0.3); box-shadow: 0 8px 32px rgba(88, 86, 214, 0.1); }

.dash-card--green .dash-card__bar { background: linear-gradient(180deg, #30D158, #34C759); }
.dash-card--green:hover { border-color: rgba(52, 199, 89, 0.3); box-shadow: 0 8px 32px rgba(52, 199, 89, 0.1); }

.dash-card--orange .dash-card__bar { background: linear-gradient(180deg, #FF9F0A, #FF9500); }
.dash-card--orange:hover { border-color: rgba(255, 149, 0, 0.3); box-shadow: 0 8px 32px rgba(255, 149, 0, 0.1); }

.dash-card--red .dash-card__bar { background: linear-gradient(180deg, #FF453A, #FF6961); }
.dash-card--red:hover { border-color: rgba(255, 69, 58, 0.3); box-shadow: 0 8px 32px rgba(255, 69, 58, 0.1); }

.dash-card--teal .dash-card__bar { background: linear-gradient(180deg, #64D2FF, #00C7BE); }
.dash-card--teal:hover { border-color: rgba(0, 199, 190, 0.3); box-shadow: 0 8px 32px rgba(0, 199, 190, 0.1); }

.dash-card--pink .dash-card__bar { background: linear-gradient(180deg, #FF6482, #FF2D55); }
.dash-card--pink:hover { border-color: rgba(255, 45, 85, 0.3); box-shadow: 0 8px 32px rgba(255, 45, 85, 0.1); }

.dash-card__body {
  flex: 1;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dash-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dash-card__label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.dash-card__badge {
  font-size: 10px;
  font-weight: 600;
  color: #30D158;
  background: rgba(48, 209, 88, 0.15);
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.5px;
  animation: pulse-badge 2s ease-in-out infinite;
}

.dash-card__badge--off {
  color: #FF453A;
  background: rgba(255, 69, 58, 0.15);
  animation: none;
}

@keyframes pulse-badge {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.dash-card__value {
  font-size: 36px;
  font-weight: 700;
  background: linear-gradient(135deg, #FFFFFF 0%, #C4B5FD 60%, #A78BFA 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  letter-spacing: 0.5px;
  filter: drop-shadow(0 0 12px rgba(139, 92, 246, 0.25));
}

.dash-card__hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  line-height: 1.4;
}

.dash-card__arrow {
  display: flex;
  align-items: center;
  padding-right: 14px;
  color: rgba(255, 255, 255, 0.15);
  transition: color 0.2s;
}

.dash-card:hover .dash-card__arrow {
  color: rgba(255, 255, 255, 0.4);
}

/* ===== Section ===== */
.dash-section {
  background: rgba(20, 24, 32, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 14px;
  padding: 20px;
  backdrop-filter: blur(8px);
}

.dash-section__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.dash-section__title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 0.5px;
}

.dash-section__action {
  font-size: 12px;
  background: linear-gradient(135deg, #6366F1, #A855F7);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.dash-section__action:hover {
  opacity: 0.8;
}

.dash-empty {
  text-align: center;
  padding: 24px;
  color: rgba(255, 255, 255, 0.25);
  font-size: 13px;
}

/* ===== Timeline ===== */
.dash-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.dash-timeline__item {
  display: flex;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  position: relative;
}

.dash-timeline__item:last-child {
  border-bottom: none;
}

.dash-timeline__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10B981, #34D399);
  flex-shrink: 0;
  margin-top: 5px;
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.55);
  animation: dash-pulse-green 2.4s ease-in-out infinite;
}

@keyframes dash-pulse-green {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
  50%      { box-shadow: 0 0 0 12px rgba(16, 185, 129, 0); }
}

.dash-timeline__item:not(:first-child) .dash-timeline__dot {
  background: rgba(255, 255, 255, 0.2);
  box-shadow: none;
}

.dash-timeline__content {
  flex: 1;
  min-width: 0;
}

.dash-timeline__title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dash-timeline__meta {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.dash-timeline__author {
  font-size: 11px;
  color: rgba(16, 185, 129, 0.95);
}

.dash-timeline__time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
}

.dash-timeline__desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 4px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ===== Status Grid ===== */
.dash-status-grid {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.dash-status-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dash-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dash-status-dot--ok {
  background: #30D158;
  box-shadow: 0 0 6px rgba(48, 209, 88, 0.5);
}

.dash-status-dot--warn {
  background: #FF9F0A;
  box-shadow: 0 0 6px rgba(255, 159, 10, 0.5);
  animation: pulse-badge 1.5s ease-in-out infinite;
}

.dash-status-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.dash-status-value {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 768px) {
  .dash-grid {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .dash-section {
    padding: 14px;
  }

  .dash-section__title {
    font-size: 13px;
  }

  .dash-timeline__item {
    padding: 10px 0;
  }

  .dash-timeline__title {
    font-size: 13px;
  }

  .dash-timeline__desc {
    font-size: 12px;
  }
}

@media (max-width: 420px) {
  .dash-grid {
    grid-template-columns: 1fr;
  }
}
</style>
