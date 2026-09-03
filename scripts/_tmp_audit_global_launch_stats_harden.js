/**
 * 全球发射统计加固审计：核对空屏/串年/半包覆盖/脏聚合写入等关键不变量。
 * 运行：node scripts/_tmp_audit_global_launch_stats_harden.js
 */
const fs = require('fs')
const path = require('path')

const issues = []
const ok = (m) => console.log('  ok  ' + m)
const fail = (m) => { issues.push(m); console.log('  FAIL ' + m) }

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
}

const page = read('subpackages/index-extra/global-launch-stats.js')
const wxml = read('subpackages/index-extra/global-launch-stats.wxml')
const cloud = read('cloudfunctions/getLaunchStats/index.js')
const client = read('utils/launch-stats-cloud.js')
const merge = read('subpackages/index-extra/utils/global-launch-stats-merge.js')

console.log('==== 全球发射统计加固审计 ====')

if (page.includes('statsHydrated')) ok('页面用 statsHydrated 区分默认空对象')
else fail('页面缺 statsHydrated，默认 total:0 会被当成已有数据')

if (page.includes('shouldKeepExistingBreakdown')) ok('半包 applyStats 会保留已有排行')
else fail('applyStats 半包可能冲掉 persist 排行')

if (page.includes('statsHydrated: false') && page.includes('byCountry: []') && /onSelectYear[\s\S]*statsHydrated: false/.test(page)) {
  ok('换年/换国家会清空上一份数据')
} else fail('换年未清空旧 summary，可能串年显示')

if (client.includes('STATS_NOT_READY') && /isRetryableCloudError[\s\S]*return false/.test(client)) {
  ok('客户端不把 notReady 当传输层可重试')
} else fail('notReady 仍会在 callFunction 层连打')

const retryFn = client.match(/function isRetryableCloudError\([\s\S]*?\n\}/)
if (retryFn && !/cloud\.callFunction:fail/.test(retryFn[0])) {
  ok('可重试判断不再匹配所有 callFunction:fail')
} else fail('isRetryableCloudError 仍匹配全部 callFunction:fail')

if (cloud.includes('incomplete_past_year')) ok('往年未拉全不写聚合缓存')
else fail('往年截断明细可能写入 30 天聚合缓存')

if (cloud.includes('allowExpired: true') && cloud.includes('staleAgg')) {
  ok('只读路径优先复用过期聚合，而不是先读整年 launches')
} else fail('只读路径未优先走 staleAgg')

if (cloud.includes('!resolved.partial && !resolved.staleCache')) {
  ok('用户路径不把 stale/partial 明细回写成聚合')
} else fail('用户路径仍可能用陈旧/截断 launches 覆盖聚合')

if (merge.includes('shouldKeepExistingBreakdown') && merge.includes('gotSummary')) {
  ok('合并层：有一边成功或 persist 就不抛')
} else fail('合并层缺 gotSummary / keepBreakdown')

if (wxml.includes('staleHint') && wxml.includes('summaryPartial')) {
  ok('模板区分陈旧提示与仅总数半成品')
} else fail('模板未接 staleHint / summaryPartial')

if (cloud.includes('alignAllSummaryWithHomeCount') && /getGlobalSummaryAction[\s\S]*?const respond = async/.test(cloud)) {
  ok('详情页头部统一与首页 count 口径对齐')
} else fail('getGlobalSummary 仍可能返回落后于首页卡片的总数')

if (cloud.includes('readGlobalAllSummaryTotal') && /aggTotal > globalThisYear/.test(cloud)) {
  ok('首页卡片刷新时反向对齐明细聚合')
} else fail('首页卡片可能落后于详情页总数')

if (merge.includes('pickAlignedSummary') && /summary: aligned/.test(merge)) {
  ok('合并层多来源计数取大值对齐')
} else fail('合并层仍按单一来源出头部数字')

if (/getGlobalBreakdownAction[\s\S]*?const respond = async/.test(cloud)) {
  ok('明细接口的头部数字也走同一套对齐')
} else fail('getGlobalBreakdown 仍可能返回落后的头部数字')

const statsUtil = read('subpackages/index-extra/utils/global-launch-stats.js')
if (statsUtil.includes('readLaunchSummarySnapshotTotal') && merge.includes('homeTotal')) {
  ok('本地缓存命中时也用首页那份总数兜底对齐（零额外请求）')
} else fail('本地缓存路径下两页仍可能各说各话')

if (wxml.includes('summaryPending') && page.includes('function pendingCount')) {
  ok('总数与成败的差额显示为待定，三项对得上')
} else fail('缺待定项，成功+失败可能小于总数')

if (page.includes('index-ux.js')) ok('分包锚点 index-ux 仍在')
else fail('缺 index-ux 锚点')

console.log('\n==== 汇总 ====')
console.log('失败', issues.length)
issues.forEach((i) => console.log(' -', i))
process.exit(issues.length ? 1 : 0)
