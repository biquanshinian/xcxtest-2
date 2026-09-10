/**
 * 进度页 LL2 两卡（绿左边线 / 去刷新）+ 时间线详情飞行剖面演示
 * 用法: node scripts/_tmp_audit_ll2_cards_flight_demo.js
 * exit 0 = 全亮绿灯
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
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

function syntaxCheck(rel) {
  try {
    new vm.Script(read(rel), { filename: rel })
    return { ok: true }
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) }
  }
}

function extractBlock(src, title) {
  // 取「星舰飞行时间线 / 星舰动态追踪」标题所在 nsf-checklist-card 片段
  var re = new RegExp(
    '<view class="nsf-checklist-card glass-card ll2-progress-card">[\\s\\S]*?' +
      title +
      '[\\s\\S]*?</view>\\s*</view>\\s*<view class="nsf-checklist-muted',
    'm'
  )
  var m = src.match(re)
  if (m) return m[0]
  // 兜底：标题前后 600 字符
  var i = src.indexOf(title)
  if (i < 0) return ''
  return src.slice(Math.max(0, i - 200), i + 400)
}

// ---------- 语法 ----------
;[
  'subpackages/progress-extra/event-detail.js',
  'pages/progress/progress.js',
  'subpackages/mission-sim/components/flight-profile-demo/flight-profile-demo.js'
].forEach(function (f) {
  var r = syntaxCheck(f)
  ok('syntax:' + f, r.ok, r.err || '')
})

// ---------- 进度页两卡：绿左边线 ----------
var progressWxss = read('pages/progress/progress.wxss')
var progressWxml = read('pages/progress/progress.wxml')
ok(
  'progress:ll2 卡左边线绿色 rgba(52,199,89)',
  /\.ll2-progress-pack\s+\.ll2-progress-card\.nsf-checklist-card\s*\{[^}]*border-left-color:\s*rgba\(\s*52\s*,\s*199\s*,\s*89/.test(
    progressWxss
  )
)
ok(
  'progress:ll2 卡不再用青色左边线覆盖',
  !/\.ll2-progress-pack\s+\.ll2-progress-card\.nsf-checklist-card\s*\{[^}]*border-left-color:\s*rgba\(\s*100\s*,\s*210\s*,\s*255/.test(
    progressWxss
  )
)

var tlCard = extractBlock(progressWxml, '星舰飞行时间线')
var upCard = extractBlock(progressWxml, '星舰动态追踪')
ok('progress:存在星舰飞行时间线卡', /星舰飞行时间线/.test(tlCard) && /ll2-progress-card/.test(tlCard))
ok('progress:存在星舰动态追踪卡', /星舰动态追踪/.test(upCard) && /ll2-progress-card/.test(upCard))
ok(
  'progress:时间线卡无刷新按钮',
  !!tlCard &&
    !/onRefreshLl2Timeline/.test(tlCard) &&
    !/ll2-updates-sync-btn/.test(tlCard) &&
    !/>刷新</.test(tlCard)
)
ok(
  'progress:动态追踪卡无刷新按钮',
  !!upCard &&
    !/onRefreshLl2LaunchUpdates/.test(upCard) &&
    !/ll2-updates-sync-btn/.test(upCard) &&
    !/>刷新</.test(upCard)
)
ok(
  'progress:wxml 全局不再绑定两卡刷新',
  !/catchtap=["']onRefreshLl2Timeline["']/.test(progressWxml) &&
    !/catchtap=["']onRefreshLl2LaunchUpdates["']/.test(progressWxml)
)

// ---------- 详情页：左边线绿 + 飞行剖面在时间线上方 ----------
var detailJs = read('subpackages/progress-extra/event-detail.js')
var detailWxml = read('subpackages/progress-extra/event-detail.wxml')
var detailWxss = read('subpackages/progress-extra/event-detail.wxss')
var detailJson = JSON.parse(read('subpackages/progress-extra/event-detail.json'))

ok(
  'detail:ll2 详情卡左边线绿色',
  /\.detail-ll2-page-card\s*\{[^}]*border-left:\s*4rpx\s+solid\s+rgba\(\s*52\s*,\s*199\s*,\s*89/.test(detailWxss)
)
ok(
  'detail:detail-flight-demo 样式存在',
  /\.detail-flight-demo\s*\{/.test(detailWxss)
)

ok(
  'detail:json 注册 flight-profile-demo',
  !!(detailJson.usingComponents && detailJson.usingComponents['flight-profile-demo'])
)
ok(
  'detail:json componentPlaceholder flight-profile-demo（跨分包）',
  !!(detailJson.componentPlaceholder && detailJson.componentPlaceholder['flight-profile-demo'])
)
ok(
  'detail:组件路径指向 mission-sim',
  /mission-sim\/components\/flight-profile-demo/.test(
    String(detailJson.usingComponents['flight-profile-demo'] || '')
  )
)

var tlMode = detailWxml.match(
  /pageMode === ['"]ll2_timeline['"][\s\S]*?pageMode === ['"]ll2_launch_updates['"]/
)
ok('detail:能截取 ll2_timeline 区块', !!tlMode)
if (tlMode) {
  var block = tlMode[0]
  var demoIdx = block.indexOf('detail-flight-demo')
  var titleIdx = block.indexOf('星舰飞行时间线')
  var cardIdx = block.indexOf('detail-ll2-page-card')
  ok('detail:时间线模式含飞行剖面容器', demoIdx >= 0)
  ok('detail:飞行剖面在时间线标题/卡片上方', demoIdx >= 0 && titleIdx > demoIdx && cardIdx > demoIdx)
  ok(
    'detail:mini + bind opentap',
    /mode=["']mini["']/.test(block) && /bind:opentap=["']openFlightDemo["']/.test(block)
  )
  ok(
    'detail:展示条件 enableMissionSim && flightDemoTimeline.length',
    /enableMissionSim\s*&&\s*flightDemoTimeline\.length/.test(block)
  )
  ok(
    'detail:active 绑定 pageVisible',
    /active=["']\{\{!loading && pageVisible\}\}["']/.test(block)
  )
  ok(
    'detail:飞行剖面不出现在动态追踪区块',
    !/ll2_launch_updates[\s\S]*detail-flight-demo/.test(detailWxml) ||
      detailWxml.indexOf('detail-flight-demo') < detailWxml.indexOf("pageMode === 'll2_launch_updates'")
  )
}

// ---------- JS：数据 / 门控 / flag ----------
ok(
  'js:data 含 enableMissionSim / flightDemoTimeline / pageVisible',
  /enableMissionSim:\s*false/.test(detailJs) &&
    /flightDemoTimeline:\s*\[\]/.test(detailJs) &&
    /pageVisible:\s*true/.test(detailJs)
)
ok(
  'js:_buildFlightDemoTimeline 映射 t/label/desc/tLabel',
  /_buildFlightDemoTimeline\s*\(/.test(detailJs) &&
    /t:\s*r\.sortKey/.test(detailJs) &&
    /label:\s*r\.title/.test(detailJs) &&
    /tLabel:\s*r\.timeLabel/.test(detailJs)
)
ok(
  'js:load 后 setData flightDemoTimeline',
  /flightDemoTimeline:\s*demoTl/.test(detailJs) || /flightDemoTimeline:\s*this\._buildFlightDemoTimeline/.test(detailJs)
)
ok(
  'js:enableMissionSim failClosed + defaultOff',
  /isFeatureEnabled\s*\(\s*['"]enableMissionSim['"]\s*,\s*\{\s*failClosed:\s*true\s*,\s*defaultOff:\s*true/.test(
    detailJs
  )
)
ok('js:require feature-flags', /require\(['"]\.\.\/\.\.\/utils\/feature-flags\.js['"]\)/.test(detailJs))
ok(
  'js:openFlightDemo gateCheck mission_sim',
  /async\s+openFlightDemo\s*\(/.test(detailJs) &&
    /gateCheck\s*\(\s*['"]mission_sim['"]\s*,\s*['"]飞行剖面演示['"]\s*\)/.test(detailJs)
)
ok(
  'js:openFlightDemo pending 锁 + finally 释放',
  /_flightDemoGatePending/.test(detailJs) &&
    /finally\s*\{\s*this\._flightDemoGatePending\s*=\s*false/.test(detailJs)
)
ok(
  'js:openFlightDemo 未允许不导航',
  /if\s*\(\s*!allowed\s*\)\s*return/.test(detailJs) &&
    /url:\s*['"]\/subpackages\/mission-sim\/flight-demo['"]/.test(detailJs)
)
ok(
  'js:openFlightDemo 无 allowAd:false',
  !/openFlightDemo[\s\S]{0,500}allowAd\s*:\s*false/.test(detailJs)
)
ok(
  'js:eventChannel flightDemoContext + id',
  /emit\s*\(\s*['"]flightDemoContext['"][\s\S]{0,200}id:\s*missionId/.test(detailJs)
)
ok(
  'js:URL 带 id/type/name',
  /id=\$\{encodeURIComponent\(missionId\)\}/.test(detailJs) &&
    /type=upcoming/.test(detailJs) &&
    /name=\$\{encodeURIComponent/.test(detailJs)
)
ok('js:onHide pageVisible false', /pageVisible:\s*false/.test(detailJs))
ok('js:onShow pageVisible true', /setData\(\s*\{\s*pageVisible:\s*true\s*\}/.test(detailJs))
ok(
  'js:失败时清空 flightDemoTimeline',
  /flightDemoTimeline:\s*\[\s*\]/.test(detailJs) && /flightDemoMissionName:\s*['"]['"]/.test(detailJs)
)

// ---------- 组件仍在 ----------
ok(
  'comp:flight-profile-demo 存在',
  exists('subpackages/mission-sim/components/flight-profile-demo/flight-profile-demo.js')
)
ok(
  'comp:opentap 事件',
  /triggerEvent\s*\(\s*['"]opentap['"]\s*\)/.test(
    read('subpackages/mission-sim/components/flight-profile-demo/flight-profile-demo.js')
  )
)

// ---------- 打印 ----------
console.log('\n=== ll2 cards + flight-demo on timeline detail ===\n')
rows.forEach(function (r) {
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  — ' + r.detail : ''))
})
console.log('\n----')
console.log('TOTAL  pass=' + pass + '  fail=' + fail + '  of=' + (pass + fail))
console.log(fail === 0 ? 'RESULT  ALL GREEN' : 'RESULT  HAS RED')
process.exit(fail === 0 ? 0 : 1)
