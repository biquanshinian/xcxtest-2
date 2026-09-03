/**
 * 审计：本轮「朋友圈分享缩略图」修复是否全链路落地
 * - 发射商详情 → logo
 * - 飞船详情 → 飞船配图
 * - 发射场详情 → 发射场配图
 * - 在轨任务详情(ll2_event) → 事件配图
 * - 封路通知 / 在轨飞行器追踪 → SpaceX logo
 * - 检查清单 / 飞行时间线 / 动态追踪 → 任务卡火箭配置图，兜底 SpaceX logo（禁 default.jpg）
 *
 * exit 0 = 全亮绿灯
 */
const fs = require('fs')
const path = require('path')

const bugs = []
const oks = []

function assert(name, cond, detail) {
  if (cond) {
    oks.push(name)
    console.log('OK  ', name)
  } else {
    const msg = name + (detail ? ': ' + detail : '')
    bugs.push(msg)
    console.log('FAIL', msg)
  }
}

function read(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
}

function hasMethod(src, name) {
  return new RegExp(
    `(?:^|\\n)\\s*(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{|` +
    `(?:^|\\n)\\s*${name}\\s*:\\s*(?:async\\s+)?function\\b`,
    'm'
  ).test(src)
}

function methodBody(src, name) {
  const re = new RegExp(`(?:^|\\n)(  (?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{)`)
  const m = src.match(re)
  if (!m) return null
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0)
  const brace = src.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) break
        i++
      }
    }
  }
  return null
}

function shareHandlersUseImage(src, pickerHint) {
  const app = methodBody(src, 'onShareAppMessage') || ''
  const tl = methodBody(src, 'onShareTimeline') || ''
  const appOk = /imageUrl/.test(app) && (!pickerHint || pickerHint.test(app))
  const tlOk = /imageUrl/.test(tl) && (!pickerHint || pickerHint.test(tl))
  return { appOk, tlOk, app, tl }
}

const ROOT = path.resolve(__dirname, '..')
process.chdir(ROOT)

console.log('===== 0. 语法可解析 =====')
const files = [
  'subpackages/monitor-pages/agency-detail.js',
  'subpackages/monitor-pages/spacecraft-detail.js',
  'subpackages/monitor-pages/launch-site-detail.js',
  'subpackages/monitor-pages/vehicle-tracker/vehicle-tracker.js',
  'subpackages/progress-extra/road-closure-detail.js',
  'subpackages/progress-extra/event-detail.js',
  'pages/progress/progress.js',
  'utils/agency-logo-overrides.js'
]
for (const f of files) {
  try {
    // Page/wx 全局在小程序环境才有；用 node --check 更稳，这里仅防明显语法炸
    require('child_process').execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
    assert('syntax ' + f, true)
  } catch (e) {
    const err = (e.stderr && e.stderr.toString()) || e.message || ''
    assert('syntax ' + f, false, err.split('\n').filter(Boolean).slice(-2).join(' | '))
  }
}

const agency = read('subpackages/monitor-pages/agency-detail.js')
const craft = read('subpackages/monitor-pages/spacecraft-detail.js')
const site = read('subpackages/monitor-pages/launch-site-detail.js')
const vt = read('subpackages/monitor-pages/vehicle-tracker/vehicle-tracker.js')
const road = read('subpackages/progress-extra/road-closure-detail.js')
const event = read('subpackages/progress-extra/event-detail.js')
const progress = read('pages/progress/progress.js')
const logoOv = read('utils/agency-logo-overrides.js')

console.log('\n===== 1. SpaceX logo 常量同源 =====')
assert(
  'logo override 导出 SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL',
  /SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL/.test(logoOv) &&
    /module\.exports[\s\S]*SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL/.test(logoOv)
)
assert(
  'logo 为 COS https',
  /https:\/\/mars-1397421562\.cos\.ap-guangzhou\.myqcloud\.com/.test(logoOv)
)

console.log('\n===== 2. 发射商详情 → logo =====')
assert('agency: shareImage data', /shareImage:\s*''/.test(agency) || /shareImage:/.test(agency))
assert('agency: _pickAgencyShareImage', hasMethod(agency, '_pickAgencyShareImage'))
assert('agency: pick 优先 logoUrl', /item\.logoUrl/.test(methodBody(agency, '_pickAgencyShareImage') || ''))
assert('agency: _syncShareImage', hasMethod(agency, '_syncShareImage'))
assert('agency: ensureShareImageHttpUrl', hasMethod(agency, 'ensureShareImageHttpUrl'))
assert('agency: load 后 sync', /_syncShareImage\(item\)/.test(agency))
{
  const s = shareHandlersUseImage(agency, /shareImage|_pickAgencyShareImage/)
  assert('agency: onShareAppMessage 带图', s.appOk)
  assert('agency: onShareTimeline 带图', s.tlOk)
  assert('agency: 分享不用空 imageUrl 字面量', !/imageUrl:\s*''/.test(s.app + s.tl))
}

console.log('\n===== 3. 飞船详情 → 飞船配图 =====')
assert('craft: shareImage data', /shareImage:\s*''/.test(craft))
assert('craft: _pickSpacecraftShareImage', hasMethod(craft, '_pickSpacecraftShareImage'))
assert('craft: pick 用 imageUrl/fullImageUrl', /fullImageUrl|imageUrl|imageFallbacks/.test(methodBody(craft, '_pickSpacecraftShareImage') || ''))
assert('craft: applyData sync', /_syncShareImage\(item\)/.test(craft))
{
  const s = shareHandlersUseImage(craft, /shareImage|_pickSpacecraftShareImage/)
  assert('craft: onShareAppMessage 带图', s.appOk)
  assert('craft: onShareTimeline 带图', s.tlOk)
}

console.log('\n===== 4. 发射场详情 → 场地图 =====')
assert('site: shareImage data', /shareImage:\s*''/.test(site))
assert('site: _pickLaunchSiteShareImage', hasMethod(site, '_pickLaunchSiteShareImage'))
assert('site: pick 用 site.imageUrl', /site\.imageUrl/.test(methodBody(site, '_pickLaunchSiteShareImage') || ''))
assert('site: load 后 sync', /_syncShareImage\(site\)/.test(site))
{
  const s = shareHandlersUseImage(site, /shareImage|_pickLaunchSiteShareImage/)
  assert('site: onShareAppMessage 带图', s.appOk)
  assert('site: onShareTimeline 带图', s.tlOk)
}

console.log('\n===== 5. 在轨任务详情(ll2_event) → 事件配图 =====')
assert('ll2_event: _pickLl2EventShareImage', hasMethod(event, '_pickLl2EventShareImage'))
assert('ll2_event: pick 用 heroImageUrl', /heroImageUrl/.test(methodBody(event, '_pickLl2EventShareImage') || ''))
assert('ll2_event: load 后 sync', /_syncLl2EventShareImage\(item\)/.test(event))
assert('ll2_event: share 分支显式 mode', /_ll2EventMode[\s\S]*mode=ll2_event/.test(event))
{
  const app = methodBody(event, 'onShareAppMessage') || ''
  const tl = methodBody(event, 'onShareTimeline') || ''
  assert('ll2_event: AppMessage 用事件图', /_ll2EventMode[\s\S]{0,400}_pickLl2EventShareImage|shareImage/.test(app))
  assert('ll2_event: Timeline 用事件图', /_ll2EventMode[\s\S]{0,400}_pickLl2EventShareImage|shareImage/.test(tl))
  assert('ll2_event: Timeline query 带 mode', /mode=ll2_event/.test(tl))
}

console.log('\n===== 6. 封路通知 → SpaceX logo =====')
assert('road: 引用 SPACEX logo', /SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL/.test(road))
assert('road: ROAD_CLOSURE_SHARE_IMAGE', /ROAD_CLOSURE_SHARE_IMAGE/.test(road))
assert('road: shareImage 初始为 logo', /shareImage:\s*ROAD_CLOSURE_SHARE_IMAGE/.test(road))
assert('road: ensureShareImageHttpUrl', hasMethod(road, 'ensureShareImageHttpUrl'))
assert('road: onLoad 预下载', /ensureShareImageHttpUrl\(ROAD_CLOSURE_SHARE_IMAGE\)/.test(road))
{
  const s = shareHandlersUseImage(road, /ROAD_CLOSURE_SHARE_IMAGE|shareImage/)
  assert('road: onShareAppMessage 带 SpaceX logo', s.appOk)
  assert('road: onShareTimeline 带 SpaceX logo', s.tlOk)
  assert('road: 不再写 imageUrl: \'\'', !/imageUrl:\s*''/.test(s.app + s.tl))
}
assert(
  'progress: 封路分享给好友带 logo',
  /shareType === ['"]roadClosure['"]/.test(progress) &&
    /SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL/.test(progress) &&
    /optimizeImageUrl\(SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL/.test(progress) &&
    /imageUrl:\s*logo/.test(progress)
)

console.log('\n===== 7. 在轨飞行器追踪 → SpaceX logo =====')
assert('vt: 引用 SPACEX logo', /SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL/.test(vt))
assert('vt: VEHICLE_TRACKER_SHARE_IMAGE', /VEHICLE_TRACKER_SHARE_IMAGE/.test(vt))
assert('vt: shareImage 初始为 logo', /shareImage:\s*VEHICLE_TRACKER_SHARE_IMAGE/.test(vt))
assert('vt: ensureShareImageHttpUrl', hasMethod(vt, 'ensureShareImageHttpUrl'))
assert('vt: onLoad 预下载', /ensureShareImageHttpUrl\(VEHICLE_TRACKER_SHARE_IMAGE\)/.test(vt))
{
  const s = shareHandlersUseImage(vt, /VEHICLE_TRACKER_SHARE_IMAGE|shareImage/)
  assert('vt: onShareAppMessage 带图', s.appOk)
  assert('vt: onShareTimeline 带图', s.tlOk)
}

console.log('\n===== 8. 检查清单 / 时间线 / 动态追踪 → 任务配置图 + SpaceX 兜底 =====')
assert('starship pages: STARSHIP_PAGE_SHARE_FALLBACK', /STARSHIP_PAGE_SHARE_FALLBACK/.test(event))
assert('starship pages: fallback 用 SpaceX logo', /STARSHIP_PAGE_SHARE_FALLBACK[\s\S]{0,200}SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL/.test(event) || /SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL[\s\S]{0,200}STARSHIP_PAGE_SHARE_FALLBACK/.test(event))
assert('starship pages: isDefaultRocketSrc 过滤占位图', /isDefaultRocketSrc/.test(event) && /pickUsableMissionRocketShareImage/.test(event))
assert('starship pages: _resolveStarshipPageShareImage', hasMethod(event, '_resolveStarshipPageShareImage'))
assert('starship pages: _syncStarshipPageShareImage', hasMethod(event, '_syncStarshipPageShareImage'))
assert('nsf: load 后 sync', /nsfStarshipMissions:\s*missions[\s\S]{0,120}_syncStarshipPageShareImage/.test(event))
assert('timeline: load 后 sync', /ll2DetailTimelineRows[\s\S]{0,400}_syncStarshipPageShareImage/.test(event))
assert('updates: load 后 sync', /ll2DetailLaunchUpdates[\s\S]{0,400}_syncStarshipPageShareImage/.test(event))
{
  const app = methodBody(event, 'onShareAppMessage') || ''
  const tl = methodBody(event, 'onShareTimeline') || ''
  assert('nsf AppMessage 不用 pickEventShareImageUrl(null)', /_nsfChecklistMode[\s\S]{0,500}_resolveStarshipPageShareImage/.test(app))
  assert('nsf Timeline 不用 pickEventShareImageUrl(null)', /_nsfChecklistMode[\s\S]{0,500}_resolveStarshipPageShareImage/.test(tl))
  assert('timeline AppMessage 用 resolve', /_ll2TimelineMode[\s\S]{0,500}_resolveStarshipPageShareImage/.test(app))
  assert('timeline Timeline 用 resolve', /_ll2TimelineMode[\s\S]{0,500}_resolveStarshipPageShareImage/.test(tl))
  assert('updates AppMessage 用 resolve', /_ll2LaunchUpdatesMode[\s\S]{0,500}_resolveStarshipPageShareImage/.test(app))
  assert('updates Timeline 用 resolve', /_ll2LaunchUpdatesMode[\s\S]{0,500}_resolveStarshipPageShareImage/.test(tl))

  // 三模式分支内不得再裸调 pickEventShareImageUrl(null) 作为 imageUrl
  const nsfApp = (app.match(/if \(this\._nsfChecklistMode\) \{[\s\S]*?\n    \}/) || [])[0] || ''
  const tlApp = (app.match(/if \(this\._ll2TimelineMode\) \{[\s\S]*?\n    \}/) || [])[0] || ''
  const luApp = (app.match(/if \(this\._ll2LaunchUpdatesMode\) \{[\s\S]*?\n    \}/) || [])[0] || ''
  assert('nsf 分支禁 default 分享图', !/pickEventShareImageUrl\(null\)/.test(nsfApp))
  assert('timeline 分支禁 default 分享图', !/pickEventShareImageUrl\(null\)/.test(tlApp))
  assert('updates 分支禁 default 分享图', !/pickEventShareImageUrl\(null\)/.test(luApp))
}
assert(
  'resolve 禁 default：先过滤再兜底 SpaceX',
  /pickUsableMissionRocketShareImage[\s\S]{0,200}isDefaultRocketSrc[\s\S]{0,800}STARSHIP_PAGE_SHARE_FALLBACK/.test(event) ||
    /function pickUsableMissionRocketShareImage[\s\S]*isDefaultRocketSrc[\s\S]*_resolveStarshipPageShareImage[\s\S]*STARSHIP_PAGE_SHARE_FALLBACK/.test(event)
)

console.log('\n===== 9. 运行时浅测：picker 逻辑 =====')
try {
  // util / agency-logo-overrides 依赖小程序全局；审计环境补桩
  global.wx = global.wx || {
    env: { USER_DATA_PATH: '/tmp' },
    getFileSystemManager: () => ({
      accessSync: () => {},
      mkdirSync: () => {},
      unlink: () => {}
    }),
    getStorageSync: () => ({}),
    setStorage: () => {},
    downloadFile: () => {}
  }
  const util = require('../utils/util.js')
  assert('util.isDefaultRocketSrc(default.jpg)', util.isDefaultRocketSrc('火箭配置图/default.jpg') === true)
  assert('util.isDefaultRocketSrc(Starship)', util.isDefaultRocketSrc('火箭配置图/Starship V3 Flight 12.jpg') === false)
  const { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require('../utils/agency-logo-overrides.js')
  assert('SpaceX logo 非空 https', /^https:\/\//.test(SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL))
  assert('SpaceX logo 不是 default', !util.isDefaultRocketSrc(SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL))
} catch (e) {
  assert('runtime shallow', false, e.message)
}

console.log('\n===== 汇总 =====')
console.log('PASS', oks.length)
console.log('FAIL', bugs.length)
if (bugs.length) {
  bugs.forEach((b) => console.log(' -', b))
  process.exit(1)
}
console.log('ALL GREEN')
process.exit(0)
