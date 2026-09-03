/**
 * 观礼通行证（现场扫码临时免除会员门控）
 *
 * 发放：观礼现场扫场次小程序码 → 云端按场次配置与发射时间窗发证（每人每场次一张）
 * 生效：gateCheck / canUsePaidCloudSync / AI 对话次数等与 Pro 会员一视同仁
 * 失效：到期自动失效；证由云端签发，全局开关关停或场次未开启通行证时不再发新证
 */
const storageCache = require('./storage-sync-cache.js')

const STORAGE_KEY = '_watch_party_pass'

function _read() {
  const raw = storageCache.readMemOrSync(STORAGE_KEY, null)
  return raw && typeof raw === 'object' ? raw : null
}

/** 通行证是否在有效期内（同步，供门控热路径调用） */
function isActive() {
  const p = _read()
  return !!(p && Number(p.expiresAt) > Date.now())
}

/** 有效期截止时间戳（已过期返回 0） */
function getExpireAt() {
  const p = _read()
  const exp = (p && Number(p.expiresAt)) || 0
  return exp > Date.now() ? exp : 0
}

/**
 * 写入云端签发的通行证（只延长不缩短）
 * @returns {boolean} 是否持有有效证（含原有更长的证）
 */
function grant(expiresAt, sessionId) {
  const exp = Number(expiresAt) || 0
  if (exp <= Date.now()) return isActive()
  if (exp <= getExpireAt()) return true
  try {
    storageCache.persistAsync(STORAGE_KEY, {
      expiresAt: exp,
      sessionId: String(sessionId || ''),
      grantedAt: Date.now()
    })
  } catch (e) {}
  return true
}

module.exports = {
  isActive,
  getExpireAt,
  grant
}
