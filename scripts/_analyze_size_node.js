const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const subpkg = [
  'subpackages/', 'pages/nasa-data/', 'pages/about/', 'pages/collect/',
  'pages/space-explore/', 'pages/image-preview/', 'pages/webview/',
  'pages/mission-detail/', 'pages/search/', 'pages/video-player/',
]
const excludeDirs = new Set([
  'node_modules', 'cloudfunctions', 'admin-web', '.git', '_error_report_extract',
  'scripts', 'scf-cos-trigger', 'cloudfunctionTemplate', '.github', 'workers', 'test', 'docs',
  'cloudflare-worker',
])
const ignoreGlobs = [
  'admin-web.zip', '**/*.zip', '_weanalysis*', '_analyze_size*', 'workers/**', 'test/**',
  'docs/**', 'utils/.api-full.backup.js', 'cloudflare-worker/**', 'admin-web/**',
  '_error_report_extract/**', '**/*.md', '*.md', 'scf-cos-trigger/**', 'scripts/**',
  'cloudfunctions/**', 'cloudfunctionTemplate/**', 'project.miniapp.json',
  'code_obfuscation_config.json', 'project.private.config.json', 'package-lock.json',
  'eslint.config.js', '_weanalysis*.py', '_analyze_size.py', 'md2wechat*.sh', 'utils/api.js',
  '.prettierrc.json', '.prettierignore', '.gitignore', 'package.json',
]

function matchGlob(rel, glob) {
  if (glob.includes('*')) {
    const re = new RegExp('^' + glob.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$')
    return re.test(rel) || re.test(rel.split('/').pop())
  }
  return rel === glob || rel.endsWith('/' + glob)
}

function ignored(rel) {
  return ignoreGlobs.some(g => matchGlob(rel, g))
}

function isMain(rel) {
  return !subpkg.some(p => rel.startsWith(p))
}

const files = []
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (excludeDirs.has(name)) continue
    const full = path.join(dir, name)
    const rel = path.relative(root, full).replace(/\\/g, '/')
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full)
    else if (isMain(rel) && !ignored(rel)) files.push({ rel, size: st.size })
  }
}
walk(root)

files.sort((a, b) => b.size - a.size)
const total = files.reduce((s, f) => s + f.size, 0)
console.log(`MAIN PACKAGE: ${(total / 1024).toFixed(1)} KB (${(total / 1024 / 1024).toFixed(3)} MB) - ${files.length} files`)
const folders = {}
for (const { rel, size } of files) {
  const parts = rel.split('/')
  let key
  if (parts[0] === 'pages' && parts.length > 1) key = 'pages/' + parts[1]
  else if (['utils', 'components', 'images', 'custom-tab-bar', 'styles', 'libs'].includes(parts[0])) key = parts[0]
  else key = parts[0]
  folders[key] = (folders[key] || 0) + size
}
console.log('By folder:')
Object.entries(folders).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${(v / 1024).toFixed(1)} KB`))
console.log('Top 25:')
files.slice(0, 25).forEach(({ rel, size }) => console.log(`  ${(size / 1024).toFixed(1)} KB  ${rel}`))
