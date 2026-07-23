/**
 * 审计：「我的太空 → 近期竞猜」火箭配置图 = 首页卡片同源复用（已清理旁路）
 * exit 0 = 全亮绿灯
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const bugs = []
const ok = []

function assert(name, cond, detail) {
  if (cond) ok.push(name)
  else bugs.push(name + (detail ? ': ' + detail : ''))
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const JS = [
  'utils/util.js',
  'utils/api-launch-list.js',
  'pages/profile/profile.js',
  'subpackages/profile-extra/utils/profile-lazy.js',
  'subpackages/profile-extra/components/profile-sections/index.js',
  'subpackages/progress-extra/components/mission-list-card/index.js'
]

for (const f of JS) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' })
  assert('syntax ' + f, r.status === 0, (r.stderr || '').split('\n')[0])
}

const utilSrc = read('utils/util.js')
const apiList = read('utils/api-launch-list.js')
const card = read('subpackages/progress-extra/components/mission-list-card/index.js')
const lazy = read('subpackages/profile-extra/utils/profile-lazy.js')
const profile = read('pages/profile/profile.js')
const secJs = read('subpackages/profile-extra/components/profile-sections/index.js')
const secWxml = read('subpackages/profile-extra/components/profile-sections/index.wxml')
const secWxss = read('subpackages/profile-extra/components/profile-sections/index.wxss')

// ---- 旁路已移除 ----
const DEAD = [
  'getRocketImageRemote',
  'getDefaultRocketImageRemote',
  'resolveProfileRocketThumb',
  'resolveVoteRocketImage',
  'resolveRocketImageUrl'
]
for (const name of DEAD) {
  assert('dead: util 无 ' + name, !new RegExp('function ' + name + '\\b').test(utilSrc))
  assert('dead: lazy 无 ' + name, !new RegExp('\\b' + name + '\\b').test(lazy))
  assert('dead: profile 无 ' + name, !new RegExp('\\b' + name + '\\b').test(profile))
}
// shouldReplaceRocketImage 仍供首页使用；竞猜路径不再引用
assert('dead: lazy 竞猜不用 shouldReplaceRocketImage', !/shouldReplaceRocketImage/.test(lazy))
assert('dead: profile 不用 shouldReplaceRocketImage', !/shouldReplaceRocketImage/.test(profile))

// ---- 同源 resolveMissionRocketImage ----
assert('util: export resolveMissionRocketImage', /resolveMissionRocketImage/.test(utilSrc))
assert(
  'homepage list: resolveMissionRocketImage(..., true)',
  /function mapLaunchToListItem[\s\S]*resolveMissionRocketImage\(\s*''[\s\S]*true\s*\)/.test(apiList)
)
assert('mission-list-card: resolveMissionRocketImage', /resolveMissionRocketImage\(/.test(card))
assert(
  'lazy: resolveHomeRocketImage → resolveMissionRocketImage(..., true)',
  /function resolveHomeRocketImage[\s\S]*resolveMissionRocketImage\([\s\S]*true\s*\)/.test(lazy)
)
assert(
  'lazy: voteHistory 用 resolveHomeRocketImage',
  /rocketImage\s*=\s*resolveHomeRocketImage\(/.test(lazy)
)
assert('lazy: loadVoteStats await media map', /async loadVoteStats[\s\S]*await loadCloudMediaMap\(\)/.test(lazy))
assert('lazy: enrich 用 launchId', /var launchId = h\.launchId[\s\S]*byId\[String\(launchId\)\]/.test(lazy))
assert('lazy: enrich 不用复合 h.id', !/byId\[String\(h\.id\)\]/.test(lazy))
assert(
  'lazy: enrich 优先直接复用列表 m.rocketImage',
  /needImg[\s\S]*!isDefaultRocketSrc\(m\.rocketImage\)\s*&&\s*m\.rocketImage[\s\S]*\?\s*m\.rocketImage/.test(lazy)
)
assert(
  'lazy: enrich 缺省再 resolveHomeRocketImage',
  /needImg[\s\S]*resolveHomeRocketImage\(m\.rocketImage/.test(lazy)
)
assert('lazy: enrich 拉 upcoming+completed', /getUpcomingMissions\(50[\s\S]*getCompletedMissions\(50/.test(lazy))
assert('lazy: onVoteHistoryRocketImageError', /async onVoteHistoryRocketImageError\(e\)/.test(lazy))
assert('lazy: error 默认停止', /isDefaultRocketSrc\(failed\)\)\s*return/.test(lazy))
assert(
  'lazy: error 同源 resolveHomeRocketImage + DEFAULT',
  /onVoteHistoryRocketImageError[\s\S]*resolveHomeRocketImage\(failed[\s\S]*resolveMissionRocketImage\(DEFAULT_ROCKET_IMAGE\)/.test(lazy)
)
assert('lazy: error markDownloadFailed', /onVoteHistoryRocketImageError[\s\S]*markDownloadFailed/.test(lazy))
assert('lazy: error loadCloudMediaMap', /onVoteHistoryRocketImageError[\s\S]*await loadCloudMediaMap\(\)/.test(lazy))
assert('lazy: error 单次 setData', (lazy.match(/onVoteHistoryRocketImageError[\s\S]*?onVoteHistoryTap/) || [''])[0].split('setData').length - 1 === 1)

assert('profile: PROFILE_LAZY 含 error', /PROFILE_LAZY_METHODS\s*=\s*\[[\s\S]*'onVoteHistoryRocketImageError'/.test(profile))
assert('profile: SECTION 含 error', /SECTION_EVENT_METHODS\s*=\s*\[[\s\S]*'onVoteHistoryRocketImageError'/.test(profile))
assert(
  'profile: reminders 直接 resolveMissionRocketImage',
  /rocketImg\s*=\s*resolveMissionRocketImage\(rocketImage\s*\|\|\s*''[\s\S]*true\)/.test(profile)
)
assert('profile: 无 DEFAULT_ROCKET_IMAGE 旁路 import', !/DEFAULT_ROCKET_IMAGE/.test(profile))

// ---- UI ----
assert('wxml: aspectFit', /vote-history-rocket-img[\s\S]*?mode="aspectFit"/.test(secWxml))
assert('wxml: binderror', /binderror="emitOnVoteHistoryRocketImageError"/.test(secWxml))
assert('wxml: data-index', /data-index="\{\{index\}\}"/.test(secWxml))
assert('wxml: 无多余 data-id', !/vote-history-rocket-img[\s\S]{0,200}data-id=/.test(secWxml))
;(function () {
  const m = secWxml.match(/class="vote-history"[\s\S]*?class="vote-history-expand"/)
  assert('wxml: vote-history 无 🚀', !!m && !/🚀/.test(m[0]))
})()
assert('wxml: 始终 image', /vote-history-icon--launch">\s*<image[\s\S]*vote-history-rocket-img/.test(secWxml))
assert('sec.js: emit', /emitOnVoteHistoryRocketImageError\(e\)\s*\{\s*this\._emit\('onVoteHistoryRocketImageError'/.test(secJs))
assert('wxss: #1a1a1a', /\.vote-history-icon--launch\s*\{[^}]*background:\s*#1a1a1a/.test(secWxss))
assert('wxss: light #e8eaef', /\.theme-light\s+\.vote-history-icon--launch\s*\{[^}]*background:\s*#e8eaef/.test(secWxss))

// ---- runtime ----
global.wx = {
  env: { USER_DATA_PATH: path.join(root, '.tmp_audit_userdata') },
  getStorageSync() { return {} },
  setStorage() {},
  setStorageSync() {},
  removeStorageSync() {},
  getFileSystemManager() {
    return {
      accessSync() { throw new Error('no') },
      mkdirSync() {},
      readdirSync() { return [] },
      unlinkSync() {}
    }
  },
  getNetworkType({ success }) { success({ networkType: 'wifi' }) },
  downloadFile() {}
}

const util = require(path.join(root, 'utils/util.js'))
assert('runtime: resolveMissionRocketImage', typeof util.resolveMissionRocketImage === 'function')
assert('runtime: 无 getRocketImageRemote export', util.getRocketImageRemote == null)
assert('runtime: 无 resolveProfileRocketThumb export', util.resolveProfileRocketThumb == null)

const a = util.resolveMissionRocketImage('', 'Falcon 9', null, true)
const b = util.resolveMissionRocketImage('', 'Falcon 9', { name: 'Falcon 9' }, true)
assert('runtime: Falcon 9 可解析', !!a && !util.isDefaultRocketSrc(a), a)
assert('runtime: 盖章复用', util.resolveMissionRocketImage(a, 'Falcon 9', null, true) === a || !util.isDefaultRocketSrc(util.resolveMissionRocketImage(a, 'Falcon 9', null, true)))
assert('runtime: 同函数可复现', !util.isDefaultRocketSrc(b), b)
assert('runtime: 未知 → default', util.isDefaultRocketSrc(util.resolveMissionRocketImage('', 'NotARealRocketXYZ999', null, true)))

console.log('\n===== 首页同源复用（清理后）审计 =====')
ok.forEach((n) => console.log('  ✅ ' + n))
if (bugs.length) {
  console.log('\n----- 断点 -----')
  bugs.forEach((n) => console.log('  ❌ ' + n))
  console.log('\n结果: ' + ok.length + ' 绿 / ' + bugs.length + ' 红')
  process.exit(1)
}
console.log('\n结果: ' + ok.length + ' 项全亮绿灯')
process.exit(0)
