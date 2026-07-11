/**
 * 视频号直播 — wx.getChannelsLiveInfo / channel-live 封装
 * 官方文档：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/channels-live
 */
const { getSystemInfo } = require('../../../utils/system.js')
const config = require('../../../utils/config.js')

/** channel-live 组件最低基础库 */
const MIN_SDK_CHANNEL_LIVE = '2.29.0'
/** getChannelsLiveInfo 最低基础库 */
const MIN_SDK_GET_INFO = '2.15.0'

/** 直播状态（wx.getChannelsLiveInfo 回包 status） */
const LIVE_STATUS = {
  /** 直播状态不存在（未开过直播） */
  NONE: 1,
  /** 直播中 */
  LIVE: 2,
  /** 直播已结束 */
  ENDED: 3,
  /** 直播准备中（未开播） */
  PREPARING: 4
}

function compareVersion(v1, v2) {
  const arr1 = String(v1 || '0.0.0').split('.')
  const arr2 = String(v2 || '0.0.0').split('.')
  const minLength = Math.min(arr1.length, arr2.length)

  for (let i = 0; i < minLength; i++) {
    const num1 = parseInt(arr1[i], 10) || 0
    const num2 = parseInt(arr2[i], 10) || 0
    if (num1 < num2) return -1
    if (num1 > num2) return 1
  }

  if (arr1.length < arr2.length) return -1
  if (arr1.length > arr2.length) return 1
  return 0
}

function getSdkVersion() {
  try {
    return getSystemInfo().SDKVersion || '0.0.0'
  } catch (e) {
    return '0.0.0'
  }
}

function isSdkAtLeast(minVersion) {
  return compareVersion(getSdkVersion(), minVersion) >= 0
}

function isChannelLiveSupported() {
  return isSdkAtLeast(MIN_SDK_CHANNEL_LIVE)
}

function getChannelsLiveConfig() {
  return (config && config.channelsLive) || {}
}

function getFinderUserName(override) {
  const cfg = getChannelsLiveConfig()
  const name = override || cfg.finderUserName || ''
  return String(name || '').trim()
}

/**
 * 校验 finderUserName（trim + sph 前缀 + 字符集）
 * @returns {{ valid: boolean, value: string, code?: string, message?: string }}
 */
function validateFinderUserName(name) {
  const value = String(name || '').trim()
  if (!value) {
    return { valid: false, value: '', code: 'NO_FINDER', message: '视频号 ID 未配置，请检查 utils/config.js 中的 channelsLive.finderUserName' }
  }
  if (!/^sph/i.test(value)) {
    return {
      valid: false,
      value,
      code: 'INVALID_FINDER_PREFIX',
      message: '视频号 ID 须以 sph 开头，请在视频号助手 → 设置 中复制完整 ID'
    }
  }
  if (!/^sph[A-Za-z0-9]+$/.test(value)) {
    return {
      valid: false,
      value,
      code: 'INVALID_FINDER_FORMAT',
      message: '视频号 ID 格式有误，请核对视频号助手中的 ID'
    }
  }
  return { valid: true, value }
}

/**
 * @param {number} status wx.getChannelsLiveInfo 回包 status
 * @returns {{ label: string, hint: string, showPlayer: boolean, tone: string }}
 */
function getLiveStatusMeta(status) {
  switch (Number(status)) {
    case LIVE_STATUS.LIVE:
      return {
        label: '直播中',
        hint: '点击画面进入视频号直播间',
        showPlayer: true,
        tone: 'live'
      }
    case LIVE_STATUS.PREPARING:
      return {
        label: '直播准备中',
        hint: '主播即将开播，请稍候刷新',
        showPlayer: false,
        tone: 'preparing'
      }
    case LIVE_STATUS.ENDED:
      return {
        label: '直播已结束',
        hint: '可前往视频号查看回放或最新动态',
        showPlayer: false,
        tone: 'ended'
      }
    case LIVE_STATUS.NONE:
    default:
      return {
        label: '暂未开播',
        hint: '关注视频号，获取开播提醒',
        showPlayer: false,
        tone: 'idle'
      }
  }
}

function normalizeLiveError(err) {
  const errMsg = (err && err.errMsg) || ''
  const errCode = err.err_code || err.errCode || ''
  const errCodeStr = String(errCode)

  const isEmptyFinderInfo =
    errMsg.includes('empty finder info') ||
    errMsg.includes('1416104') ||
    errCodeStr === '1416104' ||
    errCode === 1416104

  const isNotSameContractor =
    errMsg.includes('100008') ||
    errMsg.includes('1416103') ||
    errMsg.includes('not same contractor') ||
    errCodeStr === '100008' ||
    errCodeStr === '1416103' ||
    errCode === 1416103

  const isInvalidFinder =
    errMsg.includes('1416100') ||
    errMsg.includes('invalid finder') ||
    errCodeStr === '1416100' ||
    errCode === 1416100

  const needsChannelsAuth =
    errMsg.includes('100008') ||
    errMsg.includes('需要认证') ||
    errCodeStr === '100008'

  const isPartiallyVisible =
    errMsg.includes('1416105') ||
    errMsg.includes('partially visible') ||
    errCodeStr === '1416105' ||
    errCode === 1416105

  return Object.assign({}, err || {}, {
    errMsg,
    errCode,
    isEmptyFinderInfo,
    isNotSameContractor,
    isInvalidFinder,
    needsChannelsAuth,
    isPartiallyVisible
  })
}

/**
 * 将 API 错误映射为用户可读文案
 * @returns {{ kind: string, userMessage: string|null, treatAsIdle: boolean, canRetry: boolean }}
 */
function classifyLiveError(err) {
  if (err && err.code === 'NO_FINDER') {
    return { kind: 'config', userMessage: err.message || '视频号 ID 未配置', treatAsIdle: false, canRetry: false }
  }
  if (err && (err.code === 'INVALID_FINDER_PREFIX' || err.code === 'INVALID_FINDER_FORMAT')) {
    return { kind: 'config', userMessage: err.message, treatAsIdle: false, canRetry: false }
  }
  if (err && err.code === 'SDK_VERSION_TOO_LOW') {
    return { kind: 'sdk', userMessage: '当前微信版本较低，请更新后使用视频号直播', treatAsIdle: false, canRetry: false }
  }

  const normalized = normalizeLiveError(err)

  if (normalized.isEmptyFinderInfo) {
    return { kind: 'empty', userMessage: null, treatAsIdle: true, canRetry: true }
  }
  if (normalized.isNotSameContractor) {
    return {
      kind: 'contractor',
      userMessage: '小程序与视频号须同主体，请在公众平台完成绑定（见下方说明）',
      treatAsIdle: false,
      canRetry: true
    }
  }
  if (normalized.isInvalidFinder) {
    return { kind: 'config', userMessage: '视频号 ID 无效，请核对 config 中的 finderUserName', treatAsIdle: false, canRetry: false }
  }
  if (normalized.needsChannelsAuth) {
    return { kind: 'auth', userMessage: '视频号尚未完成认证，请在视频号助手完成认证后重试', treatAsIdle: false, canRetry: true }
  }
  if (normalized.isPartiallyVisible) {
    return { kind: 'partial', userMessage: '当前直播仅部分人可见，暂无法在小程序内展示', treatAsIdle: false, canRetry: true }
  }

  return {
    kind: 'unknown',
    userMessage: '获取直播信息失败，请稍后重试',
    treatAsIdle: false,
    canRetry: true
  }
}

function getManualFallback() {
  const cfg = getChannelsLiveConfig()
  return (cfg && cfg.manualFallback) || { enabled: false }
}

/**
 * 自己未开播时的第三方视频号引导（主页二维码，非同主体不可直跳直播间）
 * @returns {{ enabled: boolean, title: string, nickname: string, qrUrl: string, tip: string }}
 */
function getFallbackGuide() {
  const cfg = getChannelsLiveConfig()
  const raw = (cfg && cfg.fallbackGuide) || {}
  const nickname = String(raw.nickname || '').trim()
  const qrUrl = String(raw.qrUrl || '').trim()
  return {
    enabled: !!(raw.enabled && nickname && qrUrl),
    title: String(raw.title || '推荐观看').trim() || '推荐观看',
    nickname,
    qrUrl,
    tip: String(raw.tip || '扫码前往视频号主页，可预约或观看直播').trim()
  }
}

/**
 * 拉取视频号直播信息
 * @param {string} [finderUserName]
 * @param {{ startTime?: number, endTime?: number }} [options]
 */
function buildLiveInfoPayload(name, res) {
  return {
    finderUserName: name,
    feedId: (res && res.feedId) || '',
    nonceId: (res && res.nonceId) || '',
    status: (res && res.status) || LIVE_STATUS.NONE,
    description: (res && res.description) || '',
    headUrl: (res && res.headUrl) || '',
    nickname: (res && res.nickname) || '',
    replayStatus: res && res.replayStatus,
    otherInfos: (res && res.otherInfos) || []
  }
}

function buildEmptyLivePayload(name) {
  return buildLiveInfoPayload(name, { status: LIVE_STATUS.NONE })
}

function requestChannelsLiveInfo(name, timeOptions) {
  const opts = timeOptions || {}
  return new Promise((resolve, reject) => {
    const params = {
      finderUserName: name,
      success: (res) => resolve(buildLiveInfoPayload(name, res)),
      fail: (err) => reject(normalizeLiveError(err))
    }

    // 仅显式传入时才带时间范围。默认不传，取最近一场直播信息。
    // 同时传 startTime + endTime 在部分账号/时段会触发 1416104（empty finder info）。
    if (opts.startTime != null) params.startTime = opts.startTime
    if (opts.endTime != null) params.endTime = opts.endTime

    wx.getChannelsLiveInfo(params)
  })
}

function fetchChannelsLiveInfo(finderUserName, options) {
  const validation = validateFinderUserName(getFinderUserName(finderUserName))
  if (!validation.valid) {
    return Promise.reject(Object.assign(new Error(validation.message), { code: validation.code }))
  }
  const name = validation.value

  if (!isSdkAtLeast(MIN_SDK_GET_INFO)) {
    return Promise.reject(Object.assign(new Error('SDK_VERSION_TOO_LOW'), { code: 'SDK_VERSION_TOO_LOW' }))
  }

  const opts = options || {}

  return requestChannelsLiveInfo(name, opts).catch((err) => {
    const manual = getManualFallback()
    if (err && err.isNotSameContractor && manual.enabled) {
      return {
        finderUserName: name,
        feedId: manual.feedId || '',
        nonceId: manual.nonceId || '',
        status: manual.status != null ? manual.status : 0,
        description: manual.description || '',
        headUrl: '',
        nickname: '',
        fromManualFallback: true
      }
    }

    // 1416104 / empty finder info：视为「暂未开播」，不抛 scary error
    if (err && err.isEmptyFinderInfo) {
      return buildEmptyLivePayload(name)
    }

    return Promise.reject(err)
  })
}

/**
 * 直播中是否应由 channel-live 组件接管点击（无「即将打开视频号直播」确认弹窗）。
 * wx.openChannelsLive 即使用户手势触发也会出现确认弹窗，不可用于自定义封面点击。
 */
function shouldUseChannelLiveForTap(status, feedId, sdkSupported) {
  return !!(
    sdkSupported &&
    feedId &&
    Number(status) === LIVE_STATUS.LIVE
  )
}

function openChannelsLive({ finderUserName, feedId, nonceId }) {
  const name = getFinderUserName(finderUserName)
  if (!name) {
    wx.showToast({ title: '视频号 ID 未配置', icon: 'none' })
    return Promise.reject(new Error('NO_FINDER'))
  }
  if (!feedId) {
    wx.showToast({ title: '暂无直播 feedId', icon: 'none' })
    return Promise.reject(new Error('NO_FEED_ID'))
  }
  if (!isSdkAtLeast(MIN_SDK_GET_INFO)) {
    wx.showToast({ title: '请更新微信版本', icon: 'none' })
    return Promise.reject(new Error('SDK_VERSION_TOO_LOW'))
  }

  return new Promise((resolve, reject) => {
    const params = {
      finderUserName: name,
      feedId,
      success: resolve,
      fail: (err) => {
        wx.showToast({ title: '打开直播间失败', icon: 'none' })
        reject(err)
      }
    }
    if (nonceId) params.nonceId = nonceId
    wx.openChannelsLive(params)
  })
}

function openChannelsUserProfile(finderUserName) {
  const name = getFinderUserName(finderUserName)
  if (!name) {
    wx.showToast({ title: '视频号 ID 未配置', icon: 'none' })
    return Promise.reject(new Error('NO_FINDER'))
  }
  if (!isSdkAtLeast(MIN_SDK_GET_INFO)) {
    wx.showToast({ title: '请更新微信版本', icon: 'none' })
    return Promise.reject(new Error('SDK_VERSION_TOO_LOW'))
  }

  return new Promise((resolve, reject) => {
    wx.openChannelsUserProfile({
      finderUserName: name,
      success: resolve,
      fail: (err) => {
        wx.showToast({ title: '打开视频号失败', icon: 'none' })
        reject(err)
      }
    })
  })
}

module.exports = {
  LIVE_STATUS,
  isChannelLiveSupported,
  getFinderUserName,
  validateFinderUserName,
  classifyLiveError,
  getLiveStatusMeta,
  fetchChannelsLiveInfo,
  shouldUseChannelLiveForTap,
  openChannelsLive,
  openChannelsUserProfile,
  getFallbackGuide
}
