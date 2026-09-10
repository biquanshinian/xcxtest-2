/**
 * 入驻商家员工免会员门控（后台观礼全局开关 merchantStaffGateBypass）
 *
 * 生效：active 商家员工 + 开关开启 → gateCheck / canUsePaidCloudSync / AI 次数视同 Pro
 * 同步：商家中心 me / bind 成功写入；unbind 或非 active / 开关关清除
 */
const storageCache = require('./storage-sync-cache.js')

const STORAGE_KEY = '_merchant_staff_gate_bypass'

function _read() {
  const raw = storageCache.readMemOrSync(STORAGE_KEY, null)
  return raw && typeof raw === 'object' ? raw : null
}

/** 是否持有有效商家员工免门控（同步，供门控热路径） */
function isActive() {
  const p = _read()
  return !!(p && p.active === true)
}

/** 开启本地免门控标记 */
function grant(merchantId) {
  try {
    storageCache.persistAsync(STORAGE_KEY, {
      active: true,
      merchantId: String(merchantId || ''),
      syncedAt: Date.now()
    })
  } catch (e) {}
  return true
}

/** 清除（解绑 / 暂停 / 后台关开关后由 me 同步） */
function clear() {
  try {
    storageCache.persistAsync(STORAGE_KEY, { active: false, merchantId: '', syncedAt: Date.now() })
  } catch (e) {}
}

/**
 * 根据商家接口结果同步本地状态
 * @param {{ gateBypass?: boolean, merchant?: { _id?: string, id?: string } }|null} res
 */
function syncFromMerchantApi(res) {
  if (res && res.gateBypass === true) {
    const m = res.merchant || res
    grant((m && (m._id || m.id || m.merchantId)) || '')
    return true
  }
  clear()
  return false
}

module.exports = {
  isActive,
  grant,
  clear,
  syncFromMerchantApi
}
