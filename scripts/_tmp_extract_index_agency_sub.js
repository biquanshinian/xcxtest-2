/**
 * Extract upcoming-agency UI + reminder subscribe handlers into index-extra.
 * Keep applyUpcomingAgencyFilterToPatch / _patchUpcomingListAfterAgencyEnrich in main.
 */
const fs = require('fs')

const METHODS = [
  'subscribeReminderForMission',
  'unsubscribeReminderForMission',
  'onMissionSwipeSubscribeTap',
  'onCountdownRemind',
  'onUpcomingAgencyChipsScroll',
  'onUpcomingAgencyChipTap',
  '_selectUpcomingAgencyKey',
  'onAgencyChipLogoLoad',
  '_applyAgencyChipLocalLogo',
  '_applyAgencyChipLogoBgTone',
  'scheduleUpcomingAgencyChipsOverflowHint',
  'updateUpcomingAgencyChipsOverflowHint',
  '_syncUpcomingAgencyScrollHapticBaseline'
]

const srcPath = 'pages/index/index.js'
let src = fs.readFileSync(srcPath, 'utf8')
const lines = src.split(/\n/)

let pageStart = -1
for (let i = 0; i < lines.length; i++) {
  if (/^Page\s*\(/.test(lines[i])) {
    pageStart = i
    break
  }
}
if (pageStart < 0) throw new Error('Page( not found')

function findMethodRange(name) {
  const re = new RegExp('^  (async )?' + name + '\\s*\\(')
  let start = -1
  for (let i = pageStart; i < lines.length; i++) {
    if (re.test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return null
  let depth = 0
  let seen = false
  for (let i = start; i < lines.length; i++) {
    const opens = (lines[i].match(/\{/g) || []).length
    const closes = (lines[i].match(/\}/g) || []).length
    depth += opens - closes
    if (opens) seen = true
    if (seen && depth === 0) return [start, i]
  }
  return null
}

const extracted = []
const removeRanges = []
for (const name of METHODS) {
  const range = findMethodRange(name)
  if (!range) {
    console.warn('missing method', name)
    continue
  }
  const [a, b] = range
  let body = lines.slice(a, b + 1).join('\n')
  extracted.push({ name, a, b, body })
  removeRanges.push([a, b])
}

removeRanges.sort((x, y) => y[0] - x[0])
const newLines = lines.slice()
for (const [a, b] of removeRanges) {
  const name = lines[a].trim().split('(')[0].replace(/^async /, '')
  newLines.splice(a, b - a + 1, `  // ${name} → index-agency-sub attachTo`)
}

const methodBodies = extracted
  .map((e) => {
    let b = e.body
    if (!b.trimEnd().endsWith(',')) b = b.replace(/\}\s*$/, '},')
    return b
  })
  .join('\n\n')

const mod = `/**
 * 首页发射商筛选 chips / 提醒订阅交互（用户触发）
 * 主包 index.js 经 require.async + attachTo 委托；index-extra 已 preload。
 * 首屏列表过滤仍留在主包 applyUpcomingAgencyFilterToPatch。
 */
const {
  subscribeLaunch,
  unsubscribeLaunch,
  isSubscribed
} = require('../../../utils/subscribe.js')
const { peekOaAlertReady } = require('../../../utils/oa-alert.js')
const {
  gateCheck,
  getMembershipState,
  isProSync
} = require('../../../utils/membership.js')
const {
  isRemoteAgencyLogoUrl,
  persistAgencyLogoAfterRemoteLoad
} = require('../../../utils/agency-logo-cache.js')
const { ensureAgencyLogoBgTone } = require('../../../utils/agency-logo-bg.js')

const methods = {
${methodBodies}
}

function attachTo(page) {
  if (page.__agencySubAttached) return methods
  Object.keys(methods).forEach((key) => {
    page[key] = methods[key]
  })
  page.__agencySubAttached = true
  return methods
}

module.exports = { attachTo, methods }
`

// Verify requires exist
for (const p of [
  'utils/subscribe.js',
  'utils/oa-alert.js',
  'utils/membership.js',
  'utils/agency-logo-cache.js'
]) {
  if (!fs.existsSync(p)) console.warn('missing dep', p)
}

fs.writeFileSync('subpackages/index-extra/utils/index-agency-sub.js', mod)
console.log('wrote module KB', (Buffer.byteLength(mod) / 1024).toFixed(1), 'methods', extracted.length)

// Insert delegate block before INTERACTION_PKG or Page(
let out = newLines.join('\n')
if (out.includes('AGENCY_SUB_PKG')) {
  console.log('delegates already present')
} else {
  const delegateBlock = `
// ========== 发射商筛选 / 提醒订阅（用户触发）：index-extra ==========
const AGENCY_SUB_PKG = '../../subpackages/index-extra/utils/index-agency-sub.js'
const AGENCY_SUB_METHODS = ${JSON.stringify(METHODS, null, 2)}
function delegateAgencySub(name) {
  return function (...args) {
    const page = this
    if (page.__agencySubAttached) return page[name](...args)
    if (!page.__agencySubLoadPromise) {
      page.__agencySubLoadPromise = require.async(AGENCY_SUB_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__agencySubLoadPromise = null
        throw err
      })
    }
    return page.__agencySubLoadPromise.then(() => page[name](...args))
  }
}
const agencySubDelegates = {}
AGENCY_SUB_METHODS.forEach((name) => {
  agencySubDelegates[name] = delegateAgencySub(name)
})

`
  out = out.replace(
    '// ========== 用户触发交互（详情/图片错误/助推器）：index-extra ==========',
    delegateBlock + '// ========== 用户触发交互（详情/图片错误/助推器）：index-extra =========='
  )
  out = out.replace('Page({\n  ...interactionDelegates,', 'Page({\n  ...agencySubDelegates,\n  ...interactionDelegates,')
}

fs.writeFileSync(srcPath, out)
console.log('page KB', (Buffer.byteLength(out) / 1024).toFixed(1))
