/**
 * 分包仅用副本一致性：全量正本规范化后必须同 hash；薄壳只校验 require.async 字面量。
 * 运行：node --test test/subonly-copy-parity.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function normalizeCopy(src) {
  return String(src || '')
    .replace(/\r\n/g, '\n')
    .replace(/share-gate\.js（[^）]+分包内副本）/g, 'share-gate.js（分包内副本）')
    .replace(/\* 注意：index-extra[^\n]*/g, '* 注意：各分包各有一份相同副本，修改时需同步。')
}

function sha(src) {
  return crypto.createHash('sha256').update(normalizeCopy(src)).digest('hex')
}

function assertSame(canonicalRel, copyRels, label) {
  const base = sha(read(canonicalRel))
  for (const rel of copyRels) {
    assert.equal(sha(read(rel)), base, label + ': ' + rel + ' 与正本不一致')
  }
}

function assertShell(rel, spec) {
  const src = read(rel)
  assert.match(src, /require\.async\(/, rel + ' 必须 require.async')
  assert.ok(src.includes("'" + spec + "'") || src.includes('"' + spec + '"'), rel + ' 缺少字面量 ' + spec)
}

test('text-translate 全量正本一致', () => {
  assertSame(
    'subpackages/shared/utils/text-translate.js',
    ['subpackages/progress-extra/utils/text-translate.js'],
    'text-translate'
  )
})

test('text-translate 薄壳指向 shared', () => {
  assertShell('pages/mission-detail/utils/text-translate.js', '../../../subpackages/shared/utils/text-translate.js')
  assertShell('subpackages/news-extra/utils/text-translate.js', '../../shared/utils/text-translate.js')
  assertShell('subpackages/monitor-pages/utils/text-translate.js', '../../shared/utils/text-translate.js')
  assert.doesNotMatch(read('pages/mission-detail/utils/text-translate.js'), /function loadTranslateAiService/)
  assert.doesNotMatch(read('subpackages/news-extra/utils/text-translate.js'), /function loadTranslateAiService/)
  assert.doesNotMatch(read('subpackages/monitor-pages/utils/text-translate.js'), /function loadTranslateAiService/)
})

test('event-video / video-cache 全量正本一致', () => {
  assertSame(
    'subpackages/shared/utils/event-video.js',
    ['subpackages/progress-extra/utils/event-video.js'],
    'event-video'
  )
  assertSame(
    'subpackages/shared/utils/video-cache.js',
    ['subpackages/progress-extra/utils/video-cache.js'],
    'video-cache'
  )
})

test('event-video / video-cache 薄壳指向 shared', () => {
  assertShell('subpackages/index-extra/utils/event-video.js', '../../shared/utils/event-video.js')
  assertShell('subpackages/monitor-pages/utils/event-video.js', '../../shared/utils/event-video.js')
  assertShell('pages/video-player/utils/event-video.js', '../../../subpackages/shared/utils/event-video.js')
  assertShell('subpackages/index-extra/utils/video-cache.js', '../../shared/utils/video-cache.js')
  assertShell('subpackages/monitor-pages/utils/video-cache.js', '../../shared/utils/video-cache.js')
  assert.doesNotMatch(read('subpackages/index-extra/utils/event-video.js'), /function playEventVideo[\s\S]*isPlaybackAllowed/)
  assert.doesNotMatch(read('subpackages/index-extra/utils/video-cache.js'), /_videoUrlMemo/)
})

test('share-gate 规范化后一致（不改加载）', () => {
  const copies = [
    'pages/mission-detail/utils/share-gate.js',
    'subpackages/index-extra/utils/share-gate.js',
    'subpackages/progress-extra/utils/share-gate.js',
    'subpackages/monitor-pages/utils/share-gate.js',
    'subpackages/mission-sim/utils/share-gate.js'
  ]
  assertSame(copies[0], copies.slice(1), 'share-gate')
  const rocket = normalizeCopy(read('subpackages/rocket-3d/share-gate.js'))
    .replace(/require\('\.\.\/\.\.\/utils\//g, "require('../../../utils/")
  const canonical = normalizeCopy(read(copies[0]))
  assert.equal(sha(rocket), sha(canonical), 'rocket-3d share-gate 规范化后应与正本一致')
})

test('ll2 i18n / timeline 副本一致', () => {
  assertSame(
    'subpackages/progress-extra/utils/ll2-updates-i18n.js',
    ['pages/mission-detail/utils/ll2-updates-i18n.js'],
    'll2-updates-i18n'
  )
  assertSame(
    'subpackages/progress-extra/utils/ll2-timeline-i18n.js',
    [
      'subpackages/mission-sim/utils/ll2-timeline-i18n.js',
      'pages/mission-detail/utils/ll2-timeline-i18n.js'
    ],
    'll2-timeline-i18n'
  )
  assertSame(
    'subpackages/progress-extra/utils/ll2-launch-timeline.js',
    [
      'subpackages/mission-sim/utils/ll2-launch-timeline.js',
      'pages/mission-detail/utils/ll2-launch-timeline.js'
    ],
    'll2-launch-timeline'
  )
})

test('event-feed-intel 与 mission-card.wxss 双副本一致', () => {
  assertSame(
    'subpackages/shared/utils/event-feed-intel.js',
    ['subpackages/progress-extra/utils/event-feed-intel.js'],
    'event-feed-intel'
  )
  assertSame(
    'subpackages/shared/styles/mission-card.wxss',
    ['subpackages/progress-extra/styles/mission-card.wxss'],
    'mission-card.wxss'
  )
})

test('placeholder 同步锚住 shared 正本', () => {
  const src = read('subpackages/shared/placeholder.js')
  assert.match(src, /require\('\.\/utils\/event-video\.js'\)/)
  assert.match(src, /require\('\.\/utils\/video-cache\.js'\)/)
  assert.match(src, /require\('\.\/utils\/text-translate\.js'\)/)
})

test('一期：委托工厂与结算 helper 单源', () => {
  const index = read('pages/index/index.js')
  assert.match(index, /createAsyncDelegates/)
  assert.equal((index.match(/createAsyncDelegates\(/g) || []).length, 9)
  assert.match(index, /require\.async\('\.\.\/\.\.\/subpackages\/index-extra\/utils\/index-calendar-page\.js'\)/)
  assert.match(index, /missionType !== 'calendar'/)
  assert.match(index, /_indexParked/)
  assert.doesNotMatch(index, /function delegateCalendar/)
  assert.match(index, /require\('\.\.\/\.\.\/utils\/live-settle-helpers\.js'\)/)
  assert.doesNotMatch(index, /function getLiveFinderUserNameFromConfig/)
  assert.doesNotMatch(index, /function isSettleableLiveStatusId/)

  const helpers = read('utils/live-settle-helpers.js')
  assert.match(helpers, /function getLiveFinderUserNameFromConfig/)
  assert.match(helpers, /function isSettleableLiveStatusId/)
  assert.match(read('subpackages/index-extra/utils/index-live-settle.js'), /live-settle-helpers\.js/)
  assert.match(read('pages/mission-detail/mission-detail.js'), /live-settle-helpers\.js/)
  assert.match(read('pages/index/utils/index-settled-merge.js'), /live-settle-helpers\.js/)
  assert.match(read('pages/search/recent-settled-list-merge.js'), /settled-placeholder-core\.js/)
})

test('三期：share-gate 不改加载；正本仍含播放门控', () => {
  const gates = [
    'pages/mission-detail/utils/share-gate.js',
    'subpackages/index-extra/utils/share-gate.js',
    'subpackages/progress-extra/utils/share-gate.js',
    'subpackages/monitor-pages/utils/share-gate.js',
    'subpackages/mission-sim/utils/share-gate.js',
    'subpackages/rocket-3d/share-gate.js'
  ]
  for (const rel of gates) {
    assert.doesNotMatch(read(rel), /require\.async\(/, rel + ' 不应 async 化')
  }
  const ev = read('subpackages/shared/utils/event-video.js')
  assert.match(ev, /isPlaybackAllowed/)
  assert.match(ev, /getCachedVideo/)
})
