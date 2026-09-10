/**
 * 火箭档案指数：同量级折算 + 分包落位。
 * node --test test/rocket-score.test.js
 */
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..')
const score = require('../subpackages/monitor-pages/utils/rocket-score.js')

function falcon9() {
  return {
    id: 164,
    name: 'Falcon 9',
    full_name: 'Falcon 9 Block 5',
    nameZh: '猎鹰 9',
    reusable: true,
    leo_capacity: 22800,
    gto_capacity: 8300,
    to_thrust: 7607,
    launch_cost: 67000000,
    total_launch_count: 400,
    successful_launches: 396,
    attempted_landings: 350,
    successful_landings: 340,
    maiden_flight: '2010-06-04'
  }
}

function longMarch5() {
  return {
    id: 215,
    name: 'Long March 5',
    full_name: 'Long March 5',
    reusable: false,
    leo_capacity: 25000,
    gto_capacity: 14000,
    to_thrust: 10580,
    launch_cost: 100000000,
    total_launch_count: 12,
    successful_launches: 11,
    attempted_landings: 0,
    successful_landings: 0,
    maiden_flight: '2016-11-03'
  }
}

function electron() {
  return {
    id: 1,
    name: 'Electron',
    full_name: 'Electron',
    reusable: false,
    leo_capacity: 300,
    to_thrust: 224,
    launch_cost: 6000000,
    total_launch_count: 50,
    successful_launches: 47,
    maiden_flight: '2017-05-25'
  }
}

function spectrum() {
  return {
    id: 491,
    name: 'Spectrum',
    full_name: 'Spectrum',
    reusable: false,
    leo_capacity: 1000,
    to_thrust: 980,
    launch_cost: null,
    total_launch_count: 0,
    successful_launches: 0
  }
}

function catalog() {
  const map = {}
  ;[falcon9(), longMarch5(), electron(), spectrum()].forEach(function (cfg) {
    map[String(cfg.id)] = cfg
  })
  for (let i = 10; i < 40; i++) {
    map[String(i)] = {
      id: i,
      name: 'Heavy ' + i,
      reusable: false,
      leo_capacity: 9000 + i * 200,
      to_thrust: 5000 + i * 80,
      launch_cost: 80000000 + i * 1000000,
      total_launch_count: 8 + (i % 12),
      successful_launches: 7 + (i % 10)
    }
  }
  for (let i = 50; i < 80; i++) {
    map[String(i)] = {
      id: i,
      name: 'Small ' + i,
      reusable: false,
      leo_capacity: 200 + i * 8,
      to_thrust: 180 + i,
      launch_cost: 4000000 + i * 50000,
      total_launch_count: 4 + (i % 9),
      successful_launches: 3 + (i % 8)
    }
  }
  return map
}

test('量级：超重 / 重型 / 小型 / 未分级', () => {
  assert.equal(score.payloadClass({ leo_capacity: 50000 }), 'superheavy')
  assert.equal(score.payloadClass(falcon9()), 'heavy')
  assert.equal(score.payloadClass(electron()), 'small')
  assert.equal(score.payloadClass({}), 'unknown')
  assert.equal(score.classLabel('heavy'), '重型')
})

test('一次性不评复用，未首飞不评可靠度', () => {
  assert.equal(score.dimValue(longMarch5(), 'reuse'), null)
  assert.ok(score.dimValue(falcon9(), 'reuse') > 90)
  assert.equal(score.dimValue(spectrum(), 'reliability'), null)
  assert.equal(score.dimValue(spectrum(), 'maturity'), null)
  assert.ok(score.dimValue(spectrum(), 'payload') > 0)
})

test('同量级折算：猎鹰 9 综合分高于电子号，长征五号复用维缺失', () => {
  const map = catalog()
  const f9 = score.buildScoreView(falcon9(), map)
  const cz5 = score.buildScoreView(longMarch5(), map)
  const el = score.buildScoreView(electron(), map)
  assert.equal(f9.ready, true)
  assert.equal(f9.classId, 'heavy')
  assert.equal(el.classId, 'small')
  assert.ok(f9.overall != null && f9.overall >= 3)
  assert.ok(el.overall != null)
  assert.ok(f9.dims.find((d) => d.id === 'maturity').score >= 4)
  assert.equal(f9.dims.find((d) => d.id === 'reuse').missing, false)
  assert.equal(cz5.dims.find((d) => d.id === 'reuse').missing, true)
  assert.match(cz5.dims.find((d) => d.id === 'reuse').hint, /一次性/)
  assert.equal(f9.dims.length, 6)
  assert.equal(f9.radar.points.length, 6)
  assert.equal(f9.radar.labels.length, 6)
  f9.radar.labels.forEach((lab) => {
    assert.ok(lab.scoreText)
    assert.equal(lab.rawText, undefined)
  })
})

test('画像跳数只改分数展示，不带参数原文', () => {
  const view = score.buildScoreView(falcon9(), catalog())
  const zero = score.applyScoreProgress(view, 0)
  const mid = score.applyScoreProgress(view, 0.5)
  const full = score.applyScoreProgress(view, 1)
  const payload = view.dims.find((d) => d.id === 'payload')
  assert.equal(zero.dims.find((d) => d.id === 'payload').scoreShown, '0.0')
  assert.equal(zero.radar.labels.find((l) => l.id === 'payload').scoreShown, '0.0')
  assert.equal(zero.radar.labels.find((l) => l.id === 'payload').rawText, '')
  assert.equal(full.dims.find((d) => d.id === 'payload').scoreShown, payload.scoreText)
  assert.equal(full.overallShown, view.overallText)
  assert.ok(Number(mid.dims.find((d) => d.id === 'payload').scoreShown) < payload.score)
  const thin = score.applyScoreProgress(score.buildScoreView(spectrum(), catalog()), 1)
  assert.equal(thin.dims.find((d) => d.id === 'reliability').scoreShown, '—')
})

test('未首飞：可靠/成熟缺失，综合可能样本不足', () => {
  const view = score.buildScoreView(spectrum(), catalog())
  assert.equal(view.dims.find((d) => d.id === 'reliability').missing, true)
  assert.equal(view.hasFlown, false)
  assert.ok(view.grade.id === 'unflown' || view.grade.id === 'thin')
  assert.equal(score.hasFlownConfig({ maiden_flight: '2099-01-01', total_launch_count: 0 }), false)
  assert.equal(score.hasFlownConfig({ maiden_flight: '2010-06-04', total_launch_count: 0 }), true)
  assert.equal(score.formatField('missing_key', 12), '12')
  assert.match(score.formatField('leo_capacity', 22800), /22,800/)
})

test('按名称能命中猎鹰 9 / Spectrum', () => {
  const map = catalog()
  assert.equal(score.matchConfigByName(map, '猎鹰 9', '').id, 164)
  assert.equal(score.matchConfigByName(map, '', 'Falcon 9').id, 164)
  assert.equal(score.resolveScoreConfig(map, { configId: '491' }).name, 'Spectrum')
  assert.equal(score.resolveScoreConfig(map, { name: 'Spectrum' }).id, 491)
})

test('有构型 id 时不按名称落到其它 Block', () => {
  const block1 = {
    id: 90,
    name: 'Falcon 9 v1.0',
    full_name: 'Falcon 9 v1.0',
    nameZh: '猎鹰 9',
    reusable: true,
    total_launch_count: 5
  }
  const block5 = {
    id: 188,
    name: 'Falcon 9',
    full_name: 'Falcon 9 Block 5',
    nameZh: '猎鹰 9',
    full_nameZh: '猎鹰9号第5型',
    reusable: true,
    total_launch_count: 400
  }
  const map = catalog()
  map['90'] = block1
  map['188'] = block5
  assert.equal(score.resolveScoreConfig(map, {
    configId: '188',
    name: '猎鹰9号',
    nameEn: 'Falcon 9'
  }).id, 188)
  assert.equal(score.resolveScoreConfig(map, {
    configId: '188',
    name: '猎鹰9号',
    nameEn: 'Falcon 9'
  }).full_name, 'Falcon 9 Block 5')
  assert.equal(score.resolveScoreConfig(map, {
    configId: '404',
    name: '猎鹰9号',
    nameEn: 'Falcon 9'
  }), null)
  assert.equal(score.matchConfigByName(map, '猎鹰9号第5型', 'Falcon 9 Block 5').id, 188)
  assert.equal(score.matchConfigByName(map, '猎鹰 9', 'Falcon 9').id, 188)
  assert.equal(score.matchConfigByName(map, '', 'Falcon 9 v1.0').id, 90)
})

test('评分页在 monitor-pages 分包，主包只留入口', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const pkg = (appJson.subPackages || []).find((p) => p.name === 'monitor-pages')
  assert.ok(pkg.pages.indexOf('rocket-score') >= 0, '分包未注册 rocket-score')
  assert.ok((appJson.pages || []).every((p) => p.indexOf('rocket-score') < 0))
  assert.equal(fs.existsSync(path.join(ROOT, 'pages/rocket-score/rocket-score.js')), false)
  const routes = fs.readFileSync(path.join(ROOT, 'utils/routes.js'), 'utf8')
  assert.doesNotMatch(routes, /ROCKET_SCORE|rocket-score/)
  ;[
    'pages/index/index.js',
    'pages/monitor/monitor.js',
    'pages/progress/progress.js',
    'pages/news/news.js',
    'pages/profile/profile.js',
    'app.js'
  ].forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    assert.doesNotMatch(src, /rocket-score|openRocketScore|buildScoreView|ic-score/)
  })

  const missionJs = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/mission-detail.js'), 'utf8')
  const missionWxml = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/mission-detail.wxml'), 'utf8')
  const missionWxss = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/mission-detail.wxss'), 'utf8')
  assert.match(missionJs, /onTapRocketScore/)
  assert.match(missionJs, /openRocketScore/)
  assert.match(missionJs, /resolveMissionRocketConfigId/)
  assert.match(missionJs, /missionRocketNameOpts/)
  assert.doesNotMatch(missionJs, /buildScoreView/)
  assert.doesNotMatch(missionJs, /getRocketConfigMeta/)
  const listJs = fs.readFileSync(path.join(ROOT, 'utils/api-launch-list.js'), 'utf8')
  assert.match(listJs, /id:\s*cfg\.id != null && cfg\.id !== '' \? cfg\.id : null/)
  assert.match(missionWxml, /mission-fab-dock/)
  assert.match(missionWxml, /onTapRocketScore/)
  assert.match(missionWxml, /ic-score\.svg/)
  assert.match(missionWxss, /\.mission-score-fab/)
  assert.match(missionWxss, /\.mission-fab-dock/)

  const modelJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.js'), 'utf8')
  const modelWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.wxml'), 'utf8')
  const modelWxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.wxss'), 'utf8')
  assert.match(modelJs, /onTapRocketScore/)
  assert.match(modelJs, /openRocketScore\(model\.configId/)
  assert.match(modelJs, /ensureShareImageHttpUrl/)
  assert.match(modelJs, /pickRocketModelShareImageUrl/)
  assert.match(modelJs, /_syncShareImage\(model\)/)
  assert.match(modelWxml, /mission-fab-dock/)
  assert.match(modelWxml, /onTapRocketScore/)
  assert.match(modelWxml, /ic-score\.svg/)
  assert.match(modelWxss, /\.mission-score-fab/)
  const geneWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/booster-genealogy.wxml'), 'utf8')
  const geneJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/booster-genealogy.js'), 'utf8')
  assert.doesNotMatch(geneWxml, /onTapRocketScore|mission-score-fab|ic-score/)
  assert.doesNotMatch(geneJs, /openRocketScore|onTapRocketScore/)

  const pageJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-score.js'), 'utf8')
  assert.match(pageJs, /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/)
  assert.match(pageJs, /checkShareEntryGate/)
  assert.match(pageJs, /GATE_PRODUCT_ID = 'rocket_compare'/)
  assert.match(pageJs, /gateCheck\(GATE_PRODUCT_ID/)
  assert.match(pageJs, /_playEnterAnim/)
  assert.match(pageJs, /ensureScoreAccess/)
  assert.match(pageJs, /if\s*\(\s*!this\._scoreAllowed\s*\)\s*return/)
  assert.match(pageJs, /onRetryLoad[\s\S]{0,180}ensureScoreAccess/)
  assert.match(pageJs, /name=' \+ encodeURIComponent\(this\._name\)/)
  assert.match(pageJs, /onShareAppMessage/)
  assert.match(pageJs, /onShareTimeline/)
  assert.match(pageJs, /ensureShareImageHttpUrl/)
  assert.match(pageJs, /_syncShareImage/)
  assert.match(pageJs, /pickRocketModelShareImageUrl/)
  assert.match(pageJs, /imageFallbacks/)
  assert.match(pageJs, /withShareStampPath\('\/subpackages\/monitor-pages\/rocket-score'/)
  assert.match(pageJs, /rawView\.overallText/)
  assert.doesNotMatch(pageJs, /path:\s*['"]\/pages\/monitor\/monitor['"]/)
  assert.match(pageJs, /if\s*\(\s*!cfg && this\._configId\s*\)\s*cfg = await this\.fetchConfigFromLl2/)
  assert.match(pageJs, /禁止用「猎鹰 9」落到 Block 1|有构型 id 时只认这一条/)
  const loadFn = pageJs.slice(pageJs.indexOf('async loadScore'))
  assert.match(loadFn.slice(0, 900), /view:\s*null/)
  const loadIdx = pageJs.indexOf('async loadScore')
  const guardIdx = pageJs.indexOf('if (!this._scoreAllowed) return')
  const metaIdx = pageJs.indexOf('getRocketConfigMeta({ afterGate: true })')
  assert.ok(guardIdx > loadIdx && guardIdx < metaIdx, '须先过门控再拉 _config_meta')
  assert.match(pageJs, /that\._animTimer = setInterval/)
  const playFn = pageJs.slice(pageJs.indexOf('_playEnterAnim'))
  assert.doesNotMatch(playFn.slice(0, 1200), /heroReady:\s*true/)
  assert.match(pageJs, /onHeroLoad[\s\S]{0,80}heroReady:\s*true/)
  assert.match(playFn, /applyScoreProgress/)
  assert.match(pageJs, /theme\.onThemeChange/)
  const pageWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-score.wxml'), 'utf8')
  const pageWxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-score.wxss'), 'utf8')
  assert.doesNotMatch(pageWxml, /score-watermark|>INDEX</)
  assert.match(pageWxml, /radar-score/)
  assert.match(pageWxml, /item\.scoreShown/)
  assert.match(pageJs, /onTapManufacturer/)
  assert.match(pageJs, /manufacturerAbbrev/)
  assert.match(pageJs, /openEncyclopediaAgency/)
  assert.match(pageWxml, /onTapManufacturer/)
  assert.match(pageWxss, /\.theme-light \.glass-card/)
  assert.match(pageWxss, /\.theme-light \.radar-score/)

  ;[
    'pages/mission-detail/utils/booster-nav.js',
    'subpackages/monitor-pages/utils/booster-nav.js'
  ].forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    const fn = src.slice(src.indexOf('function openRocketScore'))
    assert.match(fn, /gateCheck\('rocket_compare',\s*'火箭型号对比'\)/)
    assert.match(fn, /\/subpackages\/monitor-pages\/rocket-score/)
    assert.doesNotMatch(fn.slice(0, 900), /暂无该型号档案/)
  })
})

test('评分页 wxml 绑定都有处理器', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-score.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-score.js'), 'utf8')
  const base = fs.readFileSync(path.join(ROOT, 'utils/page-base.js'), 'utf8')
  const handlers = new Set()
  const re = /\b(?:bind|catch)[:]?[A-Za-z]+="([A-Za-z_$][\w$]*)"/g
  let m
  while ((m = re.exec(wxml))) handlers.add(m[1])
  assert.ok(handlers.size >= 5, '绑定过少: ' + [...handlers].join(','))
  for (const name of handlers) {
    assert.ok(new RegExp(name + '\\s*\\(').test(js) || new RegExp(name + '\\s*\\(').test(base), '缺少处理器 ' + name)
  }
})

test('评分页 JS 语法通过 node --check', () => {
  const { spawnSync } = require('node:child_process')
  ;[
    'subpackages/monitor-pages/utils/rocket-score.js',
    'subpackages/monitor-pages/rocket-score.js'
  ].forEach((rel) => {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
    assert.equal(r.status, 0, rel + ' 语法错误:\n' + (r.stderr || r.stdout))
  })
})
