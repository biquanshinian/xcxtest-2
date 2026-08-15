/**
 * Extract user-triggered index Page methods into index-extra/utils/index-interaction.js
 * and leave require.async + attachTo delegates in pages/index/index.js.
 */
const fs = require('fs')

const METHODS = [
  'viewMissionDetail',
  'getMissionDetailCacheStore',
  'setMissionDetailCacheStore',
  'updateMissionDetailCacheEntries',
  'sanitizeMissionDetailCacheStore',
  'buildMissionDetailViewContext',
  'persistMissionDetailListSnapshot',
  'buildPrefetchedMissionDetail',
  'buildDetailPrefetchCacheEntries',
  'normalizeBoosterInfo',
  'onGoBoosterDetail',
  'onGoAgencyDetail',
  'onImageError',
  'onCountdownRocketImageError',
  'refreshLaunchPanelRocketImageUrl',
  'syncLaunchPanelRocketImageWithUpcomingList',
  'syncLaunchDataRocketImageFromListByMissionId',
  '_patchUpcomingListsRocketImage',
  '_preloadVisibleRocketImages',
  '_withResolvedRocketImage',
  'shareMission',
  'onCountdownCardTap',
  'onOverlapSideCardTap'
]

const srcPath = 'pages/index/index.js'
let src = fs.readFileSync(srcPath, 'utf8')
const lines = src.split(/\n/)

// Find Page({ start
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
  // convert `  name(` / `  async name(` to method object form
  body = body.replace(/^  (async )?([a-zA-Z_][\w]*)\s*\(/, (m, asy, n) => {
    return '  ' + (asy || '') + n + '('
  })
  // Keep as object method shorthand inside methods = { ... }
  extracted.push({ name, a, b, body })
  removeRanges.push([a, b])
}

removeRanges.sort((x, y) => y[0] - x[0])
const newLines = lines.slice()
for (const [a, b] of removeRanges) {
  // leave a short comment marker
  newLines.splice(a, b - a + 1, `  // ${lines[a].trim().split('(')[0].replace(/^async /, '')} → index-interaction attachTo`)
}

// Build module
const methodBodies = extracted
  .map((e) => {
    // ensure comma-separated object methods: change trailing `}` of function to `},`
    let b = e.body
    // indent already 2 spaces for function - good for object literal
    if (!b.trimEnd().endsWith(',')) {
      // add comma after closing brace of method
      b = b.replace(/\}\s*$/, '},')
    }
    return b
  })
  .join('\n\n')

const mod = `/**
 * 首页用户触发 / 可延迟交互：详情跳转、缓存、助推器/发射商入口、图片错误回退、分享
 * 主包 index.js 通过 require.async + attachTo 委托（index-extra 已 preload）。
 *
 * 注意：首屏仍会调用 _preloadVisibleRocketImages / syncLaunchPanel* ——
 * 委托壳在调用时 await 分包 attach，preloadRule 下几乎无等待。
 */
const { resolveMissionRocketImage, rocketNameForImage, isDefaultRocketSrc, shouldReplaceRocketImage, DEFAULT_ROCKET_IMAGE } = require('../../../utils/util.js')
const { loadCloudMediaMap } = require('../../../utils/image-config.js')
const { markDownloadFailed } = require('../../../utils/download-fail-cache.js')
const { gateCheck } = require('../../../utils/membership.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const storageCache = require('../../../utils/storage-sync-cache.js')
const {
  resolveMissionDetailSourceData,
  buildMissionDetailNavigation,
  collectMissionShareCandidates,
  setMissionDetailCacheEntry,
  // may be unused depending on extracted helpers
} = require('../../../utils/index-mission-nav.js')

// Re-require nav helpers used by extracted methods — index-mission-nav exports vary; page methods already closed over page requires.
// The extracted methods use symbols from page scope; bind via page instance only (this.* / this.data).

const interactionMethods = {
${methodBodies}
}

function attachTo(page) {
  if (page.__interactionAttached) return interactionMethods
  Object.keys(interactionMethods).forEach((key) => {
    page[key] = interactionMethods[key]
  })
  page.__interactionAttached = true
  return interactionMethods
}

module.exports = { attachTo, methods: interactionMethods }
`

// The extracted methods reference many page-level imports (resolveMissionRocketImage, etc.)
// Those are in page closure, NOT available in the new module. attachTo methods need those
// as requires in the module. Let's detect identifiers from the common page imports.

fs.writeFileSync('subpackages/index-extra/utils/index-interaction.js', mod)

// Insert delegate block before Page({
const delegateBlock = `
// ========== 用户触发交互（详情/图片错误/助推器）：index-extra ==========
const INTERACTION_PKG = '../../subpackages/index-extra/utils/index-interaction.js'
const INTERACTION_METHODS = ${JSON.stringify(extracted.map((e) => e.name), null, 2)}
function delegateInteraction(name) {
  return function (...args) {
    const page = this
    if (page.__interactionAttached) return page[name](...args)
    if (!page.__interactionLoadPromise) {
      page.__interactionLoadPromise = require.async(INTERACTION_PKG).then((mod) => {
        mod.attachTo(page)
        return mod
      }).catch((err) => {
        page.__interactionLoadPromise = null
        throw err
      })
    }
    return page.__interactionLoadPromise.then(() => page[name](...args))
  }
}
const interactionDelegates = {}
INTERACTION_METHODS.forEach((name) => {
  interactionDelegates[name] = delegateInteraction(name)
})

`

let out = newLines.join('\n')
out = out.replace(/^Page\(\{/m, delegateBlock + 'Page({\n  ...interactionDelegates,')
fs.writeFileSync(srcPath, out)

console.log('extracted', extracted.length, 'methods')
console.log('module KB', (mod.length / 1024).toFixed(1))
console.log('index.js KB', (out.length / 1024).toFixed(1))
