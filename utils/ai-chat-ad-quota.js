/**
 * 星问 AI：看广告解锁当日额外对话次数（与会员免费额度叠加）
 * 产品规则：看完一条激励视频只加 1 次提问。
 */
const storageCache = require('./storage-sync-cache.js')

const STORAGE_KEY = '_ai_chat_ad_bonus'
const DEFAULT_BONUS_PER_WATCH = 1

function _todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function getBonusPerWatch() {
  try {
    const { getMemberPolicySync } = require('./member-policy.js')
    const n = getMemberPolicySync().aiChatAdBonusPerWatch
    if (n > 0) return Math.min(1, n)
  } catch (e) {}
  return DEFAULT_BONUS_PER_WATCH
}

function _read() {
  const raw = storageCache.readMemOrSync(STORAGE_KEY, null)
  if (!raw || typeof raw !== 'object') return { date: '', bonus: 0 }
  return {
    date: String(raw.date || ''),
    bonus: Math.max(0, Number(raw.bonus) || 0)
  }
}

function _write(data) {
  try {
    storageCache.persistAsync(STORAGE_KEY, data || { date: '', bonus: 0 })
  } catch (e) {}
}

/** 今日已累计的广告赠送次数 */
function getAiChatAdBonus() {
  const today = _todayStr()
  const cur = _read()
  if (cur.date !== today) return 0
  return cur.bonus
}

/** 看完广告后追加赠送次数（可多次叠加） */
function grantAiChatAdBonus(amount) {
  const n = Math.max(0, Number(amount) || getBonusPerWatch())
  if (n <= 0) return getAiChatAdBonus()
  const today = _todayStr()
  const cur = _read()
  const prev = cur.date === today ? cur.bonus : 0
  const next = prev + n
  _write({ date: today, bonus: next })
  return next
}

/**
 * 拉起激励视频，看完则 +N 次对话
 * @returns {Promise<boolean>}
 */
function watchAdForAiChatBonus() {
  const adUnlock = require('./ad-unlock.js')
  const n = getBonusPerWatch()
  return adUnlock.showRewardedVideoAd({
    successToast: '已解锁 1 次对话',
    incompleteToast: '需看完广告才能解锁',
    holdMs: 1600
  }).then(function (ok) {
    if (ok) grantAiChatAdBonus(n)
    return !!ok
  })
}

/**
 * 次数用尽时的引导：升级（可选）/ 看广告解锁 1 次
 * @param {{ offerUpgrade?: boolean }} [opts]
 * @returns {Promise<boolean>} true=已看广告加次
 */
function offerAiChatQuotaRecover(opts) {
  const options = opts && typeof opts === 'object' ? opts : {}
  const offerUpgrade = options.offerUpgrade !== false
  const n = getBonusPerWatch()

  return new Promise(function (resolve) {
    const itemList = []
    if (offerUpgrade) itemList.push('升级星际通行证（无限提问）')
    itemList.push('看广告解锁 1 次')

    wx.showActionSheet({
      alertText: '今日提问次数已用完\n看广告可再解锁 1 次',
      itemList: itemList,
      success: function (res) {
        const idx = res.tapIndex
        if (offerUpgrade && idx === 0) {
          try {
            wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
          } catch (e) {}
          resolve(false)
          return
        }
        const adIdx = offerUpgrade ? 1 : 0
        if (idx === adIdx) {
          watchAdForAiChatBonus().then(resolve)
          return
        }
        resolve(false)
      },
      fail: function () {
        resolve(false)
      }
    })
  })
}

module.exports = {
  DEFAULT_BONUS_PER_WATCH: DEFAULT_BONUS_PER_WATCH,
  getBonusPerWatch: getBonusPerWatch,
  getAiChatAdBonus: getAiChatAdBonus,
  grantAiChatAdBonus: grantAiChatAdBonus,
  watchAdForAiChatBonus: watchAdForAiChatBonus,
  offerAiChatQuotaRecover: offerAiChatQuotaRecover
}
