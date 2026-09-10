/**
 * 星问取心 / 特写镜头：数字核对，不靠扫字符串假装过了。
 * 运行：node scripts/_tmp_audit_ip_core_focus.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { ipCoreCenterFromPoints, ipCoreFromNamedPoints } = require('../utils/ip-scale-ref.js')

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
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return ''
}

function aabbMid(pts) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, minX, maxX }
}

function cameraTargetX(figMidX, focusMidX, useFocus) {
  return useFocus ? focusMidX : figMidX
}

const runtimeSrc = read('subpackages/rocket-3d/runtime.js')
const placeBody = fnBody(runtimeSrc, 'placeIpScaleRefs')
const playBody = fnBody(runtimeSrc, 'playIpIntroView')
const measureBody = fnBody(runtimeSrc, 'measureIpFigureCore')
const poseBody = fnBody(runtimeSrc, 'ipIntroCameraPose')
const focusBody = fnBody(runtimeSrc, 'ipFigureFocusBox')
const boneBody = fnBody(runtimeSrc, 'collectSkeletonCore')
const scaleSrc = read('utils/ip-scale-ref.js')
const auditTest = read('test/rocket-3d-audit.test.js')

console.log('── 接线（源码） ──')
if (!/rememberIpFigureCore/.test(placeBody) || !/core \? core\.x/.test(placeBody)) {
  fail('落地 midX 没走身体主体')
} else ok('落地 midX 写了 core，否则才退回盒心')
if (!/ipFigureFocusBox/.test(playBody) || !/focusBox/.test(poseBody) || !/lookBox/.test(poseBody)) {
  fail('特写镜头没接到 focusBox')
} else ok('特写 play 把 ipFigureFocusBox 传给 ipIntroCameraPose')
if (!/setFromObject/.test(measureBody) || !/box.min.x \+ box.max.x/.test(measureBody)) {
  fail('取心没有整模盒心回退，空顶点会直接没中心')
} else ok('顶点/骨骼都失败时，取心会退回整模盒心')
if (/bodyW: 0/.test(boneBody)) ok('骨骼取心 bodyW 写死 0，focus 半径改走身高 0.22H')
else note('骨骼取心没有 bodyW: 0，半径算法可能变了')

console.log('\n── 数字：举手+星星 ──')
const pts = []
for (let i = 0; i < 220; i++) {
  const a = (i / 220) * Math.PI * 2
  const b = ((i % 18) / 18) * Math.PI
  pts.push({
    x: Math.sin(b) * Math.cos(a) * 0.32,
    y: 0.9 + Math.cos(b) * 0.32,
    z: Math.sin(b) * Math.sin(a) * 0.32
  })
}
for (let h = 0; h < 18; h++) pts.push({ x: -1.05, y: 1.55, z: 0.02 * h })
for (let s = 0; s < 18; s++) pts.push({ x: 0.92, y: 0.85, z: 0.04 * s })
const core = ipCoreCenterFromPoints(pts)
const box = aabbMid(pts)
if (!core) fail('合成点算不出身体中心')
else {
  const dx = Math.abs(core.x - box.x)
  console.log(
    '  盒心X=' +
      box.x.toFixed(3) +
      '  主体X=' +
      core.x.toFixed(3) +
      '  差=' +
      dx.toFixed(3)
  )
  if (dx < 0.03) fail('合成不对称模型上，主体X和盒心X几乎一样，镜头左右不会动')
  else ok('合成模型上主体X和盒心X能分开，镜头左右会动')
  const oldT = cameraTargetX(box.x, box.x, false)
  const newT = cameraTargetX(box.x, core.x, true)
  console.log('  旧特写对准X=' + oldT.toFixed(3) + '  新特写对准X=' + newT.toFixed(3))
  if (Math.abs(oldT - newT) < 0.03) fail('按这组点，特写对准点左右几乎没变')
  else ok('按这组点，特写对准点会左右挪')
}

console.log('\n── 数字：取心失败 ──')
const fallbackX = box.x
const fallbackT = cameraTargetX(box.x, fallbackX, true)
if (Math.abs(fallbackT - box.x) > 1e-9) fail('盒心回退时镜头还不该等于盒心')
else ok('顶点/骨骼都失败时，特写对准点 = 整模盒心，左右和改前一样')

console.log('\n── 数字：只有 Root 骨骼 ──')
const rootOnly = ipCoreFromNamedPoints([{ name: 'Root', x: 0, y: 0, z: 0 }])
const hips = ipCoreFromNamedPoints([
  { name: 'mixamorig:Hips', x: 0.01, y: 0.9, z: 0 },
  { name: 'mixamorig:RightHand', x: -1.1, y: 1.6, z: 0 }
])
if (!rootOnly || Math.abs(rootOnly.x) > 1e-9) fail('Root 骨骼没有被当成躯干')
else ok('单根 Root 会当成躯干中心（在原点）。若星问骨架只有 Root，顶点中位数不会跑')
if (!hips || Math.abs(hips.x) > 0.05) fail('Hips+手 没有丢掉手')
else ok('有 Hips 时，手骨骼不进中心')

console.log('\n── 现有单测覆盖 ──')
const standTest = auditTest.split('两人并排')[1] || ''
if (!/makeFig/.test(standTest) || !/_worldBox/.test(standTest)) {
  fail('落地单测结构变了，无法判断有没有网格')
} else if (/isMesh:\s*true/.test(standTest) || /attributes\.position/.test(standTest)) {
  note('落地单测现在带了网格，需要再对是否测了不对称取心')
} else ok('落地单测的人没有 geometry，走的是盒心回退，证明不了星问不对称取心')

const glbHits = []
function walk(dir, depth) {
  if (depth > 3) return
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (e) {
    return
  }
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue
    const full = path.join(dir, name)
    let st
    try {
      st = fs.statSync(full)
    } catch (e) {
      continue
    }
    if (st.isDirectory()) walk(full, depth + 1)
    else if (/\.glb$/i.test(name) && /astro|xingwen|星问|ip-astro/i.test(name)) glbHits.push(full)
  }
}
walk(ROOT, 0)
if (!glbHits.length) note('仓库里没有星问 GLB，无法用真模型量盒心和主体差')
else ok('找到本地星问 GLB: ' + glbHits.join(', '))

console.log('\n── 还在用整模盒的画面 ──')
const muskPanel = fnBody(runtimeSrc, 'layoutMuskIntroPanel')
if (/\(box\.min\.x \+ box\.max\.x\) \* 0\.5/.test(muskPanel)) {
  note('马斯克 3D 板仍用整模盒心；现网马斯克走气泡，不走这块')
}
const pickBody = fnBody(runtimeSrc, 'pickIpRefAt')
if (/ipFigureWorldBox/.test(pickBody)) note('点选用整模盒，举手更容易点中，不影响画面中心')

console.log('\n── 嵌套审计 ──')
const nested = spawnSync(process.execPath, [path.join(ROOT, 'scripts/_tmp_audit_ip_intro.js')], {
  encoding: 'utf8'
})
if (nested.status !== 0 || !/全绿灯/.test(nested.stdout || '')) {
  fail('IP 总审计未全绿')
  const last = String(nested.stdout || nested.stderr || '')
    .trim()
    .split('\n')
    .slice(-6)
    .join('\n')
  if (last) console.log(last)
} else ok('IP 总审计全绿灯（含字符串扫描和单测）')

console.log('\n── 结果 ──')
if (issues.length) {
  console.log('未通过 ' + issues.length + ' 项：')
  issues.forEach((m) => console.log('  - ' + m))
  process.exit(1)
}
console.log('本轮数字核对通过')
if (notes.length) {
  console.log('不能假装已证实的事：')
  notes.forEach((m) => console.log('  - ' + m))
}
