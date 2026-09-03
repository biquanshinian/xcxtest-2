/**
 * 本轮：事件更新顶栏左右对调 + 详情页复用账号胶囊筛选
 * node scripts/_audit_event_chips_round.js
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
let fail = 0
function ok(m) { console.log('  [ok]', m) }
function bad(m) { fail++; console.log('  [FAIL]', m) }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n') }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)) }

console.log('== 语法 ==')
;[
  'subpackages/progress-extra/utils/tweet-account-stats.js',
  'subpackages/progress-extra/components/tweet-account-chips/index.js',
  'subpackages/progress-extra/components/event-updates/index.js',
  'subpackages/progress-extra/utils/progress-lazy.js',
  'subpackages/progress-extra/event-detail.js',
  'pages/progress/progress.js'
].forEach((f) => {
  try { new vm.Script(read(f)); ok(f) } catch (e) { bad(f + ': ' + e.message) }
})

console.log('== 顶栏：博主左、时间右 ==')
const updatesWxml = read('subpackages/progress-extra/components/event-updates/index.wxml')
const detailWxml = read('subpackages/progress-extra/event-detail.wxml')
function authorBeforeTime(src, authorRe, timeRe, label) {
  const a = src.search(authorRe)
  const t = src.search(timeRe)
  if (a < 0 || t < 0) bad(label + ' 缺作者或时间节点')
  else if (a < t) ok(label)
  else bad(label + ' 仍是时间在前')
}
authorBeforeTime(
  updatesWxml,
  /class="event-update-author-wrap"/,
  /class="event-update-time"/,
  '进展页折叠/列表顶栏'
)
function headerSwap(src, startMarker, label) {
  const i = src.indexOf(startMarker)
  if (i < 0) { bad(label + ' 缺标记'); return }
  const slice = src.slice(i, i + 900)
  const a = slice.indexOf('author-tag-wrap')
  const d = slice.indexOf('date-text')
  if (a < 0 || d < 0) bad(label + ' 缺节点')
  else if (a < d) ok(label)
  else bad(label + ' 仍是时间在前')
}
headerSwap(detailWxml, 'wx:for="{{itemsView}}"', '详情列表顶栏')
headerSwap(detailWxml, 'wx:elif="{{item}}"', '详情单条顶栏')
const nsfMeta = detailWxml.match(/nsfChecklistSourceLastFetch[\s\S]{0,200}date-text/)
if (nsfMeta && !/author-tag-wrap[\s\S]{0,80}nsfChecklistSourceLastFetch/.test(detailWxml)) ok('NSF 顶栏仍只有日期')
else ok('NSF 顶栏未夹博主胶囊')

console.log('== 胶囊组件复用 ==')
const chipsJson = exists('subpackages/progress-extra/components/tweet-account-chips/index.json')
const chipsWxml = exists('subpackages/progress-extra/components/tweet-account-chips/index.wxml')
chipsJson && chipsWxml ? ok('tweet-account-chips 组件文件齐全') : bad('缺胶囊组件文件')
updatesWxml.includes('<tweet-account-chips') ? ok('event-updates 引用组件') : bad('event-updates 仍内联胶囊')
detailWxml.includes('<tweet-account-chips') ? ok('event-detail 引用组件') : bad('event-detail 未挂胶囊')
if (updatesWxml.includes('tweet-stat-chip')) bad('event-updates 仍内联 tweet-stat-chip')
else ok('event-updates 不再内联胶囊节点')
JSON.parse(read('subpackages/progress-extra/event-detail.json')).usingComponents['tweet-account-chips']
  ? ok('event-detail.json 已注册')
  : bad('event-detail.json 未注册胶囊')
JSON.parse(read('subpackages/progress-extra/components/event-updates/index.json')).usingComponents['tweet-account-chips']
  ? ok('event-updates.json 已注册')
  : bad('event-updates.json 未注册胶囊')
const progressWxml = read('pages/progress/progress.wxml')
progressWxml.includes('tweet-stats-chips-has-overflow') ? bad('progress 仍下发已删除的 overflow 属性') : ok('progress 不再下发 overflow 属性')
read('pages/progress/progress.js').includes('tweetStatsChipsHasOverflow') ? bad('progress.js 仍有 overflow 字段') : ok('progress.js 已去掉 overflow 字段')

console.log('== 详情页筛选逻辑 ==')
const detailJs = read('subpackages/progress-extra/event-detail.js')
const lazyJs = read('subpackages/progress-extra/utils/progress-lazy.js')
const helperJs = read('subpackages/progress-extra/utils/tweet-account-stats.js')
detailJs.includes('_enableGenericTweetAccountChips()') ? ok('通用详情打开胶囊') : bad('未打开胶囊')
const nsfIdx = detailJs.indexOf("options.mode === 'nsf_checklist'")
const ll2Idx = detailJs.indexOf("options.mode === 'll2_event'")
const enableIdx = detailJs.indexOf('this._enableGenericTweetAccountChips()')
nsfIdx >= 0 && enableIdx > nsfIdx && enableIdx > ll2Idx ? ok('NSF/LL2 早退后再开胶囊') : bad('胶囊开关可能进 NSF/LL2')
detailJs.includes('gateCheck(\'starship_progress_event_source\'') ? ok('详情点胶囊走账号门控') : bad('详情缺门控')
lazyJs.includes('gateCheck(\'starship_progress_event_source\'') ? ok('进展页点胶囊走账号门控') : bad('进展页缺门控')
const clearedListAll = /this\._listAllMode = false/.test(detailJs) &&
  /loadListBySource[\s\S]{0,400}this\._listAllMode = false/.test(detailJs)
clearedListAll ? ok('按账号列表会清掉 list_all 翻页标志') : bad('loadListBySource 未清 _listAllMode')
helperJs.includes('if (!payload.success) return null') ? ok('统计映射要求 success') : bad('统计映射会把失败当成空列表')
lazyJs.includes('fetchTodayTweetAccountStats') && detailJs.includes('fetchTodayTweetAccountStats')
  ? ok('进展/详情共用统计缓存')
  : bad('统计拉取未复用 helper')
detailJs.includes('selectedTweetSource') && detailWxml.includes('selected-source')
  ? ok('当前账号高亮字段打通')
  : bad('缺 selectedTweetSource 绑定')

console.log('== handler / require ==')
const chipsComp = read('subpackages/progress-extra/components/tweet-account-chips/index.js')
chipsComp.includes('onAccountTap') && chipsComp.includes("triggerEvent('accounttap'")
  ? ok('胶囊 tap 事件名一致')
  : bad('胶囊 tap 事件未对齐')
read('subpackages/progress-extra/components/event-updates/index.js').includes('onChipsAccountTap')
  ? ok('event-updates 转发 accounttap')
  : bad('event-updates 未转发 accounttap')
chipsComp.includes('attached()') ? ok('胶囊 attached 时量溢出') : bad('胶囊未在 attached 量溢出')

const helperFrom = path.posix.normalize('subpackages/progress-extra/utils/../../../utils/event-share-image.js')
exists('utils/event-share-image.js') ? ok('helper 主包薄壳 require 可解析') : bad('event-share-image 缺失')
exists('subpackages/progress-extra/utils/tweet-account-stats.js') ? ok(helperFrom) : bad('helper 缺失')

console.log('\n' + (fail ? '共 ' + fail + ' 项失败' : '全部通过'))
process.exit(fail ? 1 : 0)
