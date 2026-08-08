/**
 * 全仓语法 / 未闭合注释 / JSON / 测试 审计（一次性）
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'miniprogram_npm',
  'dist',
  'build',
  '.next',
  'agent-tools',
  'agent-transcripts'
])

function walk(dir, pred, acc = []) {
  let ents
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    return acc
  }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, pred, acc)
    else if (pred(e.name, p)) acc.push(p)
  }
  return acc
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/')
}

function isTempScript(p) {
  const b = path.basename(p)
  return (
    b.startsWith('_tmp_') ||
    b.startsWith('_restored_') ||
    b.startsWith('_share_') ||
    b.includes('_tmp_audit')
  )
}

// ── 1) JS syntax ──
const jsFiles = walk(ROOT, (name) => /\.(js|mjs|cjs)$/i.test(name))
const jsFails = []
let jsOk = 0
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status !== 0) {
    jsFails.push({
      file: rel(f),
      temp: isTempScript(f),
      err: String(r.stderr || r.stdout || '')
        .trim()
        .split(/\n/)
        .slice(0, 3)
        .join(' | ')
    })
  } else jsOk++
}

// ── 2) Dangerous unclosed / swallowed block comments in app code ──
function scanBlockComments(file) {
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split(/\n/)
  let inBlock = false
  let blockStart = 0
  let depthFromStart = 0
  const swallowed = []
  let unclosed = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let j = 0
    while (j < line.length) {
      if (!inBlock && line[j] === '/' && line[j + 1] === '/') break
      if (!inBlock && line[j] === '/' && line[j + 1] === '*') {
        inBlock = true
        blockStart = i + 1
        depthFromStart = 0
        j += 2
        continue
      }
      if (inBlock && line[j] === '*' && line[j + 1] === '/') {
        inBlock = false
        j += 2
        continue
      }
      j++
    }
    if (inBlock) {
      depthFromStart++
      const t = line.trim()
      // Page/object method while still inside a block comment
      if (/^(async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(t) || /^[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(t)) {
        swallowed.push({ line: i + 1, text: t.slice(0, 90), blockStart })
      }
    }
  }
  if (inBlock) unclosed = { line: blockStart }
  return { unclosed, swallowed }
}

const appJs = jsFiles.filter((f) => {
  const r = rel(f)
  if (isTempScript(f)) return false
  if (r.startsWith('scripts/')) return false
  return (
    r.startsWith('pages/') ||
    r.startsWith('utils/') ||
    r.startsWith('subpackages/') ||
    r.startsWith('cloudfunctions/') ||
    r.startsWith('components/') ||
    r === 'app.js'
  )
})

const commentHits = []
for (const f of appJs) {
  const { unclosed, swallowed } = scanBlockComments(f)
  // Only report if swallowed methods span more than a typical JSDoc (block continues past method)
  // Heuristic: blockStart line is a short JSDoc opener without */, and next live-looking method is inside
  if (unclosed || (swallowed.length && swallowed.some((s) => s.line - s.blockStart <= 2))) {
    const opener = fs.readFileSync(f, 'utf8').split(/\n/)[(unclosed || swallowed[0]).blockStart - 1] || ''
    const looksLikeBrokenJsdoc =
      /^\s*\/\*\*/.test(opener) && !opener.includes('*/')
    if (unclosed || looksLikeBrokenJsdoc) {
      commentHits.push({
        file: rel(f),
        unclosed,
        swallowedCount: swallowed.length,
        samples: swallowed.slice(0, 6)
      })
    }
  }
}

// ── 3) JSON ──
const jsonFiles = walk(ROOT, (name) => /\.json$/i.test(name)).filter((f) => !isTempScript(f))
const jsonFails = []
for (const f of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch (e) {
    jsonFails.push({ file: rel(f), err: String(e.message).slice(0, 160) })
  }
}

// ── 4) WXML/WXSS existence for pages (basic) ──
const pageJs = walk(path.join(ROOT, 'pages'), (name) => name.endsWith('.js'))
const pageMissing = []
for (const f of pageJs) {
  const base = f.replace(/\.js$/i, '')
  // skip utils under pages
  if (base.includes(`${path.sep}utils${path.sep}`) || /[\\/]utils$/i.test(path.dirname(f))) continue
  if (!fs.existsSync(base + '.json') && !fs.existsSync(path.dirname(f) + path.sep + path.basename(base) + '.json')) {
    // page folders usually have same-name json
  }
  const name = path.basename(base)
  const dir = path.dirname(f)
  if (path.basename(dir) === name || fs.existsSync(path.join(dir, name + '.wxml'))) {
    const need = ['.wxml', '.json']
    for (const ext of need) {
      if (!fs.existsSync(path.join(dir, name + ext)) && !fs.existsSync(base + ext)) {
        // only flag if sibling wxml expected (has .js page entry in app.json later)
      }
    }
  }
}

// ── 5) Run tests ──
const testFiles = [
  ...walk(path.join(ROOT, 'test'), (n) => /\.test\.js$/i.test(n)),
  ...walk(path.join(ROOT, 'cloudfunctions'), (n) => /\.test\.js$/i.test(n))
]
const testResult = spawnSync(process.execPath, ['--test', ...testFiles], {
  encoding: 'utf8',
  cwd: ROOT,
  maxBuffer: 20 * 1024 * 1024
})
const testOut = String(testResult.stdout || '') + String(testResult.stderr || '')
const passMatch = testOut.match(/ℹ pass (\d+)/)
const failMatch = testOut.match(/ℹ fail (\d+)/)
const testsMatch = testOut.match(/ℹ tests (\d+)/)
const failingBlocks = []
const failRe = /✖ .+/g
let m
while ((m = failRe.exec(testOut))) {
  failingBlocks.push(m[0])
}

const report = {
  js: {
    total: jsFiles.length,
    ok: jsOk,
    fail: jsFails.length,
    appFail: jsFails.filter((x) => !x.temp).length,
    tempFail: jsFails.filter((x) => x.temp).length,
    fails: jsFails
  },
  comments: {
    scannedAppFiles: appJs.length,
    suspiciousFiles: commentHits.length,
    hits: commentHits
  },
  json: {
    total: jsonFiles.length,
    fail: jsonFails.length,
    fails: jsonFails
  },
  tests: {
    files: testFiles.length,
    exitCode: testResult.status,
    tests: testsMatch ? Number(testsMatch[1]) : null,
    pass: passMatch ? Number(passMatch[1]) : null,
    fail: failMatch ? Number(failMatch[1]) : null,
    failingTitles: failingBlocks.slice(0, 30)
  }
}

const outPath = path.join(ROOT, 'scripts', '_tmp_full_repo_audit_report.json')
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log('\nWrote', rel(outPath))
