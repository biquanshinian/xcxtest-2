<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>任务头图 · 环绕全景</span>
        <el-button type="primary" :loading="saving" @click="onSave">保存配置</el-button>
      </div>
    </template>

    <div class="audit-card">
      <div class="audit-row">
        <div class="audit-info">
          <div class="audit-title">
            <el-tag type="warning" effect="dark" round size="small">送审</el-tag>
            <span class="audit-name">一键过审开关</span>
          </div>
          <div class="audit-desc">
            开启后全方位隐藏：任务详情头图 360、Starbase 设施图「环绕全景」、播放页入口，以及分享/朋友圈单页直达。
            读不到配置视为关闭（failClosed），避免审核员扫码或点分享仍看到。
            与「全局配置中心 → 一键过审」写同一字段 <b>enableOrbitPano</b>，视频绑定会保留。
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
    </div>

    <el-form :model="form" label-width="120px" class="orbit-form">
      <el-form-item label="环绕视频池" class="orbit-pool-item">
        <div class="orbit-pool-layout">
          <div class="orbit-upload-area">
            <div class="orbit-pool-hint">
              上传 Earth Studio 环绕视频后：猎鹰 9 / 重型选「发射场 × 陆地/海上」；星舰选「发射场 / 工位」（基地现有 A/B，并预留 LC-39A）。同轨迹后续任务自动对齐。朱雀、长征等在下方点选任务按型号锁定。
              不回收猎鹰任务详情自动不显示 360。不绑定单次发射、不过期。过审请用上方开关，勿只删视频。
              <span style="margin-left:8px;">已上传 {{ form.items.length }} / {{ MEDIA_MAX }}</span>
            </div>

            <div v-if="form.items.length" class="orbit-media-grid">
              <div
                v-for="(item, idx) in form.items"
                :key="item.id"
                class="orbit-preview"
                :class="{ 'orbit-preview-active': selectedId === item.id }"
                @click="selectItem(item.id)"
              >
                <video
                  :src="item.videoUrl"
                  class="orbit-preview-media"
                  controls
                  :poster="item.posterUrl || undefined"
                  @click.stop
                />
                <div class="orbit-preview-actions">
                  <el-tag size="small" type="warning">{{ idx + 1 }}. 视频</el-tag>
                  <el-button size="small" type="danger" @click.stop="removeAt(idx)">移除</el-button>
                </div>
                <div class="orbit-mission-bound">
                  <span v-if="boundLabel(item)" class="orbit-mission-bound-name">{{ boundLabel(item) }}</span>
                  <span v-else-if="item.rocketName && rocketNeedsPad(item.rocketName)" class="orbit-mission-bound-empty">
                    请重新点选以锁定发射场和回收方式
                  </span>
                  <span v-else-if="item.launchId || item.missionName" class="orbit-mission-bound-empty">
                    请重新点选以锁定型号
                  </span>
                  <span v-else class="orbit-mission-bound-empty">未锁定</span>
                </div>
              </div>
            </div>

            <div v-if="uploadTasks.length" class="upload-tasks">
              <div v-for="(task, i) in uploadTasks" :key="i" class="upload-task-row">
                <span class="task-name">{{ task.name }}</span>
                <el-progress
                  :percentage="task.percent"
                  :status="task.error ? 'exception' : task.percent >= 100 ? 'success' : ''"
                  :stroke-width="6"
                  style="flex:1"
                />
                <span v-if="task.error" class="task-error">{{ task.error }}</span>
              </div>
            </div>

            <div v-if="form.items.length < MEDIA_MAX" class="orbit-source-area">
              <div
                class="drop-zone"
                :class="{ 'drop-zone-active': isDragActive }"
                @dragover.prevent="isDragActive = true"
                @dragleave="isDragActive = false"
                @drop.prevent="onDrop"
                @click="triggerFilePicker"
              >
                <div class="drop-zone-content">
                  <svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 32l8-8 6 6 8-10 10 12"/><rect x="4" y="4" width="40" height="40" rx="4"/><circle cx="14" cy="16" r="3"/></svg>
                  <span class="drop-zone-title">拖拽或点击上传环绕视频</span>
                  <span class="drop-zone-hint">mp4/mov，≤ {{ VIDEO_MAX_MB }}MB · 建议横版 Earth Studio 成片</span>
                </div>
              </div>

              <div class="source-divider">
                <span class="source-divider-text">或</span>
              </div>

              <div class="cos-pick-zone" @click="openCosPicker">
                <div class="drop-zone-content">
                  <svg viewBox="0 0 48 48" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="40" height="32" rx="4"/><path d="M20 8V6a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M16 24h16M16 30h10"/></svg>
                  <span class="drop-zone-title">从 COS 桶选择</span>
                  <span class="drop-zone-hint">默认打开「背景视频」目录</span>
                </div>
              </div>
            </div>

            <div v-else class="orbit-pool-full">已达上限 {{ MEDIA_MAX }} 个，请先移除后再添加</div>

            <input
              ref="fileInputRef"
              type="file"
              accept=".mp4,.mov"
              multiple
              style="display:none"
              @change="onFileInputChange"
            />
          </div>

          <aside class="orbit-mission-panel">
            <div class="orbit-mission-panel-head">
              <div>
                <div class="orbit-mission-panel-title">锁定对齐</div>
                <div class="orbit-mission-panel-sub">
                  {{ selectedItem
                    ? `为「视频 ${selectedIndex + 1}」选择轨迹或型号`
                    : '请先在左侧选中一条视频' }}
                </div>
              </div>
              <el-button size="small" :loading="missionsLoading" @click="refreshMissions">刷新</el-button>
            </div>

            <div v-if="selectedItem" class="orbit-item-fields">
              <el-input
                v-model="selectedItem.title"
                size="small"
                maxlength="40"
                placeholder="展示标题，如 猎鹰9号 SLC-40 海上回收"
              />
              <div v-if="selectedBoundHint" class="orbit-rocket-hint">{{ selectedBoundHint }}</div>
              <div v-else class="orbit-rocket-hint">猎鹰 / 星舰请点下方轨迹；其它型号点选任务</div>
            </div>

            <div class="orbit-falcon-block">
              <div class="orbit-falcon-title">星舰 · 发射场 / 工位</div>
              <div class="orbit-falcon-note">不锁回收。精确工位优先于整场，整场优先于整型号。以后加场只需补一格。</div>
              <div class="orbit-falcon-grid orbit-starship-grid">
                <button
                  v-for="track in SS_TRACKS"
                  :key="track.id"
                  type="button"
                  class="orbit-falcon-option"
                  :disabled="!selectedItem"
                  :class="{ active: isTrackActive(track) }"
                  @click="assignTrack(track)"
                >
                  <span class="orbit-falcon-option-pad">{{ track.padName }}</span>
                  <span class="orbit-falcon-option-rec">{{ track.note }}</span>
                </button>
              </div>
              <div class="orbit-falcon-title">猎鹰 9 号 · 发射场 × 回收</div>
              <div class="orbit-falcon-grid">
                <button
                  v-for="track in F9_TRACKS"
                  :key="track.id"
                  type="button"
                  class="orbit-falcon-option"
                  :disabled="!selectedItem"
                  :class="{ active: isTrackActive(track) }"
                  @click="assignTrack(track)"
                >
                  <span class="orbit-falcon-option-pad">{{ track.padName }}</span>
                  <span class="orbit-falcon-option-rec">{{ track.recoveryName }}</span>
                </button>
              </div>
              <div class="orbit-falcon-title">猎鹰重型 · LC-39A</div>
              <div class="orbit-falcon-grid">
                <button
                  v-for="track in FH_TRACKS"
                  :key="track.id"
                  type="button"
                  class="orbit-falcon-option"
                  :disabled="!selectedItem"
                  :class="{ active: isTrackActive(track) }"
                  @click="assignTrack(track)"
                >
                  <span class="orbit-falcon-option-pad">{{ track.padName }}</span>
                  <span class="orbit-falcon-option-rec">{{ track.recoveryName }}</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              class="orbit-mission-option orbit-mission-option-clear"
              :disabled="!selectedItem"
              :class="{ active: selectedItem && !selectedItem.rocketName && !selectedItem.padKey && !selectedItem.recoveryKey }"
              @click="clearSelectedMission"
            >
              清除绑定
            </button>

            <div class="orbit-other-title">其它型号 · 点选任务锁定</div>
            <div class="orbit-falcon-note">朱雀、长征等按型号常驻。星舰点选任务会自动带出工位，也可用上方格子。</div>
            <el-radio-group
              v-model="missionTab"
              size="small"
              class="orbit-mission-tabs"
              @change="onMissionTabChange"
            >
              <el-radio-button value="upcoming">即将发射</el-radio-button>
              <el-radio-button value="previous">历史发射</el-radio-button>
            </el-radio-group>

            <div v-loading="missionsLoading" class="orbit-mission-list">
              <button
                v-for="m in displayedMissions"
                :key="m.missionId || m.name"
                type="button"
                class="orbit-mission-option"
                :disabled="!selectedItem"
                :class="{ active: isMissionActive(m) }"
                @click="assignMissionToSelected(m)"
              >
                <span class="orbit-mission-option-name">{{ m.name }}</span>
                <span class="orbit-mission-option-meta">
                  <span v-if="m.rocketName">{{ m.rocketName }}</span>
                  <span v-if="missionPadLabel(m)">{{ missionPadLabel(m) }}</span>
                  <span v-if="missionRecoveryLabel(m)">{{ missionRecoveryLabel(m) }}</span>
                  <span>{{ formatMissionNet(m.launchTime) }}</span>
                  <span v-if="m.status">{{ m.status }}</span>
                </span>
              </button>
              <div v-if="!missionsLoading && !displayedMissions.length" class="orbit-mission-empty">
                {{ missionTab === 'previous' ? '暂无历史发射任务，请稍后刷新' : '暂无即将发射任务，请稍后刷新' }}
              </div>
            </div>
          </aside>
        </div>
      </el-form-item>
    </el-form>
  </el-card>

  <el-dialog v-model="cosPickerVisible" title="从 COS 桶选择视频" width="1080px" :close-on-click-modal="false">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item>
          <el-link :underline="false" @click="cosNavigateTo('')">根目录</el-link>
        </el-breadcrumb-item>
        <el-breadcrumb-item v-for="(seg, i) in cosBreadcrumbs" :key="i">
          <el-link :underline="false" @click="cosNavigateTo(seg.prefix)">{{ seg.name }}</el-link>
        </el-breadcrumb-item>
      </el-breadcrumb>
      <el-text type="info" size="small" style="margin-left:auto;">仅显示视频文件 · 点选封面后确认</el-text>
    </div>

    <div v-loading="cosLoading" class="cos-grid-wrap">
      <div v-if="!cosLoading && !cosTableData.length" class="cos-grid-empty">当前目录为空</div>
      <div v-else class="cos-grid">
        <button
          v-for="row in cosTableData"
          :key="row.prefix || row.key || row.name"
          type="button"
          class="cos-card"
          :class="{
            'cos-card--folder': row._type === 'folder',
            'is-active': cosSelectedFile && (cosSelectedFile.key === row.key)
          }"
          @click="onCosRowClick(row)"
          @dblclick="onCosCardDblclick(row)"
        >
          <div class="cos-card-cover">
            <template v-if="row._type === 'folder'">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="#FFCC00">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
              </svg>
            </template>
            <img
              v-else
              :src="cosVideoPosterUrl(row.url)"
              alt=""
              loading="lazy"
              @error="onCosThumbError"
            />
          </div>
          <div class="cos-card-meta">
            <div class="cos-card-name" :title="row.name || row.key || ''">{{ row.name || row.key || '' }}</div>
            <div class="cos-card-sub">
              <template v-if="row._type === 'folder'">文件夹</template>
              <template v-else>{{ cosFormatDate(row.lastModified) }} · {{ cosFormatSize(row.size) }}</template>
            </div>
          </div>
        </button>
      </div>
    </div>

    <div v-if="cosHasMore" style="text-align:center;margin-top:12px;">
      <el-button size="small" @click="cosLoadMore" :loading="cosLoadingMore">加载更多</el-button>
    </div>

    <template #footer>
      <el-button @click="cosPickerVisible = false">取消</el-button>
      <el-button type="primary" :disabled="!cosSelectedFile" @click="onCosConfirm">
        确认选择{{ cosSelectedFile ? ` (${cosSelectedFile.name || cosSelectedFile.key})` : '' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch, watchEffect } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'

const COS_PATH_PREFIX = '背景视频/'
const COS_PICK_PREFIX = '背景视频/'
const MEDIA_MAX = 20
const VIDEO_MAX_MB = 80
const VIDEO_MAX_SIZE = VIDEO_MAX_MB * 1024 * 1024
const ALLOWED_VIDEO_EXTS = ['mp4', 'mov']

const form = reactive({
  enabled: true,
  items: []
})

const saving = ref(false)
const isDragActive = ref(false)
const uploadTasks = ref([])
const fileInputRef = ref(null)
const selectedId = ref('')
const missionTab = ref('upcoming')
const upcomingMissions = ref([])
const previousMissions = ref([])
const previousLoaded = ref(false)
const missionsLoading = ref(false)

const selectedIndex = computed(() =>
  form.items.findIndex((it) => it && it.id === selectedId.value)
)
const selectedItem = computed(() => {
  const idx = selectedIndex.value
  return idx >= 0 ? form.items[idx] : null
})
const selectedBoundHint = computed(() => {
  const item = selectedItem.value
  if (!item || !item.rocketName) return ''
  if (item.padKey || item.padName) {
    const rec = recoveryLabel(item.recoveryKey, item.recoveryName)
    return rec
      ? `已锁定：${item.rocketName} · ${padLabel(item.padKey, item.padName)} · ${rec}（同轨迹常驻，不过期）`
      : `已锁定：${item.rocketName} · ${padLabel(item.padKey, item.padName)}（同场/同工位常驻，不过期）`
  }
  if (rocketNeedsPad(item.rocketName)) {
    return '请在上方点选发射场和陆地/海上，不必翻任务列表'
  }
  if (isStarshipRocket(item.rocketName)) {
    return `已锁定：${item.rocketName}（整型号兜底，未识别工位时也显示）`
  }
  return `已锁定：${item.rocketName}（同型号均显示，不过期）`
})

const displayedMissions = computed(() =>
  missionTab.value === 'previous' ? previousMissions.value : upcomingMissions.value
)

const auditModeView = computed(() => form.enabled === false)

const handleAuditChange = async () => {
  if (!auditModeView.value) {
    try {
      await ElMessageBox.confirm(
        '将关闭环绕全景（enableOrbitPano=false）。任务详情 360、设施图入口、播放页与分享直达全部隐藏，视频绑定保留。确认后自动保存。是否继续？',
        '开启过审模式',
        { type: 'warning', confirmButtonText: '确定关闭并保存', cancelButtonText: '取消' }
      )
    } catch (e) {
      return false
    }
    form.enabled = false
    await onSave()
    return false
  }
  try {
    await ElMessageBox.confirm(
      '将恢复环绕全景展示（enableOrbitPano=true）。确认后自动保存。是否继续？',
      '关闭过审模式',
      { type: 'info', confirmButtonText: '确定恢复并保存', cancelButtonText: '取消' }
    )
  } catch (e) {
    return false
  }
  form.enabled = true
  await onSave()
  return false
}

function selectItem(id) {
  selectedId.value = id || ''
}

function ensureSelected() {
  if (!form.items.length) {
    selectedId.value = ''
    return
  }
  if (!form.items.some((it) => it && it.id === selectedId.value)) {
    selectedId.value = form.items[0].id
  }
}

function formatMissionNet(net) {
  if (!net) return '时间待定'
  const t = Date.parse(net)
  if (!Number.isFinite(t)) return String(net)
  return new Date(t).toLocaleString()
}

const STARSHIP_RE = /starship|super\s*heavy|星舰|超重/i
const ZHUQUE3_RE = /zhuque\s*-?\s*3|zq\s*-?\s*3|朱雀\s*[三3]\s*号/i
const PAD_LABELS = {
  'slc-40': 'SLC-40',
  'lc-39a': 'LC-39A',
  'slc-4e': 'SLC-4E',
  starbase: '星舰基地',
  'starbase-a': '星舰基地 A 工位',
  'starbase-b': '星舰基地 B 工位',
  vandenberg: '范登堡'
}
const RECOVERY_LABELS = {
  rtls: '陆地回收',
  asds: '海上回收',
  expended: '不回收'
}
const F9_TRACKS = [
  { id: 'f9-40-rtls', rocketName: 'Falcon 9', padKey: 'slc-40', padName: 'SLC-40', recoveryKey: 'rtls', recoveryName: '陆地回收' },
  { id: 'f9-40-asds', rocketName: 'Falcon 9', padKey: 'slc-40', padName: 'SLC-40', recoveryKey: 'asds', recoveryName: '海上回收' },
  { id: 'f9-39a-rtls', rocketName: 'Falcon 9', padKey: 'lc-39a', padName: 'LC-39A', recoveryKey: 'rtls', recoveryName: '陆地回收' },
  { id: 'f9-39a-asds', rocketName: 'Falcon 9', padKey: 'lc-39a', padName: 'LC-39A', recoveryKey: 'asds', recoveryName: '海上回收' },
  { id: 'f9-4e-rtls', rocketName: 'Falcon 9', padKey: 'slc-4e', padName: 'SLC-4E', recoveryKey: 'rtls', recoveryName: '陆地回收' },
  { id: 'f9-4e-asds', rocketName: 'Falcon 9', padKey: 'slc-4e', padName: 'SLC-4E', recoveryKey: 'asds', recoveryName: '海上回收' }
]
const FH_TRACKS = [
  { id: 'fh-39a-asds', rocketName: 'Falcon Heavy', padKey: 'lc-39a', padName: 'LC-39A', recoveryKey: 'asds', recoveryName: '海上回收' },
  { id: 'fh-39a-rtls', rocketName: 'Falcon Heavy', padKey: 'lc-39a', padName: 'LC-39A', recoveryKey: 'rtls', recoveryName: '陆地回收' }
]
/** 星舰：工位优先；整场 / 整型号作兜底。以后加场只需补一条 + inferPadKey */
const SS_TRACKS = [
  { id: 'ss-sb-a', rocketName: 'Starship', padKey: 'starbase-a', padName: '星舰基地 A', note: 'OLM-A / Pad 1', recoveryKey: '', recoveryName: '' },
  { id: 'ss-sb-b', rocketName: 'Starship', padKey: 'starbase-b', padName: '星舰基地 B', note: 'OLM-B / Pad 2', recoveryKey: '', recoveryName: '' },
  { id: 'ss-sb', rocketName: 'Starship', padKey: 'starbase', padName: '星舰基地', note: '不分工位', recoveryKey: '', recoveryName: '' },
  { id: 'ss-39a', rocketName: 'Starship', padKey: 'lc-39a', padName: 'LC-39A', note: '肯尼迪预留', recoveryKey: '', recoveryName: '' },
  { id: 'ss-vafb', rocketName: 'Starship', padKey: 'vandenberg', padName: '范登堡', note: '西海岸预留', recoveryKey: '', recoveryName: '' },
  { id: 'ss-all', rocketName: 'Starship', padKey: '', padName: '整型号兜底', note: '未识别工位也显示', recoveryKey: '', recoveryName: '' }
]

function rocketNeedsPad(name) {
  const raw = String(name || '')
  if (/falcon\s*heavy|猎鹰重型/i.test(raw)) return true
  if (/falcon\s*9|猎鹰\s*9/i.test(raw)) return true
  const key = rocketModelKey(raw)
  return key === 'falconheavy' || key === 'falcon9' || key.startsWith('falcon9')
}

function inferStarbasePadKey(s) {
  if (!/starbase|boca\s*chica|博卡奇卡|星舰基地/.test(s)) return ''
  if (/orbital launch (?:pad|mount)\s*(?:2|b)\b|olm[-\s]?b|\bpad\s*[b2]\b|launch pad [b2]|olp[-\s]?2|工位\s*[b2]|[b2]\s*工位/.test(s)) {
    return 'starbase-b'
  }
  if (/orbital launch (?:pad|mount)\s*(?:1|a)\b|olm[-\s]?a|\bpad\s*[a1]\b|launch pad [a1]|olp[-\s]?1|工位\s*[a1]|[a1]\s*工位|\bolm\b/.test(s)) {
    return 'starbase-a'
  }
  return 'starbase'
}

function inferPadKey(source) {
  const s = [
    source && source.padKey,
    source && source.padName,
    source && source.pad,
    source && source.padLocation,
    source && source.launchSite,
    source && source.missionName,
    source && source.name
  ].filter(Boolean).join(' ').toLowerCase()
  if (!s) return ''
  const rocket = [
    source && source.rocketName,
    source && source.missionName,
    source && source.name
  ].filter(Boolean).join(' ')
  const starship = isStarshipRocket(rocket)
  if (/slc[-\s]?40|space launch complex\s*40/.test(s)) return 'slc-40'
  if (/lc[-\s]?39a|launch complex\s*39a|\b39a\b/.test(s)) return 'lc-39a'
  if (starship) {
    if (/slc[-\s]?6|space launch complex\s*6|vandenberg|范登堡/.test(s)) return 'vandenberg'
    if (/kennedy|肯尼迪/.test(s)) return 'lc-39a'
    return inferStarbasePadKey(s)
  }
  if (/slc[-\s]?4e|space launch complex\s*4e/.test(s)) return 'slc-4e'
  if (/vandenberg|范登堡/.test(s)) return 'slc-4e'
  if (/kennedy|肯尼迪/.test(s)) return 'lc-39a'
  if (/cape\s*canaveral|卡纳维拉尔/.test(s)) return 'slc-40'
  return inferStarbasePadKey(s)
}

function isStarshipRocket(name) {
  return STARSHIP_RE.test(String(name || ''))
}

function padsAlign(itemPad, missionPad) {
  if (!itemPad) return true
  if (itemPad === missionPad) return true
  if (itemPad === 'starbase' && String(missionPad || '').indexOf('starbase') === 0) return true
  return false
}

function padLabel(padKey, fallback) {
  return PAD_LABELS[padKey] || String(fallback || '').trim() || padKey
}

function recoveryLabel(key, fallback) {
  return RECOVERY_LABELS[key] || String(fallback || '').trim() || ''
}

function inferRecoveryKey(mission) {
  const preset = String(mission && mission.recoveryKey || '').trim().toLowerCase()
  if (preset === 'asds' || preset === 'rtls' || preset === 'expended') return preset
  const type = String(mission && mission.landingType || '').toUpperCase()
  const loc = String(mission && mission.landingLocation || '')
  const blob = `${type} ${loc}`
  if (type === 'ASDS' || /ASOG|OCISLY|JRTI|\bASDS\b|A SHORTFALL|OF COURSE I STILL|JUST READ THE INSTRUCTIONS|DRONESHIP|无人船|海上回收/i.test(blob)) {
    return 'asds'
  }
  if (type === 'RTLS' || type === 'VL' || /LZ-?\d|LANDING ZONE|陆地回收/i.test(blob)) {
    return 'rtls'
  }
  if (type === 'EXPENDED' || /expended|一次性/i.test(blob)) return 'expended'
  return ''
}

function missionPadLabel(mission) {
  const key = inferPadKey(mission)
  return padLabel(key, mission && (mission.pad || mission.launchSite))
}

function missionRecoveryLabel(mission) {
  return recoveryLabel(inferRecoveryKey(mission), mission && mission.landingLocation)
}

function boundLabel(item) {
  if (!item || !item.rocketName) return ''
  if (item.padKey || item.padName) {
    const rec = recoveryLabel(item.recoveryKey, item.recoveryName)
    return rec
      ? `${item.rocketName} · ${padLabel(item.padKey, item.padName)} · ${rec}`
      : `${item.rocketName} · ${padLabel(item.padKey, item.padName)}`
  }
  if (rocketNeedsPad(item.rocketName)) return ''
  return `${item.rocketName} · 同型号常驻`
}

function rocketModelKey(name) {
  const s = String(name || '').trim()
  if (!s) return ''
  if (STARSHIP_RE.test(s)) return 'starship'
  if (ZHUQUE3_RE.test(s)) return 'zhuque3'
  const zhCz = s.match(/长征\s*(十一|十二|十|[一二三四五六七八九]|\d{1,2})\s*号?\s*([甲乙丙丁]|[a-dA-D])?/)
  if (zhCz) {
    const nums = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }
    const letters = { 甲: 'a', 乙: 'b', 丙: 'c', 丁: 'd' }
    const num = Object.prototype.hasOwnProperty.call(nums, zhCz[1]) ? nums[zhCz[1]] : Number(zhCz[1])
    const sfx = letters[zhCz[2]] || String(zhCz[2] || '').toLowerCase()
    if (Number.isFinite(num) && num > 0) return 'cz' + num + sfx
  }
  const key = s.toLowerCase()
    .replace(/long\s*march/g, 'cz')
    .replace(/chang\s*zheng/g, 'cz')
    .replace(/[·・./_\-\s]+/g, '')
  const m = key.match(/^(?:cz)(\d{1,2})([a-z]{0,2})$/)
  if (m) return 'cz' + Number(m[1]) + (m[2] || '')
  return key
}

function isSameRocketModel(a, b) {
  const ka = rocketModelKey(a)
  const kb = rocketModelKey(b)
  return !!(ka && kb && ka === kb)
}

function isMissionActive(mission) {
  const item = selectedItem.value
  if (!item || !mission) return false
  if (!isSameRocketModel(item.rocketName, mission.rocketName)) return false
  if (item.padKey || rocketNeedsPad(item.rocketName)) {
    if (!padsAlign(item.padKey, inferPadKey(mission))) return false
    if (!item.recoveryKey) return true
    return item.recoveryKey === inferRecoveryKey(mission)
  }
  return true
}

function defaultTitle(rocketName, missionName, padName, recoveryName) {
  const blob = `${rocketName || ''} ${missionName || ''}`
  if (/zhuque\s*-?\s*3|zq\s*-?\s*3|朱雀\s*[三3]\s*号/i.test(blob)) return '朱雀三号环绕全景'
  if (/starship|super\s*heavy|星舰|超重/i.test(blob)) {
    const pad = String(padName || '').trim()
    return pad && pad !== '整型号兜底' ? `星舰 ${pad} 环绕全景` : '星舰环绕全景'
  }
  const r = String(rocketName || missionName || '').trim()
  const pad = String(padName || '').trim()
  const rec = String(recoveryName || '').trim()
  if (r && pad && rec) return `${r} ${pad} ${rec} 环绕全景`
  if (r && pad) return `${r} ${pad} 环绕全景`
  return r ? `${r}环绕全景` : '环绕全景'
}

function assignMissionToSelected(mission) {
  const item = selectedItem.value
  if (!item || !mission) return
  const rocketName = String(mission.rocketName || '').trim()
  if (!rocketName) {
    ElMessage.warning('该任务缺少火箭型号，无法锁定')
    return
  }
  if (isStarshipRocket(rocketName)) {
    const padKey = inferPadKey(mission)
    const padName = padKey ? padLabel(padKey, mission.pad || mission.launchSite) : ''
    const rawName = String(mission.name || mission.missionName || '').trim()
    item.rocketName = rocketName
    item.padKey = padKey
    item.padName = padName
    item.recoveryKey = ''
    item.recoveryName = ''
    item.matchRocket = true
    item.launchId = ''
    item.missionName = ''
    if (!String(item.title || '').trim()) {
      item.title = defaultTitle(rocketName, rawName, padName, '')
    }
    ElMessage.success(padName
      ? `已锁定：${rocketName} · ${padName}（同场/同工位均显示）`
      : `已锁定型号：${rocketName}（整型号兜底）`)
    return
  }
  const needsPad = rocketNeedsPad(rocketName)
  const padKey = inferPadKey(mission)
  const recKey = inferRecoveryKey(mission)
  if (needsPad && !padKey) {
    ElMessage.warning('猎鹰9号 / 猎鹰重型需锁定发射场（SLC-40 / LC-39A / SLC-4E），该任务工位无法识别')
    return
  }
  if (needsPad && recKey === 'expended') {
    ElMessage.warning('该任务不回收，详情页不会显示 360，无需绑片')
    return
  }
  if (needsPad && !recKey) {
    ElMessage.warning('该任务回收方式无法识别。请点选详情页已标明陆地回收或回收船（ASOG / OCISLY / JRTI）的任务')
    return
  }
  const padName = needsPad ? padLabel(padKey, mission.pad || mission.launchSite) : ''
  const recName = needsPad ? recoveryLabel(recKey, mission.landingLocation) : ''
  const rawName = String(mission.name || mission.missionName || '').trim()
  item.rocketName = rocketName
  item.padKey = needsPad ? padKey : ''
  item.padName = padName
  item.recoveryKey = needsPad ? recKey : ''
  item.recoveryName = recName
  item.matchRocket = true
  item.launchId = ''
  item.missionName = ''
  if (!String(item.title || '').trim()) {
    item.title = defaultTitle(rocketName, rawName, padName, recName)
  }
  ElMessage.success(needsPad
    ? `已锁定：${rocketName} · ${padName} · ${recName}（同轨迹任务均显示）`
    : `已锁定型号：${rocketName}（同型号任务均显示）`)
}

function isTrackActive(track) {
  const item = selectedItem.value
  if (!item || !track) return false
  return isSameRocketModel(item.rocketName, track.rocketName)
    && (item.padKey || '') === (track.padKey || '')
    && (item.recoveryKey || '') === (track.recoveryKey || '')
}

function assignTrack(track) {
  const item = selectedItem.value
  if (!item || !track) return
  item.rocketName = track.rocketName
  item.padKey = track.padKey || ''
  item.padName = track.padKey ? (track.padName || '') : ''
  item.recoveryKey = track.recoveryKey || ''
  item.recoveryName = track.recoveryName || ''
  item.matchRocket = true
  item.launchId = ''
  item.missionName = ''
  if (!String(item.title || '').trim()) {
    item.title = defaultTitle(track.rocketName, '', track.padName, track.recoveryName)
  }
  const rec = track.recoveryName ? ` · ${track.recoveryName}` : ''
  ElMessage.success(`已锁定：${track.rocketName} · ${track.padName}${rec}（同轨迹任务均显示）`)
}

function clearSelectedMission() {
  const item = selectedItem.value
  if (!item) return
  item.rocketName = ''
  item.padKey = ''
  item.padName = ''
  item.recoveryKey = ''
  item.recoveryName = ''
  item.missionName = ''
  item.launchId = ''
}

async function loadUpcomingMissions() {
  missionsLoading.value = true
  try {
    const data = await api.listSplashUpcomingMissions()
    upcomingMissions.value = Array.isArray(data && data.list) ? data.list : []
  } catch (e) {
    upcomingMissions.value = []
    ElMessage.error('加载即将发射列表失败: ' + (e.message || ''))
  } finally {
    missionsLoading.value = false
  }
}

async function loadPreviousMissions() {
  missionsLoading.value = true
  try {
    const data = await api.listOrbitPanoPreviousMissions()
    previousMissions.value = Array.isArray(data && data.list) ? data.list : []
    previousLoaded.value = true
  } catch (e) {
    previousMissions.value = []
    ElMessage.error('加载历史发射列表失败: ' + (e.message || ''))
  } finally {
    missionsLoading.value = false
  }
}

async function refreshMissions() {
  if (missionTab.value === 'previous') {
    await loadPreviousMissions()
    return
  }
  await loadUpcomingMissions()
}

async function onMissionTabChange(tab) {
  if (tab === 'previous' && !previousLoaded.value) {
    await loadPreviousMissions()
  }
}

watch(
  () => form.items.map((it) => it && it.id).join(','),
  () => ensureSelected()
)

function newId() {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function applyData(data) {
  if (!data) return
  form.enabled = data.enabled !== false
  const items = Array.isArray(data.items) ? data.items : []
  form.items = items.slice(0, MEDIA_MAX).map((it) => ({
    id: it.id || newId(),
    videoUrl: it.videoUrl || it.mediaUrl || '',
    posterUrl: it.posterUrl || '',
    title: it.title || '',
    launchId: it.rocketName ? '' : (it.launchId || ''),
    missionName: it.rocketName ? '' : (it.missionName || ''),
    rocketName: it.rocketName || '',
    padKey: it.padKey || '',
    padName: it.padName || '',
    recoveryKey: it.recoveryKey || '',
    recoveryName: it.recoveryName || '',
    matchRocket: true,
    enabled: it.enabled !== false
  }))
  ensureSelected()
}

onMounted(async () => {
  try {
    const [data] = await Promise.all([
      api.getOrbitPano(),
      loadUpcomingMissions()
    ])
    applyData(data)
  } catch (e) {
    ElMessage.error('加载配置失败: ' + (e.message || ''))
  }
})

function getFileExt(name) {
  return (name || '').split('.').pop().toLowerCase()
}

function validateFile(file) {
  const ext = getFileExt(file.name)
  if (!ALLOWED_VIDEO_EXTS.includes(ext)) {
    return { ok: false, error: '仅支持 mp4/mov 视频' }
  }
  if (file.size > VIDEO_MAX_SIZE) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1)
    return { ok: false, error: `文件 ${sizeMB}MB 超过视频限制(${VIDEO_MAX_MB}MB)` }
  }
  return { ok: true }
}

function generateKey(file) {
  const ext = getFileExt(file.name) || 'mp4'
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `${COS_PATH_PREFIX}${ts}_${rand}.${ext}`
}

async function uploadViaPresign(file, key, task) {
  const presignData = await api.cosPresign({ key })
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', presignData.uploadUrl, true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) task.percent = Math.round((e.loaded / e.total) * 95)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        task.percent = 100
        resolve(presignData.cosUrl)
      } else reject(new Error(`HTTP ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('上传失败，请确认 COS 跨域配置'))
    xhr.send(file)
  })
}

function pushItem(cosUrl) {
  if (form.items.length >= MEDIA_MAX) {
    ElMessage.warning(`最多上传 ${MEDIA_MAX} 个环绕视频`)
    return false
  }
  const id = newId()
  form.items.push({
    id,
    videoUrl: cosUrl,
    posterUrl: '',
    title: '',
    launchId: '',
    missionName: '',
    rocketName: '',
    padKey: '',
    padName: '',
    recoveryKey: '',
    recoveryName: '',
    matchRocket: true,
    enabled: true
  })
  selectedId.value = id
  return true
}

async function uploadOneFile(file) {
  if (form.items.length >= MEDIA_MAX) {
    ElMessage.warning(`最多上传 ${MEDIA_MAX} 个环绕视频`)
    return
  }
  const { ok, error } = validateFile(file)
  if (!ok) {
    ElMessage.error(error)
    return
  }

  const key = generateKey(file)
  const task = reactive({ name: file.name, percent: 0, error: '' })
  uploadTasks.value.push(task)

  try {
    const cosUrl = await uploadViaPresign(file, key, task)
    pushItem(cosUrl)
    const idx = uploadTasks.value.indexOf(task)
    if (idx >= 0) uploadTasks.value.splice(idx, 1)
  } catch (e) {
    task.error = e.message || '上传失败'
  }
}

function removeAt(idx) {
  const removed = form.items[idx]
  form.items.splice(idx, 1)
  if (removed && removed.id === selectedId.value) {
    selectedId.value = form.items[0] ? form.items[0].id : ''
  }
  ensureSelected()
}

function triggerFilePicker() {
  fileInputRef.value?.click()
}

function onFileInputChange(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  handleFiles(files)
}

function onDrop(e) {
  isDragActive.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  handleFiles(files)
}

async function handleFiles(files) {
  for (const file of files) {
    if (form.items.length >= MEDIA_MAX) {
      ElMessage.warning(`已达上限 ${MEDIA_MAX} 个`)
      break
    }
    await uploadOneFile(file)
  }
}

async function onSave() {
  saving.value = true
  try {
    const data = await api.updateOrbitPano({
      enabled: form.enabled,
      items: form.items.map((it) => ({
        id: it.id,
        videoUrl: it.videoUrl,
        posterUrl: it.posterUrl || '',
        title: (it.title || '').trim(),
        launchId: (it.rocketName || '').trim() ? '' : (it.launchId || '').trim(),
        missionName: (it.rocketName || '').trim() ? '' : (it.missionName || '').trim(),
        rocketName: (it.rocketName || '').trim(),
        padKey: (it.padKey || '').trim(),
        padName: (it.padName || '').trim(),
        recoveryKey: (it.recoveryKey || '').trim(),
        recoveryName: (it.recoveryName || '').trim(),
        matchRocket: true,
        enabled: it.enabled !== false
      }))
    })
    if (data && typeof data === 'object') applyData(data)
    ElMessage.success('保存成功：猎鹰按发射场+回收对齐，星舰按发射场/工位对齐，其它型号按火箭型号显示 360')
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.message || ''))
  } finally {
    saving.value = false
  }
}

const COS_VIDEO_EXTS = /\.(mp4|mov)$/i
const cosPickerVisible = ref(false)
const cosLoading = ref(false)
const cosLoadingMore = ref(false)
const cosPrefix = ref('')
const cosFolders = ref([])
const cosFiles = ref([])
const cosMarker = ref('')
const cosHasMore = ref(false)
const cosSelectedFile = ref(null)
const cosBreadcrumbs = ref([])

function cosFormatSize(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function cosFormatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return String(dateStr)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function cosVideoPosterUrl(url) {
  const base = String(url || '').split('?')[0]
  if (!base) return ''
  return `${base}?ci-process=snapshot&time=0.5&format=jpg&width=720&height=0`
}

function onCosThumbError(e) {
  const el = e && e.target
  if (el) el.style.visibility = 'hidden'
}

function isCosVideoFile(name) {
  return COS_VIDEO_EXTS.test(name)
}

function buildCosBreadcrumbs(prefix) {
  if (!prefix) return []
  const parts = prefix.replace(/\/$/, '').split('/')
  return parts.map((name, i) => ({
    name,
    prefix: parts.slice(0, i + 1).join('/') + '/'
  }))
}

async function cosLoadFiles(prefix, marker = '') {
  cosLoading.value = !marker
  cosLoadingMore.value = !!marker
  try {
    const res = await api.cosListFiles({ prefix, marker, maxKeys: 200 })
    const folders = (res.folders || []).map(f => ({ ...f, _type: 'folder' }))
    const files = (res.files || []).filter(f => isCosVideoFile(f.name || f.key || '')).map(f => ({ ...f, _type: 'file' }))
    if (marker) {
      cosFolders.value = [...cosFolders.value, ...folders]
      cosFiles.value = [...cosFiles.value, ...files]
    } else {
      cosFolders.value = folders
      cosFiles.value = files
    }
    cosMarker.value = res.nextMarker || ''
    cosHasMore.value = !!res.nextMarker
  } catch (e) {
    ElMessage.error('加载 COS 文件列表失败')
  } finally {
    cosLoading.value = false
    cosLoadingMore.value = false
  }
}

const cosTableData = ref([])
watchEffect(() => {
  cosTableData.value = [...cosFolders.value, ...cosFiles.value]
})

function openCosPicker() {
  if (form.items.length >= MEDIA_MAX) {
    ElMessage.warning(`最多上传 ${MEDIA_MAX} 个环绕视频`)
    return
  }
  cosSelectedFile.value = null
  cosPrefix.value = COS_PICK_PREFIX
  cosBreadcrumbs.value = buildCosBreadcrumbs(COS_PICK_PREFIX)
  cosPickerVisible.value = true
  cosLoadFiles(COS_PICK_PREFIX)
}

function cosNavigateTo(prefix) {
  cosSelectedFile.value = null
  cosPrefix.value = prefix
  cosBreadcrumbs.value = buildCosBreadcrumbs(prefix)
  cosLoadFiles(prefix)
}

function cosLoadMore() {
  cosLoadFiles(cosPrefix.value, cosMarker.value)
}

function onCosRowClick(row) {
  if (row._type === 'folder') {
    cosNavigateTo(row.prefix)
    return
  }
  cosSelectedFile.value = row
}

function onCosCardDblclick(row) {
  if (!row || row._type === 'folder') return
  cosSelectedFile.value = row
  onCosConfirm()
}

function onCosConfirm() {
  const file = cosSelectedFile.value
  if (!file || !file.url) return
  if (form.items.length >= MEDIA_MAX) {
    ElMessage.warning(`最多上传 ${MEDIA_MAX} 个环绕视频`)
    return
  }
  const name = file.name || file.key || ''
  if (!isCosVideoFile(name)) {
    ElMessage.warning('请选择 mp4/mov 视频')
    return
  }
  pushItem(file.url)
  cosPickerVisible.value = false
  ElMessage.success('已添加: ' + name)
}
</script>

<style scoped>
.audit-card {
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid rgba(251, 191, 36, 0.42);
  background: rgba(245, 158, 11, 0.14);
  border-radius: 8px;
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

.orbit-form {
  max-width: 1100px;
}

.orbit-pool-item :deep(.el-form-item__content) {
  display: block;
  max-width: none;
}

.orbit-pool-layout {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
}

.orbit-upload-area {
  flex: 1;
  min-width: 0;
}

.orbit-pool-hint {
  font-size: 12px;
  color: var(--t-text-muted, #888);
  line-height: 1.6;
  margin-bottom: 12px;
}

.orbit-media-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.orbit-preview {
  position: relative;
  display: inline-block;
  max-width: 200px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--t-border-card, rgba(0,0,0,0.08));
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s;
}

.orbit-preview-active {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.25);
}

.orbit-preview-media {
  display: block;
  width: 200px;
  max-height: 120px;
  object-fit: contain;
  background: #000;
}

.orbit-preview-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  padding: 6px 8px;
  gap: 6px;
}

.orbit-mission-bound {
  padding: 0 8px 8px;
  font-size: 11px;
  line-height: 1.4;
}

.orbit-mission-bound-name {
  display: block;
  color: var(--el-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.orbit-mission-bound-empty {
  color: var(--t-text-muted, #999);
}

.orbit-mission-panel {
  width: 340px;
  flex-shrink: 0;
  border: 1px solid var(--t-border-card, rgba(0,0,0,0.1));
  border-radius: 10px;
  padding: 12px;
  background: var(--el-fill-color-blank, transparent);
}

.orbit-mission-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.orbit-mission-panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--t-text-primary, rgba(255, 255, 255, 0.92));
}

.orbit-mission-panel-sub {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--t-text-muted, #888);
}

.orbit-falcon-block {
  margin-bottom: 10px;
}

.orbit-falcon-title {
  margin: 8px 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--t-text-secondary, #666);
}

.orbit-falcon-note {
  margin: -2px 0 8px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--t-text-muted, #888);
}

.orbit-starship-grid {
  grid-template-columns: 1fr 1fr 1fr;
}

.orbit-falcon-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.orbit-falcon-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--t-border-card, rgba(0,0,0,0.1));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}

.orbit-falcon-option:hover:not(:disabled) {
  border-color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.04);
}

.orbit-falcon-option.active {
  border-color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.1);
}

.orbit-falcon-option:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.orbit-falcon-option-pad {
  font-size: 13px;
  font-weight: 600;
}

.orbit-falcon-option-rec {
  font-size: 11px;
  color: var(--t-text-muted, #888);
}

.orbit-other-title {
  margin: 4px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--t-text-secondary, #666);
}

.orbit-mission-tabs {
  display: flex;
  width: 100%;
  margin-bottom: 10px;
}

.orbit-mission-tabs :deep(.el-radio-button) {
  flex: 1;
}

.orbit-mission-tabs :deep(.el-radio-button__inner) {
  width: 100%;
}

.orbit-item-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.orbit-rocket-hint {
  font-size: 11px;
  color: var(--t-text-muted, #999);
}

.orbit-mission-list {
  max-height: 280px;
  overflow: auto;
  min-height: 120px;
}

.orbit-mission-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  margin-bottom: 6px;
  padding: 8px 10px;
  border: 1px solid var(--t-border-card, rgba(0,0,0,0.1));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}

.orbit-mission-option:hover:not(:disabled) {
  border-color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.04);
}

.orbit-mission-option.active {
  border-color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.08);
}

.orbit-mission-option:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.orbit-mission-option-clear {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--t-text-secondary, #666);
}

.orbit-mission-option-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
  word-break: break-word;
}

.orbit-mission-option-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--t-text-muted, #999);
}

.orbit-mission-empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--t-text-muted, #999);
}

.orbit-pool-full {
  padding: 12px;
  font-size: 13px;
  color: var(--t-text-muted, #888);
  background: rgba(0,0,0,0.03);
  border-radius: 8px;
}

.upload-tasks {
  margin-bottom: 12px;
}

.upload-task-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.task-name {
  font-size: 13px;
  color: var(--t-text-secondary, #666);
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-error {
  font-size: 12px;
  color: #FF453A;
}

.orbit-source-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drop-zone,
.cos-pick-zone {
  border: 1px dashed var(--t-border-card, rgba(0,0,0,0.15));
  border-radius: 10px;
  padding: 20px 16px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}

.drop-zone:hover,
.cos-pick-zone:hover,
.drop-zone-active {
  border-color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.04);
}

.drop-zone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--t-text-secondary, #666);
  text-align: center;
}

.drop-zone-title {
  font-size: 14px;
  font-weight: 500;
}

.drop-zone-hint {
  font-size: 12px;
  color: var(--t-text-muted, #999);
}

.source-divider {
  display: flex;
  align-items: center;
  justify-content: center;
}

.source-divider-text {
  font-size: 12px;
  color: var(--t-text-muted, #999);
}

.cos-grid-wrap {
  min-height: 220px;
}

.cos-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  max-height: 62vh;
  overflow: auto;
  padding: 2px;
}

.cos-grid-empty {
  padding: 64px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--t-text-muted, #999);
}

.cos-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s, transform .15s;
}

.cos-card:hover {
  border-color: rgba(64, 158, 255, 0.55);
}

.cos-card.is-active {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.35);
}

.cos-card-cover {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #0b0b0b;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.cos-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cos-card--folder .cos-card-cover {
  background: rgba(255, 204, 0, 0.1);
}

.cos-card-meta {
  padding: 8px 10px 10px;
}

.cos-card-name {
  font-size: 12px;
  line-height: 1.35;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cos-card-sub {
  margin-top: 4px;
  font-size: 11px;
  color: var(--t-text-muted, #999);
}

@media (max-width: 900px) {
  .orbit-pool-layout {
    flex-direction: column;
  }

  .orbit-mission-panel {
    width: 100%;
  }

  /* 窄屏下发射场/工位选项网格降列，避免按钮被压扁 */
  .orbit-starship-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 480px) {
  .orbit-starship-grid,
  .orbit-falcon-grid {
    grid-template-columns: 1fr;
  }
}
</style>
