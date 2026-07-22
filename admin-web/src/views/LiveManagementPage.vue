<template>
  <div class="live-page" v-loading="loading">
    <div class="live-header">
      <div class="live-header-left">
        <h2 class="live-title">直播管理</h2>
        <div class="live-status-row">
          <el-tag :type="form.enabled ? 'success' : 'info'" size="small" effect="plain">
            基础直播 {{ form.enabled ? '开' : '关' }}
          </el-tag>
          <el-tag :type="webBiliForm.enabled ? 'success' : 'info'" size="small" effect="plain">
            网页24小时直播阵列 {{ webBiliForm.enabled ? '开' : '关' }}
          </el-tag>
          <el-tag :type="coverForm.enabled ? 'success' : 'info'" size="small" effect="plain">
            自定义封面 {{ coverForm.enabled ? '开' : '关' }}
          </el-tag>
          <el-tag :type="fallbackForm.enabled ? 'success' : 'info'" size="small" effect="plain">
            推荐引导 {{ fallbackForm.enabled ? '开' : '关' }}
          </el-tag>
          <el-tag :type="demoForm.active ? 'success' : 'info'" size="small" effect="plain">
            演示 {{ demoForm.active ? '运行中' : '关' }}
          </el-tag>
        </div>
      </div>
    </div>

    <div class="live-grid">
      <!-- 基础直播 -->
      <section class="live-card">
        <div class="live-card-head">
          <div>
            <h3 class="live-card-title">基础直播配置</h3>
            <p class="live-card-desc">房间号、平台与推流信息</p>
          </div>
          <el-button type="primary" size="small" :loading="saving" @click="onSave">保存</el-button>
        </div>
        <el-form :model="form" label-position="top" class="live-compact-form">
          <div class="field-row">
            <el-form-item label="启用直播">
              <el-switch v-model="form.enabled" />
            </el-form-item>
            <el-form-item label="平台">
              <el-select v-model="form.platform" placeholder="选择平台" style="width: 100%">
                <el-option label="微信直播" value="微信直播" />
                <el-option label="B站" value="B站" />
                <el-option label="YouTube" value="YouTube" />
                <el-option label="其他" value="其他" />
              </el-select>
            </el-form-item>
          </div>
          <div class="field-row">
            <el-form-item label="房间号">
              <el-input v-model="form.roomId" placeholder="房间号" />
            </el-form-item>
            <el-form-item label="标题">
              <el-input v-model="form.title" placeholder="直播标题" />
            </el-form-item>
          </div>
          <el-form-item label="封面 URL">
            <el-input v-model="form.coverUrl" placeholder="封面图片链接" clearable />
          </el-form-item>
          <el-form-item label="直播流 URL">
            <el-input v-model="form.streamUrl" placeholder="直播流地址" clearable />
          </el-form-item>
        </el-form>
      </section>

      <!-- 公众网页 B 站直播 -->
      <section class="live-card">
        <div class="live-card-head">
          <div>
            <h3 class="live-card-title">公众网页 · 24小时直播阵列</h3>
            <p class="live-card-desc">内容站「工具 → 24小时直播阵列」按下方房间列表展示（默认一行两个）</p>
          </div>
          <el-button type="primary" size="small" :loading="webBiliSaving" @click="onSaveWebBili">保存</el-button>
        </div>
        <el-form :model="webBiliForm" label-position="top" class="live-compact-form">
          <div class="field-row">
            <el-form-item label="启用嵌入">
              <el-switch v-model="webBiliForm.enabled" />
            </el-form-item>
            <el-form-item label=" ">
              <el-button size="small" @click="addWebBiliRoom">添加房间</el-button>
            </el-form-item>
          </div>

          <div
            v-for="(room, idx) in webBiliForm.rooms"
            :key="'web-bili-room-' + idx"
            class="web-bili-room"
          >
            <div class="web-bili-room__head">
              <span class="web-bili-room__label">机位 {{ idx + 1 }}</span>
              <el-button
                link
                type="danger"
                size="small"
                :disabled="webBiliForm.rooms.length <= 1"
                @click="removeWebBiliRoom(idx)"
              >
                删除
              </el-button>
            </div>
            <div class="field-row">
              <el-form-item label="房间号">
                <el-input
                  v-model="room.roomId"
                  placeholder="如 390508，也可粘贴直播间链接"
                  @change="onWebBiliRoomChange(idx)"
                />
              </el-form-item>
              <el-form-item label="机位名称">
                <el-input
                  v-model="room.title"
                  placeholder="如 塔架总览 / 海上视角"
                  clearable
                  maxlength="60"
                  show-word-limit
                />
              </el-form-item>
            </div>
            <el-form-item label="打开链接（可选）">
              <el-input
                v-model="room.link"
                placeholder="默认 https://live.bilibili.com/{房间号}"
                clearable
              />
            </el-form-item>
            <el-form-item label="嵌入播放地址（可选）">
              <el-input
                v-model="room.embedUrl"
                type="textarea"
                :rows="2"
                placeholder="留空则使用 B 站官方嵌入页 + 房间号"
                clearable
              />
            </el-form-item>
          </div>
          <div class="form-tip">配置几个机位，内容站就展示几路；机位名称会出现在阵列卡片上。默认一行主画面 + 下方副画面可点「设为主看」。</div>
        </el-form>
      </section>

      <!-- 监控页背景封面 -->
      <section class="live-card" v-loading="coverLoading">
        <div class="live-card-head">
          <div>
            <h3 class="live-card-title">监控页背景封面</h3>
            <p class="live-card-desc">直播观看板块背景图/循环视频，保存后自动万象转码</p>
          </div>
          <el-button type="primary" size="small" :loading="coverSaving" @click="onSaveCoverConfig">保存</el-button>
        </div>

        <div class="cover-layout">
          <div class="cover-preview-pane">
            <div class="cover-preview-frame">
              <template v-if="coverForm.coverType !== 'default' && coverPlaybackUrl">
                <video
                  v-if="coverForm.coverType === 'video' || isCoverVideoUrl(coverForm.mediaUrl)"
                  :key="coverPlaybackUrl"
                  :src="coverPlaybackUrl"
                  :poster="coverForm.posterUrl || undefined"
                  class="cover-preview-media"
                  muted
                  loop
                  autoplay
                  playsinline
                />
                <img v-else :key="coverForm.mediaUrl" :src="coverForm.mediaUrl" class="cover-preview-media" alt="封面预览" />
              </template>
              <div v-else class="cover-preview-empty">
                <span>未设置自定义封面</span>
                <span class="cover-preview-empty-sub">选择图片或视频后在此预览</span>
              </div>
              <div v-if="coverForm.enabled && coverForm.showLiveBadge" class="cover-live-tag">
                <span class="cover-live-eq" aria-hidden="true">
                  <span class="cover-live-eq-bar"></span>
                  <span class="cover-live-eq-bar"></span>
                  <span class="cover-live-eq-bar"></span>
                </span>
                <span class="cover-live-tag-text">直播中</span>
              </div>
            </div>
            <div v-if="coverForm.coverType === 'video' && coverForm.mediaUrl" class="cover-transcode-bar">
              <el-tag v-if="coverForm.previewStatus === 'ready'" type="success" size="small">预览就绪</el-tag>
              <el-tag v-else-if="coverForm.previewStatus === 'processing' || coverForm.previewStatus === 'pending'" type="info" size="small">转码中</el-tag>
              <el-tag v-else-if="coverForm.previewStatus === 'failed'" type="danger" size="small">转码失败</el-tag>
              <el-tag v-else type="info" size="small">未转码</el-tag>
              <el-tag v-if="coverDirty" type="warning" size="small">未保存</el-tag>
              <el-button size="small" text type="primary" :loading="coverRefreshing" @click="refreshCoverPreview">刷新</el-button>
              <span v-if="coverForm.previewError" class="form-tip danger">{{ coverForm.previewError }}</span>
            </div>
            <div class="form-tip" style="margin-top:6px;">上传新媒体后会自动保存并转码；点「刷新」仅查询转码状态</div>
          </div>

          <el-form :model="coverForm" label-position="top" class="live-compact-form cover-form">
            <div class="field-row field-row-3">
              <el-form-item label="启用">
                <el-switch v-model="coverForm.enabled" />
              </el-form-item>
              <el-form-item label="直播中角标">
                <el-switch v-model="coverForm.showLiveBadge" />
              </el-form-item>
              <el-form-item label="类型">
                <el-radio-group v-model="coverForm.coverType" size="small">
                  <el-radio-button label="default">默认</el-radio-button>
                  <el-radio-button label="image">图片</el-radio-button>
                  <el-radio-button label="video">视频</el-radio-button>
                </el-radio-group>
              </el-form-item>
            </div>

            <el-form-item v-if="coverForm.coverType !== 'default'" label="封面媒体">
              <div class="compact-upload">
                <CosUpload
                  v-model="coverForm.mediaUrl"
                  path-prefix="直播观看/"
                  :accept="coverForm.coverType === 'video' ? 'video/*' : 'image/*,video/*'"
                  :button-text="coverForm.coverType === 'video' ? '上传视频' : '上传媒体'"
                  placeholder="粘贴 COS URL"
                  @success="onCoverMediaChange"
                />
              </div>
              <div class="form-tip">建议 16:9，视频 ≤ 30MB</div>
            </el-form-item>

            <el-form-item v-if="coverForm.coverType === 'video'" label="海报（可选）">
              <div class="compact-upload">
                <CosUpload
                  v-model="coverForm.posterUrl"
                  path-prefix="直播观看/"
                  accept="image/*"
                  button-text="上传海报"
                  placeholder="可空，保存后自动截帧"
                />
              </div>
            </el-form-item>

            <el-form-item label="展示标题">
              <el-input v-model="coverForm.title" placeholder="可留空" maxlength="40" show-word-limit />
            </el-form-item>
            <el-form-item label="点击跳转">
              <el-select v-model="coverForm.linkMode" style="width: 100%">
                <el-option label="自动（直播中官方播放器）" value="auto" />
                <el-option label="始终自定义封面" value="custom" />
                <el-option label="直播中强制官方播放器" value="official" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>
      </section>

      <!-- 推荐引导 -->
      <section class="live-card" v-loading="fallbackLoading">
        <div class="live-card-head">
          <div>
            <h3 class="live-card-title">推荐视频号引导</h3>
            <p class="live-card-desc">自己未开播时弹出对方主页二维码</p>
          </div>
          <el-button type="primary" size="small" :loading="fallbackSaving" @click="onSaveFallbackGuide">保存</el-button>
        </div>

        <div class="fallback-layout">
          <div class="fallback-qr-pane">
            <div class="fallback-qr-frame">
              <img v-if="fallbackForm.qrUrl" :key="fallbackForm.qrUrl" :src="fallbackForm.qrUrl" class="fallback-qr-img" alt="二维码" />
              <div v-else class="cover-preview-empty">
                <span>二维码预览</span>
              </div>
            </div>
            <div class="compact-upload">
              <CosUpload
                v-model="fallbackForm.qrUrl"
                path-prefix="二维码/"
                accept="image/*"
                button-text="上传二维码"
                placeholder="粘贴二维码 URL"
                @success="onFallbackQrChange"
              />
            </div>
            <div class="form-tip">请用视频号「主页二维码」，勿用单场预约码；上传后会自动保存</div>
          </div>

          <el-form :model="fallbackForm" label-position="top" class="live-compact-form">
            <el-form-item label="启用引导">
              <el-switch v-model="fallbackForm.enabled" />
            </el-form-item>
            <div class="field-row">
              <el-form-item label="弹窗标题">
                <el-input v-model="fallbackForm.title" placeholder="推荐观看" maxlength="20" show-word-limit />
              </el-form-item>
              <el-form-item label="视频号名称">
                <el-input v-model="fallbackForm.nickname" placeholder="如：空天动力瞭望" maxlength="40" show-word-limit />
              </el-form-item>
            </div>
            <el-form-item label="引导文案">
              <el-input
                v-model="fallbackForm.tip"
                type="textarea"
                :rows="3"
                placeholder="扫码前往视频号主页，可预约或观看直播"
                maxlength="80"
                show-word-limit
              />
            </el-form-item>
          </el-form>
        </div>
      </section>

      <!-- 演示模式 -->
      <section class="live-card live-card-demo">
        <div class="live-card-head">
          <div>
            <h3 class="live-card-title">演示模式</h3>
            <p class="live-card-desc">直播讲解远程控制与配音</p>
          </div>
          <div class="demo-toggle">
            <el-switch v-model="demoForm.active" @change="onDemoToggle" />
            <el-tag v-if="demoForm.active" type="success" size="small">运行中</el-tag>
            <el-tag v-else type="info" size="small">已关闭</el-tag>
          </div>
        </div>

        <el-form label-position="top" class="live-compact-form">
          <div class="field-row">
            <el-form-item label="演示脚本">
              <el-select v-model="demoForm.scriptName" style="width: 100%" @change="onScriptChange">
                <el-option
                  v-for="s in scriptList"
                  :key="s.name"
                  :label="`${s.title}（${s.stepCount} 步）`"
                  :value="s.name"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="直播账号 openid">
              <el-input v-model="demoForm.liveOpenid" placeholder="仅此账号可见演示" clearable />
            </el-form-item>
          </div>

          <el-form-item label="远程控制">
            <div class="demo-remote-controls">
              <el-button size="small" @click="sendCommand('start')" :disabled="!demoForm.active">开始</el-button>
              <el-button size="small" @click="sendCommand('prev')" :disabled="!demoForm.active">上一步</el-button>
              <el-button size="small" @click="sendCommand('next')" :disabled="!demoForm.active">下一步</el-button>
              <el-button size="small" type="danger" @click="sendCommand('stop')" :disabled="!demoForm.active">停止</el-button>
              <div class="demo-goto">
                <el-input-number v-model="demoForm.gotoStep" :min="1" :max="99" size="small" controls-position="right" />
                <el-button size="small" @click="sendCommand('goto')" :disabled="!demoForm.active">跳转</el-button>
              </div>
            </div>
          </el-form-item>

          <el-form-item :label="`脚本配音 · ${currentScriptTitle || ''}`">
            <div class="audio-row">
              <el-input
                v-model="scriptAudioUrl"
                placeholder="整段配音 COS/CDN 地址"
                clearable
              />
              <el-button type="primary" size="small" :loading="savingAudio" @click="saveAudioUrl">保存配音</el-button>
              <el-tag v-if="scriptAudioUrl" type="success" size="small">已配置</el-tag>
              <el-tag v-else type="info" size="small">静音</el-tag>
            </div>
          </el-form-item>
        </el-form>

        <div v-if="currentSteps.length" class="script-steps-wrap">
          <div class="audio-label">步骤预览（{{ currentSteps.length }}）</div>
          <div class="script-steps">
            <div
              v-for="(step, idx) in currentSteps"
              :key="idx"
              class="script-step-item"
            >
              <span class="step-index">{{ idx + 1 }}</span>
              <span class="step-action">{{ step.action }}</span>
              <span class="step-bubble">{{ step.bubble || step.page || (step.scrollTop !== undefined ? '滚动 ' + step.scrollTop : '-') }}</span>
              <span class="step-delay">{{ step.delay ? (step.delay / 1000) + 's' : '-' }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import CosUpload from '../components/CosUpload.vue'

const form = reactive({
  enabled: false,
  roomId: '',
  platform: '',
  title: '',
  coverUrl: '',
  streamUrl: ''
})

const webBiliForm = reactive({
  enabled: true,
  rooms: [{ roomId: '390508', title: '', link: '', embedUrl: '' }]
})
const webBiliSaving = ref(false)

function emptyWebBiliRoom() {
  return { roomId: '', title: '', link: '', embedUrl: '' }
}

function extractBiliRoomId(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const m = s.match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d{3,})/i)
  if (m) return m[1]
  if (/^\d{3,}$/.test(s)) return s
  return ''
}

function defaultWebBiliEmbedUrl(roomId) {
  return `https://www.bilibili.com/blackboard/live/live-activity-player.html?cid=${roomId}&mute=1&danmaku=0&logo=0&recommend=0`
}

function onWebBiliRoomChange(idx) {
  const room = webBiliForm.rooms[idx]
  if (!room) return
  const extracted = extractBiliRoomId(room.roomId) || extractBiliRoomId(room.link)
  if (!extracted) return
  room.roomId = extracted
  room.link = `https://live.bilibili.com/${extracted}`
  room.embedUrl = defaultWebBiliEmbedUrl(extracted)
}

function addWebBiliRoom() {
  webBiliForm.rooms.push(emptyWebBiliRoom())
}

function removeWebBiliRoom(idx) {
  if (webBiliForm.rooms.length <= 1) return
  webBiliForm.rooms.splice(idx, 1)
}

function normalizeWebBiliRoomsFromConfig(data) {
  const list = Array.isArray(data && data.publicBiliRooms) ? data.publicBiliRooms : []
  const rooms = list
    .map((r) => ({
      roomId: String((r && (r.roomId || r.room_id)) || '').trim(),
      title: String((r && r.title) || '').trim(),
      link: String((r && r.link) || '').trim(),
      embedUrl: String((r && (r.embedUrl || r.embed_url)) || '').trim()
    }))
    .filter((r) => r.roomId || r.link)
  if (rooms.length) return rooms
  return [
    {
      roomId: String((data && (data.publicBiliRoomId || data.roomId)) || '390508'),
      title: String((data && data.publicBiliTitle) || '').trim(),
      link: String((data && data.publicBiliLink) || '').trim(),
      embedUrl: String((data && data.publicBiliEmbedUrl) || '').trim()
    }
  ]
}

const fallbackForm = reactive({
  enabled: false,
  title: '推荐观看',
  nickname: '',
  qrUrl: '',
  tip: '扫码前往视频号主页，可预约或观看直播'
})

const coverForm = reactive({
  enabled: false,
  coverType: 'default',
  mediaUrl: '',
  previewUrl: '',
  posterUrl: '',
  previewStatus: '',
  previewError: '',
  title: '',
  linkMode: 'auto',
  showLiveBadge: true
})

/** 服务端已保存的封面快照，用于判断未保存 / 预览是否过期 */
const coverSavedSnapshot = ref({
  mediaUrl: '',
  posterUrl: '',
  title: '',
  linkMode: 'auto',
  enabled: false,
  showLiveBadge: true,
  coverType: 'default'
})

const demoForm = reactive({
  active: false,
  scriptName: 'fullTour',
  liveOpenid: '',
  gotoStep: 1
})

const saving = ref(false)
const fallbackSaving = ref(false)
const fallbackLoading = ref(false)
const coverSaving = ref(false)
const coverLoading = ref(false)
const coverRefreshing = ref(false)
const savingAudio = ref(false)
const loading = ref(false)

function isCoverVideoUrl(url) {
  return /\.(mp4|mov|m4v|webm|m3u8)(\?|#|$)/i.test(String(url || ''))
}

/** 仅转码就绪时用压缩预览，否则播原片，避免旧 previewUrl 盖住新视频 */
const coverPlaybackUrl = computed(() => {
  if (coverForm.coverType === 'video' || isCoverVideoUrl(coverForm.mediaUrl)) {
    if (coverForm.previewStatus === 'ready' && coverForm.previewUrl) {
      return coverForm.previewUrl
    }
    return coverForm.mediaUrl || ''
  }
  return coverForm.mediaUrl || ''
})

const coverDirty = computed(() => {
  const s = coverSavedSnapshot.value
  return (
    !!coverForm.enabled !== !!s.enabled ||
    coverForm.coverType !== s.coverType ||
    String(coverForm.mediaUrl || '') !== String(s.mediaUrl || '') ||
    String(coverForm.posterUrl || '') !== String(s.posterUrl || '') ||
    String(coverForm.title || '') !== String(s.title || '') ||
    coverForm.linkMode !== s.linkMode ||
    !!coverForm.showLiveBadge !== !!s.showLiveBadge
  )
})

function syncCoverSnapshot(data) {
  const src = data || coverForm
  coverSavedSnapshot.value = {
    mediaUrl: src.mediaUrl || '',
    posterUrl: src.posterUrl || '',
    title: src.title || '',
    linkMode: src.linkMode || 'auto',
    enabled: !!src.enabled,
    showLiveBadge: src.showLiveBadge !== false,
    coverType: src.coverType || 'default'
  }
}

function applyCoverForm(data) {
  if (!data) return
  coverForm.enabled = !!data.enabled
  coverForm.coverType = data.coverType || 'default'
  coverForm.mediaUrl = data.mediaUrl || ''
  coverForm.previewUrl = data.previewUrl || ''
  coverForm.posterUrl = data.posterUrl || ''
  coverForm.previewStatus = data.previewStatus || ''
  coverForm.previewError = data.previewError || ''
  coverForm.title = data.title || ''
  coverForm.linkMode = data.linkMode || 'auto'
  coverForm.showLiveBadge = data.showLiveBadge !== false
  syncCoverSnapshot(coverForm)
}

async function onCoverMediaChange(url) {
  const u = String(url || '').trim()
  if (!u) return
  // 新媒体立刻清掉旧转码预览，左侧改播原片
  coverForm.previewUrl = ''
  coverForm.posterUrl = ''
  coverForm.previewError = ''
  if (/\.(mp4|mov|m4v|webm|m3u8)(\?|#|$)/i.test(u)) {
    coverForm.coverType = 'video'
    coverForm.previewStatus = 'pending'
  } else if (/\.(jpe?g|png|gif|webp|bmp)(\?|#|$)/i.test(u)) {
    coverForm.coverType = 'image'
    coverForm.previewStatus = ''
  }
  // 上传即保存，避免只点「刷新」把未入库的新媒体冲掉
  await onSaveCoverConfig({ fromUpload: true })
}

const scriptAudioUrl = ref('')

const scriptList = ref([
  { name: 'fullTour', title: '🚀 火星探索日志 · 全功能巡览', stepCount: 31 },
  { name: 'starlinkDemo', title: '🛰️ Starlink 卫星追踪演示', stepCount: 14 },
  { name: 'launchDemo', title: '🔥 发射任务追踪演示', stepCount: 18 }
])

const currentScriptTitle = computed(() => {
  const s = scriptList.value.find(s => s.name === demoForm.scriptName)
  return s ? s.title : ''
})

const scriptSteps = {
  fullTour: [
    { action: 'navigate', page: '/pages/index/index', delay: 1000 },
    { action: 'bubble', bubble: '欢迎来到火星探索日志', delay: 4000 },
    { action: 'scroll', scrollTop: 200, delay: 2000 },
    { action: 'scroll', scrollTop: 500, delay: 2500 },
    { action: 'scroll', scrollTop: 800, delay: 2500 },
    { action: 'scroll', scrollTop: 0, delay: 2000 },
    { action: 'bubble', bubble: '发射任务实时倒计时', delay: 3500 },
    { action: 'navigate', page: '/pages/monitor/monitor', delay: 1500 },
    { action: 'bubble', bubble: '监控中心 — 系统神经中枢', delay: 3500 },
    { action: 'scroll', scrollTop: 300, delay: 2500 },
    { action: 'scroll', scrollTop: 600, delay: 2500 },
    { action: 'bubble', bubble: 'Starlink 卫星实时追踪', delay: 3500 },
    { action: 'scroll', scrollTop: 900, delay: 2500 },
    { action: 'scroll', scrollTop: 0, delay: 2000 },
    { action: 'navigate', page: '/pages/progress/progress', delay: 1500 },
    { action: 'bubble', bubble: '星舰 — 人类最强运载火箭', delay: 3500 },
    { action: 'scroll', scrollTop: 300, delay: 2500 },
    { action: 'scroll', scrollTop: 600, delay: 2500 },
    { action: 'scroll', scrollTop: 0, delay: 2000 },
    { action: 'navigate', page: '/pages/news/news', delay: 1500 },
    { action: 'bubble', bubble: '全球航天动态 · AI 智能搜索', delay: 3500 },
    { action: 'scroll', scrollTop: 400, delay: 2500 },
    { action: 'scroll', scrollTop: 0, delay: 2000 },
    { action: 'navigate', page: '/pages/profile/profile', delay: 1500 },
    { action: 'bubble', bubble: '个人中心 — 签到 · 成就 · 竞猜', delay: 3500 },
    { action: 'scroll', scrollTop: 400, delay: 2500 },
    { action: 'scroll', scrollTop: 800, delay: 2500 },
    { action: 'scroll', scrollTop: 0, delay: 2000 },
    { action: 'navigate', page: '/pages/index/index', delay: 1000 },
    { action: 'qrcode', bubble: '扫码加入，星辰大海是日常', delay: 8000 }
  ],
  starlinkDemo: [
    { action: 'navigate', page: '/pages/index/index', delay: 1000 },
    { action: 'bubble', bubble: '今晚，亲眼看到星链卫星', delay: 4000 },
    { action: 'navigate', page: '/pages/monitor/monitor', delay: 1500 },
    { action: 'bubble', bubble: '监控中心 — 卫星追踪指挥台', delay: 3500 },
    { action: 'scroll', scrollTop: 200, delay: 2000 },
    { action: 'scroll', scrollTop: 400, delay: 2500 },
    { action: 'bubble', bubble: 'Starlink 全球实时分布', delay: 3500 },
    { action: 'scroll', scrollTop: 600, delay: 2500 },
    { action: 'bubble', bubble: '过境预报 — 精确到分钟', delay: 4000 },
    { action: 'scroll', scrollTop: 800, delay: 2500 },
    { action: 'bubble', bubble: '方位角 · 仰角 · 亮度', delay: 3500 },
    { action: 'scroll', scrollTop: 0, delay: 2000 },
    { action: 'navigate', page: '/pages/index/index', delay: 1000 },
    { action: 'qrcode', bubble: '扫码查看今晚过境预报', delay: 8000 }
  ],
  launchDemo: [
    { action: 'navigate', page: '/pages/index/index', delay: 1000 },
    { action: 'bubble', bubble: '全球发射任务追踪', delay: 4000 },
    { action: 'scroll', scrollTop: 300, delay: 2500 },
    { action: 'bubble', bubble: '倒计时实时跳动', delay: 3500 },
    { action: 'scroll', scrollTop: 600, delay: 2500 },
    { action: 'bubble', bubble: '任务卡片 — 作战简报', delay: 3500 },
    { action: 'scroll', scrollTop: 900, delay: 2500 },
    { action: 'scroll', scrollTop: 0, delay: 2000 },
    { action: 'navigate', page: '/pages/monitor/monitor', delay: 1500 },
    { action: 'bubble', bubble: '发射场地图 · 轨道可视化', delay: 3500 },
    { action: 'scroll', scrollTop: 300, delay: 2500 },
    { action: 'scroll', scrollTop: 0, delay: 2000 },
    { action: 'navigate', page: '/pages/news/news', delay: 1500 },
    { action: 'bubble', bubble: '航天百科 · 多维度搜索', delay: 3500 },
    { action: 'scroll', scrollTop: 300, delay: 2500 },
    { action: 'scroll', scrollTop: 0, delay: 2000 },
    { action: 'navigate', page: '/pages/index/index', delay: 1000 },
    { action: 'qrcode', bubble: '扫码开始太空追踪之旅', delay: 8000 }
  ]
}

const currentSteps = computed(() => scriptSteps[demoForm.scriptName] || [])

function onScriptChange() {
  loadAudioUrls()
}

async function loadConfig() {
  loading.value = true
  try {
    const data = await api.getLiveConfig()
    if (data) {
      form.enabled = !!data.enabled
      form.roomId = data.roomId || ''
      form.platform = data.platform || ''
      form.title = data.title || ''
      form.coverUrl = data.coverUrl || ''
      form.streamUrl = data.streamUrl || ''
      webBiliForm.enabled = data.publicBiliEnabled !== false
      webBiliForm.rooms = normalizeWebBiliRoomsFromConfig(data)
    }
  } catch (e) {
    ElMessage.error(e.message || '加载配置失败')
  }

  try {
    const demoData = await api.getDemoConfig()
    if (demoData) {
      demoForm.active = !!demoData.active
      demoForm.scriptName = demoData.scriptName || 'fullTour'
      demoForm.liveOpenid = demoData.liveOpenid || ''
    }
  } catch (e) {}

  await loadCoverConfig()
  await loadFallbackGuide()
  await loadAudioUrls()
  loading.value = false
}

async function loadCoverConfig() {
  coverLoading.value = true
  try {
    const data = await api.getChannelsLiveCoverConfig()
    applyCoverForm(data)
  } catch (e) {
    ElMessage.error(e.message || '加载直播封面失败')
  } finally {
    coverLoading.value = false
  }
}

async function refreshCoverPreview() {
  if (coverDirty.value) {
    ElMessage.warning('当前有未保存的修改，请先点「保存」，再刷新转码状态')
    return
  }
  coverRefreshing.value = true
  try {
    const data = await api.getChannelsLiveCoverConfig()
    applyCoverForm(data)
    if (data && data.previewStatus === 'ready') {
      ElMessage.success('预览已就绪')
    } else if (data && (data.previewStatus === 'processing' || data.previewStatus === 'pending')) {
      ElMessage.info('仍在转码中，请稍后再刷新')
    } else if (data && data.previewStatus === 'failed') {
      ElMessage.warning(data.previewError || '转码失败')
    }
  } catch (e) {
    ElMessage.error(e.message || '刷新失败')
  } finally {
    coverRefreshing.value = false
  }
}

async function onSaveCoverConfig(opts = {}) {
  if (coverForm.enabled && coverForm.coverType !== 'default' && !String(coverForm.mediaUrl || '').trim()) {
    ElMessage.warning('请先上传封面媒体')
    return
  }
  coverSaving.value = true
  try {
    const saved = await api.updateChannelsLiveCoverConfig({
      enabled: !!coverForm.enabled,
      coverType: coverForm.coverType,
      mediaUrl: coverForm.mediaUrl,
      posterUrl: coverForm.posterUrl,
      title: coverForm.title,
      linkMode: coverForm.linkMode,
      showLiveBadge: !!coverForm.showLiveBadge
    })
    applyCoverForm(saved)
    const pending = saved && saved.coverType === 'video' && saved.previewStatus !== 'ready' && saved.previewStatus !== 'failed'
    if (opts.fromUpload) {
      ElMessage.success(pending ? '新媒体已保存，正在转码（约 1–3 分钟）' : '新媒体已保存')
    } else {
      ElMessage.success(pending ? '已保存，视频正在转码（约 1–3 分钟）' : '封面配置已保存')
    }
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    coverSaving.value = false
  }
}

async function loadFallbackGuide() {
  fallbackLoading.value = true
  try {
    const data = await api.getChannelsLiveFallbackGuide()
    if (data) {
      fallbackForm.enabled = !!data.enabled
      fallbackForm.title = data.title || '推荐观看'
      fallbackForm.nickname = data.nickname || ''
      fallbackForm.qrUrl = data.qrUrl || ''
      fallbackForm.tip = data.tip || '扫码前往视频号主页，可预约或观看直播'
    }
  } catch (e) {
    ElMessage.error(e.message || '加载推荐引导失败')
  } finally {
    fallbackLoading.value = false
  }
}

async function onFallbackQrChange(url) {
  const u = String(url || '').trim()
  if (!u) return
  fallbackForm.qrUrl = u
  await onSaveFallbackGuide({ fromUpload: true })
}

async function onSaveFallbackGuide(opts = {}) {
  if (fallbackForm.enabled && !String(fallbackForm.nickname || '').trim()) {
    ElMessage.warning('请填写视频号名称')
    return
  }
  if (fallbackForm.enabled && !String(fallbackForm.qrUrl || '').trim()) {
    ElMessage.warning('请上传或填写主页二维码')
    return
  }
  fallbackSaving.value = true
  try {
    const submittedUrl = String(fallbackForm.qrUrl || '').trim()
    const saved = await api.updateChannelsLiveFallbackGuide({
      enabled: !!fallbackForm.enabled,
      title: fallbackForm.title,
      nickname: fallbackForm.nickname,
      qrUrl: submittedUrl,
      tip: fallbackForm.tip
    })
    // 保存后再读一次，确认云端已是新图
    let confirmed = saved
    try {
      confirmed = await api.getChannelsLiveFallbackGuide() || saved
    } catch (e) {}
    if (confirmed) {
      fallbackForm.enabled = !!confirmed.enabled
      fallbackForm.title = confirmed.title || fallbackForm.title
      fallbackForm.nickname = confirmed.nickname || ''
      fallbackForm.qrUrl = confirmed.qrUrl || ''
      fallbackForm.tip = confirmed.tip || fallbackForm.tip
    }
    const cloudUrl = String((confirmed && confirmed.qrUrl) || '').trim()
    if (cloudUrl && cloudUrl !== submittedUrl) {
      ElMessage.warning('云端二维码与刚提交的不一致，请重试保存')
    } else {
      ElMessage.success(opts.fromUpload ? '新二维码已保存到云端' : '推荐引导已保存到云端')
    }
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    fallbackSaving.value = false
  }
}

async function loadAudioUrls() {
  try {
    const data = await api.getDemoAudioUrls(demoForm.scriptName)
    scriptAudioUrl.value = (data && data.audioUrl) || (data && data.audioUrls && data.audioUrls[0]) || ''
  } catch (e) {
    scriptAudioUrl.value = ''
  }
}

async function saveAudioUrl() {
  savingAudio.value = true
  try {
    await api.updateDemoAudioUrls({
      scriptName: demoForm.scriptName,
      audioUrl: scriptAudioUrl.value,
      audioUrls: scriptAudioUrl.value ? [scriptAudioUrl.value] : []
    })
    ElMessage.success('配音配置已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    savingAudio.value = false
  }
}

async function onSave() {
  saving.value = true
  try {
    await api.updateLiveConfig(form)
    ElMessage.success('保存成功')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function onSaveWebBili() {
  webBiliSaving.value = true
  try {
    webBiliForm.rooms.forEach((_, idx) => onWebBiliRoomChange(idx))
    const rooms = webBiliForm.rooms
      .map((r) => {
        const roomId = extractBiliRoomId(r.roomId) || extractBiliRoomId(r.link) || String(r.roomId || '').trim()
        if (!roomId) return null
        return {
          roomId,
          title: String(r.title || '').trim(),
          link: String(r.link || '').trim() || `https://live.bilibili.com/${roomId}`,
          embedUrl: defaultWebBiliEmbedUrl(roomId)
        }
      })
      .filter(Boolean)
    if (!rooms.length) {
      ElMessage.warning('请至少填写一个有效房间号')
      return
    }
    const first = rooms[0]
    await api.updateLiveConfig({
      publicBiliEnabled: webBiliForm.enabled,
      publicBiliRooms: rooms,
      // 兼容旧字段：同步第一个房间
      publicBiliRoomId: first.roomId,
      publicBiliLink: first.link,
      publicBiliEmbedUrl: first.embedUrl,
      publicBiliTitle: first.title
    })
    webBiliForm.rooms = rooms
    ElMessage.success('公众网页24小时直播阵列配置已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    webBiliSaving.value = false
  }
}

async function onDemoToggle(val) {
  try {
    await api.updateDemoConfig({
      active: val,
      scriptName: demoForm.scriptName,
      liveOpenid: demoForm.liveOpenid,
      liveAccountOpenids: demoForm.liveOpenid ? [demoForm.liveOpenid] : []
    })
    ElMessage.success(val ? '演示模式已开启' : '演示模式已关闭')
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
    demoForm.active = !val
  }
}

async function sendCommand(cmd) {
  try {
    const payload = {
      command: cmd,
      scriptName: demoForm.scriptName,
      timestamp: Date.now()
    }
    if (cmd === 'goto') {
      payload.step = (demoForm.gotoStep || 1) - 1
    }
    await api.sendDemoCommand(payload)
    ElMessage.success(`指令已发送: ${cmd}`)
  } catch (e) {
    ElMessage.error(e.message || '发送指令失败')
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.live-page {
  padding: 0;
  max-width: 1280px;
}

.live-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 12px;
}

.live-header-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.live-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--t-text-primary, #fff);
}

.live-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.live-grid {
  display: grid;
  grid-template-columns: 1fr 1.15fr;
  gap: 14px;
  align-items: start;
}

.live-card {
  background: var(--t-bg-card, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--t-border-card, rgba(255, 255, 255, 0.08));
  border-radius: 14px;
  padding: 16px 18px;
  min-width: 0;
}

.live-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--t-border-card, rgba(255, 255, 255, 0.06));
}

.live-card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--t-text-primary, #fff);
}

.live-card-desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--t-text-muted, #86868b);
  line-height: 1.4;
}

.live-compact-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.live-compact-form :deep(.el-form-item__label) {
  margin-bottom: 4px !important;
  padding: 0 !important;
  line-height: 1.3;
  font-size: 12px;
  color: var(--t-text-muted, #86868b);
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}

.field-row-3 {
  grid-template-columns: auto auto 1fr;
  align-items: end;
}

.cover-layout,
.fallback-layout {
  display: grid;
  grid-template-columns: minmax(180px, 42%) 1fr;
  gap: 14px;
  align-items: start;
}

.cover-preview-pane,
.fallback-qr-pane {
  min-width: 0;
}

.cover-preview-frame,
.fallback-qr-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  background: #0b0b0f;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.fallback-qr-frame {
  aspect-ratio: 1;
  max-width: 160px;
  margin: 0 auto 10px;
}

.cover-preview-media,
.fallback-qr-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-preview-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--t-text-muted, #86868b);
  font-size: 13px;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(88, 86, 214, 0.18), transparent 55%),
    radial-gradient(ellipse at 80% 80%, rgba(0, 122, 255, 0.12), transparent 50%),
    #0b0b0f;
}

.cover-preview-empty-sub {
  font-size: 11px;
  opacity: 0.7;
}

.cover-live-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  background: linear-gradient(90deg, #ff2d55, #ff453a);
  box-shadow: 0 2px 8px rgba(255, 45, 85, 0.35);
  box-sizing: border-box;
}

.cover-live-tag-text {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  line-height: 1;
  letter-spacing: 0.3px;
}

.cover-live-eq {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 11px;
  flex-shrink: 0;
}

.cover-live-eq-bar {
  display: block;
  width: 2.5px;
  height: 100%;
  border-radius: 999px;
  background: #fff;
  transform-origin: center bottom;
  animation: cover-live-eq 0.8s ease-in-out infinite;
}

.cover-live-eq-bar:nth-child(1) { animation-delay: 0s; }
.cover-live-eq-bar:nth-child(2) { animation-delay: 0.15s; }
.cover-live-eq-bar:nth-child(3) { animation-delay: 0.3s; }

@keyframes cover-live-eq {
  0%, 100% { transform: scaleY(0.35); }
  25% { transform: scaleY(1); }
  50% { transform: scaleY(0.55); }
  75% { transform: scaleY(0.85); }
}

.cover-transcode-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.compact-upload :deep(.adv-drop-zone) {
  padding: 10px 12px;
  min-height: 0;
}

.compact-upload :deep(.adv-drop-zone svg) {
  width: 22px;
  height: 22px;
}

.compact-upload :deep(.adv-drop-title) {
  font-size: 12px;
}

.compact-upload :deep(.adv-drop-hint) {
  font-size: 11px;
}

.compact-upload :deep(.adv-preview-thumb) {
  max-height: 72px;
  width: auto;
}

.compact-upload :deep(.adv-preview-card) {
  max-width: 120px;
}

.form-tip {
  font-size: 11px;
  color: var(--t-text-muted, #86868b);
  margin-top: 4px;
  line-height: 1.4;
}

.web-bili-room {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.web-bili-room__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.web-bili-room__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--t-text-primary, #fff);
}

.form-tip.danger {
  color: #f56c6c;
}

.demo-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.demo-remote-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.demo-goto {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
}

.audio-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.audio-row .el-input {
  flex: 1;
  min-width: 180px;
}

.script-steps-wrap {
  margin-top: 4px;
}

.audio-label {
  font-size: 12px;
  color: var(--t-text-muted, #86868b);
  margin-bottom: 8px;
}

.script-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
  padding-right: 4px;
}

.script-step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--t-bg-input, rgba(255, 255, 255, 0.04));
  border-radius: 6px;
  font-size: 12px;
}

.step-index {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, #007aff, #5856d6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.step-action {
  background: rgba(0, 122, 255, 0.12);
  color: #007aff;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
}

.step-bubble {
  flex: 1;
  color: var(--t-text-regular, rgba(255, 255, 255, 0.85));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-delay {
  color: var(--t-text-muted, #86868b);
  flex-shrink: 0;
  font-size: 11px;
}

@media (max-width: 1100px) {
  .live-grid {
    grid-template-columns: 1fr;
  }

  .cover-layout,
  .fallback-layout {
    grid-template-columns: 1fr;
  }

  .cover-preview-frame {
    max-width: 420px;
  }

  .field-row-3 {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .field-row,
  .field-row-3 {
    grid-template-columns: 1fr;
  }
}
</style>
