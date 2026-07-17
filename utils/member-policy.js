/**
 * 会员免费额度 / 流量策略：读 global_config.main（后台「全局配置中心」维护）
 * 缺省与现网硬编码一致，避免配置未同步时行为跳变。
 */
const { fetchMainConfig } = require('./feature-flags.js')

const DEFAULTS = {
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
  mediaTrafficMode: 'normal' // normal | save | emergency
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeMode(raw) {
  const m = String(raw || '').trim().toLowerCase()
  if (m === 'save' || m === 'emergency') return m
  return 'normal'
}

/**
 * @param {Object} [cfg] global_config.main
 * @returns {Object} 归一化后的策略
 */
function normalizeMemberPolicy(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  const mode = normalizeMode(c.mediaTrafficMode)

  let forcePoster = c.forceNonMemberVideoPoster !== false
  let splashAllow = !!c.splashAllowVideoForNonMember
  let carouselAllow = !!c.carouselAllowVideoForNonMember

  // 省流 / 紧急：强制收紧非会员视频（覆盖单项开关）
  if (mode === 'save' || mode === 'emergency') {
    forcePoster = true
    splashAllow = false
    carouselAllow = false
  }

  return {
    freeMissionListLimit: clampInt(c.freeMissionListLimit, 1, 200, DEFAULTS.freeMissionListLimit),
    freeEventListLimit: clampInt(c.freeEventListLimit, 1, 100, DEFAULTS.freeEventListLimit),
    freeAiChatDaily: clampInt(c.freeAiChatDaily, 0, 200, DEFAULTS.freeAiChatDaily),
    freeAiImageDaily: clampInt(c.freeAiImageDaily, 0, 50, DEFAULTS.freeAiImageDaily),
    adUnlockMinutes: clampInt(c.adUnlockMinutes, 1, 1440, DEFAULTS.adUnlockMinutes),
    enableMissionListGate: c.enableMissionListGate !== false,
    enableEventListGate: c.enableEventListGate !== false,
    forceNonMemberVideoPoster: forcePoster,
    splashAllowVideoForNonMember: splashAllow,
    carouselAllowVideoForNonMember: carouselAllow,
    mediaTrafficMode: mode,
    /** 紧急档：轨道卡等背景 mp4 也对非 Pro 关闭（与强制封面叠加） */
    emergencyMedia: mode === 'emergency'
  }
}

function getMemberPolicySync() {
  // fetchMainConfig 未完成时用默认；完成后来自模块缓存
  try {
    const flags = require('./feature-flags.js')
    const cached = typeof flags.getCachedMainConfig === 'function' ? flags.getCachedMainConfig() : null
    return normalizeMemberPolicy(cached || {})
  } catch (e) {
    return normalizeMemberPolicy({})
  }
}

function getMemberPolicy(forceRefresh) {
  return fetchMainConfig(forceRefresh).then(normalizeMemberPolicy).catch(function () {
    return normalizeMemberPolicy({})
  })
}

module.exports = {
  DEFAULTS,
  normalizeMemberPolicy,
  getMemberPolicy,
  getMemberPolicySync
}
