/**
 * 从 pages/index/index.js 提取低频 UX 逻辑到 index-extra/utils/index-ux.js
 * （演示模式 / 隐私续费 / 分享面板 / 公告关闭 / 入口跳转）
 */
const fs = require('fs')
const path = require('path')

const INDEX = path.join(__dirname, '../pages/index/index.js')
const OUT = path.join(__dirname, '../subpackages/index-extra/utils/index-ux.js')
const ANCHOR = path.join(__dirname, '../subpackages/index-extra/global-launch-stats.js')

let src = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n')
const before = src.length

const METHOD_NAMES = [
  'closeAnnouncementBanner',
  'closeAnnouncementDetail',
  'openAISearch',
  'openShop',
  '_initDemoMode',
  'onDemoRemoteStart',
  'onDemoStop',
  '_maybePromptPrivacy',
  '_resumeDeferredPopups',
  'onMissionShareTap',
  'onMissionLongPress',
  'onShareSheetClose',
  'onShareSheetItemTap',
  'onShareBriefing',
  'onBriefingClosed',
  '_tryShowRenewalReminder',
  'ensureShareImageHttpUrl'
]

function extractMethod(src, name) {
  // Match `  name(...) {` or `  async name(...) {`
  const re = new RegExp(`\\n  (async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`)
  const m = src.match(re)
  if (!m) throw new Error('method not found: ' + name)
  const start = m.index + 1 // skip leading \n
  const braceStart = src.indexOf('{', start)
  let depth = 0
  let i = braceStart
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        i++
        break
      }
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === q) break
        i++
      }
    }
  }
  // include trailing comma if present
  let end = i
  if (src[end] === ',') end++
  const body = src.slice(start, end).replace(/,\s*$/, '')
  return { start, end, body }
}

const extracted = []
const ranges = []
for (const name of METHOD_NAMES) {
  const r = extractMethod(src, name)
  ranges.push(r)
  extracted.push({ name, body: r.body })
}

// Remove from back to front
ranges
  .slice()
  .sort((a, b) => b.start - a.start)
  .forEach((r) => {
    // also remove blank lines / comment blocks immediately before method if short
    let start = r.start
    const beforeChunk = src.slice(Math.max(0, start - 400), start)
    const commentMatch = beforeChunk.match(/(\n  \/\*\*[\s\S]*?\*\/\n)$/)
    if (commentMatch) start = start - commentMatch[1].length + 1
    src = src.slice(0, start) + src.slice(r.end)
  })

// Remove top-level startDemo require
src = src.replace(
  /const \{ startDemo \} = require\('\.\.\/\.\.\/utils\/demo-engine\.js'\)\n/,
  ''
)

// Inject UX delegates after liveSettleDelegates block
const UX_BLOCK = `
// ========== 低频 UX（演示/隐私/分享面板/公告关闭）：index-extra ==========
const UX_PKG = '../../subpackages/index-extra/utils/index-ux.js'
const UX_METHODS = ${JSON.stringify(METHOD_NAMES, null, 2).replace(/\n/g, '\n')}
function delegateUx(name) {
  return function (...args) {
    const page = this
    if (page.__uxAttached) return page[name](...args)
    if (!page.__uxLoadPromise) {
      page.__uxLoadPromise = require.async(UX_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__uxLoadPromise = null
        throw err
      })
    }
    return page.__uxLoadPromise.then(() => page[name](...args))
  }
}
const uxDelegates = {}
UX_METHODS.forEach((name) => {
  uxDelegates[name] = delegateUx(name)
})
`

if (!src.includes('const liveSettleDelegates')) {
  throw new Error('liveSettleDelegates marker missing')
}
src = src.replace(
  /const liveSettleDelegates = \{\}\nLIVE_SETTLE_METHODS\.forEach\(\(name\) => \{\n  liveSettleDelegates\[name\] = delegateLiveSettle\(name\)\n\}\)\n\nPage\(\{/,
  `const liveSettleDelegates = {}\nLIVE_SETTLE_METHODS.forEach((name) => {\n  liveSettleDelegates[name] = delegateLiveSettle(name)\n})\n${UX_BLOCK}\nPage({`
)

if (!src.includes('...liveSettleDelegates,')) {
  throw new Error('spread marker missing')
}
src = src.replace(
  '  ...liveSettleDelegates,\n',
  '  ...uxDelegates,\n  ...liveSettleDelegates,\n'
)

// Build out module
const moduleSrc = `/**
 * 首页低频 UX：演示模式 / 隐私与续费 / 分享面板 / 公告关闭 / 入口跳转
 * 主包 index.js 通过 require.async + attachTo 委托加载
 */
const { startDemo } = require('../../../utils/demo-engine.js')
const { resolveMissionRocketImage } = require('../../../utils/util.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const {
  resolveMissionSharePayload
} = require('../../../utils/index-mission-nav.js')

const methods = {
${extracted.map((e) => e.body).join(',\n\n')}
}

function attachTo(page) {
  Object.assign(page, methods)
  page.__uxAttached = true
}

module.exports = { attachTo, methods }
`

fs.writeFileSync(OUT, moduleSrc.replace(/\r\n/g, '\n'))
fs.writeFileSync(INDEX, src.replace(/\r\n/g, '\n'))

// Anchor in global-launch-stats
let anchor = fs.readFileSync(ANCHOR, 'utf8')
if (!anchor.includes('index-ux.js')) {
  anchor = anchor.replace(
    "require('./utils/index-live-settle.js')",
    "require('./utils/index-live-settle.js')\nrequire('./utils/index-ux.js')"
  )
  fs.writeFileSync(ANCHOR, anchor)
}

console.log('index.js', (before / 1024).toFixed(1), '->', (src.length / 1024).toFixed(1), 'KB')
console.log('index-ux.js', (moduleSrc.length / 1024).toFixed(1), 'KB')
console.log('methods', METHOD_NAMES.length)
