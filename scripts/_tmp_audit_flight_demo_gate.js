/**
 * 飞行剖面演示 + 门控 一轮静态审计
 * 用法: node scripts/_tmp_audit_flight_demo_gate.js
 */
var fs = require('fs')
var path = require('path')
var vm = require('vm')

var root = path.join(__dirname, '..')
var pass = 0
var fail = 0
var rows = []

function ok(name, cond, detail) {
  if (cond) {
    pass++
    rows.push({ ok: true, name: name, detail: detail || '' })
  } else {
    fail++
    rows.push({ ok: false, name: name, detail: detail || '' })
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

function syntaxCheck(rel) {
  var src = read(rel)
  try {
    new vm.Script(src, { filename: rel })
    return { ok: true }
  } catch (e) {
    return { ok: false, err: String(e && e.message || e) }
  }
}

// ---------- 文件存在 ----------
;[
  'subpackages/mission-sim/flight-demo.js',
  'subpackages/mission-sim/flight-demo.wxml',
  'subpackages/mission-sim/flight-demo.json',
  'subpackages/mission-sim/flight-demo.wxss',
  'subpackages/mission-sim/flight-viz.js',
  'subpackages/mission-sim/flight-tick.js',
  'subpackages/mission-sim/sim-engine.js',
  'subpackages/mission-sim/components/flight-profile-demo/flight-profile-demo.js',
  'subpackages/mission-sim/components/flight-profile-demo/flight-profile-demo.wxml',
  'subpackages/mission-sim/components/flight-profile-demo/flight-profile-demo.json'
].forEach(function (f) {
  ok('exists:' + f, exists(f))
})

// ---------- 语法 ----------
;[
  'pages/mission-detail/mission-detail.js',
  'subpackages/mission-sim/flight-demo.js',
  'subpackages/mission-sim/mission-sim.js',
  'subpackages/mission-sim/flight-viz.js',
  'subpackages/mission-sim/flight-tick.js',
  'subpackages/mission-sim/sim-engine.js',
  'subpackages/mission-sim/components/flight-profile-demo/flight-profile-demo.js',
  'utils/membership.js'
].forEach(function (f) {
  var r = syntaxCheck(f)
  ok('syntax:' + f, r.ok, r.err || '')
})

// ---------- app.json 注册 ----------
var appJson = JSON.parse(read('app.json'))
var missionPkg = (appJson.subPackages || appJson.subpackages || []).find(function (p) {
  return p.root === 'subpackages/mission-sim' || p.name === 'mission-sim'
})
ok('app.json:mission-sim package', !!missionPkg)
ok(
  'app.json:flight-demo page',
  !!(missionPkg && (missionPkg.pages || []).indexOf('flight-demo') >= 0)
)

// ---------- 详情页门控 ----------
var detailJs = read('pages/mission-detail/mission-detail.js')
var detailWxml = read('pages/mission-detail/mission-detail.wxml')
var detailJson = JSON.parse(read('pages/mission-detail/mission-detail.json'))

ok(
  'gate:openFlightDemo async + gateCheck mission_sim',
  /async\s+openFlightDemo\s*\(/.test(detailJs) &&
    /gateCheck\s*\(\s*['"]mission_sim['"]\s*,\s*['"]飞行剖面演示['"]\s*\)/.test(detailJs)
)
ok(
  'gate:pending lock _flightDemoGatePending',
  /_flightDemoGatePending/.test(detailJs) &&
    /finally\s*\{\s*this\._flightDemoGatePending\s*=\s*false/.test(detailJs)
)
ok(
  'gate:navigate after allowed',
  /if\s*\(\s*!allowed\s*\)\s*return/.test(detailJs) &&
    /url:\s*['"]\/subpackages\/mission-sim\/flight-demo['"]/.test(detailJs)
)
ok(
  'gate:指挥室仍用 mission_sim',
  /gateCheck\s*\(\s*['"]mission_sim['"]\s*,\s*['"]星舰任务指挥室['"]\s*\)/.test(detailJs)
)
ok(
  'gate:openFlightDemo 无 allowAd:false（默认可看广告）',
  !/openFlightDemo[\s\S]{0,400}allowAd\s*:\s*false/.test(detailJs)
)
ok(
  'gate:membership allowAd 默认开启',
  /var\s+allowAd\s*=\s*!opts\s*\|\|\s*opts\.allowAd\s*!==\s*false/.test(read('utils/membership.js'))
)
ok(
  'ui:bind opentap → openFlightDemo',
  /bind:opentap=["']openFlightDemo["']/.test(detailWxml)
)
ok(
  'ui:mini 展示条件 missionSimEligible && enableMissionSim',
  /missionSimEligible\s*&&\s*enableMissionSim\s*&&\s*flightDemoTimeline\.length/.test(detailWxml)
)
ok(
  'ui:详情注册 flight-profile-demo 组件',
  !!(detailJson.usingComponents && detailJson.usingComponents['flight-profile-demo'])
)
ok(
  'ui:完整页注释不再写免费预览无门控',
  !/飞行剖面完整演示页（免费预览/.test(detailJs) &&
    !/免费预览，无会员门控/.test(read('subpackages/mission-sim/flight-demo.js'))
)

// ---------- membership 弹窗含广告 ----------
var mem = read('utils/membership.js')
ok(
  'membership:_showPurchaseDialog 含看广告',
  /看广告免费体验/.test(mem) && /showRewardedAdForUnlock/.test(mem)
)

// ---------- 组件 / 引擎 ----------
var compJs = read('subpackages/mission-sim/components/flight-profile-demo/flight-profile-demo.js')
ok('demo:autoDemo true', /autoDemo:\s*true/.test(compJs))
ok('demo:用 _loop 非残留 _timer 判续跑', /if\s*\(\s*!this\._loop\s*\)\s*this\._startTimer/.test(compJs))
ok('demo:mini 点击 triggerEvent opentap', /triggerEvent\s*\(\s*['"]opentap['"]\s*\)/.test(compJs))
ok('demo:lockDark 属性', /lockDark:\s*\{\s*type:\s*Boolean/.test(compJs))

var engineSrc = read('subpackages/mission-sim/sim-engine.js')
ok('engine:autoDemo shipLuck=1', /if\s*\(\s*autoDemo\s*\)\s*\{[\s\S]*?shipLuck\s*=\s*1/.test(engineSrc))
ok('engine:autoDemo 开局 GO g1', /if\s*\(\s*autoDemo\s*\)\s*decide\s*\(\s*['"]g1_fuel['"]\s*,\s*['"]go['"]\s*\)/.test(engineSrc))

// ---------- 溅落几何 ----------
var viz = read('subpackages/mission-sim/flight-viz.js')
ok('viz:SPLASH_X_BOOSTER=0.30', /SPLASH_X_BOOSTER\s*=\s*0\.30/.test(viz))
ok('viz:SPLASH_X_SHIP=0.90', /SPLASH_X_SHIP\s*=\s*0\.90/.test(viz))
ok(
  'viz:间距≈0.60',
  (function () {
    var m1 = viz.match(/SPLASH_X_BOOSTER\s*=\s*([0-9.]+)/)
    var m2 = viz.match(/SPLASH_X_SHIP\s*=\s*([0-9.]+)/)
    if (!m1 || !m2) return false
    var d = Math.abs(parseFloat(m2[1]) - parseFloat(m1[1]))
    return Math.abs(d - 0.6) < 0.001
  })()
)

// ---------- tick ~30fps ----------
var tick = read('subpackages/mission-sim/flight-tick.js')
ok('tick:RENDER_MS≈33 (~30fps)', /RENDER_MS\s*=\s*33/.test(tick))
ok('tick:stepSmoothed 导出', /stepSmoothed/.test(tick) && /exports[\s\S]*stepSmoothed/.test(tick))
ok(
  'mission-sim 与 demo 共用 flight-tick',
  /require\(['"]\.\/flight-tick\.js['"]\)/.test(read('subpackages/mission-sim/mission-sim.js')) &&
    /require\(['"]\.\.\/\.\.\/flight-tick\.js['"]\)/.test(compJs)
)

// ---------- 主题：指挥室/完整页深色 ----------
var fdJs = read('subpackages/mission-sim/flight-demo.js')
var fdWxml = read('subpackages/mission-sim/flight-demo.wxml')
var msJs = read('subpackages/mission-sim/mission-sim.js')
ok('theme:flight-demo forceDarkTheme', /forceDarkTheme:\s*true/.test(fdJs))
ok('theme:mission-sim forceDarkTheme', /forceDarkTheme:\s*true/.test(msJs))
ok('theme:full 页 lockDark=true', /lockDark=["']\{\{true\}\}["']/.test(fdWxml))
ok(
  'theme:flight-demo syncTheme 清空 theme-light',
  /themeClass:\s*['"]['"]/.test(fdJs) && /pageBgColor:\s*['"]#000000['"]/.test(fdJs)
)

// ---------- failClosed ----------
ok(
  'flag:flight-demo enableMissionSim failClosed',
  /isFeatureEnabled\s*\(\s*['"]enableMissionSim['"]\s*,\s*\{\s*failClosed:\s*true/.test(fdJs)
)
ok(
  'flag:mission-sim enableMissionSim failClosed',
  /isFeatureEnabled\s*\(\s*['"]enableMissionSim['"]\s*,\s*\{\s*failClosed:\s*true/.test(msJs)
)

// ---------- eventChannel ----------
ok(
  'channel:emit flightDemoContext',
  /emit\s*\(\s*['"]flightDemoContext['"]/.test(detailJs)
)
ok(
  'channel:on flightDemoContext',
  /on\s*\(\s*['"]flightDemoContext['"]/.test(fdJs)
)

// ---------- 运行时：autoDemo 闭环成功（轻量） ----------
try {
  var engine = require(path.join(root, 'subpackages/mission-sim/sim-engine.js'))
  var tl = [
    { t: 0, label: 'LIFTOFF' },
    { t: 120, label: 'MECO' },
    { t: 444, label: 'BOOSTER SPLASH' },
    { t: 520, label: 'SECO' },
    { t: 3921, label: 'SHIP SPLASH' }
  ]
  var m = engine.createMission({ seed: 20260, timeline: tl, autoDemo: true })
  m.setRate(64)
  var snap = m.snapshot()
  var guard = 0
  while (snap && snap.phase !== 'done' && guard < 20000) {
    snap = m.step(50)
    guard++
  }
  ok('runtime:autoDemo 能跑到 done', !!(snap && snap.phase === 'done'), 'steps=' + guard)
  var outcomeOk =
    snap &&
    snap.phase === 'done' &&
    snap.outcome &&
    (snap.outcome.result === 'success' || snap.outcome === 'success')
  ok(
    'runtime:autoDemo 成功结局（非失败）',
    !!outcomeOk,
    JSON.stringify({
      phase: snap && snap.phase,
      result: snap && snap.outcome && snap.outcome.result
    })
  )
} catch (e) {
  ok('runtime:autoDemo 引擎可 require', false, String(e && e.message || e))
}

// ---------- 打印 ----------
console.log('\n=== flight-demo / gate audit ===\n')
rows.forEach(function (r) {
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  — ' + r.detail : ''))
})
console.log('\n----')
console.log('TOTAL  pass=' + pass + '  fail=' + fail + '  of=' + (pass + fail))
console.log(fail === 0 ? 'RESULT  ALL GREEN' : 'RESULT  HAS RED')
process.exit(fail === 0 ? 0 : 1)
