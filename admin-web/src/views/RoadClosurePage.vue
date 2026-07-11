<template>

  <div class="rc-page">

    <!-- 手动配置 -->

    <el-card style="margin-bottom: 20px">

      <template #header>

        <div style="display: flex; justify-content: space-between; align-items: center">

          <span>手动封路通知配置</span>

          <el-button type="warning" :loading="syncing" @click="onSync">从 API 同步</el-button>

        </div>

      </template>

      <el-form :model="form" label-width="120px" style="max-width: 720px">

        <el-form-item label="是否启用">

          <el-switch v-model="form.isActive" />

        </el-form-item>

        <el-form-item label="展示文案">

          <el-input v-model="form.message" type="textarea" :rows="3" />

        </el-form-item>

        <el-form-item label="时间区间文案">

          <el-input v-model="form.timeRange" />

        </el-form-item>

        <el-form-item label="优先级">

          <el-input-number v-model="form.priority" :min="0" :max="999" />

        </el-form-item>

        <el-form-item label="开始时间">

          <el-date-picker v-model="startDate" type="datetime" placeholder="选择开始时间" @change="onStartDateChange" />

        </el-form-item>

        <el-form-item label="结束时间">

          <el-date-picker v-model="endDate" type="datetime" placeholder="选择结束时间" @change="onEndDateChange" />

        </el-form-item>

        <el-form-item>

          <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>

        </el-form-item>

      </el-form>

    </el-card>



    <!-- API 自动同步数据 -->

    <el-card class="rc-sync-panel">

      <template #header>

        <div class="rc-sync-panel-head">

          <span>API 自动同步封路数据（{{ autoList.length }} 条）</span>

          <span class="rc-sync-panel-hint">卡片展示结构化字段，便于核对海滩 / 道路 / 市长令</span>

        </div>

      </template>



      <el-empty v-if="autoList.length === 0" description="暂无 API 同步数据，点击「从 API 同步」获取" />



      <div v-else class="rc-sync-list">

        <el-card

          v-for="row in autoList"

          :key="row._id"

          class="rc-record-card"

          shadow="never"

        >

          <!-- 卡片头 -->

          <div class="rc-record-header">

            <div class="rc-record-header-left">

              <div class="rc-record-tags">

                <el-tag :type="sourceTagType(row.source)" size="small" effect="dark" round>

                  {{ sourceLabel(row.source) }}

                </el-tag>

                <el-tag :type="row.isActive ? 'danger' : 'success'" size="small" effect="plain" round>

                  {{ row.isActive ? '封闭 / 管制中' : '已开放' }}

                </el-tag>

                <el-tag v-if="row.statusText" type="info" size="small" effect="plain" round>

                  {{ row.statusText }}

                </el-tag>

              </div>

              <div class="rc-record-meta">

                <span v-if="row.timeRange" class="rc-meta-item">

                  <span class="rc-meta-label">时间</span>

                  <span class="rc-meta-value rc-meta-multiline">{{ row.timeRange }}</span>

                </span>

                <span class="rc-meta-item">

                  <span class="rc-meta-label">同步</span>

                  <span class="rc-meta-value">{{ formatTime(row.syncedAt || row.updatedAt) }}</span>

                </span>

                <span v-if="row._id" class="rc-meta-item rc-meta-id">

                  <span class="rc-meta-label">ID</span>

                  <span class="rc-meta-value">{{ row._id }}</span>

                </span>

              </div>

            </div>

            <el-popconfirm title="确定删除此条同步记录？" @confirm="onDeleteItem(row._id)">

              <template #reference>

                <el-button type="danger" size="small" text>删除</el-button>

              </template>

            </el-popconfirm>

          </div>



          <template v-if="buildRecordView(row)">

            <template v-for="view in [buildRecordView(row)]" :key="view.id">

              <!-- 海滩 / 道路状态胶囊 -->

              <div v-if="view.showPills" class="rc-status-pills">

                <div

                  v-if="view.beachOpen !== null && view.beachOpen !== undefined"

                  class="rc-pill"

                  :class="view.beachOpen === false ? 'rc-pill--alert' : 'rc-pill--ok'"

                >

                  <span class="rc-pill-label">海滩</span>

                  <span class="rc-pill-value">{{ view.beachOpen === false ? '封闭' : '开放' }}</span>

                </div>

                <div

                  v-if="view.roadOpen !== null && view.roadOpen !== undefined"

                  class="rc-pill"

                  :class="view.roadOpen === false ? 'rc-pill--warn' : 'rc-pill--ok'"

                >

                  <span class="rc-pill-label">道路</span>

                  <span class="rc-pill-value">{{ view.roadOpen === false ? '管制' : '正常' }}</span>

                </div>

              </div>



              <!-- SpaceDevs 等无结构化字段时的主内容区 -->

              <div v-if="view.showSimpleBody" class="rc-simple-body">

                <p v-if="view.message" class="rc-simple-message">{{ view.message }}</p>

                <p v-if="view.statusText" class="rc-simple-line">

                  <span class="rc-simple-label">原始状态</span>{{ view.statusText }}

                </p>

                <p v-if="view.timeRange" class="rc-simple-line">

                  <span class="rc-simple-label">时间范围</span>{{ view.timeRange }}

                </p>

              </div>



              <!-- 结构化分区 -->

              <div v-else class="rc-sections">

                <div v-if="view.showBanner" class="rc-section">

                  <div class="rc-section-head">

                    <el-icon class="rc-section-icon"><Notification /></el-icon>

                    <span class="rc-section-title">滚动通知</span>

                    <el-tag size="small" type="warning" effect="plain" round>{{ view.bannerAlerts.length }}</el-tag>

                  </div>

                  <ul class="rc-bullet-list">

                    <li v-for="(alert, i) in view.bannerAlerts" :key="'b-' + i" class="rc-bullet-item">{{ alert }}</li>

                  </ul>

                </div>



                <div v-if="view.showBeach" class="rc-section">

                  <div class="rc-section-head">

                    <el-icon class="rc-section-icon"><Location /></el-icon>

                    <div class="rc-section-head-text">

                      <span class="rc-section-title">海滩封闭计划</span>

                      <span v-if="view.beachStatusText" class="rc-section-sub">{{ view.beachStatusText }}</span>

                    </div>

                  </div>

                  <ul v-if="view.beachSlots.length" class="rc-slot-list">

                    <li

                      v-for="(slot, i) in view.beachSlots"

                      :key="'s-' + i"

                      class="rc-slot-item"

                      :class="'rc-slot-item--' + slot.kind"

                    >

                      <el-tag size="small" :type="slot.kind === 'primary' ? 'danger' : slot.kind === 'backup' ? 'warning' : 'info'" effect="plain">

                        {{ slot.kindLabel }}

                      </el-tag>

                      <span class="rc-slot-time">{{ slot.timeText }}</span>

                    </li>

                  </ul>

                  <p v-else class="rc-section-empty">未列出具体封闭时段</p>

                </div>



                <div v-if="view.showRoad" class="rc-section">

                  <div class="rc-section-head">

                    <el-icon class="rc-section-icon"><Guide /></el-icon>

                    <div class="rc-section-head-text">

                      <span class="rc-section-title">道路更新</span>

                      <span v-if="view.roadStatusText" class="rc-section-sub">{{ view.roadStatusText }}</span>

                    </div>

                  </div>

                  <ul v-if="view.roadItems.length" class="rc-road-list">

                    <li v-for="(road, i) in view.roadItems" :key="'r-' + i" class="rc-road-item">

                      <span class="rc-road-desc">{{ road.description }}</span>

                      <span v-if="road.date" class="rc-road-date">{{ road.date }}</span>

                    </li>

                  </ul>

                  <p v-else class="rc-section-empty">无道路延迟明细</p>

                </div>



                <div v-if="view.showPublic" class="rc-section">

                  <div class="rc-section-head">

                    <el-icon class="rc-section-icon"><Document /></el-icon>

                    <span class="rc-section-title">市长令 / 公告</span>

                  </div>

                  <div v-for="(order, i) in view.publicOrders" :key="'o-' + i" class="rc-order-block">

                    <div class="rc-order-no">{{ order.orderNo }}</div>

                    <div v-if="order.bodyTextZh" class="rc-order-body">

                      <p
                        class="rc-order-body-text"
                        :class="{ 'rc-order-body-text--clamped': order.bodyLong && !isOrderBodyExpanded(view.id, i) }"
                      >{{ order.bodyTextZh }}</p>

                      <button
                        v-if="order.bodyLong"
                        type="button"
                        class="rc-order-body-toggle"
                        @click="toggleOrderBody(view.id, i)"
                      >{{ isOrderBodyExpanded(view.id, i) ? '收起' : '展开全文' }}</button>

                    </div>

                    <div v-if="order.primaryPeriod" class="rc-order-row">

                      <span class="rc-order-label">主要封闭期</span>

                      <span class="rc-order-value">{{ order.primaryPeriod }}</span>

                    </div>

                    <div v-if="order.alternateDates" class="rc-order-row">

                      <span class="rc-order-label">备选日期</span>

                      <span class="rc-order-value">{{ order.alternateDates }}</span>

                    </div>

                    <div v-if="order.revocation" class="rc-order-row">

                      <span class="rc-order-label">解除封闭</span>

                      <span class="rc-order-value">{{ order.revocation }}</span>

                    </div>

                  </div>

                </div>

              </div>



              <!-- 摘要文案：有结构化内容时折叠，避免与分区重复占屏 -->

              <el-collapse v-if="view.showSummary" class="rc-summary-collapse" accordion>

                <el-collapse-item :title="view.summaryTitle" name="summary">

                  <p class="rc-summary-text">{{ view.message }}</p>

                </el-collapse-item>

              </el-collapse>

            </template>

          </template>

        </el-card>

      </div>

    </el-card>

  </div>

</template>



<script setup>

import { onMounted, reactive, ref } from 'vue'

import { ElMessage } from 'element-plus'
import { Document, Guide, Location, Notification } from '@element-plus/icons-vue'

import { api } from '../api/client'
import { applyStarbaseI18n, resolveRoadStatusDisplay, translateMayorOrderBody } from '../utils/starbase-i18n.js'

const BODY_COLLAPSE_LEN = 120



const saving = ref(false)

const syncing = ref(false)

const orderBodyExpanded = ref({})

const autoList = ref([])

const startDate = ref(null)

const endDate = ref(null)



const form = reactive({

  isActive: false,

  message: '',

  timeRange: '',

  priority: 0,

  startAt: 0,

  endAt: 0

})



const SOURCE_LABELS = {

  starbase_gov: 'Starbase.gov',

  spacedevs: 'SpaceDevs',

  manual: '管理员'

}



function formatTime(ts) {

  if (!ts) return '-'

  const d = new Date(ts)

  return d.toLocaleString('zh-CN', { hour12: false })

}



function sourceLabel(source) {

  return SOURCE_LABELS[source] || source || '未知'

}



function sourceTagType(source) {

  if (source === 'spacedevs') return 'primary'

  if (source === 'starbase_gov') return 'success'

  return 'info'

}



function normalizeScheduleLine(line) {

  const s = String(line || '').trim()

  const m = s.match(/^(Primary|Backup|主要时段|备用时段)\s*:\s*(.+)$/i)

  if (m) {

    const kind = /backup|备用/i.test(m[1]) ? 'backup' : 'primary'

    return {

      kind,

      kindLabel: kind === 'primary' ? '主要时段' : '备用时段',

      timeText: m[2].trim()

    }

  }

  return { kind: 'slot', kindLabel: '时段', timeText: applyStarbaseI18n(s) }

}



function normalizeRoadItem(item) {

  if (item && typeof item === 'object') {

    return {

      description: applyStarbaseI18n(item.description || ''),

      date: item.date || ''

    }

  }

  const s = String(item || '').trim()

  const m = s.match(/^(.+?)\s*[（(](.+)[）)]$/)

  if (m) {

    return {

      description: applyStarbaseI18n(m[1].trim()),

      date: m[2].trim()

    }

  }

  return { description: applyStarbaseI18n(s), date: '' }

}



function normalizePublicOrder(o) {

  const bodyTextZh = o.bodyTextZh || translateMayorOrderBody(o.bodyText || '')

  return {

    orderNo: applyStarbaseI18n(o.orderNo || 'Mayor Order'),

    bodyTextZh,

    bodyLong: bodyTextZh.length > BODY_COLLAPSE_LEN,

    primaryPeriod: applyStarbaseI18n(o.primaryPeriod || ''),

    alternateDates: applyStarbaseI18n(o.alternateDates || ''),

    revocation: applyStarbaseI18n(o.revocation || '')

  }

}



function orderBodyKey(recordId, index) {

  return `${recordId}-${index}`

}



function isOrderBodyExpanded(recordId, index) {

  return !!orderBodyExpanded.value[orderBodyKey(recordId, index)]

}



function toggleOrderBody(recordId, index) {

  const key = orderBodyKey(recordId, index)

  orderBodyExpanded.value[key] = !orderBodyExpanded.value[key]

}



function buildRecordView(row) {

  if (!row) return null



  const beachSlots = (row.beachClosureSchedule || []).map(normalizeScheduleLine)

  const roadItems = (row.roadUpdates || []).map(normalizeRoadItem)

  const bannerAlerts = (row.bannerAlerts && row.bannerAlerts.length)

    ? row.bannerAlerts.map((a) => applyStarbaseI18n(a))

    : (row.roadDelays || []).map((a) => applyStarbaseI18n(a))



  const publicOrders = (row.publicOrders || []).map(normalizePublicOrder)

  if (!publicOrders.length && row.publicNotice) {

    const bodyTextZh = translateMayorOrderBody(row.publicNotice)

    publicOrders.push({

      orderNo: '市长令摘要',

      bodyTextZh,

      bodyLong: bodyTextZh.length > BODY_COLLAPSE_LEN,

      primaryPeriod: '',

      alternateDates: '',

      revocation: ''

    })

  }



  const hasStructured =

    beachSlots.length > 0 ||

    roadItems.length > 0 ||

    bannerAlerts.length > 0 ||

    publicOrders.length > 0



  const showBeach =

    beachSlots.length > 0 || row.beachOpen === false || !!row.beachStatus

  const showRoad =

    roadItems.length > 0 || row.roadOpen === false || !!row.roadStatusLabel

  const showBanner = bannerAlerts.length > 0

  const showPublic = publicOrders.length > 0

  const showPills =

    (row.beachOpen !== null && row.beachOpen !== undefined) ||

    (row.roadOpen !== null && row.roadOpen !== undefined)



  const message = (row.message || '').trim()

  const showSimpleBody =
    !hasStructured &&
    !showBeach &&
    !showRoad &&
    !showBanner &&
    !showPublic &&
    !!(message || row.statusText || row.timeRange)

  const showSummary = !!message && hasStructured



  return {

    id: row._id,

    message,

    statusText: row.statusText || '',

    timeRange: row.timeRange || '',

    beachOpen: row.beachOpen,

    roadOpen: row.roadOpen,

    beachStatusText: applyStarbaseI18n(row.beachStatus || ''),

    roadStatusText: resolveRoadStatusDisplay(row),

    beachSlots,

    roadItems,

    bannerAlerts,

    publicOrders,

    showBeach,

    showRoad,

    showBanner,

    showPublic,

    showPills,

    hasStructured,

    showSimpleBody,

    showSummary,

    summaryTitle: hasStructured ? '查看合并摘要文案' : '通知摘要'

  }

}



function onStartDateChange(val) {

  form.startAt = val ? new Date(val).getTime() : 0

}



function onEndDateChange(val) {

  form.endAt = val ? new Date(val).getTime() : 0

}



const load = async () => {

  try {

    const data = await api.getRoadClosure()

    if (data && data.manual) {

      Object.assign(form, data.manual)

      if (data.manual.startAt) startDate.value = new Date(data.manual.startAt)

      if (data.manual.endAt) endDate.value = new Date(data.manual.endAt)

    }

    autoList.value = data?.autoSynced || []

  } catch (e) {

    ElMessage.error('加载失败: ' + (e.message || ''))

  }

}



const onSave = async () => {

  saving.value = true

  try {

    await api.updateRoadClosure(form)

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

    const res = await api.syncRoadClosure()

    const r = res?.result || res

    const sg = r?.starbaseGov

    if (r?.partial) {

      ElMessage.warning(`Starbase 已同步（${r.merged || 0} 条），SpaceDevs 辅助源失败：${r.spacedevs?.error || '未知'}`)

    } else if (sg && sg.success === false) {

      ElMessage.warning(`同步完成，但 Starbase.gov 抓取失败：${sg.error || '未知错误'}`)

    } else if ((r?.merged || 0) === 0) {

      ElMessage.warning('同步完成，但未写入新数据，请检查云函数环境变量 STARBASE_FETCH_PROXY_*')

    } else {

      const via = sg?.fetchVia ? `（${sg.fetchVia}）` : ''

      ElMessage.success(`同步完成，已合并 ${r.merged} 条${via}`)

    }

    await load()

  } catch (e) {

    const detail = e?.data?.error || e?.response?.data?.data?.error || ''

    const hint = e?.data?.hint || ''

    const combined = `${e.message || ''} ${detail} ${hint}`

    const isTimeout = /ESOCKETTIMEDOUT|timeout|timed out|超时/i.test(combined)

    if (isTimeout) {

      ElMessage.error({

        message: `${e.message || '同步超时'}。请确认云函数 adminGateway 与 syncSpaceDevsData 已重新部署，且微信控制台超时设置 ≥60 秒。${hint || detail ? ` ${hint || detail}` : ''}`,

        duration: 9000,

        showClose: true

      })

    } else {

      ElMessage.error(detail ? `${e.message || '同步失败'}：${detail}` : (e.message || '同步失败'))

    }

  } finally {

    syncing.value = false

  }

}



const onDeleteItem = async (id) => {

  try {

    await api.deleteRoadClosureItem(id)

    ElMessage.success('删除成功')

    await load()

  } catch (e) {

    ElMessage.error(e.message || '删除失败')

  }

}



onMounted(load)

</script>



<style scoped>

.rc-page {

  display: block;

}



.rc-sync-panel-head {

  display: flex;

  flex-wrap: wrap;

  align-items: baseline;

  gap: 12px;

}



.rc-sync-panel-hint {

  font-size: 12px;

  color: var(--t-text-muted, rgba(255, 255, 255, 0.5));

  font-weight: 400;

}



.rc-sync-list {

  display: flex;

  flex-direction: column;

  gap: 14px;

}



.rc-record-card {

  border: 1px solid var(--t-border, rgba(255, 255, 255, 0.08));

  background: var(--t-bg-card, rgba(0, 0, 0, 0.28));

  border-radius: 12px;

}



.rc-record-card :deep(.el-card__body) {

  padding: 16px 18px;

}



.rc-record-header {

  display: flex;

  justify-content: space-between;

  align-items: flex-start;

  gap: 12px;

  margin-bottom: 14px;

  padding-bottom: 12px;

  border-bottom: 1px solid var(--t-border, rgba(255, 255, 255, 0.06));

}



.rc-record-header-left {

  flex: 1;

  min-width: 0;

}



.rc-record-tags {

  display: flex;

  flex-wrap: wrap;

  gap: 6px;

  margin-bottom: 8px;

}



.rc-record-meta {

  display: flex;

  flex-wrap: wrap;

  gap: 10px 18px;

  font-size: 12px;

}



.rc-meta-item {

  display: flex;

  flex-direction: column;

  gap: 2px;

  min-width: 0;

}



.rc-meta-label {

  color: var(--t-text-muted, rgba(255, 255, 255, 0.45));

  font-size: 11px;

}



.rc-meta-value {

  color: var(--t-text-secondary, rgba(255, 255, 255, 0.75));

  word-break: break-word;

  line-height: 1.45;

}



.rc-meta-multiline {

  white-space: pre-wrap;

  max-width: 520px;

}



.rc-meta-id .rc-meta-value {

  font-family: ui-monospace, monospace;

  font-size: 11px;

  color: var(--t-text-placeholder, rgba(255, 255, 255, 0.35));

}



.rc-status-pills {

  display: flex;

  flex-wrap: wrap;

  gap: 10px;

  margin-bottom: 14px;

}



.rc-pill {

  display: inline-flex;

  align-items: center;

  gap: 8px;

  padding: 6px 14px;

  border-radius: 999px;

  border: 1px solid var(--t-border, rgba(255, 255, 255, 0.1));

  background: rgba(255, 255, 255, 0.04);

}



.rc-pill-label {

  font-size: 11px;

  color: var(--t-text-muted, rgba(255, 255, 255, 0.5));

}



.rc-pill-value {

  font-size: 13px;

  font-weight: 600;

  color: var(--t-text-primary, #fff);

}



.rc-pill--ok {

  border-color: rgba(52, 199, 89, 0.35);

  background: rgba(52, 199, 89, 0.1);

}



.rc-pill--alert {

  border-color: rgba(255, 69, 58, 0.4);

  background: rgba(255, 69, 58, 0.12);

}



.rc-pill--warn {

  border-color: rgba(255, 159, 10, 0.4);

  background: rgba(255, 159, 10, 0.12);

}



.rc-simple-body {

  padding: 12px 14px;

  border-radius: 10px;

  background: rgba(255, 255, 255, 0.03);

  border: 1px solid var(--t-border, rgba(255, 255, 255, 0.06));

}



.rc-simple-message {

  margin: 0 0 10px;

  font-size: 14px;

  line-height: 1.55;

  color: var(--t-text-regular, rgba(255, 255, 255, 0.88));

  white-space: pre-wrap;

  word-break: break-word;

}



.rc-simple-line {

  margin: 6px 0 0;

  font-size: 13px;

  line-height: 1.5;

  color: var(--t-text-secondary, rgba(255, 255, 255, 0.7));

  white-space: pre-wrap;

  word-break: break-word;

}



.rc-simple-label {

  display: inline-block;

  min-width: 72px;

  margin-right: 8px;

  color: var(--t-text-muted, rgba(255, 255, 255, 0.45));

}



.rc-sections {

  display: flex;

  flex-direction: column;

  gap: 12px;

}



.rc-section {

  padding: 12px 14px;

  border-radius: 10px;

  background: rgba(255, 255, 255, 0.02);

  border: 1px solid var(--t-border, rgba(255, 255, 255, 0.06));

}



.rc-section-head {

  display: flex;

  align-items: center;

  flex-wrap: wrap;

  gap: 8px;

  margin-bottom: 10px;

}



.rc-section-head-text {

  display: flex;

  flex-direction: column;

  gap: 2px;

  flex: 1;

  min-width: 0;

}



.rc-section-icon {

  font-size: 16px;

  line-height: 1;

  color: #c8c8ce;

  flex-shrink: 0;

}



.rc-section-title {

  font-size: 13px;

  font-weight: 600;

  color: var(--t-text-primary, #fff);

}



.rc-section-sub {

  font-size: 12px;

  color: var(--t-text-muted, rgba(255, 255, 255, 0.5));

  line-height: 1.4;

}



.rc-section-empty {

  margin: 0;

  font-size: 12px;

  color: var(--t-text-placeholder, rgba(255, 255, 255, 0.35));

}



.rc-bullet-list,

.rc-slot-list,

.rc-road-list {

  margin: 0;

  padding: 0;

  list-style: none;

}



.rc-bullet-item {

  position: relative;

  padding: 6px 0 6px 14px;

  font-size: 13px;

  line-height: 1.5;

  color: var(--t-text-regular, rgba(255, 255, 255, 0.85));

  word-break: break-word;

  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

}



.rc-bullet-item:last-child {

  border-bottom: none;

}



.rc-bullet-item::before {

  content: '';

  position: absolute;

  left: 0;

  top: 12px;

  width: 5px;

  height: 5px;

  border-radius: 50%;

  background: rgba(255, 159, 10, 0.85);

}



.rc-slot-item {

  display: flex;

  align-items: flex-start;

  gap: 10px;

  padding: 8px 0;

  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

}



.rc-slot-item:last-child {

  border-bottom: none;

}



.rc-slot-time {

  flex: 1;

  font-size: 13px;

  line-height: 1.5;

  color: var(--t-text-regular, rgba(255, 255, 255, 0.88));

  white-space: pre-wrap;

  word-break: break-word;

}



.rc-road-item {

  display: flex;

  flex-direction: column;

  gap: 4px;

  padding: 8px 0;

  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

}



.rc-road-item:last-child {

  border-bottom: none;

}



.rc-road-desc {

  font-size: 13px;

  line-height: 1.5;

  color: var(--t-text-regular, rgba(255, 255, 255, 0.88));

  word-break: break-word;

}



.rc-road-date {

  font-size: 12px;

  color: var(--t-text-muted, rgba(255, 255, 255, 0.5));

}



.rc-order-block + .rc-order-block {

  margin-top: 12px;

  padding-top: 12px;

  border-top: 1px dashed rgba(255, 255, 255, 0.08);

}



.rc-order-no {

  font-size: 12px;

  font-weight: 600;

  color: var(--t-text-secondary, rgba(255, 255, 255, 0.7));

  margin-bottom: 8px;

}



.rc-order-body {

  margin-bottom: 8px;

}



.rc-order-body-text {

  margin: 0;

  font-size: 12px;

  line-height: 1.65;

  color: var(--t-text-secondary, rgba(255, 255, 255, 0.75));

  white-space: pre-wrap;

}



.rc-order-body-text--clamped {

  display: -webkit-box;

  -webkit-box-orient: vertical;

  -webkit-line-clamp: 4;

  overflow: hidden;

}



.rc-order-body-toggle {

  margin-top: 6px;

  padding: 0;

  border: none;

  background: none;

  font-size: 12px;

  color: #4ea1ff;

  cursor: pointer;

}



.rc-order-row {

  display: grid;

  grid-template-columns: 88px 1fr;

  gap: 8px 12px;

  margin-top: 6px;

  font-size: 12px;

  line-height: 1.5;

}



.rc-order-label {

  color: var(--t-text-muted, rgba(255, 255, 255, 0.45));

}



.rc-order-value {

  color: var(--t-text-regular, rgba(255, 255, 255, 0.85));

  white-space: pre-wrap;

  word-break: break-word;

}



.rc-summary-collapse {

  margin-top: 12px;

  border: none;

  background: transparent;

}



.rc-summary-collapse :deep(.el-collapse-item__header) {

  height: 36px;

  line-height: 36px;

  font-size: 12px;

  color: var(--t-text-muted, rgba(255, 255, 255, 0.5));

  background: transparent;

  border: none;

}



.rc-summary-collapse :deep(.el-collapse-item__wrap) {

  background: transparent;

  border: none;

}



.rc-summary-collapse :deep(.el-collapse-item__content) {

  padding-bottom: 4px;

}



.rc-summary-text {

  margin: 0;

  font-size: 12px;

  line-height: 1.55;

  color: var(--t-text-secondary, rgba(255, 255, 255, 0.65));

  white-space: pre-wrap;

  word-break: break-word;

}

</style>

