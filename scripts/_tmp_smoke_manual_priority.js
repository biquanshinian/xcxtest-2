/**
 * 冒烟：手动优先 ↔ 官网自动开关 + 服务端同策略
 */
let pass = 0
let fail = 0
function check(name, actual, expected) {
  const ok = Object.is(actual, expected)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`)
  ok ? pass++ : fail++
}

function applyPolicy(items) {
  const manual = items.filter((it) => it && it.autoSource !== 'spacex')
  const auto = items.filter((it) => it && it.autoSource === 'spacex')
  const hasManual = manual.length > 0
  const nextItems = hasManual ? manual : items
  return {
    mediaItems: nextItems,
    autoSyncSpacex: !hasManual,
    strippedAuto: hasManual && auto.length > 0
  }
}

const onlyAuto = [
  { id: 'a1', autoSource: 'spacex', mediaUrl: 'https://x/a.mp4' }
]
const mixed = [
  { id: 'm1', autoSource: '', mediaUrl: 'https://x/m.mp4' },
  { id: 'a1', autoSource: 'spacex', mediaUrl: 'https://x/a.mp4' }
]
const onlyManual = [
  { id: 'm1', autoSource: '', mediaUrl: 'https://x/m.mp4' }
]
const empty = []

let r = applyPolicy(onlyAuto)
check('仅自动 → 开同步', r.autoSyncSpacex, true)
check('仅自动 → 保留 1 条', r.mediaItems.length, 1)

r = applyPolicy(mixed)
check('混入手动 → 关同步', r.autoSyncSpacex, false)
check('混入手动 → 剔自动', r.mediaItems.length, 1)
check('混入手动 → 剩手动', r.mediaItems[0].id, 'm1')
check('混入手动 → 标记剔除', r.strippedAuto, true)

r = applyPolicy(onlyManual)
check('仅手动 → 关同步', r.autoSyncSpacex, false)
check('仅手动 → 保留', r.mediaItems.length, 1)

r = applyPolicy(empty)
check('空池 → 开同步（等定时回填）', r.autoSyncSpacex, true)
check('空池 → 0 条', r.mediaItems.length, 0)

// 删光手动后等价 empty
r = applyPolicy(mixed.filter((it) => it.autoSource === 'spacex' ? false : false)) // all removed
check('删光后 → 开同步', applyPolicy([]).autoSyncSpacex, true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
