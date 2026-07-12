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

    <el-card class="section-card" shadow="never" style="margin-top:16px;">
      <template #header>
        <div class="section-header">
          <span class="section-title">B 站自动发文</span>
          <span class="section-hint">总开关控制事件更新（含推文）自动入队发动态；实际发帖需本机/VPS Agent</span>
        </div>
      </template>

      <div class="audit-row" style="margin-bottom:16px;">
        <div class="audit-info">
          <div class="audit-title">
            <el-tag type="danger" effect="plain" round size="small">B站</el-tag>
            <span class="audit-name">自动同步总开关</span>
          </div>
          <div class="audit-desc">
            开启后仅同步「开启时刻」之后的新事件，不回灌历史。关闭会取消待发队列。
          </div>
        </div>
        <div class="audit-switch">
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
      </div>

      <el-row :gutter="16" style="margin-bottom:12px;">
        <el-col :xs="12" :sm="6"><div class="bili-stat"><div class="bili-stat-label">今日已发</div><div class="bili-stat-value">{{ biliHealth.publishedToday || 0 }}</div></div></el-col>
        <el-col :xs="12" :sm="6"><div class="bili-stat"><div class="bili-stat-label">本小时</div><div class="bili-stat-value">{{ biliHealth.publishedHour || 0 }}</div></div></el-col>
        <el-col :xs="12" :sm="6"><div class="bili-stat"><div class="bili-stat-label">待发队列</div><div class="bili-stat-value">{{ biliHealth.pendingQueue || 0 }}</div></div></el-col>
        <el-col :xs="12" :sm="6"><div class="bili-stat"><div class="bili-stat-label">连续失败</div><div class="bili-stat-value">{{ biliHealth.consecutiveFails || 0 }}</div></div></el-col>
      </el-row>
      <el-alert
        v-if="biliHealth.cooling"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom:12px;"
        :title="`冷却中至 ${formatTs(biliHealth.cooldownUntil)}`"
      />
      <el-alert
        v-if="biliHealth.lastError"
        type="error"
        :closable="false"
        show-icon
        style="margin-bottom:12px;"
        :title="biliHealth.lastError"
      />

      <el-collapse>
        <el-collapse-item title="高级风控参数" name="adv">
          <el-form :model="biliForm" label-width="140px" style="max-width:640px;">
            <el-form-item label="最小间隔(秒)"><el-input-number v-model="biliForm.minIntervalSec" :min="300" :max="86400" /></el-form-item>
            <el-form-item label="间隔抖动(秒)"><el-input-number v-model="biliForm.intervalJitterSec" :min="0" :max="3600" /></el-form-item>
            <el-form-item label="每小时上限"><el-input-number v-model="biliForm.maxPerHour" :min="1" :max="20" /></el-form-item>
            <el-form-item label="每天上限"><el-input-number v-model="biliForm.maxPerDay" :min="1" :max="50" /></el-form-item>
            <el-form-item label="纯文字每天上限"><el-input-number v-model="biliForm.textOnlyMaxPerDay" :min="0" :max="20" /></el-form-item>
            <el-form-item label="话题上限"><el-input-number v-model="biliForm.topicMax" :min="1" :max="8" /></el-form-item>
            <el-form-item label="AI 补话题"><el-switch v-model="biliForm.aiTopicEnabled" /></el-form-item>
            <el-form-item label="AI 自动入库"><el-switch v-model="biliForm.aiTopicAutopromote" /></el-form-item>
            <el-form-item label="页脚"><el-input v-model="biliForm.footer" /></el-form-item>
          </el-form>
          <el-button type="primary" :loading="biliSaving" @click="saveBiliAdvanced">保存高级参数</el-button>
        </el-collapse-item>
      </el-collapse>

      <el-alert
        v-if="biliHealth.lastEnqueueAt"
        type="success"
        :closable="false"
        show-icon
        style="margin-bottom:12px;"
        :title="`上次自动扫库：${formatTs(biliHealth.lastEnqueueAt)}（来源 ${biliHealth.lastEnqueueFrom || '-'}，结果 ${biliHealth.lastEnqueueResult || '-'}）`"
      />
      <el-alert
        v-if="biliHealth.syncFromAt"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom:12px;"
        :title="`只同步此时间之后的事件：${formatTs(biliHealth.syncFromAt)}（早于此时间的「未同步」不会入队）`"
      />

      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <el-button :loading="biliEnqueueing" type="warning" @click="onBiliEnqueue">立即扫库入队</el-button>
        <el-button @click="onBiliBackdate">把起点拨回1小时（纳入刚发的事件）</el-button>
        <el-button @click="loadBili">刷新状态</el-button>
      </div>
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
  aiTopicEnabled: true,
  aiTopicAutopromote: true,
  footer: '—— 火星探索日志'
})

const form = reactive({
  enableCarousel: true,
  enableSplash: true,
  enablePushNotify: true,
  enableTweetSync: true,
  enableLive: true,
  enableEventVideo: true,
  enableAIChat: true,
  enableLunarWishes: true,
  enableMembership: false,
  enableBriefing: true,
  enableLiveWatch: true,
  enablePublishPanel: true,
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
  'enableLive',
  'enableAIChat',
  'enableLunarWishes',
  'enableBriefing',
  'enableLiveWatch',
  'enablePublishPanel'
]

const AUDIT_LABEL = '轮播图、开屏动画、事件更新视频（含播放页/世界杯/背景视频）、直播功能、AI 太空助手、月愿计划、每日太空简报、直播观看、贴图讨论区'

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
      Object.assign(form, {
        enableCarousel: data.enableCarousel !== false,
        enableSplash: data.enableSplash !== false,
        enablePushNotify: data.enablePushNotify !== false,
        enableTweetSync: data.enableTweetSync !== false,
        enableLive: data.enableLive !== false,
        enableEventVideo: data.enableEventVideo !== false,
        enableAIChat: data.enableAIChat !== false,
        enableLunarWishes: data.enableLunarWishes !== false,
        enableMembership: !!data.enableMembership,
        enableBriefing: data.enableBriefing !== false,
        enableLiveWatch: data.enableLiveWatch !== false,
        enablePublishPanel: data.enablePublishPanel !== false,
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

.bili-stat {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.bili-stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.bili-stat-value {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 600;
}
</style>
