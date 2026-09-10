/**
 * 服务端时钟校准：给倒计时提供不受设备系统时间影响的「现在」。
 *
 * 为什么需要：发射倒计时、T-0 探针编排、竞猜封盘全都用 Date.now() 作基准，
 * 用户手动改时间 / 时区错乱 / 设备时钟漂移都会让倒计时整体偏移，
 * 并连带错误触发 _onCountdownExpired（发无意义探针）和前后端封盘判定打架。
 *
 * 设计要点：
 * - 只维护一个内存 offset，getServerNow() = Date.now() + offset
 * - 校时失败时 offset 恒为 0，行为与未校时完全一致（零回归风险）
 * - offset 不持久化：跨会话复用旧 offset 会在设备时钟被改回正确值后反而引入偏差
 * - 采样用 NTP 式中点估计抵消 RTT，Date 响应头秒级截断带来的 ±500ms 误差
 *   对秒级倒计时可接受
 * - 小于 MIN_MEANINGFUL_OFFSET_MS 的偏移视为噪声丢弃，避免每次采样都轻微抖动
 */

let _offsetMs = 0
let _syncedAt = 0
let _syncing = null

/** 小于此偏移视为网络噪声，不采用 */
const MIN_MEANINGFUL_OFFSET_MS = 2000
/** 两次主动校时的最小间隔 */
const RESYNC_MIN_GAP_MS = 10 * 60 * 1000

/** 校准后的当前时间戳；未校时或校时失败时等于 Date.now() */
function getServerNow() {
  return Date.now() + _offsetMs
}

function getClockOffsetMs() {
  return _offsetMs
}

function isClockSynced() {
  return _syncedAt > 0
}

/**
 * 喂入一次服务端时间采样。
 * @param {number} serverMs 服务端时间（毫秒）
 * @param {number} sentAtMs 本地发起请求的时刻
 * @param {number} recvAtMs 本地收到响应的时刻
 * @returns {boolean} 是否采用了本次采样
 */
function noteServerTimeSample(serverMs, sentAtMs, recvAtMs) {
  const server = Number(serverMs)
  if (!Number.isFinite(server) || server <= 0) return false
  const sent = Number(sentAtMs)
  const recv = Number(recvAtMs)
  if (!Number.isFinite(sent) || !Number.isFinite(recv) || recv < sent) return false

  // NTP 式中点估计：假设请求与响应的单程延迟大致对称
  const localMidpoint = sent + (recv - sent) / 2
  const offset = server - localMidpoint
  _syncedAt = Date.now()
  if (Math.abs(offset) < MIN_MEANINGFUL_OFFSET_MS) {
    _offsetMs = 0
    return false
  }
  _offsetMs = Math.round(offset)
  return true
}

/**
 * 校时端点：必须是已在小程序后台 request 白名单里的域名，否则 wx.request 直接被拦。
 * 首选自有 Cloudflare Worker 代理（线上功能在用，域名必然已配；Cloudflare 边缘节点
 * 时间由 NTP 同步，且根路径 404 响应同样带 Date 头，小程序对 4xx 走 success 回调）。
 */
function resolveProbeUrl() {
  try {
    const config = require('./config.js')
    const worker = String((config && config.workerProxyUrl) || '').trim()
    if (worker) return worker
  } catch (e) {}
  try {
    const { getCdnBase } = require('./cos-url.js')
    const base = String(getCdnBase() || '').trim()
    if (base) return base
  } catch (e) {}
  return ''
}

/**
 * 主动校时：读 HTTPS 响应头的 Date。
 * 任何失败都静默降级（offset 保持 0），调用方无需处理异常。
 * @param {{ force?: boolean, url?: string }} [options]
 * @returns {Promise<number>} 采用后的 offset（毫秒）
 */
function syncServerClock(options = {}) {
  const force = !!(options && options.force)
  if (!force && _syncedAt && Date.now() - _syncedAt < RESYNC_MIN_GAP_MS) {
    return Promise.resolve(_offsetMs)
  }
  if (_syncing) return _syncing

  const url = (options && options.url) || resolveProbeUrl()
  if (!url || typeof wx === 'undefined' || typeof wx.request !== 'function') {
    return Promise.resolve(_offsetMs)
  }

  const sentAt = Date.now()
  _syncing = new Promise((resolve) => {
    wx.request({
      url,
      method: 'HEAD',
      // 校时对业务无阻塞价值，超时就放弃本轮
      timeout: 8000,
      success: (res) => {
        const recvAt = Date.now()
        const header = (res && res.header) || {}
        const dateText = header.Date || header.date || ''
        const serverMs = dateText ? Date.parse(dateText) : NaN
        if (Number.isFinite(serverMs)) {
          noteServerTimeSample(serverMs, sentAt, recvAt)
        }
        resolve(_offsetMs)
      },
      fail: () => resolve(_offsetMs)
    })
  }).then((value) => {
    _syncing = null
    return value
  })

  return _syncing
}

/** 单测用：重置内部状态 */
function _resetForTest() {
  _offsetMs = 0
  _syncedAt = 0
  _syncing = null
}

module.exports = {
  getServerNow,
  getClockOffsetMs,
  isClockSynced,
  noteServerTimeSample,
  syncServerClock,
  MIN_MEANINGFUL_OFFSET_MS,
  _resetForTest
}
