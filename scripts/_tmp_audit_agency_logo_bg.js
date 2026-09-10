/**
 * 审计：发射商透明 Logo 自动底色
 * 运行：node scripts/_tmp_audit_agency_logo_bg.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
let failed = 0
function must(cond, msg) {
  if (!cond) {
    failed += 1
    console.error('FAIL:', msg)
  } else {
    console.log('OK  :', msg)
  }
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}
function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

console.log('=== 1. 核心模块与单测 ===')
must(exists('utils/agency-logo-bg.js'), 'utils/agency-logo-bg.js 存在')
must(exists('test/agency-logo-bg.test.js'), 'test/agency-logo-bg.test.js 存在')
const bg = read('utils/agency-logo-bg.js')
must(bg.includes('function pickLogoBgToneFromPixels'), 'pickLogoBgToneFromPixels')
must(bg.includes('function resolveAgencyLogoBgTone'), 'resolveAgencyLogoBgTone')
must(bg.includes('function ensureAgencyLogoBgTone'), 'ensureAgencyLogoBgTone')
must(bg.includes('function ensureAgencyLogoBgToneIfCached'), 'ensureAgencyLogoBgToneIfCached')
must(bg.includes("LOGO_BG_LIGHT = '#ffffff'"), 'LOGO_BG_LIGHT')
must(bg.includes("LOGO_BG_DARK = '#111111'"), 'LOGO_BG_DARK')
must(bg.includes('createOffscreenCanvas'), 'offscreen canvas 分析')
must(bg.includes('_agency_logo_bg_index'), 'storage 缓存 key')

const cache = read('utils/agency-logo-cache.js')
must(cache.includes('_warmLogoBgTone'), '落盘后 warm logoBg')
must(cache.includes('normalizeAgencyLogoCacheKey'), 'URL key 规范化导出')
must(cache.includes("require('./agency-logo-bg.js')"), '懒加载 agency-logo-bg')

console.log('\n=== 2. 数据层 logoBgTone ===')
must(read('utils/upcoming-agency-filter.js').includes('logoBgTone'), '胶囊 finalizeChipLogoFields')
must(read('subpackages/monitor-pages/utils/agency-data.js').includes('logoBgTone'), 'formatAgency')
must(read('subpackages/monitor-pages/agency-detail.js').includes('logoBgTone'), 'agency-detail format')
must(read('subpackages/index-extra/utils/global-launch-stats.js').includes('logoBgTone'), 'decorateAgencyRows')
must(read('subpackages/shared/utils/ai-chat-rich.js').includes('logoBgTone'), 'toAgencyChatCard')
must(read('subpackages/index-extra/utils/index-splash.js').includes('agencyLogoBgTone'), 'splash payload')
must(read('pages/profile/profile.js').includes('logoBgTone'), 'profile favorites')

console.log('\n=== 3. UI class + bindload ===')
const appWxss = read('app.wxss')
must(appWxss.includes('.agency-logo-bg--light'), 'app.wxss light')
must(appWxss.includes('.agency-logo-bg--dark'), 'app.wxss dark')

const checks = [
  ['pages/index/index.wxml', 'agency-logo-bg--', '首页胶囊/开屏 class'],
  ['pages/index/index.wxml', 'onAgencyChipLogoLoad', '胶囊 bindload'],
  ['pages/index/index.wxml', 'onSplashAgencyLogoLoad', '开屏 bindload'],
  ['pages/index/index.js', "'onSplashAgencyLogoLoad'", 'SPLASH_METHODS 委托'],
  ['subpackages/index-extra/utils/index-splash.js', 'onSplashAgencyLogoLoad', 'splash 方法实现'],
  ['subpackages/monitor-pages/agency-detail.wxml', 'agency-logo-bg--', '详情 chip class'],
  ['subpackages/monitor-pages/agency-detail.wxml', 'onAgencyLogoLoad', '详情 bindload'],
  ['subpackages/monitor-pages/components/monitor-galleries/index.wxml', 'emitOnAgencyImageLoad', '图鉴预览 bindload'],
  ['subpackages/monitor-pages/components/monitor-galleries/index.wxml', 'agency-logo-bg--', '图鉴预览 class'],
  ['subpackages/monitor-pages/components/monitor-galleries/index.js', 'emitOnAgencyImageLoad', '图鉴组件 emit'],
  ['subpackages/monitor-pages/components/monitor-galleries/index.wxss', 'agency-logo-bg--dark', '图鉴组件 wxss 隔离补丁'],
  ['pages/monitor/monitor.js', "'onAgencyImageLoad'", 'GALLERIES_METHODS 委托'],
  ['subpackages/monitor-pages/utils/monitor-galleries.js', 'onAgencyImageLoad', '图鉴 load 实现'],
  ['subpackages/monitor-pages/agency-list.wxml', 'onCardImageLoad', '列表 bindload'],
  ['subpackages/monitor-pages/agency-list.wxml', 'agency-logo-bg--', '列表 class'],
  ['subpackages/index-extra/global-launch-stats.wxml', 'agency-logo-bg--', '统计 class'],
  ['subpackages/index-extra/global-launch-stats.js', 'ensureAgencyLogoBgTone', '统计 ensure'],
  ['pages/profile/profile.wxml', 'agency-logo-bg--', '收藏 class'],
  ['subpackages/shared/components/ai-chat/index.wxml', 'onAgencyLogoLoad', '星问 bindload'],
  ['subpackages/shared/components/ai-chat/index.wxml', 'agency-logo-bg--', '星问 class'],
  ['subpackages/shared/components/ai-chat/index.wxss', 'agency-logo-bg--dark', '星问 wxss 隔离补丁'],
  ['subpackages/shared/components/ai-chat/index.js', 'onAgencyLogoLoad(e)', '星问 load 实现']
]
for (const [rel, needle, msg] of checks) {
  must(exists(rel) && read(rel).includes(needle), msg + ` (${rel})`)
}

console.log('\n=== 4. 语法检查（关键改动文件） ===')
const jsFiles = [
  'utils/agency-logo-bg.js',
  'utils/agency-logo-cache.js',
  'utils/upcoming-agency-filter.js',
  'pages/index/index.js',
  'pages/profile/profile.js',
  'pages/monitor/monitor.js',
  'subpackages/monitor-pages/agency-detail.js',
  'subpackages/monitor-pages/agency-list.js',
  'subpackages/monitor-pages/utils/agency-data.js',
  'subpackages/monitor-pages/utils/monitor-galleries.js',
  'subpackages/monitor-pages/components/monitor-galleries/index.js',
  'subpackages/index-extra/global-launch-stats.js',
  'subpackages/index-extra/utils/global-launch-stats.js',
  'subpackages/index-extra/utils/index-splash.js',
  'subpackages/shared/utils/ai-chat-rich.js',
  'subpackages/shared/components/ai-chat/index.js'
]
for (const rel of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' })
  must(r.status === 0, `syntax ok: ${rel}` + (r.status === 0 ? '' : ` :: ${(r.stderr || '').trim()}`))
}

console.log('\n=== 5. 单测 ===')
const test = spawnSync(process.execPath, ['--test', 'test/agency-logo-bg.test.js'], {
  cwd: root,
  encoding: 'utf8'
})
must(test.status === 0, 'agency-logo-bg.test.js 全绿')
if (test.status !== 0) console.error(test.stdout || test.stderr)

console.log('\n=== 6. 纯函数冒烟（模拟像素） ===')
const { pickLogoBgToneFromPixels } = require(path.join(root, 'utils/agency-logo-bg.js'))
function fill(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const c = fn(x, y)
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]
    }
  }
  return d
}
must(pickLogoBgToneFromPixels(fill(16, 16, (x, y) => (x >= 4 && x < 12 && y >= 4 && y < 12) ? [255, 255, 255, 255] : [0, 0, 0, 0]), 16, 16) === 'dark', '白透明→dark')
must(pickLogoBgToneFromPixels(fill(16, 16, (x, y) => (x >= 4 && x < 12 && y >= 4 && y < 12) ? [0, 102, 204, 255] : [0, 0, 0, 0]), 16, 16) === 'light', '蓝透明→light')
must(pickLogoBgToneFromPixels(fill(8, 8, () => [10, 10, 10, 255]), 8, 8) === '', '不透明→空')

console.log('\n=== RESULT ===')
if (failed) {
  console.error(`FAILED: ${failed} check(s)`)
  process.exit(1)
}
console.log('ALL GREEN')
process.exit(0)
