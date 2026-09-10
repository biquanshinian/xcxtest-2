/**
 * 微信 AI 知识库 / page-meta / 明文 Scheme 路径须落在 app.json 页面上。
 * node --test test/wechat-ai-kb.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function collectAppPages() {
  const app = JSON.parse(read('app.json'))
  const pages = new Set(app.pages)
  for (const sp of app.subPackages || []) {
    const root = String(sp.root || '').replace(/\/$/, '')
    for (const p of sp.pages || []) {
      pages.add(root + '/' + p)
    }
  }
  return pages
}

function schemeFileLines() {
  return read('docs/plaintext-scheme-paths.txt').split(/\r?\n/)
}

function splitPaths(line) {
  return String(line || '')
    .replace(/^[^:]*：/, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /^(pages|subpackages)\//.test(s))
}

function schemePaths() {
  return splitPaths(schemeFileLines()[0])
}

function pendingSchemePaths() {
  const line = schemeFileLines().find((l) => l.indexOf('发版后追加') === 0) || ''
  return splitPaths(line)
}

function backtickAppPaths(rel) {
  const re = /`(pages\/[a-z0-9_\-\/]+|subpackages\/[a-z0-9_\-\/]+)`/gi
  const text = read(rel)
  const out = new Set()
  let m
  while ((m = re.exec(text))) out.add(m[1])
  return [...out]
}

test('明文 Scheme 路径均在 app.json 且含 2026-09 新页', () => {
  const appPages = collectAppPages()
  const paths = schemePaths()
  assert.ok(paths.length >= 40, '路径过少：' + paths.length)
  const seen = new Set()
  for (const p of paths) {
    assert.ok(!seen.has(p), '重复路径 ' + p)
    seen.add(p)
    assert.ok(appPages.has(p), 'Scheme 路径不在 app.json：' + p)
  }
  for (const must of [
    'subpackages/monitor-pages/rocket-model-detail',
    'subpackages/rocket-3d/viewer',
    'subpackages/watch-party/merchant-list',
    'subpackages/index-extra/global-launch-stats',
    'subpackages/monitor-pages/booster-genealogy',
    'subpackages/news-extra/photo-detail'
  ]) {
    assert.ok(seen.has(must), '缺少 ' + must)
  }
  assert.ok(!seen.has('subpackages/monitor-pages/rocket-compare'), '对比页尚未进正式版，勿放第 1 行')
  assert.ok(!seen.has('subpackages/monitor-pages/rocket-score'), '评分页尚未进正式版，勿放第 1 行')
  const pending = new Set(pendingSchemePaths())
  assert.ok(pending.has('subpackages/monitor-pages/rocket-compare'))
  assert.ok(pending.has('subpackages/monitor-pages/rocket-score'))
  for (const p of pending) {
    assert.ok(appPages.has(p), '待追加 Scheme 不在 app.json：' + p)
  }
})

test('page-meta 路径均在 app.json 且覆盖对比/评分/3D/观礼', () => {
  const appPages = collectAppPages()
  const meta = JSON.parse(read('agent-config/page-meta.json'))
  const pages = meta.pages
  assert.ok(Array.isArray(pages) && pages.length >= 18)
  const seen = new Set()
  for (const item of pages) {
    assert.ok(item.path && item.name && item.description)
    assert.ok(!seen.has(item.path), 'page-meta 重复 ' + item.path)
    seen.add(item.path)
    assert.ok(appPages.has(item.path), 'page-meta 不在 app.json：' + item.path)
  }
  assert.ok(seen.has('subpackages/monitor-pages/rocket-compare'))
  assert.ok(seen.has('subpackages/monitor-pages/rocket-score'))
  assert.ok(seen.has('subpackages/rocket-3d/viewer'))
  assert.ok(seen.has('subpackages/watch-party/merchant-list'))
  assert.ok(seen.has('subpackages/monitor-pages/rocket-model-detail'))
  assert.ok(seen.has('subpackages/monitor-pages/starlink-fullscreen'))
  const scheme = new Set(schemePaths().concat(pendingSchemePaths()))
  for (const p of seen) {
    assert.ok(scheme.has(p), 'page-meta 未进 Scheme 白名单（含待发版）：' + p)
  }
})

test('功能导航反引号路径均在 app.json', () => {
  const appPages = collectAppPages()
  const paths = backtickAppPaths('docs/小程序功能导航.md')
  assert.ok(paths.length >= 20, '功能导航路径过少：' + paths.length)
  for (const p of paths) {
    assert.ok(appPages.has(p), '功能导航路径不在 app.json：' + p)
  }
})

test('知识库文档含新功能关键词且不含过期接入结论', () => {
  const guide = read('docs/小程序功能导航.md')
  const faq = read('docs/用户常见问题.md')
  const xiaowei = read('docs/小微调用本小程序.md')
  const cap = read('docs/wechat-ai-capability.md')
  const agents = read('agent-config/AGENTS.md')
  assert.match(guide, /火箭型号对比/)
  assert.match(guide, /档案指数/)
  assert.match(guide, /3D 火箭/)
  assert.match(guide, /火箭观礼/)
  assert.match(guide, /航天摄影/)
  assert.match(faq, /不是投票/)
  assert.match(faq, /文昌观礼/)
  assert.match(faq, /航天摄影/)
  assert.match(faq, /打开微信小程序「火星探索日志」/)
  assert.match(xiaowei, /火星探索日志/)
  assert.doesNotMatch(xiaowei, /wxf98b58309019771b/)
  assert.doesNotMatch(guide, /wxf98b58309019771b/)
  assert.match(xiaowei, /打开「火星探索日志」底部「主页」/)
  assert.match(xiaowei, /星链/)
  assert.match(xiaowei, /观礼/)
  assert.doesNotMatch(faq, /不要编一条任务凑数|不要用过期日程表/)
  assert.doesNotMatch(xiaowei, /应\*\*打开并调用本小程序\*\*/)
  assert.match(agents, /被微信小微/)
  assert.doesNotMatch(guide, /launch-tracker|booster-tracker|station-tracker|starship-tracker/)
  assert.doesNotMatch(faq, /launch-tracker|booster-tracker|station-tracker|starship-tracker/)
  assert.doesNotMatch(xiaowei, /launch-tracker|booster-tracker|station-tracker|starship-tracker/)
  assert.doesNotMatch(cap, /尚未接入微信 AI 开发模式/)
  assert.match(cap, /小微调用本小程序\.md/)
})
