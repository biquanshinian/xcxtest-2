/**
 * 星舰示意图姿态审计：一级溅落尾朝海、二级载荷后平躺/再入腹面/翻转尾朝海
 * 用法: node scripts/_tmp_audit_attitude.js
 */
var path = require('path')
var root = path.join(__dirname, '..')
var vizPath = path.join(root, 'subpackages/mission-sim/flight-viz.js')
var engPath = path.join(root, 'subpackages/mission-sim/sim-engine.js')

// flight-viz 非纯 module 导出姿态函数；用 vm 抽核心函数源码 eval
var fs = require('fs')
var src = fs.readFileSync(vizPath, 'utf8')
function extract(name) {
  var re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}')
  var m = src.match(re)
  if (!m) throw new Error('missing ' + name)
  return m[0]
}
eval(extract('lerpAngle'))
eval(extract('boosterDiagramAng'))
eval(extract('shipDiagramAng'))
eval(extract('shipPlasmaIntensity'))

var engine = require(engPath)
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

var profile = { boosterEnd: 'splash', shipEnd: 'splash', payloadT: 1120, entryT: 2845, shipEndT: 3921 }

// 一级：着陆/溅落必须 ≈ -π/2（发动机朝海）
ok('booster@430 engines-to-sea', near(boosterDiagramAng(430, Math.PI / 2), -Math.PI / 2), String(boosterDiagramAng(430, Math.PI / 2)))
ok('booster@444 engines-to-sea', near(boosterDiagramAng(444, 1.2), -Math.PI / 2))
// 反推：发动机沿速度
ok('booster@200 engines-along-vel', near(boosterDiagramAng(200, 0.5), 0.5 + Math.PI))

// 二级：载荷后趋平躺 ang→0
var afterPayload = shipDiagramAng(1200, 0.1, profile)
ok('ship@payload+ belly-flat', near(afterPayload, 0, 0.25), String(afterPayload))

// 再入：腹面迎风 = vel - π/2
var velDown = Math.PI / 2
var entryAng = shipDiagramAng(3000, velDown, profile)
ok('ship@entry belly-into-wind', near(entryAng, velDown - Math.PI / 2), String(entryAng))

// 翻转着陆：尾朝海
var landAng = shipDiagramAng(3920, velDown, profile)
ok('ship@landing engines-to-sea', near(landAng, -Math.PI / 2, 0.35), String(landAng))

// 等离子：再入中有、翻转后无
ok('plasma@mid-entry >0.5', shipPlasmaIntensity(3200, profile) > 0.5, String(shipPlasmaIntensity(3200, profile)))
ok('plasma@pre-entry =0', shipPlasmaIntensity(2000, profile) === 0)
ok('plasma@after-flip =0', shipPlasmaIntensity(3900, profile) === 0)

// 剖面推断含 entryT；换任务钟仍正确
var m = engine.createMission({
  seed: 1,
  autoDemo: true,
  timeline: [
    { t: 0, label: 'Liftoff', desc: '' },
    { t: 1120, label: 'Payload deploy', desc: '载荷部署' },
    { t: 2500, label: 'Entry interface', desc: '再入界面 等离子' },
    { t: 4000, label: 'Ship splashdown', desc: '飞船溅落' }
  ]
})
var snap = m.snapshot()
ok('profile.entryT from timeline', snap.profile.entryT === 2500, JSON.stringify(snap.profile))
ok('profile.shipEndT from timeline', snap.profile.shipEndT === 4000)

var p2 = snap.profile
ok('ship ang scales with new entryT', near(shipDiagramAng(2600, Math.PI / 2, p2), Math.PI / 2 - Math.PI / 2))
ok('ship land ang scales with new se', near(shipDiagramAng(3995, Math.PI / 2, p2), -Math.PI / 2, 0.35))

// 源码：不再用硬编码 t<3760 等离子 / 一级 t>=190 无脑 +π
ok('no hardcoded plasma t<3760', !/shipEntry' && t < 3760/.test(src) && !/t < 3760/.test(src))
ok('uses boosterDiagramAng', /boosterDiagramAng\s*\(/.test(src))
ok('uses shipDiagramAng', /shipDiagramAng\s*\(/.test(src))
ok('heat tiles path', /heatTiles/.test(src))

console.log('\n----\nTOTAL pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
