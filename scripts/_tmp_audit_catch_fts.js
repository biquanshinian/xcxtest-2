/**
 * 筷子捕获姿态 + 溅落 FTS 审计
 * 用法: node scripts/_tmp_audit_catch_fts.js
 */
var path = require('path')
var fs = require('fs')
var root = path.join(__dirname, '..')
var viz = require(path.join(root, 'subpackages/mission-sim/flight-viz.js'))
var engine = require(path.join(root, 'subpackages/mission-sim/sim-engine.js'))
var src = fs.readFileSync(path.join(root, 'subpackages/mission-sim/flight-viz.js'), 'utf8')

var pass = 0
var fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  — ' + detail : '')) }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')) }
}
function near(a, b, tol) {
  var d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return Math.abs(d) <= (tol || 0.2)
}

var splashProf = { boosterEnd: 'splash', shipEnd: 'splash', payloadT: 1120, entryT: 2845, shipEndT: 3921 }
var catchProf = { boosterEnd: 'catch', shipEnd: 'catch', payloadT: 1120, entryT: 2845, shipEndT: 3921 }
var dualCatchTl = [
  { t: 0, label: 'Liftoff', desc: '' },
  { t: 444, label: 'Booster catch', desc: '助推器筷子捕获' },
  { t: 1120, label: 'Payload', desc: '载荷部署' },
  { t: 2845, label: 'Entry', desc: '再入界面' },
  { t: 3921, label: 'Ship catch', desc: '飞船筷子捕获 Mechazilla' }
]

// 捕获末段：一二级均为尾朝下（−π/2）
ok('catch booster@430 engines-down', near(viz.boosterDiagramAng(430, 1.0, catchProf), -Math.PI / 2))
ok('catch booster@360 early lock', near(viz.boosterDiagramAng(360, 0.8, catchProf), -Math.PI / 2))
ok('catch ship@landing engines-down', near(viz.shipDiagramAng(3910, Math.PI / 2, catchProf), -Math.PI / 2, 0.35))
ok('splash ship@landing still engines-down', near(viz.shipDiagramAng(3910, Math.PI / 2, splashProf), -Math.PI / 2, 0.35))

// 捕获几何：终点不入海、二级高于一级
var gCatch = viz.buildDiagramGeo(catchProf)
var bEnd = gCatch.booster[gCatch.booster.length - 1]
var sEnd = gCatch.ship[gCatch.ship.length - 1]
ok('catch booster y above sea', bEnd[2] >= 0.05, String(bEnd[2]))
ok('catch ship y above booster', sEnd[2] > bEnd[2], 'ship=' + sEnd[2] + ' booster=' + bEnd[2])
ok('catch ship not at splash x', Math.abs(sEnd[1] - 0.9) > 0.3)

var gSplash = viz.buildDiagramGeo(splashProf)
var bSplashEnd = gSplash.booster[gSplash.booster.length - 1]
ok('splash booster near sea', bSplashEnd[2] < 0.02)

// 时间线推断双捕获
var m = engine.createMission({ seed: 1, autoDemo: true, timeline: dualCatchTl })
var p = m.snapshot().profile
ok('infer dual catch boosterEnd', p.boosterEnd === 'catch', JSON.stringify(p))
ok('infer dual catch shipEnd', p.shipEnd === 'catch')

var mSplash = engine.createMission({ seed: 1, autoDemo: true })
var ps = mSplash.snapshot().profile
ok('default still dual splash', ps.boosterEnd === 'splash' && ps.shipEnd === 'splash')

// 源码：FTS 仅 splash；捕获有 hang / chopsticks
ok('has _drawFtsBoom', /_drawFtsBoom\s*:\s*function/.test(src))
ok('has _drawChopsticksLive', /_drawChopsticksLive\s*:\s*function/.test(src))
ok('FTS gated by bSplash', /bSplash[\s\S]{0,120}_drawFtsBoom/.test(src) || /if \(bSplash[\s\S]{0,200}_drawFtsBoom/.test(src))
ok('FTS gated by sSplash', /sSplash[\s\S]{0,120}_drawFtsBoom/.test(src) || /if \(sSplash[\s\S]{0,200}_drawFtsBoom/.test(src))
ok('no FTS on catch path comment', /捕获不炸/.test(src) || /仅 splash/.test(src))
ok('catch hold engines -PI/2', /bCatch[\s\S]{0,400}-Math\.PI \/ 2[\s\S]{0,80}booster/.test(src))
ok('ship hold catch branch', /shipHeld/.test(src) && /sCatch/.test(src))
ok('labels FTS / 捕获', /一级溅落·FTS/.test(src) && /一级捕获/.test(src) && /二级捕获/.test(src))

console.log('\n----\nTOTAL pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
