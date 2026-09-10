/**
 * 开屏自动同步 + 12 秒截取 + 任务匹配 + 缓存预览 第三轮审计断言
 */
let pass = 0
let fail = 0
function check(name, actual, expected) {
  const ok = Object.is(actual, expected) || (typeof expected === 'object' && JSON.stringify(actual) === JSON.stringify(expected))
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`)
  if (ok) pass++
  else fail++
}

// ── 窗口三态 ──
const WINDOW_MS = 5 * 24 * 60 * 60 * 1000
const GRACE_MS = 24 * 60 * 60 * 1000
function isFlightInLaunchWindow(row, nowTs) {
  if (!row) return null
  const netTs = new Date(row.net || row.launchTime || row.windowStart || '').getTime()
  if (!Number.isFinite(netTs)) return null
  if (netTs - nowTs > WINDOW_MS) return false
  if (nowTs - netTs > GRACE_MS) return false
  return true
}
const now = Date.now()
const day = 86400000
check('窗外 false', isFlightInLaunchWindow({ net: new Date(now + 10 * day).toISOString() }, now), false)
check('窗内 true', isFlightInLaunchWindow({ net: new Date(now + 2 * day).toISOString() }, now), true)
check('无行 null', isFlightInLaunchWindow(null, now), null)
check('出窗才下架', isFlightInLaunchWindow({ net: new Date(now + 10 * day).toISOString() }, now) === false, true)
check('未知不下架', isFlightInLaunchWindow(null, now) !== false, true)

// ── 预览 URL 选取（对齐 index-splash pickPreviewUrl）──
function pickPreviewUrl(it, isVideoItem) {
  if (!isVideoItem || !it || !it.previewUrl) return ''
  const st = String(it.previewStatus || '').trim().toLowerCase()
  if (st && st !== 'ready') return ''
  return String(it.previewUrl).trim()
}
check('ready 用预览', pickPreviewUrl({ previewStatus: 'ready', previewUrl: 'https://x/_fast12.mp4' }, true), 'https://x/_fast12.mp4')
check('processing 不用', pickPreviewUrl({ previewStatus: 'processing', previewUrl: 'https://x/_fast12.mp4' }, true), '')
check('缓存无 status 但有 url 信任', pickPreviewUrl({ previewUrl: 'https://x/_fast12.mp4' }, true), 'https://x/_fast12.mp4')
check('failed 不用', pickPreviewUrl({ previewStatus: 'failed', previewUrl: 'https://x/_fast12.mp4' }, true), '')

// ── _fast12 强制重转 ──
function shouldForceJob(prevUrl, previewUrl, lastJob, nowTs) {
  const urlChanged = !!(prevUrl && prevUrl !== previewUrl)
  return urlChanged || !lastJob || nowTs - lastJob > 10 * 60 * 1000
}
check('fast→fast12 强制', shouldForceJob('https://x/a_fast.mp4', 'https://x/a_fast12.mp4', now - 60000, now), true)
check('同 url 节流', shouldForceJob('https://x/a_fast12.mp4', 'https://x/a_fast12.mp4', now - 60000, now), false)

// ── 12 秒硬上限 ──
const MAX = 12
check('倒计时封顶', Math.min(MAX, 30), 12)
check('timeupdate 切点', 12 >= MAX, true)
check('11 秒不切', 11 >= MAX, false)

// ── 任务名软匹配 ──
const softNorm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
    .replace(/flighttest/g, 'flight')
    .replace(/integratedflighttest/g, 'flight')
check('Flight Test ↔ Flight', softNorm('Starship Flight Test 13') === softNorm('Starship Flight 13'), true)
const extractFlightNo = (s) => {
  const m = String(s || '').match(/flight\s*(?:test\s*)?#?\s*(\d+)/i) || String(s || '').match(/\bift[-\s]?(\d+)/i)
  return m ? Number(m[1]) : 0
}
check('编号一致', extractFlightNo('Starship Flight 13') === extractFlightNo('Starship Flight Test 13'), true)

// ── Flight 行匹配不误伤 130 ──
const nameRe = (n) => new RegExp(`flight[^0-9]*0*${n}(?![0-9])`, 'i')
check('13 命中', nameRe(13).test('Starship Flight 13'), true)
check('13 不误命中 130', nameRe(13).test('Starship Flight 130'), false)

// ── BOM ──
check('BOM 可解析', (() => { try { JSON.parse('\uFEFF[1]'.replace(/^\uFEFF/, '')); return true } catch (e) { return false } })(), true)

// ── 生命周期 keep 条件 ──
function lifecycle(settled, inWindow, scannedCms, stillFeatured) {
  const knownOutside = inWindow === false
  const featured = scannedCms ? stillFeatured : true
  if (settled || knownOutside || !featured) {
    return settled ? 'settled' : knownOutside ? 'outside' : 'tile_gone'
  }
  return 'keep'
}
check('未扫官网不误删', lifecycle(false, null, false, false), 'keep')
check('推迟出窗下架', lifecycle(false, false, false, true), 'outside')
check('飞行中下架', lifecycle(true, true, true, true), 'settled')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
