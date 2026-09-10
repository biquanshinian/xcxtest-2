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
  const re = new RegExp(
    `(?:^|\\n)(  (?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{|` +
    `  ${name}\\s*:\\s*(?:async\\s+)?function\\s*\\([^)]*\\)\\s*\\{)`
  )
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
  'subpackages/progress-extra/hardware-detail.js',
  'subpackages/progress-extra/starship-detail.js',
  'subpackages/progress-extra/utils/hardware-share-image.js',
  'subpackages/monitor-pages/rocket-compare.js',
  'subpackages/monitor-pages/rocket-score.js',
  'subpackages/monitor-pages/utils/rocket-model-share-image.js',
  'subpackages/monitor-pages/station-detail.js',
  'subpackages/monitor-pages/booster-detail.js',
  'subpackages/monitor-pages/rocket-model-detail.js',
  'utils/agency-logo-overrides.js',
  'utils/share-thumb.js',
  'subpackages/news-extra/detail.js',
  'subpackages/monitor-pages/agency-list.js',
  'subpackages/progress-extra/hardware-list.js',
  'subpackages/monitor-pages/booster-genealogy.js',
  'subpackages/monitor-pages/spacecraft-gallery.js',
  'subpackages/monitor-pages/launch-site-gallery.js',
  'pages/monitor/monitor.js',
  'subpackages/news-extra/photo-detail.js',
  'subpackages/rocket-3d/share.js',
  'subpackages/shared/ai-chat.js',
  'subpackages/shared/briefing.js',
  'pages/index/index.js',
  'subpackages/progress-extra/event-detail.js'
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
assert('craft: shareImage data', /shareImage:\s*(''|SHARE_THUMB_FALLBACK)/.test(craft))
assert('craft: pickShareImageUrl 禁 webp 直出', /pickShareImageUrl/.test(craft) && /ensureShareImageOnPage/.test(craft))
assert('craft: _pickSpacecraftShareImage', hasMethod(craft, '_pickSpacecraftShareImage'))
assert('craft: pick 用 imageUrl/fullImageUrl', /fullImageUrl|imageUrl|imageFallbacks/.test(methodBody(craft, '_pickSpacecraftShareImage') || ''))
assert('craft: applyData sync', /_syncShareImage\(item\)/.test(craft))
{
  const s = shareHandlersUseImage(craft, /shareImage|_pickSpacecraftShareImage/)
  assert('craft: onShareAppMessage 带图', s.appOk)
  assert('craft: onShareTimeline 带图', s.tlOk)
}

console.log('\n===== 4. 发射场详情 → 场地图 =====')
assert('site: shareImage data', /shareImage:\s*(''|SHARE_THUMB_FALLBACK)/.test(site))
assert('site: _pickLaunchSiteShareImage', hasMethod(site, '_pickLaunchSiteShareImage'))
assert('site: pick 用 site.imageUrl', /imageUrl/.test(methodBody(site, '_shareImageOpts') || methodBody(site, '_pickLaunchSiteShareImage') || ''))
assert('site: pickShareImageUrl 禁 webp 直出', /pickShareImageUrl/.test(site) && /ensureShareImageOnPage/.test(site))
assert('site: load 后 sync', /_syncShareImage\(site\)/.test(site))
{
  const s = shareHandlersUseImage(site, /shareImage|_pickLaunchSiteShareImage|pageShareImage/)
  assert('site: onShareAppMessage 带图', s.appOk)
  assert('site: onShareTimeline 带图', s.tlOk)
  assert('site: 分享不再可空 imageUrl', !/if \(imageUrl\) result\.imageUrl/.test(s.app + s.tl))
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
assert('timeline: load 后 sync', /ll2DetailTimelineRows:\s*rows[\s\S]{0,800}_syncStarshipPageShareImage/.test(event))
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

console.log('\n===== 9. 事件更新推文分享 → 媒体优先 / 无图才用头像 =====')
assert('event: 推文分享预下载 ensureShareImageHttpUrl', /ensureShareImageHttpUrl\(shareImage\)/.test(event) && /ensureShareImageHttpUrl\(listShareImage\)/.test(event))
assert('event: 今日动态会写 shareImage', /namePart \+ ' · 今日动态'/.test(event) && /shareImage/.test(event))
assert('event: 列表分享优先已落地本地图', /_shareImageSourceUrl === picked/.test(event))
{
  const helper = read('subpackages/shared/utils/event-share-image.js')
  assert('picker 媒体优先于头像', /function pickEventMediaShareImageUrl/.test(helper) && helper.indexOf('pickEventMediaShareImageUrl') < helper.indexOf('pickEventAvatarShareImageUrl'))
  assert('picker 无媒体才用头像', /mediaPicked/.test(helper) && /avatarPicked/.test(helper) && helper.indexOf('if (mediaPicked)') < helper.indexOf('avatarPicked'))
  assert('picker 分享图不转 webp', /朋友圈缩略图对 webp/.test(helper) && !/optimizeImageUrl\(httpsUrl, 'medium'\)/.test(helper))
  assert('视频分享用指定封面', /preferMediaIndex/.test(event) && /_buildEventVideoShareInfo\(item\._id, mediaIndex\)/.test(event))
}

console.log('\n===== 10. 星舰硬件设施详情 / 型号进展详情 =====')
const hardware = read('subpackages/progress-extra/hardware-detail.js')
const starship = read('subpackages/progress-extra/starship-detail.js')
const hwShare = read('subpackages/progress-extra/utils/hardware-share-image.js')
assert('hardware helper: cloud:// 不当 imageUrl', /cloud:\/\//.test(hwShare) && /toShareableHttps/.test(hwShare) && /HARDWARE_SHARE_SAFE_FALLBACK/.test(hwShare))
assert('hardware helper: 预下载保留 fileID', /pickHardwareShareSourceForDownload/.test(hwShare) && /cloud:\/\//.test(methodBody(hwShare, 'pickHardwareShareSourceForDownload') || hwShare))
assert('hardware-detail: shareImage + ensure', /shareImage:\s*''/.test(hardware) && hasMethod(hardware, 'ensureShareImageHttpUrl') && /_syncShareImage\(vehicle\)/.test(hardware))
assert('starship-detail: shareImage + ensure', /shareImage:\s*''/.test(starship) && hasMethod(starship, 'ensureShareImageHttpUrl') && /_syncShareImage\(detail\)/.test(starship))
{
  const h = shareHandlersUseImage(hardware, /shareImage|_buildShareImage|pickHardwareShareImageUrl/)
  const s = shareHandlersUseImage(starship, /shareImage|_buildShareImage|pickHardwareShareImageUrl/)
  assert('hardware-detail: AppMessage 带图', h.appOk)
  assert('hardware-detail: Timeline 带图', h.tlOk)
  assert('starship-detail: AppMessage 带图', s.appOk)
  assert('starship-detail: Timeline 带图', s.tlOk)
}

console.log('\n===== 11. 火箭对比 / 档案指数 =====')
const compareShare = read('subpackages/monitor-pages/rocket-compare.js')
const scoreShare = read('subpackages/monitor-pages/rocket-score.js')
const rocketShare = read('subpackages/monitor-pages/utils/rocket-model-share-image.js')
assert('rocket helper: 禁 webp/default 远程图', /isWebpPath/.test(rocketShare) && /isDefaultRocketSrc/.test(rocketShare))
assert('rocket helper: 预下载走代理或 fileID', /toDownloadableShareSrc/.test(rocketShare) && /proxiedImageUrl/.test(rocketShare))
assert('compare: shareImage + ensure', /shareImage:\s*''/.test(compareShare) && hasMethod(compareShare, 'ensureShareImageHttpUrl') && /_syncShareImage\(selected\)/.test(compareShare))
assert('score: shareImage + ensure', /shareImage:\s*''/.test(scoreShare) && hasMethod(scoreShare, 'ensureShareImageHttpUrl') && /_syncShareImage\(model\)/.test(scoreShare))
{
  const c = shareHandlersUseImage(compareShare, /shareImage|_buildShareImage|pickRocketModelShareImageUrl/)
  const s = shareHandlersUseImage(scoreShare, /shareImage|_buildShareImage|pickRocketModelShareImageUrl/)
  assert('compare: AppMessage 带图', c.appOk)
  assert('compare: Timeline 带图', c.tlOk)
  assert('score: AppMessage 带图', s.appOk)
  assert('score: Timeline 带图', s.tlOk)
}

console.log('\n===== 12. 空间站详情 =====')
const stationShare = read('subpackages/monitor-pages/station-detail.js')
assert('station: shareImage + ensure', /shareImage:\s*''/.test(stationShare) && hasMethod(stationShare, 'ensureShareImageHttpUrl') && /_syncShareImage\(merged\)/.test(stationShare))
assert('station: 预加载也会 sync', /_syncShareImage\(preloadItem\)/.test(stationShare))
{
  const s = shareHandlersUseImage(stationShare, /shareImage|_buildShareImage|pickRocketModelShareImageUrl/)
  assert('station: AppMessage 带图', s.appOk)
  assert('station: Timeline 带图', s.tlOk)
  assert('station: 不再直出 item.image', !/imageUrl:\s*item && item\.image/.test(s.app + s.tl))
}

console.log('\n===== 13. 可回收火箭档案详情 =====')
const boosterShare = read('subpackages/monitor-pages/booster-detail.js')
assert('booster: shareImage + ensure', /shareImage:\s*''/.test(boosterShare) && hasMethod(boosterShare, 'ensureShareImageHttpUrl') && /_syncShareImage\(item\)/.test(boosterShare))
assert('booster: 族名兜底配置图', /rocketFamilyEn/.test(boosterShare) && /pickRocketModelShareImageUrl/.test(boosterShare))
{
  const b = shareHandlersUseImage(boosterShare, /shareImage|_buildShareImage|pickRocketModelShareImageUrl/)
  assert('booster: AppMessage 带图', b.appOk)
  assert('booster: Timeline 带图', b.tlOk)
  assert('booster: 不再直出 item.imageUrl', !/imageUrl:\s*item && item\.imageUrl/.test(b.app + b.tl))
}

console.log('\n===== 14. 火箭型号档案详情 =====')
const modelShare = read('subpackages/monitor-pages/rocket-model-detail.js')
assert('model: shareImage + ensure', /shareImage:\s*''/.test(modelShare) && hasMethod(modelShare, 'ensureShareImageHttpUrl') && /_syncShareImage\(model\)/.test(modelShare))
assert('model: 头图链含配置图兜底', /heroCandidates/.test(modelShare) && /imageFallbacks/.test(modelShare) && /getRocketImage/.test(modelShare))
{
  const m = shareHandlersUseImage(modelShare, /shareImage|_buildShareImage|pickRocketModelShareImageUrl/)
  assert('model: AppMessage 带图', m.appOk)
  assert('model: Timeline 带图', m.tlOk)
  assert('model: 不再直出 model.imageUrl', !/imageUrl:\s*model && model\.imageUrl/.test(m.app + m.tl))
}

console.log('\n===== 15. 资讯详情 / 图鉴列表 / 监控分享 =====')
{
  const newsDetail = read('subpackages/news-extra/detail.js')
  const agencyList = read('subpackages/monitor-pages/agency-list.js')
  const hardwareList = read('subpackages/progress-extra/hardware-list.js')
  const genealogy = read('subpackages/monitor-pages/booster-genealogy.js')
  const craftGallery = read('subpackages/monitor-pages/spacecraft-gallery.js')
  const siteGallery = read('subpackages/monitor-pages/launch-site-gallery.js')
  const monitor = read('pages/monitor/monitor.js')
  const shareThumb = read('utils/share-thumb.js')
  assert('share-thumb: 导出 pick + ensure + SpaceX 兜底', /pickShareImageUrl/.test(shareThumb) && /ensureShareImageOnPage/.test(shareThumb) && /SHARE_THUMB_FALLBACK/.test(shareThumb))
  assert('news-detail: pick + ensure', /pickShareImageUrl/.test(newsDetail) && /_syncShareImage/.test(newsDetail) && /ensureShareImageOnPage/.test(newsDetail))
  {
    const s = shareHandlersUseImage(newsDetail, /shareImage|resolveShareImage/)
    assert('news-detail: AppMessage 带图', s.appOk)
    assert('news-detail: Timeline 带图', s.tlOk)
  }
  assert('agency-list: sync + pick', /_syncShareImage/.test(agencyList) && /shareOptsFromCard/.test(agencyList))
  {
    const s = shareHandlersUseImage(agencyList, /pageShareImage|shareImage/)
    assert('agency-list: AppMessage 带图', s.appOk)
    assert('agency-list: Timeline 带图', s.tlOk)
    assert('agency-list: 不再直出 displayImage', !/imageUrl:\s*\(this\.data\.list\[0\]/.test(s.app + s.tl))
  }
  assert('hardware-list: hardware picker + ensure', /pickHardwareShareImageUrl/.test(hardwareList) && /ensureShareImageOnPage/.test(hardwareList))
  {
    const s = shareHandlersUseImage(hardwareList, /_buildShareImage|shareImage/)
    assert('hardware-list: AppMessage 带图', s.appOk)
    assert('hardware-list: Timeline 带图', s.tlOk)
  }
  assert('genealogy: rocket picker + ensure', /pickRocketModelShareImageUrl/.test(genealogy) && /_syncShareImage/.test(genealogy))
  {
    const s = shareHandlersUseImage(genealogy, /_buildShareImage|shareImage/)
    assert('genealogy: AppMessage 带图', s.appOk)
    assert('genealogy: Timeline 带图', s.tlOk)
  }
  assert('spacecraft-gallery: sync + share', /syncPageShareImage/.test(craftGallery) && shareHandlersUseImage(craftGallery, /pageShareImage/).appOk)
  assert('launch-site-gallery: sync + share', /syncPageShareImage/.test(siteGallery) && shareHandlersUseImage(siteGallery, /pageShareImage/).appOk)
  assert('monitor: boot + 全部分支带图', /bootPageShareThumb/.test(monitor) && /_withShareThumb/.test(monitor))
  {
    const app = methodBody(monitor, 'onShareAppMessage') || ''
    const tl = methodBody(monitor, 'onShareTimeline') || ''
    assert('monitor: AppMessage 带图', /_withShareThumb/.test(app))
    assert('monitor: Timeline 带图', /_withShareThumb/.test(tl))
  }
}

console.log('\n===== 16. 运行时浅测：picker 逻辑 =====')
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
  const shareThumb = require('../utils/share-thumb.js')
  const webp = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/nsf/f9.webp?imageMogr2/thumbnail/480x/format/webp/quality/70'
  assert('share-thumb: webp 不当远程 imageUrl', shareThumb.pickShareImageUrl({ rawImage: webp }) === shareThumb.SHARE_THUMB_FALLBACK)
  const siteJpg = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%8F%91%E5%B0%84%E5%9C%BA/ksc.jpg?imageMogr2/thumbnail/480x/format/webp/quality/70'
  const siteRaw = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%8F%91%E5%B0%84%E5%9C%BA/ksc.jpg'
  assert(
    'share-thumb: 发射场卡片 webp 回退原 jpg',
    shareThumb.pickShareImageUrl({ displayImage: siteJpg, rawImage: siteJpg, fallbacks: [siteRaw] }) === siteRaw
  )
  const ll2 = 'https://thespacedevs-prod.nyc3.digitaloceanspaces.com/media/images/kennedy_image.jpeg'
  assert('share-thumb: LL2 预下载走代理', String(shareThumb.pickShareDownloadSrc({ rawImage: ll2 })).indexOf('/image?url=') >= 0)
  assert('share-thumb: cloud:// 不当 imageUrl', shareThumb.pickShareImageUrl({ rawImage: 'cloud://x/a.jpg' }) === shareThumb.SHARE_THUMB_FALLBACK)
} catch (e) {
  assert('runtime shallow', false, e.message)
}

console.log('\n===== 17. 本轮全页：预下载 + 禁止空图 + 禁 cloud:// 当本地 =====')
{
  const more = [
    ['photo-detail', 'subpackages/news-extra/photo-detail.js', /pageShareImage|shareImage/],
    ['briefing', 'subpackages/shared/briefing.js', /pageShareImage|shareImage/],
    ['ai-chat', 'subpackages/shared/ai-chat.js', /pageShareImage|shareImage/],
    ['global-stats', 'subpackages/index-extra/global-launch-stats.js', /pageShareImage|shareImage/],
    ['artemis', 'subpackages/monitor-pages/artemis-detail.js', /pageShareImage|shareImage/],
    ['starlink-full', 'subpackages/monitor-pages/starlink-fullscreen.js', /pageShareImage|shareImage/],
    ['starlink-pass', 'subpackages/monitor-pages/starlink-pass-detail.js', /pageShareImage|shareImage/],
    ['entry-list', 'subpackages/monitor-pages/space-notices/entry-list.js', /pageShareImage|shareImage/],
    ['notice-map', 'subpackages/monitor-pages/space-notices/notice-map.js', /pageShareImage|shareImage/],
    ['agency-launches', 'subpackages/monitor-pages/agency-launches.js', /pageShareImage|shareImage/],
    ['booster-history', 'subpackages/monitor-pages/booster-history.js', /pageShareImage|shareImage/],
    ['site-map', 'subpackages/monitor-pages/launch-site-map.js', /pageShareImage|shareImage/],
    ['starbase-map', 'subpackages/progress-extra/starbase-map.js', /pageShareImage|shareImage/],
    ['road-map', 'subpackages/progress-extra/road-closure-map.js', /buildMapShareOptions|SHARE_THUMB_FALLBACK|imageUrl/],
    ['nasa-data', 'pages/nasa-data/nasa-data.js', /_getShareImage|shareImage|pageShareImage/],
    ['eonet-map', 'pages/nasa-data/eonet-map.js', /pageShareImage|shareImage/],
    ['astro-calendar', 'pages/space-explore/astro-calendar.js', /pageShareImage|shareImage/],
    ['exoplanet', 'pages/space-explore/exoplanet.js', /pageShareImage|shareImage/],
    ['collect', 'pages/collect/collect.js', /pageShareImage|shareImage/],
    ['search', 'pages/search/search.js', /_shareThumb|shareImage/],
    ['launch-updates', 'pages/mission-detail/launch-updates.js', /pageShareImage|shareImage/],
    ['mission-sim', 'subpackages/mission-sim/mission-sim.js', /pageShareImage|shareImage/],
    ['flight-demo', 'subpackages/mission-sim/flight-demo.js', /pageShareImage|shareImage/]
  ]
  more.forEach(([label, file, hint]) => {
    const src = read(file)
    assert(label + ': 有预下载或兜底 logo', /ensureShareImageOnPage|ensureShareImageHttpUrl|bootPageShareThumb|SHARE_THUMB_FALLBACK|pickShareImageUrl/.test(src))
    const s = shareHandlersUseImage(src, hint)
    const app = methodBody(src, 'onShareAppMessage') || ''
    const tl = methodBody(src, 'onShareTimeline') || ''
    const appHas = s.appOk || /buildMapShareOptions|buildRocket3dShareOptions|_withShareThumb/.test(app)
    const tlHas = !tl || s.tlOk || /buildRocket3dShareOptions|_withShareThumb/.test(tl)
    assert(label + ': AppMessage 带图', appHas)
    if (tl) assert(label + ': Timeline 带图', tlHas)
    assert(label + ': 无空 imageUrl 字面量', !/imageUrl:\s*''/.test(app + tl))
  })

  const rocket3d = read('subpackages/rocket-3d/share.js')
  assert('rocket-3d: 始终带 imageUrl', /pickShareImageUrl/.test(rocket3d) && /imageUrl:\s*imageUrl/.test(rocket3d))
  const mapCommon = read('subpackages/monitor-pages/utils/map-page-common.js')
  assert('map-page-common: 分享带 SpaceX logo', /SHARE_THUMB_FALLBACK/.test(mapCommon) && /imageUrl:\s*SHARE_THUMB_FALLBACK/.test(mapCommon))

  const indexSrc = read('pages/index/index.js')
  const indexApp = methodBody(indexSrc, 'onShareAppMessage') || ''
  assert('index: 简报分享不再空图', /shareType === ['"]briefing['"]/.test(indexApp) && /SHARE_THUMB_FALLBACK/.test(indexApp) && !/imageUrl:\s*''/.test(indexApp))
  assert('index: 封路分享带图', /shareType === ['"]roadClosure['"]/.test(indexApp) && /imageUrl:\s*SHARE_THUMB_FALLBACK/.test(indexApp))

  const craftNow = read('subpackages/monitor-pages/spacecraft-detail.js')
  const siteNow = read('subpackages/monitor-pages/launch-site-detail.js')
  const eventNow = read('subpackages/progress-extra/event-detail.js')
  assert(
    '详情页禁把非 http 当本地路径',
    !/return !\/\^https\?:/.test(craftNow + siteNow + eventNow)
  )
  assert('ll2_event: pickShareImageUrl', /pickShareImageUrl/.test(eventNow) && /heroImageUrl/.test(methodBody(eventNow, '_pickLl2EventShareImage') || ''))
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
