/**
 * share-gate.js（index-extra 分包内副本）— 会员详情页「分享免门控 + 24 小时有效期」
 *
 * 注意：index-extra / progress-extra / monitor-pages / mission-detail / mission-sim 各有一份相同副本，修改时需同步。
 * 不能放 shared 等其他分包（分包间同步 require 在直达入口时目标分包未下载会黑屏），
 * 也不放主包（代码质量扫描会报「主包未使用文件」），故每个使用方分包各留一份。
 *
 * 规则：
 * 1. App 内自然入口（列表点卡片）在入口处 gateCheck，详情页 onLoad 不拦（维持原有行为）；
 * 2. 有权益的用户分享出去的卡片路径携带分享时间戳 sst（base36 毫秒）；
 * 3. 接收者打开：24 小时内免门控直接查看；超过 24 小时走 gateCheck（会员放行，非会员弹开通引导）；
 * 4. 无权益的接收者再转发：继承原始 sst（24 小时窗口不重置）；有权益的用户转发：写入新时间戳。
 *
 * 页面接入方式：
 *   onLoad:  const allowed = await checkShareEntryGate(this, options, productId, productName)
 *            if (!allowed) { 展示锁定态并 return }
 *            warmShareEntitlement(this, productId)   // 静默预取自身权益，供分享时同步读取
 *   分享:    path 追加 appendShareStamp(this) 返回的 'sst=…'（空串表示不追加）
 */
const { gateCheck, isMembershipEnabled, getMembershipState, isPro, hasPurchased } = require('../../../utils/membership.js')

const SHARE_GATE_TTL_MS = 24 * 60 * 60 * 1000

/** 解析入页参数中的分享时间戳（sst，base36 毫秒），非法/缺失返回 0 */
function parseShareStamp(options) {
  const raw = options && options.sst
  if (!raw) return 0
  const ms = parseInt(String(raw), 36)
  return ms > 0 && ms <= Date.now() + 60 * 1000 ? ms : 0
}

/**
 * 详情页 onLoad 分享入口校验。
 * 返回 true = 放行渲染；false = 分享已过期且用户无权益（gateCheck 已弹过开通引导）。
 * 非分享进入（无 sst，包括 App 内导航和旧版分享卡片）一律放行，与原有行为一致。
 */
async function checkShareEntryGate(page, options, productId, productName) {
  const sst = parseShareStamp(options)
  page._shareSst = sst
  if (!sst) return true
  if (Date.now() - sst <= SHARE_GATE_TTL_MS) {
    // 免门控窗口内：展示底部「限时查看」倒计时胶囊（会员本人在 warmShareEntitlement 里再隐藏）
    page.setData({ shareGateExpireAt: sst + SHARE_GATE_TTL_MS })
    return true
  }
  // 分享卡片已超过 24 小时：按正常门控处理
  return gateCheck(productId, productName)
}

/** 静默预取自身权益（不弹窗），结果缓存在页面实例上，供同步的分享回调读取 */
function warmShareEntitlement(page, productId) {
  page._shareEntitled = false
  isMembershipEnabled()
    .then((enabled) => {
      if (!enabled) {
        page._shareEntitled = true
        return null
      }
      return getMembershipState().then((state) => {
        page._shareEntitled = isPro(state) || hasPurchased(state, productId)
      })
    })
    .then(() => {
      // 自身有权益（会员/已购/会员功能关闭）：无需限时提示，隐藏倒计时胶囊
      if (page._shareEntitled && page.data && page.data.shareGateExpireAt) {
        page.setData({ shareGateExpireAt: 0 })
      }
    })
    .catch(() => {})
}

/**
 * 构建分享路径的时间戳参数（'sst=…' 或空串）。
 * 有权益 → 新时间戳（重开 24 小时窗口）；无权益 → 继承进入时的时间戳（窗口不重置）。
 */
function appendShareStamp(page) {
  const ms = page._shareEntitled ? Date.now() : (page._shareSst || 0)
  return ms ? 'sst=' + ms.toString(36) : ''
}

/** 把 sst 参数拼到分享 path 后面（自动判断 ? / &） */
function withShareStampPath(path, page) {
  const stamp = appendShareStamp(page)
  if (!stamp) return path
  return path + (path.indexOf('?') >= 0 ? '&' : '?') + stamp
}

/** 把 sst 参数拼到朋友圈分享 query 串后面（query 可为空串） */
function withShareStampQuery(query, page) {
  const stamp = appendShareStamp(page)
  if (!stamp) return query || ''
  return query ? query + '&' + stamp : stamp
}

module.exports = {
  SHARE_GATE_TTL_MS,
  parseShareStamp,
  checkShareEntryGate,
  warmShareEntitlement,
  appendShareStamp,
  withShareStampPath,
  withShareStampQuery
}
