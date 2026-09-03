/**
 * NASA 数据中心：火星探索后新增月球探索 / 宇宙探索 Tab
 * 运行：node --test test/nasa-data-tabs.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}

function stripJs(src) {
  return String(src || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('NASA 数据中心 Tab 顺序：火星 → 月球 → 宇宙 → 地球 → 近地天体', () => {
  const js = read('pages/nasa-data/nasa-data.js')
  const wxml = read('pages/nasa-data/nasa-data.wxml')
  assert.match(js, /key: 'mars'[\s\S]*key: 'moon'[\s\S]*key: 'universe'[\s\S]*key: 'eonet'[\s\S]*key: 'cad'/)
  assert.match(js, /label: '月球探索'/)
  assert.match(js, /label: '宇宙探索'/)
  assert.match(wxml, /hidden="\{\{activeTab !== 1\}\}"[\s\S]{0,280}monitor-artemis-card/)
  assert.match(wxml, /hidden="\{\{activeTab !== 2\}\}"[\s\S]{0,280}monitor-roman-card/)
  assert.match(wxml, /activeTab === 3/)
  assert.match(wxml, /activeTab === 4/)
  const moonBlock = wxml.split('nasaArtemisCard')[0]
  const universeBlock = wxml.split('nasaArtemisCard')[1].split('nasaRomanCard')[0]
  assert.doesNotMatch(moonBlock, /eonet-card/)
  assert.doesNotMatch(universeBlock, /cad-card/)
})

test('月球/宇宙 Tab 跨分包组件有 placeholder，且页面 JS 不同步 require 监控分包', () => {
  const json = JSON.parse(read('pages/nasa-data/nasa-data.json'))
  assert.equal(
    json.usingComponents['monitor-artemis-card'],
    '/subpackages/monitor-pages/components/monitor-artemis-card/index'
  )
  assert.equal(
    json.usingComponents['monitor-roman-card'],
    '/subpackages/monitor-pages/components/monitor-roman-card/index'
  )
  assert.equal(json.componentPlaceholder['monitor-artemis-card'], 'view')
  assert.equal(json.componentPlaceholder['monitor-roman-card'], 'view')
  const js = stripJs(read('pages/nasa-data/nasa-data.js'))
  assert.doesNotMatch(js, /require\(\s*['"][^'"]*monitor-pages/)
  assert.match(js, /tab=/)
  assert.match(js, /nasaArtemisCard/)
  assert.match(js, /nasaRomanCard/)
})

test('阿尔忒弥斯/罗曼卡片：进详情均走会员门控，广告解锁默认开启', () => {
  const artemis = read('subpackages/monitor-pages/components/monitor-artemis-card/index.js')
  const roman = read('subpackages/monitor-pages/components/monitor-roman-card/index.js')
  assert.match(artemis, /gateCheck\('artemis_telemetry'/)
  assert.match(artemis, /ROUTES\.ARTEMIS_DETAIL/)
  assert.match(artemis, /fetchArtemisIiBriefing/)
  assert.match(roman, /GATE_PRODUCT_ID = 'roman_tracker'/)
  assert.match(roman, /gateCheck\(GATE_PRODUCT_ID/)
  assert.doesNotMatch(roman, /allowAd:\s*false/)
  assert.match(roman, /scene === 'nasa'/)
  assert.match(read('pages/nasa-data/nasa-data.wxml'), /scene="nasa"/)
})

test('进入 NASA 数据中心会预下载 monitor-pages 分包', () => {
  const app = JSON.parse(read('app.json'))
  const rule = app.preloadRule && app.preloadRule['pages/nasa-data/nasa-data']
  assert.ok(rule)
  assert.ok(rule.packages.includes('monitor-pages'))
})

test('改动文件语法可通过 node --check', () => {
  const files = [
    'pages/nasa-data/nasa-data.js',
    'subpackages/monitor-pages/agency-detail.js',
    'subpackages/monitor-pages/components/monitor-artemis-card/index.js',
    'subpackages/monitor-pages/components/monitor-roman-card/index.js'
  ]
  for (const rel of files) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' })
  }
})
