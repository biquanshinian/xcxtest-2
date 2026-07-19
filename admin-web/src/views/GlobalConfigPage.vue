<template>
  <div class="global-config">
    <div class="page-header">
      <div>
        <div class="page-title">全局配置中心</div>
        <div class="page-subtitle">统一管理首页功能开关、小程序基本信息与「在线客服」文案</div>
      </div>
      <el-button type="primary" :loading="saving" size="large" @click="onSave">保存配置</el-button>
    </div>

    <el-card class="audit-card" shadow="never">
      <div class="audit-row">
        <div class="audit-info">
          <div class="audit-title">
            <el-tag type="warning" effect="dark" round size="small">送审</el-tag>
            <span class="audit-name">一键过审总开关</span>
          </div>
          <div class="audit-desc">
            开启后将一次性关闭：<b>轮播图、开屏动画、事件更新视频（含全站播放页/世界杯视频/背景视频）、直播功能、AI 太空助手（星问）、月愿计划、每日太空简报、直播观看、贴图讨论区</b>，便于版本送审。关闭后会恢复推荐默认值，并自动保存。
          </div>
        </div>
        <div class="audit-switch">
          <el-switch
            v-model="auditModeView"
            size="large"
            inline-prompt
            active-text="过审"
            inactive-text="正常"
            :before-change="handleAuditChange"
          />
        </div>
      </div>
    </el-card>

    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header">
          <span class="section-title">功能开关</span>
          <span class="section-hint">控制小程序前端各模块是否可见</span>
        </div>
      </template>

      <el-row :gutter="24">
        <el-col v-for="item in featureSwitches" :key="item.field" :xs="24" :sm="12">
          <div class="switch-row">
            <div class="switch-label">
              <div class="switch-name">{{ item.label }}</div>
              <div v-if="item.desc" class="switch-desc">{{ item.desc }}</div>
            </div>
            <el-switch v-model="form[item.field]" />
          </div>
        </el-col>
      </el-row>
    </el-card>

    <el-card class="section-card" shadow="never">
      <template #header>
        <div class="section-header">
          <span class="section-title">会员策略与流量</span>
          <span class="section-hint">非会员免费额度、列表门控与 COS 流量降级；与「会员系统」总开关独立</span>
        </div>
      </template>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom:16px;"
        title="省流 / 紧急档会强制：非会员只封面、开屏与轮播禁视频。紧急档额外关闭非 Pro 轨道卡背景视频。单项开关在「正常」档下才完全生效。"
      />

      <el-form :model="form" label-width="160px" label-position="right" style="max-width:720px;">
        <el-form-item label="媒体流量档位">
          <el-select v-model="form.mediaTrafficMode" style="width:220px;">
            <el-option label="正常" value="normal" />
            <el-option label="省流" value="save" />
            <el-option label="紧急" value="emergency" />
          </el-select>
        </el-form-item>
        <el-form-item label="任务列表免费条数">
          <el-input-number v-model="form.freeMissionListLimit" :min="1" :max="200" />
          <el-text type="info" style="margin-left:12px">非会员首页即将/历史发射各可见条数</el-text>
        </el-form-item>
        <el-form-item label="事件列表免费条数">
          <el-input-number v-model="form.freeEventListLimit" :min="1" :max="100" />
          <el-text type="info" style="margin-left:12px">事件更新「查看更多」首屏免费条数</el-text>
        </el-form-item>
        <el-form-item label="AI 星问每日次数">
          <el-input-number v-model="form.freeAiChatDaily" :min="0" :max="200" />
          <el-text type="info" style="margin-left:12px">会员系统开启时的非 Pro 额度</el-text>
        </el-form-item>
        <el-form-item label="AI 识图每日次数">
          <el-input-number v-model="form.freeAiImageDaily" :min="0" :max="50" />
        </el-form-item>
        <el-form-item label="广告解锁时长(分)">
          <el-input-number v-model="form.adUnlockMinutes" :min="1" :max="1440" />
        </el-form-item>
        <el-form-item label="任务列表门控">
          <el-switch v-model="form.enableMissionListGate" />
          <el-text type="info" style="margin-left:12px">关闭则非会员也可完整浏览任务列表</el-text>
        </el-form-item>
        <el-form-item label="事件列表门控">
          <el-switch v-model="form.enableEventListGate" />
          <el-text type="info" style="margin-left:12px">关闭则非会员可完整翻页事件更新</el-text>
        </el-form-item>
        <el-form-item label="非会员强制视频封面">
          <el-switch v-model="form.forceNonMemberVideoPoster" />
          <el-text type="info" style="margin-left:12px">开启后非会员不预拉可播地址，点击先门控</el-text>
        </el-form-item>
        <el-form-item label="非会员开屏可播视频">
          <el-switch v-model="form.splashAllowVideoForNonMember" />
          <el-text type="info" style="margin-left:12px">默认关；与强制封面同时开时仍以强制封面为准</el-text>
        </el-form-item>
        <el-form-item label="非会员轮播可播视频">
          <el-switch v-model="form.carouselAllowVideoForNonMember" />
          <el-text type="info" style="margin-left:12px">默认关；允许自动播/预拉需同时关闭「强制封面」</el-text>
        </el-form-item>
      </el-form>
    </el-card>

    <el-row :gutter="16" class="config-row">
      <el-col :xs="24" :md="12">
        <el-card class="section-card config-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">小程序配置</span>
              <span class="section-hint">基本信息与维护模式</span>
            </div>
          </template>

          <el-form :model="form" label-width="100px" label-position="right">
            <el-form-item label="小程序名称">
              <el-input v-model="form.appName" placeholder="小程序名称" />
            </el-form-item>
            <el-form-item label="当前版本">
              <el-input v-model="form.appVersion" placeholder="如 1.0.0" />
            </el-form-item>
            <el-form-item label="维护模式">
              <el-switch v-model="form.maintenanceMode" />
              <el-text type="info" style="margin-left:12px">开启后用户进入小程序将看到维护提示</el-text>
            </el-form-item>
            <el-form-item label="维护提示">
              <el-input
                v-model="form.maintenanceMessage"
                type="textarea"
                :rows="3"
                placeholder="维护时显示的提示信息"
              />
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="12">
        <el-card class="section-card config-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">在线客服</span>
              <span class="section-hint">显示在「我的太空」页面</span>
            </div>
          </template>

          <el-form :model="form" label-width="100px" label-position="right">
            <el-form-item label="介绍文字">
              <el-input v-model="form.aboutText" type="textarea" :rows="6" placeholder="显示在「我的太空」页面的在线客服介绍文字" />
            </el-form-item>
            <el-form-item label="微信号">
              <el-input v-model="form.aboutWechat" placeholder="用户可点击复制的微信号" style="max-width:360px;" />
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="section-card bili-card" shadow="never" style="margin-top:16px;">
      <template #header>
        <div class="bili-header">
          <div class="bili-header-main">
            <div class="bili-header-title">
              <el-tag type="danger" effect="plain" round size="small">B站</el-tag>
              <span class="section-title">B 站自动发文</span>
              <el-tag v-if="biliAutoPaused" type="warning" size="small" effect="light">连败自动暂停</el-tag>
            </div>
            <div class="bili-header-desc">
              开启后仅同步「开启时刻」之后的事件；每次自动/扫库入队只发当时最新一条推文，会取消积压的旧待发。关闭会取消待发队列。实际发帖需本机/VPS Agent 在线。
            </div>
          </div>
          <el-switch
            v-model="biliForm.enabled"
            size="large"
            inline-prompt
            active-text="开"
            inactive-text="关"
            :loading="biliSaving"
            @change="onBiliToggle"
          />
        </div>
      </template>

      <div class="bili-status-grid">
        <div class="bili-stat">
          <div class="bili-stat-label">今日已发</div>
          <div class="bili-stat-value">{{ biliHealth.publishedToday || 0 }}</div>
        </div>
        <div class="bili-stat">
          <div class="bili-stat-label">本小时</div>
          <div class="bili-stat-value">{{ biliHealth.publishedHour || 0 }}</div>
        </div>
        <div class="bili-stat">
          <div class="bili-stat-label">待发队列</div>
          <div class="bili-stat-value">{{ biliHealth.pendingQueue || 0 }}</div>
        </div>
        <div class="bili-stat" :class="{ 'bili-stat--danger': (biliHealth.consecutiveFails || 0) > 0 }">
          <div class="bili-stat-label">连续失败</div>
          <div class="bili-stat-value">{{ biliHealth.consecutiveFails || 0 }}</div>
          <div v-if="biliAutoPaused" class="bili-stat-sub bili-stat-sub--danger">已自动暂停</div>
        </div>
        <div class="bili-stat">
          <div class="bili-stat-label">上次扫库</div>
          <div class="bili-stat-value bili-stat-value--time">{{ formatTs(biliHealth.lastEnqueueAt) }}</div>
          <div class="bili-stat-sub">
            来源 {{ biliHealth.lastEnqueueFrom || '-' }} · 结果
            <el-tag size="small" effect="plain" :type="biliHealth.lastEnqueueResult === 'enqueued' ? 'success' : 'info'">
              {{ biliHealth.lastEnqueueResult || '-' }}
            </el-tag>
          </div>
        </div>
        <div class="bili-stat">
          <div class="bili-stat-label">同步起点</div>
          <div class="bili-stat-value bili-stat-value--time">{{ formatTs(biliHealth.syncFromAt) }}</div>
          <div class="bili-stat-sub">早于此时间的「未同步」不会入队</div>
        </div>
      </div>

      <div v-if="biliHealth.cooling || biliHealth.lastError" class="bili-alerts">
        <el-alert
          v-if="biliHealth.cooling"
          type="warning"
          :closable="false"
          show-icon
          :title="`冷却中至 ${formatTs(biliHealth.cooldownUntil)}`"
        />
        <el-alert v-if="biliHealth.lastError" type="error" :closable="false" show-icon>
          <template #title>
            <div class="bili-error-row">
              <span class="bili-error-text">{{ biliHealth.lastError }}</span>
              <el-button size="small" type="danger" plain :loading="biliResetting" @click="onBiliResetFails">
                重置失败并清除错误
              </el-button>
            </div>
          </template>
        </el-alert>
      </div>

      <div class="bili-actions">
        <el-button :loading="biliEnqueueing" type="primary" @click="onBiliEnqueue">立即扫库入队</el-button>
        <el-button @click="onBiliBackdate">把起点拨回 1 小时（纳入刚发的事件）</el-button>
        <el-button @click="loadBili">刷新状态</el-button>
      </div>

      <el-collapse class="bili-advanced">
        <el-collapse-item title="高级风控参数" name="adv">
          <el-form :model="biliForm" label-width="140px">
            <div class="bili-adv-grid">
              <el-form-item label="最小间隔(秒)"><el-input-number v-model="biliForm.minIntervalSec" :min="300" :max="86400" /></el-form-item>
              <el-form-item label="间隔抖动(秒)"><el-input-number v-model="biliForm.intervalJitterSec" :min="0" :max="3600" /></el-form-item>
              <el-form-item label="每小时上限"><el-input-number v-model="biliForm.maxPerHour" :min="1" :max="20" /></el-form-item>
              <el-form-item label="每天上限"><el-input-number v-model="biliForm.maxPerDay" :min="1" :max="50" /></el-form-item>
              <el-form-item label="纯文字每天上限"><el-input-number v-model="biliForm.textOnlyMaxPerDay" :min="0" :max="20" /></el-form-item>
              <el-form-item label="话题上限"><el-input-number v-model="biliForm.topicMax" :min="1" :max="8" /></el-form-item>
              <el-form-item label="连败自动暂停(次)"><el-input-number v-model="biliForm.autoPauseAfterFails" :min="1" :max="20" /></el-form-item>
              <el-form-item label="限频冷却(分钟)"><el-input-number v-model="biliForm.onRateLimitCooldownMin" :min="5" :max="1440" /></el-form-item>
              <el-form-item label="AI 补话题"><el-switch v-model="biliForm.aiTopicEnabled" /></el-form-item>
              <el-form-item label="AI 自动入库"><el-switch v-model="biliForm.aiTopicAutopromote" /></el-form-item>
            </div>
            <el-form-item label="页脚"><el-input v-model="biliForm.footer" style="max-width:420px;" /></el-form-item>
          </el-form>
          <el-button type="primary" :loading="biliSaving" @click="saveBiliAdvanced">保存高级参数</el-button>
        </el-collapse-item>
      </el-collapse>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const saving = ref(false)
const biliSaving = ref(false)
const biliEnqueueing = ref(false)
const biliResetting = ref(false)
const biliHealth = reactive({
  publishedToday: 0,
  publishedHour: 0,
  pendingQueue: 0,
  consecutiveFails: 0,
  cooling: false,
  cooldownUntil: 0,
  lastError: '',
  syncFromAt: 0,
  lastEnqueueAt: 0,
  lastEnqueueFrom: '',
  lastEnqueueResult: ''
})
const biliForm = reactive({
  enabled: false,
  minIntervalSec: 1800,
  intervalJitterSec: 600,
  maxPerHour: 2,
  maxPerDay: 8,
  textOnlyMaxPerDay: 3,
  topicMax: 5,
  autoPauseAfterFails: 3,
  onRateLimitCooldownMin: 120,
  aiTopicEnabled: true,
  aiTopicAutopromote: true,
  footer: '—— 火星探索日志'
})

/** 连败达到阈值且总开关已被关掉 → 大概率是自动暂停 */
const biliAutoPaused = computed(
  () =>
    !biliForm.enabled &&
    Number(biliHealth.consecutiveFails || 0) >= Number(biliForm.autoPauseAfterFails || 3)
)

const form = reactive({
  enableCarousel: true,
  enableSplash: true,
  enablePushNotify: true,
  enableTweetSync: true,
  enableLive: true,
  enableEventVideo: true,
  enableMissionReplay: true,
  enableAIChat: true,
  enableLunarWishes: true,
  enableMembership: false,
  enableBriefing: true,
  enableLiveWatch: true,
  enablePublishPanel: true,
  // 会员策略与流量
  mediaTrafficMode: 'normal',
  freeMissionListLimit: 10,
  freeEventListLimit: 5,
  freeAiChatDaily: 3,
  freeAiImageDaily: 1,
  adUnlockMinutes: 10,
  enableMissionListGate: true,
  enableEventListGate: true,
  forceNonMemberVideoPoster: true,
  splashAllowVideoForNonMember: false,
  carouselAllowVideoForNonMember: false,
  appName: '',
  appVersion: '',
  maintenanceMode: false,
  maintenanceMessage: '',
  aboutText: '',
  aboutWechat: ''
})

const featureSwitches = [
  { field: 'enableCarousel', label: '轮播图', desc: '关闭后首页轮播区域将隐藏' },
  { field: 'enableSplash', label: '开屏动画', desc: '关闭后冷启动不再展示开屏动画' },
  { field: 'enablePushNotify', label: '发射提醒推送', desc: '控制订阅消息是否实际下发' },
  { field: 'enableTweetSync', label: '推文自动同步', desc: '定时拉取 SpaceX/Starship 推文' },
  { field: 'enableLive', label: '直播功能', desc: '与「直播观看」同时生效：关闭后监控中心与任务详情直播入口均隐藏' },
  { field: 'enableEventVideo', label: '事件更新视频', desc: '关闭后隐藏事件视频、全站播放页、世界杯视频与静音背景视频，方便过审' },
  { field: 'enableMissionReplay', label: '发射回放', desc: '关闭后任务详情页「观看回放」卡片（发射集锦 + 完整回放外链）隐藏，方便过审' },
  { field: 'enableAIChat', label: 'AI 太空助手（星问）', desc: '关闭后 NASA 圆盘菜单中的星问入口将隐藏，方便过审' },
  { field: 'enableLunarWishes', label: '月愿计划', desc: '关闭后 NASA 圆盘菜单中的月愿入口将隐藏，方便过审' },
  { field: 'enableMembership', label: '会员系统（星际通行证）', desc: '关闭后隐藏所有付费入口，AI 保持 10 次/日免费额度' },
  { field: 'enableBriefing', label: '每日太空简报', desc: '关闭后用户进入小程序不再弹出每日简报' },
  { field: 'enableLiveWatch', label: '直播观看（监控中心）', desc: '关闭后监控中心与任务详情的视频号/B站直播入口隐藏；需「直播功能」未关' },
  { field: 'enablePublishPanel', label: '贴图讨论区', desc: '关闭后全站详情页底部的贴图讨论区组件将隐藏，方便过审' }
]

const AUDIT_FIELDS = [
  'enableCarousel',
  'enableSplash',
  'enableEventVideo',
  'enableMissionReplay',
  'enableLive',
  'enableAIChat',
  'enableLunarWishes',
  'enableBriefing',
  'enableLiveWatch',
  'enablePublishPanel'
]

const AUDIT_LABEL = '轮播图、开屏动画、事件更新视频（含播放页/世界杯/背景视频）、发射回放、直播功能、AI 太空助手、月愿计划、每日太空简报、直播观看、贴图讨论区'

const auditModeView = computed(() => AUDIT_FIELDS.every((f) => form[f] === false))

const handleAuditChange = async () => {
  if (!auditModeView.value) {
    try {
      await ElMessageBox.confirm(
        `将一次性关闭：${AUDIT_LABEL}。确认后自动保存配置。是否继续？`,
        '开启过审模式',
        { type: 'warning', confirmButtonText: '确定关闭并保存', cancelButtonText: '取消' }
      )
    } catch (e) {
      return false
    }
    AUDIT_FIELDS.forEach((f) => { form[f] = false })
    await onSave()
    return false
  }

  try {
    await ElMessageBox.confirm(
      `将恢复推荐默认值：${AUDIT_LABEL} → 开启。确认后自动保存配置。是否继续？`,
      '关闭过审模式',
      { type: 'info', confirmButtonText: '确定恢复并保存', cancelButtonText: '取消' }
    )
  } catch (e) {
    return false
  }
  form.enableCarousel = true
  form.enableSplash = true
  form.enableEventVideo = true
  form.enableMissionReplay = true
  form.enableLive = true
  form.enableAIChat = true
  form.enableLunarWishes = true
  form.enableBriefing = true
  form.enableLiveWatch = true
  form.enablePublishPanel = true
  await onSave()
  return false
}

const formatTs = (t) => (t ? new Date(t).toLocaleString() : '-')

const loadBili = async () => {
  try {
    const data = await api.getBilibiliAutoPublish()
    if (!data) return
    Object.assign(biliForm, {
      enabled: !!data.enabled,
      minIntervalSec: Number(data.minIntervalSec || 1800),
      intervalJitterSec: Number(data.intervalJitterSec || 600),
      maxPerHour: Number(data.maxPerHour || 2),
      maxPerDay: Number(data.maxPerDay || 8),
      textOnlyMaxPerDay: Number(data.textOnlyMaxPerDay || 3),
      topicMax: Number(data.topicMax || 5),
      autoPauseAfterFails: Number(data.autoPauseAfterFails || 3),
      onRateLimitCooldownMin: Number(data.onRateLimitCooldownMin || 120),
      aiTopicEnabled: data.aiTopicEnabled !== false,
      aiTopicAutopromote: data.aiTopicAutopromote !== false,
      footer: data.footer || '—— 火星探索日志'
    })
    const h = data.health || {}
    Object.assign(biliHealth, {
      publishedToday: h.publishedToday || 0,
      publishedHour: h.publishedHour || 0,
      pendingQueue: h.pendingQueue || 0,
      consecutiveFails: h.consecutiveFails || 0,
      cooling: !!h.cooling,
      cooldownUntil: h.cooldownUntil || 0,
      lastError: h.lastError || '',
      syncFromAt: h.syncFromAt || 0,
      lastEnqueueAt: h.lastEnqueueAt || 0,
      lastEnqueueFrom: h.lastEnqueueFrom || '',
      lastEnqueueResult: h.lastEnqueueResult || ''
    })
  } catch (e) {
    ElMessage.error(e.message || '加载 B 站配置失败')
  }
}

const onBiliToggle = async (val) => {
  biliSaving.value = true
  try {
    if (val) {
      await ElMessageBox.confirm(
        '开启后将从「现在」起同步新事件到 B 站队列（不回灌历史）。确认开启？',
        '开启 B 站自动发文',
        { type: 'warning' }
      )
    }
    await api.updateBilibiliAutoPublish({ enabled: !!val })
    ElMessage.success(val ? '已开启' : '已关闭')
    await loadBili()
  } catch (e) {
    biliForm.enabled = !val
    if (e !== 'cancel' && e?.action !== 'cancel') {
      ElMessage.error(e.message || '切换失败')
    }
  } finally {
    biliSaving.value = false
  }
}

const saveBiliAdvanced = async () => {
  biliSaving.value = true
  try {
    await api.updateBilibiliAutoPublish({
      minIntervalSec: biliForm.minIntervalSec,
      intervalJitterSec: biliForm.intervalJitterSec,
      maxPerHour: biliForm.maxPerHour,
      maxPerDay: biliForm.maxPerDay,
      textOnlyMaxPerDay: biliForm.textOnlyMaxPerDay,
      topicMax: biliForm.topicMax,
      autoPauseAfterFails: biliForm.autoPauseAfterFails,
      onRateLimitCooldownMin: biliForm.onRateLimitCooldownMin,
      aiTopicEnabled: biliForm.aiTopicEnabled,
      aiTopicAutopromote: biliForm.aiTopicAutopromote,
      footer: biliForm.footer
    })
    ElMessage.success('高级参数已保存')
    await loadBili()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    biliSaving.value = false
  }
}

const onBiliResetFails = async () => {
  biliResetting.value = true
  try {
    await api.updateBilibiliAutoPublish({ consecutiveFails: 0, lastError: '', cooldownUntil: 0 })
    ElMessage.success('已重置失败计数并清除错误')
    await loadBili()
  } catch (e) {
    ElMessage.error(e.message || '重置失败')
  } finally {
    biliResetting.value = false
  }
}

const onBiliBackdate = async () => {
  try {
    await ElMessageBox.confirm('将同步起点拨回 1 小时，使最近发布但未同步的事件可以入队。是否继续？', '调整同步起点', { type: 'info' })
    const ts = Date.now() - 60 * 60 * 1000
    await api.updateBilibiliAutoPublish({ syncFromAt: ts })
    ElMessage.success('已拨回 1 小时，请再点「立即扫库入队」')
    await loadBili()
  } catch (e) {
    if (e !== 'cancel' && e?.action !== 'cancel') ElMessage.error(e.message || '操作失败')
  }
}

const onBiliEnqueue = async () => {
  biliEnqueueing.value = true
  try {
    const res = await api.enqueueBilibiliPublish()
    const n = Number(res?.enqueued || 0)
    const reason = res?.reason || res?.skipped
    if (n > 0) ElMessage.success(`已入队 ${n} 条`)
    else if (reason) ElMessage.warning(`未入队：${reason}（候选 ${res?.candidates ?? '-'}）`)
    else ElMessage.info(`未入队新任务（候选 ${res?.candidates ?? 0}，跳过相似 ${res?.skippedSimilar ?? 0}）`)
    console.log('[bili enqueue]', res)
    await loadBili()
  } catch (e) {
    ElMessage.error(e.message || '触发失败')
  } finally {
    biliEnqueueing.value = false
  }
}

const load = async () => {
  try {
    const data = await api.getGlobalConfig()
    if (data) {
      const mode = ['normal', 'save', 'emergency'].includes(data.mediaTrafficMode)
        ? data.mediaTrafficMode
        : 'normal'
      Object.assign(form, {
        enableCarousel: data.enableCarousel !== false,
        enableSplash: data.enableSplash !== false,
        enablePushNotify: data.enablePushNotify !== false,
        enableTweetSync: data.enableTweetSync !== false,
        enableLive: data.enableLive !== false,
        enableEventVideo: data.enableEventVideo !== false,
        enableMissionReplay: data.enableMissionReplay !== false,
        enableAIChat: data.enableAIChat !== false,
        enableLunarWishes: data.enableLunarWishes !== false,
        enableMembership: !!data.enableMembership,
        enableBriefing: data.enableBriefing !== false,
        enableLiveWatch: data.enableLiveWatch !== false,
        enablePublishPanel: data.enablePublishPanel !== false,
        mediaTrafficMode: mode,
        freeMissionListLimit: Number(data.freeMissionListLimit) > 0 ? Number(data.freeMissionListLimit) : 10,
        freeEventListLimit: Number(data.freeEventListLimit) > 0 ? Number(data.freeEventListLimit) : 5,
        freeAiChatDaily: Number.isFinite(Number(data.freeAiChatDaily)) ? Number(data.freeAiChatDaily) : 3,
        freeAiImageDaily: Number.isFinite(Number(data.freeAiImageDaily)) ? Number(data.freeAiImageDaily) : 1,
        adUnlockMinutes: Number(data.adUnlockMinutes) > 0 ? Number(data.adUnlockMinutes) : 10,
        enableMissionListGate: data.enableMissionListGate !== false,
        enableEventListGate: data.enableEventListGate !== false,
        forceNonMemberVideoPoster: data.forceNonMemberVideoPoster !== false,
        splashAllowVideoForNonMember: !!data.splashAllowVideoForNonMember,
        carouselAllowVideoForNonMember: !!data.carouselAllowVideoForNonMember,
        appName: data.appName ?? '',
        appVersion: data.appVersion ?? '',
        maintenanceMode: !!data.maintenanceMode,
        maintenanceMessage: data.maintenanceMessage ?? '',
        aboutText: data.aboutText ?? '',
        aboutWechat: data.aboutWechat ?? ''
      })
    }
  } catch (e) {
    ElMessage.error(e.message || '加载配置失败')
  }
  await loadBili()
}

const onSave = async () => {
  saving.value = true
  try {
    await api.updateGlobalConfig({ ...form })
    ElMessage.success('配置已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.global-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  padding: 4px 4px 0;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}

.page-subtitle {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.audit-card {
  border: 1px solid var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
}

.audit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.audit-info {
  flex: 1;
  min-width: 0;
}

.audit-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.audit-name {
  font-size: 16px;
  font-weight: 600;
}

.audit-desc {
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.6;
}

.audit-switch {
  flex-shrink: 0;
}

.section-card {
  border: 1px solid var(--el-border-color-lighter);
}

.config-row {
  margin: 0 !important;
}

.config-row > .el-col {
  display: flex;
  margin-bottom: 16px;
}

.config-card {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.config-card :deep(.el-card__body) {
  flex: 1;
}

.section-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
}

.section-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.switch-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 4px;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.switch-row:last-child {
  border-bottom: none;
}

.switch-label {
  flex: 1;
  min-width: 0;
}

.switch-name {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
}

.switch-desc {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

/* ============== B 站自动发文卡片（深色玻璃主题适配） ==============
 * 全站是深空玻璃底（styles/theme.css），Element Plus 变量仍是亮色默认值，
 * 这里一律用 --cx-* 暗色 token / 半透明色，避免亮色块糊在黑底上看不清。 */
.bili-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.bili-header-main {
  flex: 1;
  min-width: 0;
}

.bili-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.bili-header-title :deep(.el-tag--danger) {
  background: rgba(239, 68, 68, 0.14) !important;
  border-color: rgba(248, 113, 113, 0.45) !important;
  color: #fca5a5 !important;
}

.bili-header-title :deep(.el-tag--warning) {
  background: rgba(245, 158, 11, 0.14) !important;
  border-color: rgba(251, 191, 36, 0.45) !important;
  color: #fbbf24 !important;
}

.bili-header-desc {
  margin-top: 6px;
  color: var(--cx-text-3, rgba(255, 255, 255, 0.52));
  font-size: 12px;
  line-height: 1.6;
  font-weight: 400;
}

.bili-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.bili-stat {
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--cx-glass-stroke, rgba(255, 255, 255, 0.08));
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bili-stat--danger {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(248, 113, 113, 0.38);
}

.bili-stat--danger .bili-stat-value {
  color: #f87171;
}

.bili-stat-label {
  font-size: 12px;
  color: var(--cx-text-3, rgba(255, 255, 255, 0.52));
}

.bili-stat-value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--cx-text-1, rgba(255, 255, 255, 0.92));
}

.bili-stat-value--time {
  font-size: 14px;
}

.bili-stat-sub {
  font-size: 12px;
  color: var(--cx-text-3, rgba(255, 255, 255, 0.52));
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.bili-stat-sub--danger {
  color: #f87171;
  font-weight: 500;
}

/* 结果 tag（plain 效果在亮色变量下是白底）改为暗色胶囊 */
.bili-stat-sub :deep(.el-tag) {
  background: rgba(255, 255, 255, 0.06) !important;
  border-color: rgba(255, 255, 255, 0.16) !important;
  color: var(--cx-text-2, rgba(255, 255, 255, 0.72)) !important;
}

.bili-stat-sub :deep(.el-tag--success) {
  background: rgba(16, 185, 129, 0.14) !important;
  border-color: rgba(52, 211, 153, 0.4) !important;
  color: #34d399 !important;
}

.bili-alerts {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* el-alert 默认是亮色浅底：换成深色玻璃 + 高对比文字 */
.bili-alerts :deep(.el-alert) {
  border-radius: 10px;
  padding: 10px 14px;
}

.bili-alerts :deep(.el-alert--error) {
  background: rgba(239, 68, 68, 0.12) !important;
  border: 1px solid rgba(248, 113, 113, 0.38);
}

.bili-alerts :deep(.el-alert--error .el-alert__title),
.bili-alerts :deep(.el-alert--error .el-alert__icon) {
  color: #fca5a5 !important;
}

.bili-alerts :deep(.el-alert--warning) {
  background: rgba(245, 158, 11, 0.12) !important;
  border: 1px solid rgba(251, 191, 36, 0.38);
}

.bili-alerts :deep(.el-alert--warning .el-alert__title),
.bili-alerts :deep(.el-alert--warning .el-alert__icon) {
  color: #fbbf24 !important;
}

.bili-error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.bili-error-text {
  flex: 1;
  min-width: 0;
  word-break: break-all;
  line-height: 1.5;
}

/* 危险 plain 按钮在亮色变量下是白底红字：改为深色描边款 */
.bili-error-row :deep(.el-button--danger.is-plain) {
  background: rgba(239, 68, 68, 0.16) !important;
  border-color: rgba(248, 113, 113, 0.55) !important;
  color: #fecaca !important;
  border-radius: 8px;
  flex-shrink: 0;
}

.bili-error-row :deep(.el-button--danger.is-plain:hover) {
  background: rgba(239, 68, 68, 0.3) !important;
  border-color: #f87171 !important;
  color: #fff !important;
}

.bili-actions {
  margin-top: 14px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 折叠面板：去掉亮色底/分隔线，融入玻璃卡片 */
.bili-advanced {
  margin-top: 14px;
  border-top: 1px solid var(--cx-glass-stroke, rgba(255, 255, 255, 0.08));
  border-bottom: none;
}

.bili-advanced :deep(.el-collapse-item__header) {
  background: transparent !important;
  color: var(--cx-text-2, rgba(255, 255, 255, 0.72)) !important;
  border-bottom-color: var(--cx-glass-stroke, rgba(255, 255, 255, 0.08)) !important;
  font-size: 13px;
}

.bili-advanced :deep(.el-collapse-item__wrap) {
  background: transparent !important;
  border-bottom-color: var(--cx-glass-stroke, rgba(255, 255, 255, 0.08)) !important;
}

.bili-advanced :deep(.el-collapse-item__content) {
  color: var(--cx-text-1, rgba(255, 255, 255, 0.92));
  padding-top: 16px;
}

.bili-advanced :deep(.el-form-item__label) {
  color: var(--cx-text-2, rgba(255, 255, 255, 0.72));
}

.bili-adv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  column-gap: 24px;
}
</style>
