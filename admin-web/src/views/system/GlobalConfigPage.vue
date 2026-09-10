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
            开启后将一次性关闭：<b>{{ AUDIT_LABEL }}</b>，便于版本送审。关闭后会恢复推荐默认值，并自动保存。
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
        <el-form-item label="星问看广告加次">
          <el-input-number v-model="form.aiChatAdBonusPerWatch" :min="1" :max="1" />
          <el-text type="info" style="margin-left:12px">看完一条激励视频只解锁 1 次提问</el-text>
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
          <el-text type="info" style="margin-left:12px">已默认放开：开屏视频对非会员始终可播（省流/紧急档自动收紧），此开关不再生效</el-text>
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

  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'

const saving = ref(false)

const form = reactive({
  enableCarousel: true,
  enableSplash: true,
  enablePushNotify: true,
  enableTweetSync: true,
  enableLive: true,
  enableEventVideo: true,
  enableMissionReplay: true,
  enableAIChat: true,
  enableXingwenAgent: true,
  enableLunarWishes: true,
  enableAstroPhotos: false,
  enableMembership: false,
  enableMembershipPopup: true,
  enableBriefing: true,
  enableLiveWatch: true,
  enablePublishPanel: true,
  enableMissionSim: false,
  enableWatchParty: true,
  enableOrbitPano: true,
  enableProfileShop: false,
  // 会员策略与流量
  mediaTrafficMode: 'normal',
  freeMissionListLimit: 10,
  freeEventListLimit: 5,
  freeAiChatDaily: 3,
  aiChatAdBonusPerWatch: 1,
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
  { field: 'enableEventVideo', label: '事件更新视频', desc: '关闭后隐藏事件视频、全站播放页与静音背景视频，方便过审' },
  { field: 'enableMissionReplay', label: '发射回放', desc: '关闭后任务详情页「观看回放」卡片（发射集锦 + 完整回放外链）隐藏，方便过审' },
  { field: 'enableAIChat', label: 'AI 太空助手（星问）', desc: '关闭后圆盘入口、首页放大镜与星问详情页均不可用（含分享直达）；一键过审时同步隐藏，方便过审' },
  { field: 'enableXingwenAgent', label: '星问 Agent 工具循环', desc: '关闭后星问回退为纯正则出卡 + 混元润色，不走 Hy3 工具调用。字段缺省视为开启' },
  { field: 'enableLunarWishes', label: '月愿计划', desc: '关闭后 NASA 圆盘菜单中的月愿入口将隐藏，方便过审' },
  { field: 'enableAstroPhotos', label: '航天摄影', desc: '默认关闭；开启后新闻页显示「航天摄影」分区并允许用户投稿，过审期间请保持关闭' },
  { field: 'enableMembership', label: '会员系统（星际通行证）', desc: '关闭后隐藏所有付费入口，AI 保持 10 次/日免费额度' },
  { field: 'enableMembershipPopup', label: '首页会员订阅弹窗', desc: '控制首页会员升级推荐 / 续费提醒弹窗；默认开启，关闭后不再自动弹出（会员系统总开关仍需开启才会弹）' },
  { field: 'enableBriefing', label: '每日太空简报', desc: '关闭后用户进入小程序不再弹出每日简报' },
  { field: 'enableLiveWatch', label: '直播观看（监控中心）', desc: '关闭后监控中心与任务详情的视频号/B站直播入口隐藏；需「直播功能」未关' },
  { field: 'enablePublishPanel', label: '贴图讨论区', desc: '关闭后全站详情页底部的贴图讨论区组件将隐藏，方便过审' },
  { field: 'enableMissionSim', label: '星舰任务指挥室（互动模拟）', desc: '星舰进度页的发射流程互动模拟入口；默认关闭，建议过审通过后再灰度开启' },
  { field: 'enableWatchParty', label: '火箭观礼', desc: '关闭后我的入口、任务详情入口、星问观礼卡、分享/扫码直达与全部公开接口均下线（failClosed），方便过审；与观礼页「一键关停」独立，过审请关本开关' },
  { field: 'enableOrbitPano', label: '环绕全景', desc: '关闭后任务详情头图 360、Starbase 设施图入口、播放页与分享直达全部隐藏（failClosed），方便过审；环绕全景页「一键过审」写同一字段' },
  { field: 'enableProfileShop', label: '我的页微信小店', desc: '默认关闭；开启后「我的太空」星际通行证下方展示微信小店官方首页（store-home，含精选展示位）。不必选择商品。过审请保持关闭' }
]

const AUDIT_FIELDS = [
  'enableCarousel',
  'enableSplash',
  'enableEventVideo',
  'enableMissionReplay',
  'enableLive',
  'enableAIChat',
  'enableLunarWishes',
  'enableAstroPhotos',
  'enableBriefing',
  'enableLiveWatch',
  'enablePublishPanel',
  'enableMissionSim',
  'enableWatchParty',
  'enableOrbitPano',
  'enableProfileShop'
]

const AUDIT_LABEL = '轮播图、开屏动画、事件更新视频（含播放页/背景视频）、发射回放、直播功能、AI 太空助手、月愿计划、每日太空简报、直播观看、贴图讨论区、火箭观礼、环绕全景、我的页微信小店（航天摄影、星舰任务指挥室默认保持关闭）'

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
  form.enableAstroPhotos = false
  form.enableBriefing = true
  form.enableLiveWatch = true
  form.enablePublishPanel = true
  form.enableWatchParty = true
  form.enableOrbitPano = true
  await onSave()
  return false
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
        enableXingwenAgent: data.enableXingwenAgent !== false,
        enableLunarWishes: data.enableLunarWishes !== false,
        // failClosed：默认关闭，只有显式 true 才算开启
        enableAstroPhotos: data.enableAstroPhotos === true,
        enableMembership: !!data.enableMembership,
        // 字段缺省视为开启（与小程序 isFeatureEnabled 语义一致）
        enableMembershipPopup: data.enableMembershipPopup !== false,
        enableBriefing: data.enableBriefing !== false,
        enableLiveWatch: data.enableLiveWatch !== false,
        enablePublishPanel: data.enablePublishPanel !== false,
        // failClosed：默认关闭，只有显式 true 才算开启
        enableMissionSim: data.enableMissionSim === true,
        // 火箭观礼：字段缺省视为开启（与小程序 !== false 一致）；一键过审写入 false
        enableWatchParty: data.enableWatchParty !== false,
        enableOrbitPano: data.enableOrbitPano !== false && data.orbitPanoEnabled !== false,
        enableProfileShop: data.enableProfileShop === true,
        mediaTrafficMode: mode,
        freeMissionListLimit: Number(data.freeMissionListLimit) > 0 ? Number(data.freeMissionListLimit) : 10,
        freeEventListLimit: Number(data.freeEventListLimit) > 0 ? Number(data.freeEventListLimit) : 5,
        freeAiChatDaily: Number.isFinite(Number(data.freeAiChatDaily)) ? Number(data.freeAiChatDaily) : 3,
        aiChatAdBonusPerWatch: 1,
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
  border: 1px solid rgba(251, 191, 36, 0.42);
  background: rgba(245, 158, 11, 0.14);
  color: rgba(255, 255, 255, 0.92);
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
  color: rgba(255, 255, 255, 0.95);
}

.audit-desc {
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  line-height: 1.6;
}

.audit-desc :deep(b) {
  color: #fbbf24;
  font-weight: 600;
}

.audit-switch {
  flex-shrink: 0;
}

.audit-switch :deep(.el-switch__label) {
  color: rgba(255, 255, 255, 0.55);
}

.audit-switch :deep(.el-switch__label.is-active) {
  color: rgba(255, 255, 255, 0.92);
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















/* 结果 tag（plain 效果在亮色变量下是白底）改为暗色胶囊 */



/* el-alert 默认是亮色浅底：换成深色玻璃 + 高对比文字 */







/* 危险 plain 按钮在亮色变量下是白底红字：改为深色描边款 */



/* 折叠面板：去掉亮色底/分隔线，融入玻璃卡片 */





</style>
