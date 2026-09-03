/**
 * node cloudfunctions/syncSpaceDevsData/dual-copy-parity.test.js
 * 双副本一致性守卫：云函数目录间无法共享代码，同源文件靠本测试防漂移。
 * 历史教训：launch-data-sync 两份副本曾漂移出「24h vs 48h 保留期 + 字段互相覆盖」。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

function readNormalized(rel) {
  return fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\r\n/g, '\n')
}

/** 从共同起始标记行开始比较（跳过 db 初始化方式不同的文件头） */
function bodyFromMarker(content, marker, rel) {
  const idx = content.indexOf(marker)
  assert.ok(idx >= 0, `${rel} 缺少同步比较标记行: ${marker}`)
  return content.slice(idx)
}

test('launch-data-sync.js 双副本主体逐字一致', () => {
  const marker = '/** 与 sync meta 一起存'
  const a = bodyFromMarker(
    readNormalized('syncSpaceDevsData/launch-data-sync.js'),
    marker,
    'syncSpaceDevsData/launch-data-sync.js'
  )
  const b = bodyFromMarker(
    readNormalized('sendLaunchReminder/launch-data-sync.js'),
    marker,
    'sendLaunchReminder/launch-data-sync.js'
  )
  assert.equal(a, b, 'launch-data-sync 两份副本主体不一致：请把改动同步到另一份')
})

test('ll2-budget.js 三副本完全一致', () => {
  const base = readNormalized('syncSpaceDevsData/ll2-budget.js')
  assert.equal(
    readNormalized('ll2Query/ll2-budget.js'),
    base,
    'll2Query/ll2-budget.js 与 syncSpaceDevsData 副本不一致'
  )
  assert.equal(
    readNormalized('getLaunchStats/ll2-budget.js'),
    base,
    'getLaunchStats/ll2-budget.js 与 syncSpaceDevsData 副本不一致'
  )
})

test('agency-name-i18n.js 双副本完全一致', () => {
  assert.equal(
    readNormalized('syncSpaceDevsData/agency-name-i18n.js'),
    readNormalized('sendLaunchReminder/agency-name-i18n.js'),
    'agency-name-i18n 两份副本不一致'
  )
})

test('nsf-checklist-i18n 管理端与小程序短语副本一致', () => {
  assert.equal(
    readNormalized('../subpackages/progress-extra/utils/nsf-checklist-i18n.js'),
    readNormalized('adminGateway/nsf-checklist-i18n.js'),
    'adminGateway/nsf-checklist-i18n.js 与小程序 progress-extra 副本不一致'
  )
})

test('ll2-updates-i18n.js 双副本完全一致', () => {
  assert.equal(
    readNormalized('syncSpaceDevsData/ll2-updates-i18n.js'),
    readNormalized('ll2Query/ll2-updates-i18n.js'),
    'll2-updates-i18n 两份副本不一致'
  )
})

console.log('dual-copy-parity.test.js: all assertions queued (node:test will report)')
