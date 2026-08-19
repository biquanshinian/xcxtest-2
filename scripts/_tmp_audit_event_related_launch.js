/**
 * 事件流「对应发射」建议卡：JS 报错 + 跳转口径审计
 * node scripts/_tmp_audit_event_related_launch.js
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..')
let fail = 0
function bad(msg) { fail++; console.log('  [FAIL] ' + msg) }
function ok(msg) { console.log('  [ok] ' + msg) }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }

const files = [
  'utils/event-feed-intel.js',
  'subpackages/progress-extra/utils/progress-lazy.js',
  'subpackages/progress-extra/event-detail.js',
  'subpackages/progress-extra/components/event-updates/index.js',
  'subpackages/progress-extra/components/mission-list-card/index.js',
  'pages/progress/progress.js'
]

console.log('== 语法 ==')
for (const f of files) {
  try { new vm.Script(read(f)); ok(f) } catch (e) { bad(f + ': ' + e.message) }
}

console.log('== 跳转绑定 ==')
const row = read('subpackages/progress-extra/event-intel-row.wxml')
const related = read('subpackages/progress-extra/event-related-launch.wxml')
const list = read('subpackages/progress-extra/event-detail.wxml')
const updatesWxml = read('subpackages/progress-extra/components/event-updates/index.wxml')
const updatesJs = read('subpackages/progress-extra/components/event-updates/index.js')
const updatesJson = read('subpackages/progress-extra/components/event-updates/index.json')
const cardWxml = read('subpackages/progress-extra/components/mission-list-card/index.wxml')
const cardJs = read('subpackages/progress-extra/components/mission-list-card/index.js')
const cardWxss = read('subpackages/progress-extra/components/mission-list-card/index.wxss')
const progressJs = read('pages/progress/progress.js')
const lazyJs = read('subpackages/progress-extra/utils/progress-lazy.js')
const detailJs = read('subpackages/progress-extra/event-detail.js')
const intelJs = read('utils/event-feed-intel.js')

if (row.includes('event-related-card') || row.includes('relatedLaunchId')) {
  bad('关键词行仍夹着对应发射卡')
} else ok('关键词行不再夹对应发射卡')

if (related.includes('mission-list-card') || related.includes('onRelatedLaunchTap')) {
  bad('event-related-launch.wxml 仍含任务卡，容易被再次当片段引入')
} else ok('对应发射不再走独立片段')

if (related.includes('catchtouchstart="stopPropagation"') ||
    updatesWxml.includes('catchtouchstart="stopPropagation"') ||
    list.includes('catchtouchstart="stopPropagation"')) {
  bad('外包 catchtouchstart 会掐掉任务卡内部点击')
} else ok('没有 catchtouchstart 包住任务卡')

if (/data-id="\{\{item\.relatedLaunchId\}\}"/.test(related) || /data-id="\{\{item\.relatedLaunchId\}\}"/.test(updatesWxml)) {
  bad('建议卡仍用 data-id，会和推文卡片抢 id')
} else ok('建议卡不再使用易冲突的 data-id')

if (updatesWxml.includes('include src="../../event-related-launch.wxml"') ||
    list.includes('event-related-launch.wxml')) {
  bad('宿主仍 include 对应发射片段')
} else ok('宿主已内联 mission-list-card')

const hostHasCardAndBind =
  updatesWxml.includes('bind:cardtap="onRelatedLaunchTap"') &&
  updatesWxml.includes('bind:favoritetap="onToggleRelatedLaunchFavorite"') &&
  list.includes('bind:cardtap="onRelatedLaunchTap"') &&
  list.includes('bind:favoritetap="onToggleRelatedLaunchFavorite"')
if (hostHasCardAndBind) ok('进度流 / 详情页都在宿主上 bind:cardtap')
else bad('宿主缺少 bind:cardtap / bind:favoritetap')

if (updatesWxml.includes('catchtap="onRelatedLaunchTap"') &&
    updatesWxml.includes('data-launch-id="{{item.relatedLaunchId}}"') &&
    list.includes('catchtap="onRelatedLaunchTap"') &&
    list.includes('data-launch-id="{{ev.relatedLaunchId}}"')) {
  ok('外包原生 catchtap + launch-id，拦住推文 bindtap 抢点击')
} else bad('外包未 catchtap 拦截推文点击')

if (updatesWxml.includes('catchlongpress="stopPropagation"') && list.includes('catchlongpress="stopPropagation"')) {
  ok('长按任务卡不会弹出推文分享')
} else bad('对应发射未拦住 longpress，会打开推文分享')

const mediaThenRelated = updatesWxml.indexOf('event-media-list') >= 0 &&
  updatesWxml.lastIndexOf('event-related-mission-wrap') > updatesWxml.lastIndexOf('event-media-list')
if (mediaThenRelated) ok('进度流对应发射在媒体之后（推文最底部）')
else bad('进度流对应发射未放到媒体后面')

const listBlockStart = list.indexOf('wx:for-item="ev"')
const listBlockEnd = list.indexOf('wx:elif="{{item}}"')
const listBlock = listBlockStart >= 0 && listBlockEnd > listBlockStart
  ? list.slice(listBlockStart, listBlockEnd)
  : ''
if (listBlock.indexOf('event-media-list') >= 0 &&
    listBlock.lastIndexOf('ev.relatedLaunchCard') > listBlock.lastIndexOf('event-media-list')) {
  ok('事件列表对应发射在媒体之后')
} else bad('事件列表对应发射未放到媒体后面')

if (updatesWxml.includes('wx:if="{{!item.relatedLaunchId}}"') && updatesWxml.includes('event-update-share-wrap')) {
  ok('有对应发射时隐藏推文转发，收藏改走任务卡槽位')
} else bad('未把转发换成任务卡收藏')

if (updatesJson.includes('mission-list-card')) ok('event-updates 已注册 mission-list-card')
else bad('event-updates 未注册 mission-list-card')

if (updatesJs.includes("name: 'onRelatedLaunchTap'") && updatesJs.includes('launchId:')) {
  ok('组件把点击回传到页面（含 launchId）')
} else bad('event-updates 未转发 onRelatedLaunchTap')

if (progressJs.includes("'onRelatedLaunchTap'") && /PROGRESS_SECTION_EVENT_METHODS[\s\S]*onRelatedLaunchTap/.test(progressJs)) {
  ok('progress sectionevent 白名单含 onRelatedLaunchTap')
} else bad('progress 白名单缺少 onRelatedLaunchTap')

if (lazyJs.includes('relatedLaunchNavFromEvent') && detailJs.includes('relatedLaunchNavFromEvent')) {
  ok('进度页 / 详情页都从组件 detail 解析发射 id')
} else bad('跳转 handler 未走 relatedLaunchNavFromEvent')

if (intelJs.includes('raw.id') && /parseRelatedLaunchNavDataset[\s\S]{0,400}raw\.id/.test(intelJs)) {
  bad('解析函数回退 dataset.id，推文 id 会污染跳转')
} else ok('解析函数不读 dataset.id')

if (lazyJs.includes('ROUTES.MISSION_DETAIL') && lazyJs.includes('&type=')) ok('进度页跳转带 id + type')
else bad('进度页跳转 URL 不完整')

if (detailJs.includes('buildMissionDetailUrl({ id: nav.id, detailType: nav.type })')) {
  ok('详情页走 buildMissionDetailUrl')
} else bad('详情页未用统一任务 URL')

if (lazyJs.includes('fail()') && detailJs.includes('fail()')) ok('navigateTo 有 fail 兜底')
else bad('navigateTo 缺少 fail')

if (intelJs.includes('function decorateEventItem') && intelJs.includes('catch (e)') && /function decorateEventItem[\s\S]*catch \(e\) \{\s*return item/.test(intelJs)) {
  ok('decorateEventItem 吞异常，避免整条事件流挂掉')
} else bad('decorateEventItem 无 try/catch')

if (intelJs.includes('_detailType === \'upcoming\'') && intelJs.includes('_isUpcoming === true')) {
  ok('任务 type 优先信列表标记，不用过期 NET 误判 completed')
} else bad('resolveRelatedDetailType 未信任 _detailType')

if (cardJs.includes('virtualHost: true') && cardWxml.includes('catchtap="onTap"')) {
  ok('任务卡 virtualHost + 根节点 catchtap，点击不会漏给推文')
} else bad('任务卡未设 virtualHost / 根节点 catchtap')

console.log('== 收藏 ==')
if (cardWxml.includes('enableFavorite') && cardWxml.includes('catchtap="onFavoriteTap"') &&
    cardJs.includes('toggleMissionFavorite')) {
  ok('收藏在任务卡内直接 toggleMissionFavorite')
} else bad('收藏未走任务卡内 toggleMissionFavorite')

if (cardWxss.includes('width: 42rpx') && cardWxss.includes('height: 42rpx') &&
    !cardWxss.includes('transform: scale(1.3)')) {
  ok('收藏心形按 1.3 倍实尺寸放大（不被 overflow:hidden 裁掉）')
} else bad('收藏图标未按实尺寸放大到 1.3')

if (cardWxml.includes("item.countryDisplay || item.langUnknownCountry || '未知'") ||
    cardWxml.includes('item.langUnknownCountry || \'未知\'')) {
  bad('任务卡国家空值仍回退「未知」')
} else if (cardWxml.includes('wx:if="{{item.countryDisplay || item.langUnknownCountry}}"')) {
  ok('国家缺失时不展示「未知」')
} else bad('任务卡国家展示条件不对')

if (cardWxml.includes('wx:if="{{item.recoveryTagText}}"')) ok('空回收标签不占位')
else bad('空 recoveryTagText 仍会画出空标签')

const nsfCard = list.slice(list.indexOf('nsf-starship-missions'), list.indexOf('nsf-checklist-detail-card'))
if (nsfCard.includes('enableFavorite="{{true}}"')) bad('NSF 星舰卡被打开了收藏槽')
else ok('NSF 任务卡默认不显示收藏')

if (updatesJs.includes("name: 'onToggleRelatedLaunchFavorite'")) ok('组件转发收藏点击')
else bad('event-updates 未转发收藏')

if (progressJs.includes("'onToggleRelatedLaunchFavorite'") &&
    /PROGRESS_SECTION_EVENT_METHODS[\s\S]*onToggleRelatedLaunchFavorite/.test(progressJs) &&
    /PROGRESS_LAZY_METHODS[\s\S]*onToggleRelatedLaunchFavorite/.test(progressJs)) {
  ok('progress 白名单 + lazy 委托含收藏')
} else bad('progress 未注册收藏 handler')

if (lazyJs.includes('typeof d.favorited === \'boolean\'') &&
    detailJs.includes('typeof d.favorited === \'boolean\'')) {
  ok('页面收到组件已收藏结果后不再二次 toggle')
} else bad('收藏会再 toggle 一次把状态打回去')

const missionDetailJs = read('pages/mission-detail/mission-detail.js')
const favJs = read('utils/favorites.js')
if (favJs.includes('function toggleMissionFavorite') && intelJs.includes('toggleMissionFavorite') && missionDetailJs.includes('toggleMissionFavorite(mission, this.data.detailType)')) {
  ok('收藏走 toggleMissionFavorite，与任务详情同一条路')
} else bad('收藏未与任务详情共用 toggleMissionFavorite')

if (intelJs.includes('function clearRelatedLaunchFavAnimate') && lazyJs.includes('clearRelatedLaunchFavAnimate') && detailJs.includes('clearRelatedLaunchFavAnimate')) {
  ok('爱心动画回调只清动画，不回写收藏态')
} else bad('仍用旧 timeout 回写 favorited')

if (intelJs.includes('isPlaceholderMissionField')) ok('占位地点走 isPlaceholderMissionField')
else bad('未过滤未知地点')

if (intelJs.includes('relatedLaunchCard') && intelJs.includes('recoveryIcons')) {
  ok('建议卡透传首页任务卡回收图标字段')
} else bad('relatedLaunchCard 缺少 recoveryIcons')

console.log('== 运行时 ==')
try {
  require(path.join(ROOT, 'test/event-feed-intel.test.js'))
  ok('event-feed-intel.test.js')
} catch (e) {
  bad('单测失败: ' + e.message)
}

try {
  const intel = require(path.join(ROOT, 'utils/event-feed-intel.js'))
  const reconstructed = { currentTarget: { dataset: { id: 'tweet-1' } }, detail: { id: 's10', type: 'upcoming' } }
  const nav = intel.relatedLaunchNavFromEvent(reconstructed)
  assert.strictEqual(nav.id, 's10')
  assert.strictEqual(nav.type, 'upcoming')
  ok('sectionevent 还原后读组件 detail.id，而不是推文 id')

  const favNav = intel.relatedLaunchNavFromEvent({
    currentTarget: { dataset: { id: 'tweet-1' } },
    detail: { id: 's10', type: 'upcoming' }
  })
  assert.strictEqual(favNav.id, 's10')
  ok('收藏 favoritetap 同样忽略推文 id')

  const wrapNav = intel.relatedLaunchNavFromEvent({
    currentTarget: { dataset: { launchId: 's10', launchType: 'upcoming' } },
    detail: { x: 12, y: 34 }
  })
  assert.ok(wrapNav)
  assert.strictEqual(wrapNav.id, 's10')
  ok('外包原生 catchtap 用 data-launch-id，忽略点击坐标')

  const afterUnfav = [{ relatedLaunchId: 's10', relatedLaunchFavorited: false, relatedLaunchFavAnimate: true }]
  const cleared = intel.clearRelatedLaunchFavAnimate(afterUnfav, 's10')
  assert.strictEqual(cleared[0].relatedLaunchFavorited, false)
  assert.strictEqual(cleared[0].relatedLaunchFavAnimate, false)
  ok('连点收藏再取消后，动画回调不会把爱心点回来')

  const emptyCountry = intel.matchRelatedLaunch({
    content: 'Starship Flight 10',
    originalText: 'Starship Flight 10'
  }, [{
    id: 's10',
    rocketName: 'Starship',
    missionName: 'Flight 10',
    countryDisplay: '未知',
    launchTime: Date.now() + 86400000
  }])
  assert.ok(emptyCountry && emptyCountry.card)
  assert.strictEqual(emptyCountry.card.countryDisplay, '')
  ok('国家占位不会写进任务卡')
} catch (e) {
  bad('sectionevent 还原跳转: ' + e.message)
}

console.log(fail ? ('== 失败 ' + fail + ' ==') : '== 全部通过 ==')
process.exit(fail ? 1 : 0)
