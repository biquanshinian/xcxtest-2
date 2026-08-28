<template>
  <div class="vault">
    <header class="vault-hud">
      <div class="vault-hud__corner vault-hud__corner--tl" />
      <div class="vault-hud__corner vault-hud__corner--tr" />
      <div class="vault-hud__corner vault-hud__corner--bl" />
      <div class="vault-hud__corner vault-hud__corner--br" />
      <div class="vault-hud__brand">
        <span class="vault-kicker">VAULT-01</span>
        <div class="vault-hud__titles">
          <h1 class="vault-hud__title">太空数据仓</h1>
          <span class="vault-hud__en">SPACE DATA VAULT</span>
        </div>
      </div>
      <div class="vault-hud__meta">
        <span class="vault-meta"><em>LOCAL</em>{{ clock }}</span>
        <span class="vault-meta"><em>CATALOG</em>{{ sortedCards.length }} MOD</span>
        <span class="vault-meta"><em>EVT</em>{{ stats.starshipEventUpdates }} / 30</span>
        <span class="vault-live" :class="{ 'is-warn': stats.starshipEventUpdates > 25 }">
          <i />{{ stats.starshipEventUpdates > 25 ? 'CAPACITY WARN' : 'LINK NOMINAL' }}
        </span>
      </div>
    </header>

    <section class="vault-panel">
      <div class="vault-panel__head">
        <span class="vault-kicker">MODULE CATALOG</span>
        <span class="vault-panel__sub">模块目录 · 拖拽排序 · 点击进入</span>
      </div>
      <div class="vault-grid">
        <div
          v-for="(item, idx) in sortedCards"
          :key="item.key"
          class="vault-mod"
          :class="[`vault-mod--${item.color}`, { 'is-dragging': dragKey === item.key, 'is-over': dragOverKey === item.key && dragKey !== item.key }]"
          draggable="true"
          @dragstart="onDragStart($event, item.key)"
          @dragover.prevent="onDragOver(item.key)"
          @dragenter.prevent
          @drop.prevent="onDrop(item.key)"
          @dragend="onDragEnd"
          @click="onCardClick(item)"
        >
          <div class="vault-mod__bar" />
          <div class="vault-mod__body">
            <div class="vault-mod__top">
              <span class="vault-mod__code">{{ item.code }}-{{ String(idx + 1).padStart(2, '0') }}</span>
              <span v-if="item.badge" class="vault-mod__badge" :class="{ 'is-off': item.badgeType === 'off' }">{{ item.badge }}</span>
            </div>
            <div class="vault-mod__label">{{ item.label }}</div>
            <div class="vault-mod__value">{{ item.value }}</div>
            <div class="vault-mod__hint">{{ item.hint }}</div>
          </div>
          <div class="vault-mod__arrow">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z"/></svg>
          </div>
        </div>
      </div>
    </section>

    <div class="vault-split">
      <section class="vault-panel vault-panel--feed">
        <div class="vault-panel__head">
          <span class="vault-kicker">TELEMETRY</span>
          <span class="vault-panel__sub">事件遥测</span>
          <span class="vault-panel__action" @click="$router.push('/starship-event-updates')">查看全部</span>
        </div>
        <div v-if="recentEvents.length === 0" class="vault-empty">暂无事件数据</div>
        <div v-else class="vault-feed">
          <div v-for="(evt, idx) in recentEvents" :key="idx" class="vault-feed__item">
            <div class="vault-feed__rail">
              <span class="vault-feed__dot" :class="{ 'is-live': idx === 0 }" />
            </div>
            <div class="vault-feed__body">
              <div class="vault-feed__title">{{ evt.title || '无标题' }}</div>
              <div class="vault-feed__meta">
                <span v-if="evt.author">{{ evt.author }}</span>
                <span>{{ formatTime(evt.publishedAt) }}</span>
              </div>
              <div v-if="evt.content" class="vault-feed__desc">{{ truncate(evt.content, 80) }}</div>
            </div>
          </div>
        </div>
      </section>

      <div class="vault-side">
        <section class="vault-panel">
          <div class="vault-panel__head">
            <span class="vault-kicker">SUBSYSTEMS</span>
            <span class="vault-panel__sub">子系统</span>
          </div>
          <div class="vault-sys">
            <div class="vault-sys__row">
              <i class="vault-sys__dot is-ok" />
              <span class="vault-sys__name">自动同步</span>
              <span class="vault-sys__val">运行中</span>
            </div>
            <div class="vault-sys__row">
              <i class="vault-sys__dot is-ok" />
              <span class="vault-sys__name">数据库</span>
              <span class="vault-sys__val">正常</span>
            </div>
            <div class="vault-sys__row">
              <i class="vault-sys__dot" :class="stats.starshipEventUpdates > 25 ? 'is-warn' : 'is-ok'" />
              <span class="vault-sys__name">事件容量</span>
              <span class="vault-sys__val">{{ stats.starshipEventUpdates }} / 30</span>
            </div>
            <div class="vault-sys__row">
              <i class="vault-sys__dot" :class="stats.splashEnabled ? 'is-ok' : 'is-off'" />
              <span class="vault-sys__name">开屏动画</span>
              <span class="vault-sys__val">{{ stats.splashEnabled ? '已开启' : '已关闭' }}</span>
            </div>
          </div>
        </section>

        <section class="vault-panel vault-panel--logs">
          <div class="vault-panel__head">
            <span class="vault-kicker">OPS LOG</span>
            <span class="vault-panel__sub">操作记录</span>
            <span class="vault-panel__action" @click="$router.push('/logs')">全部日志</span>
          </div>
          <div v-if="recentLogs.length === 0" class="vault-empty">暂无操作记录</div>
          <div v-else class="vault-log">
            <div v-for="(log, idx) in recentLogs" :key="idx" class="vault-log__row">
              <span class="vault-log__mod">{{ log.module || 'sys' }}</span>
              <span class="vault-log__act">{{ log.action || '-' }}</span>
              <span class="vault-log__who">{{ log.operatorName || '-' }}</span>
              <span class="vault-log__time">{{ formatTime(log.createdAt) }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../../api/client'

const router = useRouter()

const stats = reactive({
  events: 0, articles: 0, carousel: 0,
  shopFeed: 0, mediaAssets: 0, spaceDevsCache: 0,
  roadClosure: 0, starshipEventUpdates: 0,
  cosFileCount: 0, splashEnabled: false, splashCountdown: 0
})
const recentEvents = ref([])
const recentLogs = ref([])
const clock = ref('')

const CARD_DEFS = {
  starshipEventUpdates: { code: 'EVT', label: '事件更新追踪', hint: '自动同步 SpaceX / Starlink 推文', route: '/starship-event-updates', color: 'blue', badge: 'LIVE', statKey: 'starshipEventUpdates' },
  mediaAssets: { code: 'MED', label: '星舰建设进度', hint: '建设进度媒体素材库', route: '/starship-progress', color: 'cyan', statKey: 'mediaAssets' },
  carousel: { code: 'CAR', label: '轮播图', hint: '首页轮播图管理', route: '/carousel', color: 'purple', statKey: 'carousel' },
  roadClosure: { code: 'RD', label: '封路通知', hint: '博卡奇卡封路信息', route: '/road-closure', color: 'orange', statKey: 'roadClosure' },
  starshipStatus: { code: 'SS', label: '星舰状态', hint: '星舰发射准备状态总览', route: '/starship-status', color: 'red', fixedValue: '查看' },
  cosStorage: { code: 'COS', label: 'COS云存储', hint: 'COS 对象存储文件管理', route: '/cos-storage', color: 'teal', statKey: 'cosFileCount' },
  splashScreen: { code: 'SPL', label: '开屏动画', hint: '跳过倒计时随视频时长', route: '/splash-screen', color: 'pink', statKey: 'splashCountdown' },
  launchData: { code: 'LD', label: '发射数据', hint: '发射任务数据管理', route: '/launch-data', color: 'blue', statKey: 'spaceDevsCache' },
  tweetMonitor: { code: 'TW', label: '推文监控', hint: 'SpaceX推文同步监控', route: '/tweet-monitor', color: 'cyan', fixedValue: '查看' },
  pushNotify: { code: 'PSH', label: '推送通知', hint: '订阅消息与推送管理', route: '/push-notify', color: 'orange', fixedValue: '管理' },
  statistics: { code: 'ST', label: '数据统计', hint: '全局数据统计分析', route: '/statistics', color: 'green', fixedValue: '查看' }
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
      card.value = stats.splashEnabled ? '自动' : '—'
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

function tickClock() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  clock.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const load = async () => {
  try {
    const data = await api.dashboardOverview()
    Object.assign(stats, data.contentStats || {})
    recentEvents.value = data.recentEvents || []
    recentLogs.value = (data.recentLogs || []).slice(0, 8)
  } catch (e) {
    ElMessage.error('仪表盘加载失败: ' + (e.message || ''))
  }
}

let clockTimer = null
onMounted(() => {
  tickClock()
  clockTimer = setInterval(tickClock, 1000)
  load()
})
onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<style scoped>
.vault {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.vault-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #A78BFA;
  text-transform: uppercase;
}

.vault-hud {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  padding: 18px 20px 16px;
  background: rgba(10, 14, 26, 0.55);
  border: 1px solid rgba(139, 92, 246, 0.28);
  border-radius: 14px;
  box-shadow: 0 0 40px rgba(139, 92, 246, 0.08);
  overflow: hidden;
}

.vault-hud::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    180deg,
    transparent 0,
    transparent 3px,
    rgba(255, 255, 255, 0.012) 3px,
    rgba(255, 255, 255, 0.012) 4px
  );
}

.vault-hud__corner {
  position: absolute;
  width: 14px;
  height: 14px;
  pointer-events: none;
}
.vault-hud__corner--tl { top: 6px; left: 6px; border-top: 2px solid #8B5CF6; border-left: 2px solid #8B5CF6; border-top-left-radius: 4px; }
.vault-hud__corner--tr { top: 6px; right: 6px; border-top: 2px solid #8B5CF6; border-right: 2px solid #8B5CF6; border-top-right-radius: 4px; }
.vault-hud__corner--bl { bottom: 6px; left: 6px; border-bottom: 2px solid #8B5CF6; border-left: 2px solid #8B5CF6; border-bottom-left-radius: 4px; }
.vault-hud__corner--br { bottom: 6px; right: 6px; border-bottom: 2px solid #8B5CF6; border-right: 2px solid #8B5CF6; border-bottom-right-radius: 4px; }

.vault-hud__brand {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.vault-hud__titles {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.vault-hud__title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.94);
}

.vault-hud__en {
  font-size: 11px;
  letter-spacing: 1.6px;
  color: rgba(255, 255, 255, 0.35);
}

.vault-hud__meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 14px;
}

.vault-meta {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.78);
}
.vault-meta em {
  display: block;
  font-style: normal;
  font-size: 9px;
  letter-spacing: 1.4px;
  color: rgba(255, 255, 255, 0.35);
  margin-bottom: 2px;
}

.vault-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
  color: #34D399;
}
.vault-live i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34D399;
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.7);
  animation: vault-pulse 1.8s ease-in-out infinite;
}
.vault-live.is-warn { color: #FBBF24; }
.vault-live.is-warn i {
  background: #FBBF24;
  box-shadow: 0 0 8px rgba(251, 191, 36, 0.7);
}

@keyframes vault-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.vault-panel {
  background: rgba(10, 14, 26, 0.46);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  padding: 16px 18px 18px;
}

.vault-panel__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}

.vault-panel__sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.38);
}

.vault-panel__action {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  background: linear-gradient(135deg, #6366F1, #A855F7);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  cursor: pointer;
}

.vault-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.vault-mod {
  position: relative;
  display: flex;
  align-items: stretch;
  min-height: 118px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.vault-mod:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.14);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
}

.vault-mod.is-dragging {
  opacity: 0.4;
  transform: scale(0.97);
  box-shadow: none;
}

.vault-mod.is-over {
  border-color: #8B5CF6;
  box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.35);
}

.vault-mod__bar {
  width: 4px;
  flex-shrink: 0;
}

.vault-mod--blue .vault-mod__bar { background: linear-gradient(180deg, #007AFF, #0A84FF); }
.vault-mod--cyan .vault-mod__bar { background: linear-gradient(180deg, #32D7E0, #5AC8FA); }
.vault-mod--purple .vault-mod__bar { background: linear-gradient(180deg, #5856D6, #AF52DE); }
.vault-mod--green .vault-mod__bar { background: linear-gradient(180deg, #30D158, #34C759); }
.vault-mod--orange .vault-mod__bar { background: linear-gradient(180deg, #FF9F0A, #FF9500); }
.vault-mod--red .vault-mod__bar { background: linear-gradient(180deg, #FF453A, #FF6961); }
.vault-mod--teal .vault-mod__bar { background: linear-gradient(180deg, #64D2FF, #00C7BE); }
.vault-mod--pink .vault-mod__bar { background: linear-gradient(180deg, #FF6482, #FF2D55); }

.vault-mod__body {
  flex: 1;
  min-width: 0;
  padding: 12px 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vault-mod__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.vault-mod__code {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
  color: rgba(167, 139, 250, 0.85);
}

.vault-mod__badge {
  font-size: 10px;
  font-weight: 700;
  color: #30D158;
  background: rgba(48, 209, 88, 0.15);
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.4px;
}

.vault-mod__badge.is-off {
  color: #FF453A;
  background: rgba(255, 69, 58, 0.15);
}

.vault-mod__label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
}

.vault-mod__value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: 0.4px;
  font-variant-numeric: tabular-nums;
  background: linear-gradient(135deg, #fff 0%, #C4B5FD 60%, #A78BFA 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.vault-mod__hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.32);
  line-height: 1.35;
}

.vault-mod__arrow {
  display: flex;
  align-items: center;
  padding-right: 10px;
  color: rgba(255, 255, 255, 0.16);
}

.vault-mod:hover .vault-mod__arrow {
  color: rgba(255, 255, 255, 0.45);
}

.vault-split {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
  gap: 16px;
}

.vault-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.vault-empty {
  text-align: center;
  padding: 28px 8px;
  color: rgba(255, 255, 255, 0.28);
  font-size: 13px;
}

.vault-feed__item {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.vault-feed__item:last-child { border-bottom: none; }

.vault-feed__rail {
  padding-top: 5px;
}

.vault-feed__dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
}
.vault-feed__dot.is-live {
  background: #34D399;
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.55);
}

.vault-feed__title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vault-feed__meta {
  display: flex;
  gap: 10px;
  margin-top: 3px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.32);
}
.vault-feed__meta span:first-child { color: #34D399; }

.vault-feed__desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.4);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.vault-sys {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vault-sys__row {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  align-items: center;
  gap: 8px;
}

.vault-sys__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.vault-sys__dot.is-ok { background: #30D158; box-shadow: 0 0 6px rgba(48, 209, 88, 0.5); }
.vault-sys__dot.is-warn { background: #FF9F0A; box-shadow: 0 0 6px rgba(255, 159, 10, 0.5); }
.vault-sys__dot.is-off { background: rgba(255, 255, 255, 0.28); }

.vault-sys__name { font-size: 12px; color: rgba(255, 255, 255, 0.45); }
.vault-sys__val { font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.78); font-variant-numeric: tabular-nums; }

.vault-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vault-log__row {
  display: grid;
  grid-template-columns: 64px 1fr 72px 72px;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}

.vault-log__mod {
  color: #A78BFA;
  text-transform: lowercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vault-log__act {
  color: rgba(255, 255, 255, 0.72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vault-log__who,
.vault-log__time {
  color: rgba(255, 255, 255, 0.32);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 980px) {
  .vault-split { grid-template-columns: 1fr; }
  .vault-hud { flex-direction: column; align-items: flex-start; }
  .vault-hud__meta { justify-content: flex-start; }
}

@media (max-width: 768px) {
  .vault-grid { grid-template-columns: 1fr 1fr; }
  .vault-hud__title { font-size: 18px; }
  .vault-log__row { grid-template-columns: 56px 1fr 64px; }
  .vault-log__who { display: none; }
}

@media (max-width: 420px) {
  .vault-grid { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .vault-live i { animation: none; }
  .vault-mod { transition: none; }
}
</style>
