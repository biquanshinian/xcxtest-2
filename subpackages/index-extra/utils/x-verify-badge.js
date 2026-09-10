/**
 * X 认证标：灰=政府 / 蓝=个人 Premium / 金=企业。
 * progress-extra / index-extra / shared 各有一份相同副本，修改时需同步。
 * 不能跨分包同步 require，也不放主包（代码质量会报「主包未使用 JS」）。
 * 推文抓取（fxtwitter）不区分类型，以前台运营在 tweet_accounts.verifyBadge 的设置为准。
 */
const VERIFY_BADGE_TYPES = ['none', 'blue', 'gold', 'grey']

const VERIFY_BADGE_SRC = {
  grey: '/images/x-verify/grey.svg',
  blue: '/images/x-verify/blue.svg',
  gold: '/images/x-verify/gold.svg'
}

function normalizeVerifyBadge(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'gray' || v === 'government') return 'grey'
  if (v === 'business' || v === 'organization' || v === 'org') return 'gold'
  if (v === 'premium' || v === 'verified') return 'blue'
  if (VERIFY_BADGE_TYPES.indexOf(v) >= 0) return v
  return 'none'
}

function verifyBadgeSrc(type) {
  const t = normalizeVerifyBadge(type)
  return VERIFY_BADGE_SRC[t] || ''
}

module.exports = {
  VERIFY_BADGE_TYPES,
  VERIFY_BADGE_SRC,
  normalizeVerifyBadge,
  verifyBadgeSrc
}
