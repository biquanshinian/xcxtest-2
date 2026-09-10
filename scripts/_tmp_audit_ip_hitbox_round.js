/**
 * 本轮审计：3D 页参照点选盒按模型尺寸对齐（人全身 / 车手册）
 * 运行：node scripts/_tmp_audit_ip_hitbox_round.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const issues = []
const notes = []
const ok = (m) => console.log('  ok  ' + m)
const fail = (m) => {
  issues.push(m)
  console.log('  FAIL ' + m)
}
const note = (m) => {
  notes.push(m)
  console.log('  note ' + m)
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

function syntaxOk(rel) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
  return r.status === 0
}

function fnBody(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(')
  const m = src.match(re)
  if (!m) return ''
  const open = src.indexOf('{', m.index)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open)
}

function runNode(args) {
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
}

const intro = require('../subpackages/rocket-3d/ip-intro.js')
const runtimeSrc = read('subpackages/rocket-3d/runtime.js')
const introSrc = read('subpackages/rocket-3d/ip-intro.js')
const pickSrc = fnBody(runtimeSrc, 'pickIpRefAt')
const hitBoxSrc = fnBody(runtimeSrc, 'ipFigureHitWorldBox')
const personBoxSrc = fnBody(runtimeSrc, 'ipFigurePersonHitBox')
const vehicleBoxSrc = fnBody(runtimeSrc, 'alignVehicleBoxToModel')
const projectSrc = fnBody(runtimeSrc, 'projectBoxToCssRect')
const pickHitSrc = fnBody(introSrc, 'pickHitSlug')
const padSrc = fnBody(introSrc, 'padModelHitRect')

console.log('── 源码：不套固定宽高 ──')
if (/VEHICLE_HIT|PERSON_HIT|hitSizeForSlug|isVehicleHit/.test(introSrc)) {
  fail('ip-intro 还在按 slug 套固定热区常数')
} else ok('点选不再按人/车写死像素')
if (/expandHitRect\(list\[i\], 56, 88/.test(introSrc) || /minW: 168|minH: 104/.test(introSrc)) {
  fail('pickHitSlug 仍在用 56×88 / 168×104')
} else ok('pickHitSlug 不再套 56×88 / 168×104')
if (!/HIT_PAD_RATIO/.test(padSrc) || !/HIT_SLACK_PX/.test(padSrc)) {
  fail('屏幕外扩没有跟投影盒自己的宽高走')
} else ok('屏幕外扩按该投影盒比例 + 指尖余量')
if (/kind: ipScaleRef\.isVehicleRef/.test(pickSrc)) {
  fail('pickIpRefAt 还在传 kind 给已经不认 kind 的 pickHitSlug')
} else ok('点选只传模型投影盒')

console.log('\n── 源码：盒对齐模型 ──')
if (!/ipFigureHitWorldBox/.test(pickSrc)) fail('点选没用模型对齐世界盒')
else ok('点选用 ipFigureHitWorldBox')
if (!/ipFigurePersonHitBox/.test(hitBoxSrc) || !/alignVehicleBoxToModel/.test(hitBoxSrc)) {
  fail('人/车没有分开按模型对齐')
} else ok('人走全身盒，车走手册盒')
if (!/box\.max\.y/.test(personBoxSrc) || /yTop/.test(personBoxSrc)) {
  fail('人物点选盒还在用特写裁切高度，头顶会点不中')
} else ok('人物点选盒用脚到头的全身高')
if (!/core\.x - r/.test(personBoxSrc)) fail('人物点选盒宽度没按身体核')
else ok('人物宽度按身体核，不认举手臂展')
if (!/needL/.test(vehicleBoxSrc) || !/needW/.test(vehicleBoxSrc) || !/needH/.test(vehicleBoxSrc)) {
  fail('车辆点选盒没按手册长宽高对齐')
} else ok('车辆点选盒按手册长 / 宽 / 高对齐')
if (!/1\.25/.test(vehicleBoxSrc)) fail('网格垃圾尺寸不会被收到手册范围')
else ok('车盒过大时收到手册尺寸 1.25 倍内')
if (!/HIT_WORLD_PAD_RATIO/.test(hitBoxSrc)) fail('世界盒没有按自身比例外扩')
else ok('世界盒按自身 6% 外扩，人和车同一规则')
if (!/forHit/.test(projectSrc) || !/inFront/.test(projectSrc)) {
  fail('投影热区没把镜头前出画角点算进去')
} else ok('热区投影认镜头前角点，不丢拉近后的车身')
if (!/!p.visible/.test(projectSrc)) fail('非点选投影不再挡镜头背后的点，可能扫到整屏')
else ok('非点选投影仍丢掉看不见的角点')

console.log('\n── 行为：屏幕盒跟模型走 ──')
const truckPad = intro.padModelHitRect({ left: 100, top: 200, right: 200, bottom: 220 })
const personPad = intro.padModelHitRect({ left: 100, top: 100, right: 120, bottom: 200 })
if (!truckPad || truckPad.right - truckPad.left <= truckPad.bottom - truckPad.top) {
  fail('车投影外扩后不再是横宽')
} else ok('车投影外扩后仍是横宽')
if (!personPad || personPad.bottom - personPad.top <= personPad.right - personPad.left) {
  fail('人投影外扩后不再是竖高')
} else ok('人投影外扩后仍是竖高')
if (truckPad.bottom - truckPad.top >= 50) fail('车高被拉成小人竖条')
else ok('车高没有被拉成 88px 竖条')
if (
  intro.pickHitSlug(
    [
      { slug: 'musk', left: 160, top: 200, right: 190, bottom: 250 },
      { slug: 'cyber-pickup', left: 120, top: 220, right: 230, bottom: 255 }
    ],
    175,
    225
  ) !== 'musk'
) {
  fail('点在人身上没点到人')
} else ok('重叠时点更小的模型盒')
if (
  intro.pickHitSlug(
    [
      { slug: 'musk', left: 160, top: 200, right: 190, bottom: 250 },
      { slug: 'cyber-pickup', left: 120, top: 220, right: 230, bottom: 255 }
    ],
    130,
    238
  ) !== 'cyber-pickup'
) {
  fail('点在车身露出部分没点到车')
} else ok('点车身露出部分是皮卡')
if (intro.pickHitSlug([], 10, 10) !== '') fail('空热区还能点中')
else ok('点空处不会误中')
if (intro.getIpIntro('cyber-pickup').name !== '赛博皮卡') fail('皮卡介绍丢了')
else ok('皮卡介绍还在')

console.log('\n── 语法 ──')
;[
  'subpackages/rocket-3d/ip-intro.js',
  'subpackages/rocket-3d/runtime.js',
  'subpackages/rocket-3d/components/rocket-3d-viewer/index.js',
  'utils/ip-scale-ref.js',
  'test/ip-intro.test.js',
  'test/rocket-3d-audit.test.js'
].forEach((rel) => {
  if (!exists(rel)) fail('缺文件 ' + rel)
  else if (!syntaxOk(rel)) fail(rel + ' 语法错误')
  else ok(rel + ' 语法通过')
})

console.log('\n── 单测 ──')
const tests = runNode([
  '--test',
  'test/ip-intro.test.js',
  'test/ip-scale-ref.test.js',
  'test/ip-reference-ready.test.js',
  'test/rocket-3d-audit.test.js'
])
if (tests.status !== 0) {
  fail('本轮相关单测失败')
  console.log(tests.stdout || tests.stderr)
} else {
  const m = String(tests.stdout || '').match(/# (?:tests|pass|fail)[^\n]*/g)
  ok('本轮相关单测通过' + (m && m.length ? ' (' + m.join(', ') + ')' : ''))
}

console.log('\n── 旧审计回归 ──')
;[
  ['scripts/_tmp_audit_ip_scale_ref.js', 'IP 标尺'],
  ['scripts/_tmp_audit_ip_dim_fixed.js', '尺寸+固定']
].forEach(([rel, label]) => {
  const r = runNode([rel])
  const out = String(r.stdout || '') + String(r.stderr || '')
  if (r.status !== 0 || !/全绿灯/.test(out)) {
    fail(label + '未全绿')
    const last = out.trim().split('\n').slice(-8).join('\n')
    if (last) console.log(last)
  } else ok(label + '全绿灯')
})

if (/ipFigureWorldBox/.test(pickSrc)) {
  note('旧核心焦点审计曾记录点选用整模盒；本轮已改模型对齐盒')
}

console.log('\n── 结果 ──')
if (notes.length) {
  console.log('备注 ' + notes.length + ' 项：')
  notes.forEach((m) => console.log('  - ' + m))
}
if (issues.length) {
  console.log('未通过 ' + issues.length + ' 项：')
  issues.forEach((m) => console.log('  - ' + m))
  process.exit(1)
}
console.log('全绿灯')
