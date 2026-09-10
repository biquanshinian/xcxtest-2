/** 审计刚改代码：featured 与超体积拆分、resume 门控 */
function buildSets(tiles, maxBytes) {
  const featured = new Set()
  const candidates = []
  for (const tile of tiles) {
    const fn = tile.flightNumber
    if (!fn) continue
    featured.add(fn)
    if (!tile.url) continue
    const sizeBytes = Math.round(Number(tile.sizeKb || 0) * 1024)
    if (sizeBytes > maxBytes) continue
    candidates.push({ flightNumber: fn, sourceUrl: tile.url })
  }
  return { featured, candidates }
}

const MAX = 30 * 1024 * 1024
const tiles = [
  { flightNumber: 9, url: 'http://a', sizeKb: 1000 },
  { flightNumber: 11, url: 'http://b', sizeKb: 40000 } // 40MB 超限
]
const { featured, candidates } = buildSets(tiles, MAX)
console.assert(featured.has(11), 'oversized flight still featured')
console.assert(!candidates.some((c) => c.flightNumber === 11), 'oversized not downloadable')
console.assert(featured.has(11) && !candidates.some((c) => c.flightNumber === 11), 'keep auto, skip redownload')

// 多 Flight 在窗：取编号最大
let target = null
const inWindow = new Set([9, 11])
for (const c of [
  { flightNumber: 9 },
  { flightNumber: 11 }
]) {
  if (inWindow.has(c.flightNumber)) {
    if (!target || c.flightNumber > target.flightNumber) target = c
  }
}
console.assert(target.flightNumber === 11, 'prefer newest flight')

// softNorm
const softNorm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
    .replace(/integratedflighttest/g, 'flight')
    .replace(/flighttest/g, 'flight')
    .replace(/ift(?=\d)/g, 'flight')
console.assert(softNorm('Starship IFT-13') === softNorm('Starship Flight 13'))

// manual heal needHeal
function needHeal(autoLen, autoSync) {
  return autoLen > 0 || autoSync !== false
}
console.assert(needHeal(0, false) === false, 'stable manual no rewrite')
console.assert(needHeal(1, false) === true, 'strip leftover auto')
console.assert(needHeal(0, true) === true, 'flip switch off')

console.log('ROUND5_ASSERT_OK')
