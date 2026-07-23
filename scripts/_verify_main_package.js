#!/usr/bin/env node
/** Verify main-package JSON has no BOM; syntax-check modified JS. */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.join(__dirname, '..')
const mainSubpkgExclude = [
  'subpackages/', 'pages/nasa-data/', 'pages/about/', 'pages/collect/',
  'pages/space-explore/', 'pages/webview/',
  'pages/mission-detail/', 'pages/search/', 'pages/video-player/',
]

function isMain(rel) {
  return !mainSubpkgExclude.some((p) => rel.startsWith(p))
}

const jsFiles = [
  'pages/monitor/monitor.js',
  'pages/mission-detail/mission-detail.js',
  'pages/index/index.js',
  'subpackages/profile-extra/utils/checkin.js',
  'subpackages/profile-extra/utils/space-quiz.js',
  'utils/demo-engine.js',
  'subpackages/shared/utils/demo-scripts.js',
  'subpackages/index-extra/utils/index-calendar-page.js',
  'subpackages/shared/utils/channels-live.js',
  'subpackages/shared/utils/channels-live-config-cache.js',
  'subpackages/shared/utils/official-account-scene.js',
  'subpackages/shared/components/channels-live-panel/index.js',
  'subpackages/shared/components/official-account-bar/index.js',
  'subpackages/monitor-pages/utils/artemis-arow.js',
  'subpackages/monitor-pages/utils/starbase-weather.js',
]

let bomIssues = []
function walkJson(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'cloudfunctions' || name === 'admin-web') continue
    const full = path.join(dir, name)
    const rel = path.relative(root, full).replace(/\\/g, '/')
    const st = fs.statSync(full)
    if (st.isDirectory()) walkJson(full)
    else if (rel.endsWith('.json') && isMain(rel)) {
      const buf = fs.readFileSync(full)
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bomIssues.push(rel)
      try { JSON.parse(buf.toString('utf8')) } catch (e) {
        console.error('JSON parse fail:', rel, e.message)
        process.exitCode = 1
      }
    }
  }
}

walkJson(root)
if (bomIssues.length) {
  console.error('BOM in JSON:', bomIssues.join(', '))
  process.exitCode = 1
} else {
  console.log('JSON BOM check: OK (' + 'main package json files')
}

for (const rel of jsFiles) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) {
    console.error('Missing:', rel)
    process.exitCode = 1
    continue
  }
  try {
    execSync(`node --check "${full}"`, { stdio: 'pipe' })
    console.log('syntax OK:', rel)
  } catch (e) {
    console.error('syntax FAIL:', rel)
    process.exitCode = 1
  }
}

// Simulate index page require chain (top-level requires only)
const indexJs = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8')
const requireRe = /require\(['"]([^'"]+)['"]\)/g
let m
const missing = []
while ((m = requireRe.exec(indexJs))) {
  const req = m[1]
  if (!req.startsWith('.')) continue
  const base = path.resolve(path.join(root, 'pages/index'), req)
  const candidates = [base, base + '.js', path.join(base, 'index.js')]
  if (!candidates.some((c) => fs.existsSync(c))) missing.push(req)
}
if (missing.length) {
  console.error('Index page missing requires:', missing.join(', '))
  process.exitCode = 1
} else {
  console.log('Index page require chain: OK')
}
