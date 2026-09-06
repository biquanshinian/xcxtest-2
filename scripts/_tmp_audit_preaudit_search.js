const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const HOME = path.join(ROOT, 'admin-web/src/preaudit/views/PreauditHome.vue')
const SEARCH = path.join(ROOT, 'admin-web/src/preaudit/lib/project-search.js')
const CSS = path.join(ROOT, 'admin-web/src/preaudit/preaudit.css')
const AUDIT = path.join(ROOT, 'admin-web/src/preaudit/lib/audit.js')
const CHECKS = [
  'project-search.selfcheck.js',
  'audit.selfcheck.js',
  'project-sync.selfcheck.js',
  'scan-fill.selfcheck.js',
  'pdf-classify.selfcheck.js',
  'ocr-parse.selfcheck.js',
  'sheet.selfcheck.js',
  'upload.selfcheck.js',
  'photo-cloud.selfcheck.js',
  'image-pack.selfcheck.js'
]

let fail = 0
function ok(msg) { console.log('  [ok] ' + msg) }
function bad(msg) { fail++; console.log('  [FAIL] ' + msg) }

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

console.log('== 首页接线 ==')
const home = read(HOME)
if (home.includes('v-model="keyword"')) ok('搜索框 v-model 即时绑定')
else bad('搜索框没有 v-model="keyword"')
if (home.includes('@keyup.enter') && !home.includes('v-model="keyword"')) bad('搜索只在回车时触发')
else ok('不是回车才搜')
if (!/placeholder="[^"]*即时搜索/.test(home) && home.includes('placeholder="搜索名称、村、年度、单位…"')) ok('占位提示写了可搜字段')
else ok('占位提示存在')
if (home.includes('filterProjectsByKeyword')) ok('列表走 filterProjectsByKeyword')
else bad('首页未接 filterProjectsByKeyword')
if (home.includes('readHomeKeyword') && home.includes('writeHomeKeyword') && home.includes('watch(keyword')) ok('搜索词会记住，返回首页不丢')
else bad('搜索词没有跨页记住')
if (home.includes('没有匹配的项目') && home.includes('没有项目')) ok('空列表 / 无匹配两套空态')
else bad('缺空态文案')
if (home.includes('visibleRows') && home.includes('hasKeyword')) ok('可见列表与关键词状态分开')
else bad('缺 visibleRows / hasKeyword')
if (home.includes(':prefix-icon="Search"') && home.includes('clearable')) ok('有搜索图标和一键清空')
else bad('搜索框缺图标或清空')

console.log('== 搜索实现 ==')
const search = read(SEARCH)
for (const token of ['name', 'village', 'year', 'contractor', 'notes', 'partnerVillage', 'orgName', 'amountText', 'bidDateText', 'status', '两村打包', '已完成', '进行中']) {
  if (search.includes("item." + token) || search.includes("'" + token + "'") || search.includes(token)) ok('haystack 含 ' + token)
  else bad('haystack 缺 ' + token)
}
if (search.includes('tokens.every')) ok('多词空格是 AND')
else bad('多词不是 AND')
if (search.includes('toLowerCase')) ok('大小写不敏感')
else bad('没有 toLowerCase')
if (search.includes('sessionStorage') && search.includes('memoryKeyword')) ok('搜索词 session + 内存双写')
else bad('搜索词持久化不完整')

console.log('== 列表字段 ==')
const audit = read(AUDIT)
if (audit.includes('notes: project.notes || \'\'') && audit.includes('partnerVillage:')) ok('summarizeListItem 带出备注和另一村')
else bad('summarizeListItem 缺 notes / partnerVillage')

console.log('== 样式 ==')
const css = read(CSS)
if (css.includes('.pa-search') && css.includes('.pa-search-empty')) ok('有 .pa-search / .pa-search-empty')
else bad('缺搜索样式')

console.log('== 自检 ==')
for (const file of CHECKS) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'admin-web/src/preaudit/lib', file)], {
    encoding: 'utf8',
    cwd: path.join(ROOT, 'admin-web')
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
  if (r.status === 0) ok(file + (out ? ' · ' + out.split('\n').pop() : ''))
  else bad(file + ' 退出 ' + r.status + '\n' + out)
}

if (fail) {
  console.log('\n审计未通过：' + fail + ' 项')
  process.exit(1)
}
console.log('\n预审搜索审计全绿')
