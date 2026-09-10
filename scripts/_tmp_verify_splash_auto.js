// 一次性脚本：验证官网星舰视频自动同步的提取/匹配逻辑（与 adminGateway 实现一致）
const fs = require('fs')

const ORD = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16,
  seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40
}
const TENS = { twenty: 20, thirty: 30 }

function parseOrdinalWord(text) {
  const s = String(text || '').toLowerCase()
  const compound = s.match(/\b(twenty|thirty)[-\s](first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/)
  if (compound) return TENS[compound[1]] + ORD[compound[2]]
  const single = s.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth)\b/)
  if (single) return ORD[single[1]]
  return 0
}

function extractStarshipFlightNumber(tile) {
  if (!tile || typeof tile !== 'object') return 0
  const link = String(tile.link || '')
  const m = link.match(/starship-flight-(\d+)/i)
  if (m) return Number(m[1]) || 0
  const title = String(tile.title || '')
  if (!/starship/i.test(title) && !/starship/i.test(link)) return 0
  const direct = title.match(/flight\s*(?:test\s*)?(\d+)/i)
  if (direct) return Number(direct[1]) || 0
  return parseOrdinalWord(title)
}

let pass = 0
let failCount = 0
function check(label, actual, expected) {
  const ok = actual === expected
  ok ? pass++ : failCount++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' (期望 ' + JSON.stringify(expected) + ')'}`)
}

// 真实 CMS 返回
const tiles = JSON.parse(fs.readFileSync(require('path').join(__dirname, '_tmp_featured_tiles_fixture.json'), 'utf8'))
for (const t of tiles) {
  console.log(`实测 tile: "${t.title}" link=${t.link} videoMobile=${!!(t.videoMobile && t.videoMobile.url)} (${Math.round(t.videoMobile.size)}KB)`)
  check('link 提取 Flight 编号', extractStarshipFlightNumber(t), 13)
}

// 兜底与负样本
check('序数词兜底 Thirteenth', extractStarshipFlightNumber({ title: "Starship's Thirteenth Flight Test", link: 'watch' }), 13)
check('复合序数词 Twenty-First', extractStarshipFlightNumber({ title: "Starship's Twenty-First Flight Test", link: 'watch' }), 21)
check('标题带数字 Flight Test 15', extractStarshipFlightNumber({ title: 'Starship Flight Test 15', link: 'watch' }), 15)
check('猎鹰任务忽略', extractStarshipFlightNumber({ title: 'Crew-12 Mission', link: 'crew-12' }), 0)
check('龙飞船忽略', extractStarshipFlightNumber({ title: 'CRS-33 Mission', link: 'crs-33' }), 0)
check('空 tile', extractStarshipFlightNumber(null), 0)

// missionName 与 LL2 名称匹配（小程序倒计时组件的归一化逻辑）
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
const target = norm('Starship Flight 13')
const ll2 = norm('Starship | Flight 13')
check('missionName 命中 LL2 名称', ll2.indexOf(target) !== -1 || target.indexOf(ll2) !== -1, true)

// 生命周期状态判断
const INFLIGHT = 6
const TERMINAL = { 3: true, 4: true, 7: true, 9: true }
const nameRe = (n) => new RegExp(`flight[^0-9]*0*${n}(?![0-9])`, 'i')
check('launch_status 名称匹配 Flight 13', nameRe(13).test('Starship | Flight 13'), true)
check('Flight 13 不误配 Flight 130', nameRe(13).test('Starship | Flight 130'), false)
check('Flight 1 不误配 Flight 13', nameRe(1).test('Starship | Flight 13'), false)
check('状态 6 判飞行中', INFLIGHT === 6 && !TERMINAL[6], true)
check('状态 3 判终态', !!TERMINAL[3], true)

// ── T-5 开启窗口与推迟处理（与 adminGateway isFlightInLaunchWindow / 生命周期分支一致） ──
const WINDOW_MS = 5 * 24 * 60 * 60 * 1000
const GRACE_MS = 24 * 60 * 60 * 1000

function isRowSettledOrInFlight(row) {
  const sid = Number(row && row.status && row.status.id)
  return sid === INFLIGHT || !!TERMINAL[sid]
}

function isFlightInLaunchWindow(row, nowTs) {
  if (!row) return null
  const netTs = new Date(row.net || row.launchTime || row.windowStart || '').getTime()
  if (!Number.isFinite(netTs)) return null
  if (netTs - nowTs > WINDOW_MS) return false
  if (nowTs - netTs > GRACE_MS) return false
  return true
}

const nowTs = Date.now()
const day = 24 * 60 * 60 * 1000
const rowAt = (offsetMs, statusId) => ({
  name: 'Starship | Flight 13',
  net: new Date(nowTs + offsetMs).toISOString(),
  status: { id: statusId }
})

check('T-3 天在窗内', isFlightInLaunchWindow(rowAt(3 * day, 1), nowTs), true)
check('恰好 T-5 天在窗内', isFlightInLaunchWindow(rowAt(5 * day, 1), nowTs), true)
check('T-6 天未到窗口不扫描', isFlightInLaunchWindow(rowAt(6 * day, 1), nowTs), false)
check('推迟到 T-10 天出窗下架', isFlightInLaunchWindow(rowAt(10 * day, 1), nowTs), false)
check('NET 刚过 2 小时（当日 hold/推迟）仍在窗', isFlightInLaunchWindow(rowAt(-2 * 60 * 60 * 1000, 1), nowTs), true)
check('NET 过 2 天未结算视为陈旧出窗', isFlightInLaunchWindow(rowAt(-2 * day, 1), nowTs), false)
check('无探针行 → 未知(null) 不误删', isFlightInLaunchWindow(null, nowTs), null)
check('NET 缺失 → 未知(null) 不误删', isFlightInLaunchWindow({ name: 'Starship | Flight 13', status: { id: 1 } }, nowTs), null)
check('launch_data 行（launchTime 字段）T-2 天在窗内', isFlightInLaunchWindow({
  name: 'Starship | Flight 13',
  launchTime: new Date(nowTs + 2 * day).toISOString()
}, nowTs), true)

// 窗口预判：仅未结算 + 窗内的行才触发官网扫描
const statusRows = [
  rowAt(10 * day, 1), // Flight 14 之类：太远
  rowAt(-30 * day, 3) // 上一发：已终态
]
const anyInWindow = (rows) => rows.some((r) => !isRowSettledOrInFlight(r) && isFlightInLaunchWindow(r, nowTs) === true)
check('全部窗外/已结算 -> 不扫官网', anyInWindow(statusRows), false)
check('加入 T-3 天任务 -> 开始扫描', anyInWindow([...statusRows, rowAt(3 * day, 1)]), true)
check('窗内但已飞行中 -> 不触发新增扫描', anyInWindow([rowAt(-60 * 60 * 1000, 6)]), false)

// 生命周期分支：settled / 出窗 / tile 消失 的移除原因；排期未知与未扫描不误删
function lifecycleReason(row, stillFeatured, scannedCms) {
  const settled = isRowSettledOrInFlight(row)
  const inWindow = isFlightInLaunchWindow(row, nowTs)
  const knownOutside = inWindow === false
  const featured = scannedCms ? stillFeatured : true
  if (settled || knownOutside || !featured) {
    return settled ? 'inflight_or_settled' : (knownOutside ? 'outside_launch_window' : 'tile_gone')
  }
  return 'keep'
}
check('飞行中 -> 移除(inflight_or_settled)', lifecycleReason(rowAt(-60 * 60 * 1000, 6), true, true), 'inflight_or_settled')
check('推迟出窗 -> 下架(outside_launch_window)', lifecycleReason(rowAt(8 * day, 1), true, true), 'outside_launch_window')
check('官网撤下 -> 移除(tile_gone)', lifecycleReason(rowAt(2 * day, 1), false, true), 'tile_gone')
check('窗内且在售 -> 保留', lifecycleReason(rowAt(2 * day, 1), true, true), 'keep')
check('排期未知 + 未扫官网 -> 保留(不误删)', lifecycleReason(null, false, false), 'keep')
check('回窗恢复：出窗被删后重新入窗可再上架', isFlightInLaunchWindow(rowAt(4 * day, 1), nowTs) === true && !isRowSettledOrInFlight(rowAt(4 * day, 1)), true)

// 任务名软匹配：Flight vs Flight Test
const softNorm = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
    .replace(/flighttest/g, 'flight')
    .replace(/integratedflighttest/g, 'flight')
const extractFlightNo = (s) => {
  const m = String(s || '').match(/flight\s*(?:test\s*)?#?\s*(\d+)/i) ||
    String(s || '').match(/\bift[-\s]?(\d+)/i)
  return m ? Number(m[1]) : 0
}
check('软归一化 Flight Test ↔ Flight', softNorm('Starship Flight Test 13') === softNorm('Starship Flight 13'), true)
check('编号提取 Flight Test 13', extractFlightNo('Starship Flight Test 13'), 13)
check('编号提取 Starship Flight 13', extractFlightNo('Starship Flight 13'), 13)
check('BOM 剥离后可解析', (() => {
  try {
    JSON.parse('\uFEFF[{"id":1}]'.replace(/^\uFEFF/, '').trim())
    return true
  } catch (e) { return false }
})(), true)

console.log(`\n${pass} passed, ${failCount} failed`)
process.exit(failCount ? 1 : 0)
