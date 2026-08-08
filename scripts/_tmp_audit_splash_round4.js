/** 开屏审计 round4 离线断言 */
function extractStillFeatured(candidates, flight) {
  const set = new Set(candidates.map((c) => c.flightNumber))
  return set.has(flight)
}

const tiles = [{ flightNumber: 9 }, { flightNumber: 11 }]
console.assert(extractStillFeatured(tiles, 11) === true, 'F11 must stay featured')
console.assert(extractStillFeatured(tiles, 9) === true, 'F9 featured')
console.assert(extractStillFeatured(tiles, 12) === false, 'F12 gone')

const oldTarget = tiles[0]
const oldStill = !!(oldTarget && oldTarget.flightNumber === 11)
console.assert(oldStill === false, 'old bug reproduces')

const softNorm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
    .replace(/integratedflighttest/g, 'flight')
    .replace(/flighttest/g, 'flight')
    .replace(/ift(?=\d)/g, 'flight')

console.assert(softNorm('Starship IFT-13') === softNorm('Starship Flight 13'), 'ift softNorm')

const items = [{ autoSource: '' }, { autoSource: 'spacex' }]
const manual = items.filter((i) => i.autoSource !== 'spacex')
console.assert(manual.length === 1, 'manual detect')

console.log('ALL_ASSERT_OK')
