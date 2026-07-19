/**
 * share-gate.js（mission-sim 分包内副本）— 会员详情页「分享免门控 + 24 小时有效期」
 *
 * 注意：index-extra / progress-extra / monitor-pages / mission-detail / mission-sim 各有一份相同副本，修改时需同步。
 * 不能放 shared 等其他分包（分包间同步 require 在直达入口时目标分包未下载会黑屏），
 * 也不放主包（代码质量扫描会报「主包未使用文件」），故每个使用方分包各留一份。
 *
 * 规则：
 * 1. App 内自然入口在入口处 gateCheck，详情页 onLoad 不拦（维持原有行为）；
 * 2. 有权益的用户分享出去的卡片路径携带分享时间戳 sst（base36 毫秒）；
 * 3. 接收者打开：24 小时内免门控直接查看；超过 24 小时走 gateCheck（会员放行，非会员弹开通引导）；
 * 4. 无权益的接收者再转发：继承原始 sst（24 小时窗口不重置）；有权益的用户转发：写入新时间戳。
 */
const { gateCheck, isMembershipEnabled, getMembershipState, isPro, hasPurchased } = require('../../../utils/membership.js')

const SHARE_GATE_TTL_MS = 24 * 60 * 60 * 1000

function parseShareStamp(options) {
  const raw = options && options.sst
  if (!raw) return 0
  const ms = parseInt(String(raw), 36)
  return ms > 0 && ms <= Date.now() + 60 * 1000 ? ms : 0
}

async function checkShareEntryGate(page, options, productId, productName) {
  const sst = parseShareStamp(options)
  page._shareSst = sst
  if (!sst) return true
  if (Date.now() - sst <= SHARE_GATE_TTL_MS) {
    page.setData({ shareGateExpireAt: sst + SHARE_GATE_TTL_MS })
    return true
  }
  return gateCheck(productId, productName)
}

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
      if (page._shareEntitled && page.data && page.data.shareGateExpireAt) {
        page.setData({ shareGateExpireAt: 0 })
      }
    })
    .catch(() => {})
}

function appendShareStamp(page) {
  const ms = page._shareEntitled ? Date.now() : (page._shareSst || 0)
  return ms ? 'sst=' + ms.toString(36) : ''
}

function withShareStampPath(path, page) {
  const stamp = appendShareStamp(page)
  if (!stamp) return path
  return path + (path.indexOf('?') >= 0 ? '&' : '?') + stamp
}

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
