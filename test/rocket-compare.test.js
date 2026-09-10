/**
 * 火箭型号对比：纯逻辑 + 分包落位（不得进主包）。
 * node --test test/rocket-compare.test.js
 */
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..')
const compare = require('../subpackages/monitor-pages/utils/rocket-compare.js')

function falcon9() {
  return {
    id: 164,
    name: 'Falcon 9',
    full_name: 'Falcon 9 Block 5',
    manufacturerName: 'SpaceX',
    manufacturerDisplay: 'SpaceX',
    countryCode: 'US',
    reusable: true,
    length: 70,
    diameter: 3.7,
    launch_mass: 549,
    leo_capacity: 22800,
    gto_capacity: 8300,
    to_thrust: 7607,
    launch_cost: 67000000,
    max_stage: 2,
    maiden_flight: '2010-06-04',
    total_launch_count: 400,
    successful_launches: 396,
    failed_launches: 4,
    pending_launches: 8,
    attempted_landings: 350,
    successful_landings: 340,
    consecutive_successful_landings: 20,
    fastestTurnaroundText: '9 天'
  }
}

function longMarch5() {
  return {
    id: 215,
    name: 'Long March 5',
    full_name: 'Long March 5',
    manufacturerName: 'CASC',
    manufacturerDisplay: '中国航天科技集团',
    countryCode: 'CN',
    reusable: false,
    length: 56.97,
    diameter: 5,
    launch_mass: 869,
    leo_capacity: 25000,
    gto_capacity: 14000,
    to_thrust: 10580,
    launch_cost: 100000000,
    max_stage: 2,
    maiden_flight: '2016-11-03',
    total_launch_count: 12,
    successful_launches: 11,
    failed_launches: 1,
    pending_launches: 2,
    attempted_landings: 0,
    successful_landings: 0
  }
}

test('parseCompareIds：逗号分隔、去重、最多 4 个', () => {
  assert.deepEqual(compare.parseCompareIds({ ids: '164,215,164' }), ['164', '215'])
  assert.deepEqual(compare.parseCompareIds({ id: '164' }), ['164'])
  assert.deepEqual(compare.parseCompareIds({ configIds: '1,2,3,4,5' }), ['1', '2', '3', '4'])
  assert.deepEqual(compare.parseCompareIds({}), [])
})

test('countryLabel / 成功率 / 着陆率', () => {
  assert.equal(compare.countryLabel('CN'), '中国')
  assert.equal(compare.countryLabel('us'), '美国')
  assert.equal(compare.successRate(falcon9()), 99)
  assert.equal(compare.landingRate(falcon9()), 97.1)
  assert.equal(compare.landingRate(longMarch5()), null)
})

test('两款火箭：复用与运力差异会被标出，相同级数不进「只看差异」', () => {
  const a = { name: '猎鹰 9', cfg: falcon9() }
  const b = { name: '长征五号', cfg: longMarch5() }
  const all = compare.buildCompareTable([a, b], { onlyDiff: false })
  const diffOnly = compare.buildCompareTable([a, b], { onlyDiff: true })
  const reusable = all.rows.find((r) => r.key === 'reusable')
  const stages = all.rows.find((r) => r.key === 'max_stage')
  const leo = all.rows.find((r) => r.key === 'leo_capacity')
  assert.equal(reusable.differs, true)
  assert.equal(reusable.cells[0].text, '可复用')
  assert.equal(reusable.cells[1].text, '一次性')
  assert.equal(reusable.cells[0].win, true)
  assert.equal(stages.differs, false)
  assert.ok(!diffOnly.rows.some((r) => r.key === 'max_stage'))
  assert.equal(leo.differs, true)
  assert.equal(leo.cells[1].win, true)
  assert.ok(all.insights.some((i) => i.key === 'reusable' && /可复用/.test(i.text)))
  assert.ok(all.insights.some((i) => i.key === 'leo_capacity' && /LEO/.test(i.text)))
  assert.ok(all.diffCount >= 3)
})

test('只看差异时 sameCount 仍统计被藏起的相同项', () => {
  const a = { name: '猎鹰 9', cfg: falcon9() }
  const b = { name: '长征五号', cfg: Object.assign({}, longMarch5(), { max_stage: 2 }) }
  const all = compare.buildCompareTable([a, b], { onlyDiff: false })
  const diffOnly = compare.buildCompareTable([a, b], { onlyDiff: true })
  assert.ok(all.sameCount > 0)
  assert.equal(diffOnly.sameCount, all.sameCount)
  assert.equal(diffOnly.diffCount, all.diffCount)
  assert.ok(diffOnly.rows.length < all.rows.length)
})

test('三款比成本：最低/最高不说反', () => {
  const cheap = { name: '电子号', cfg: Object.assign({}, falcon9(), { id: 1, launch_cost: 6000000 }) }
  const mid = { name: '猎鹰 9', cfg: falcon9() }
  const pricey = { name: '长征五号', cfg: longMarch5() }
  const table = compare.buildCompareTable([cheap, mid, pricey], { onlyDiff: true })
  const cost = table.insights.find((i) => i.key === 'launch_cost')
  assert.ok(cost)
  assert.match(cost.text, /最低是 电子号/)
  assert.match(cost.text, /最高是 长征五号/)
  assert.doesNotMatch(cost.text, /最高是 电子号/)
})

test('resolveConfig：字符串 / 数字 / id 字段都能命中', () => {
  const cfg = falcon9()
  const map = { 164: cfg }
  assert.equal(compare.resolveConfig(map, '164'), cfg)
  assert.equal(compare.resolveConfig(map, 164), cfg)
  assert.equal(compare.resolveConfig({ other: cfg }, '164'), cfg)
  assert.equal(compare.resolveConfig({}, '164'), null)
  assert.deepEqual(compare.idsMissingFromArchive(['164', '491', '164'], map), ['491'])
  assert.deepEqual(compare.idsMissingFromArchive(['164'], map), [])
  assert.equal(compare.catalogLooksIncomplete({ 164: cfg }), true)
  const many = {}
  for (let i = 0; i < compare.CATALOG_FULL_MIN_COUNT; i++) many[String(i)] = { id: i }
  assert.equal(compare.catalogLooksIncomplete(many), false)
  const merged = compare.mergeConfigMaps({ 164: cfg }, { 491: { id: 491, name: 'Spectrum' } })
  assert.equal(merged['164'].name, 'Falcon 9')
  assert.equal(merged['491'].name, 'Spectrum')
})

test('选型搜索只本地截断，已选始终可见', () => {
  const cards = []
  for (let i = 0; i < 80; i++) {
    cards.push({
      configId: i,
      name: '型号' + i,
      fullName: '型号' + i,
      reusable: i < 50,
      searchText: '型号' + i + '|model' + i,
      manufacturerDisplay: '厂商' + i,
      statText: '发射 ' + i
    })
  }
  const idle = compare.buildPickerView(cards, '', [])
  assert.equal(idle.shown, compare.PICKER_IDLE_LIMIT)
  assert.equal(idle.total, 80)
  assert.equal(idle.truncated, true)
  assert.ok(idle.groups.every((g) => (g.items || []).every((item) => item.fullName && item.configId != null)))

  const picked = compare.buildPickerView(cards, '', [{ configId: 70, name: '型号70' }])
  const pickedIds = picked.groups.reduce((acc, g) => acc.concat((g.items || []).map((i) => i.configId)), [])
  assert.ok(pickedIds.indexOf(70) >= 0)

  const searched = compare.buildPickerView(cards, 'model79', [])
  assert.equal(searched.total, 1)
  assert.equal(searched.truncated, false)
  assert.equal(searched.groups[0].items[0].configId, 79)
})

test('只选一款时不出差异摘要', () => {
  const table = compare.buildCompareTable([{ name: '猎鹰 9', cfg: falcon9() }])
  assert.equal(table.insights.length, 0)
  assert.ok(table.rows.length > 0)
})

test('PK 条形图：更大值更长，分区胜出不双赢', () => {
  const a = { name: '猎鹰 9', cfg: falcon9(), manufacturerDisplay: 'SpaceX' }
  const b = { name: '长征五号', cfg: longMarch5(), manufacturerDisplay: '中国航天科技集团' }
  const pk = compare.buildPkView(a, b)
  assert.equal(pk.left.name, '猎鹰 9')
  assert.equal(pk.right.name, '长征五号')
  const size = pk.sections.find((s) => s.id === 'size')
  const length = size.rows.find((r) => r.key === 'length')
  assert.ok(length.leftPct > length.rightPct)
  assert.equal(length.leftWin, true)
  const power = pk.sections.find((s) => s.id === 'power')
  assert.ok(power.winner === 'left' || power.winner === 'right' || power.winner === '')
  const leo = power.rows.find((r) => r.key === 'leo_capacity')
  assert.equal(leo.rightWin, true)
  assert.equal(length.leftWeak, false)
  assert.equal(length.rightWeak, true)
  assert.equal(leo.leftWeak, true)
  assert.equal(leo.rightWeak, false)
  const sizeKeys = size.rows.map((r) => r.key)
  assert.ok(sizeKeys.indexOf('max_stage') >= 0)
  const record = pk.sections.find((s) => s.id === 'record')
  const recordKeys = record.rows.map((r) => r.key)
  ;['successful_launches', 'attempted_landings', 'successful_landings', 'consecutive_successful_landings'].forEach((key) => {
    assert.ok(recordKeys.indexOf(key) >= 0, '战绩缺 ' + key)
  })
  const spec = compare.buildSpecGroups([a, b], { onlyDiff: false })
  const specKeys = spec.groups.reduce((acc, g) => acc.concat(g.rows.map((r) => r.key)), [])
  assert.ok(specKeys.indexOf('failed_launches') >= 0)
  assert.ok(specKeys.indexOf('pending_launches') >= 0)
  assert.ok(specKeys.indexOf('attempted_landings') >= 0)
  assert.ok(pk.overview.some((r) => r.key === 'gto_capacity'))
  assert.ok(pk.overview.some((r) => r.key === 'to_thrust'))
  assert.ok(spec.groups.some((g) => g.id === 'size' && g.rows.length))
  const groups = compare.groupPickerCards([
    { configId: 1, picked: true, reusable: true, fullName: 'A' },
    { configId: 2, picked: false, reusable: false, fullName: 'B' }
  ])
  assert.equal(groups[0].id, 'picked')
  assert.ok(groups.some((g) => g.id === 'expendable'))
  const bars = compare.barPercents(70, 35)
  assert.equal(bars.left, 100)
  assert.equal(bars.right, 50)
})

test('一侧暂无数据：不打分、不胜出、条形图不假胜利', () => {
  const emptyBars = compare.barPercents(22800, null)
  assert.equal(emptyBars.empty, true)
  assert.equal(emptyBars.left, 0)
  assert.equal(emptyBars.right, 0)
  assert.deepEqual(compare.barPercents('', 8300), { left: 0, right: 0, empty: true })

  const left = {
    name: '猎鹰 9',
    cfg: falcon9()
  }
  const right = {
    name: '朱雀三号',
    cfg: Object.assign({}, falcon9(), {
      id: 888,
      name: 'Zhuque-3',
      launch_cost: null,
      gto_capacity: null,
      total_launch_count: 2,
      successful_launches: 2
    })
  }
  const pk = compare.buildPkView(left, right)
  const cost = pk.overview.find((r) => r.key === 'launch_cost')
  assert.ok(cost)
  assert.equal(cost.rightText, '暂无')
  assert.equal(cost.rightEmpty, true)
  assert.equal(cost.leftWin, false)
  assert.equal(cost.rightWin, false)

  const power = pk.sections.find((s) => s.id === 'power')
  const gto = power.rows.find((r) => r.key === 'gto_capacity')
  assert.ok(gto)
  assert.equal(gto.rightEmpty, true)
  assert.equal(gto.leftWin, false)
  assert.equal(gto.rightWin, false)
  assert.equal(gto.leftPct, 0)
  assert.equal(gto.rightPct, 0)
  assert.notEqual(power.winner, 'left')
})

test('PK 槽带出配置图 URL，空槽不带图', () => {
  const left = { name: '猎鹰 9', imageUrl: 'https://cdn.example/falcon9.jpg', cfg: falcon9() }
  const right = { name: '长征五号', imageUrl: 'https://cdn.example/cz5.jpg', cfg: longMarch5() }
  const view = compare.buildPkView(left, right)
  assert.equal(view.left.imageUrl, 'https://cdn.example/falcon9.jpg')
  assert.equal(view.right.imageUrl, 'https://cdn.example/cz5.jpg')
  assert.equal(view.left.empty, false)
  const half = compare.buildPkView(left, null)
  assert.equal(half.right.empty, true)
  assert.equal(half.right.imageUrl, '')
})

test('分享标题用 vs 拼接', () => {
  assert.match(
    compare.buildShareTitle([{ name: '猎鹰 9' }, { name: '长征五号' }]),
    /猎鹰 9 vs 长征五号/
  )
  assert.equal(compare.buildShareTitle([{ name: '猎鹰 9' }]), '猎鹰 9 · 对比其他型号')
  assert.equal(compare.joinCompareIds(['164', '215']), '164,215')
  assert.equal(compare.buildShareQuery(['164', '215']), 'ids=' + encodeURIComponent('164,215'))
  assert.deepEqual(
    compare.parseCompareIds({ ids: decodeURIComponent(compare.buildShareQuery(['164', '215']).slice(4)) }),
    ['164', '215']
  )
  assert.deepEqual(
    compare.resolveShareIds([], ['164', '215'], false),
    ['164', '215']
  )
  assert.deepEqual(compare.resolveShareIds([], ['164', '215'], true), [])
  assert.deepEqual(
    compare.resolveShareIds([{ configId: 888 }], ['164', '215'], false),
    ['888']
  )
})

test('对比页落在 monitor-pages 分包，主包 pages 不含该功能', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const pkg = (appJson.subPackages || []).find((p) => p.name === 'monitor-pages')
  assert.ok(pkg, '缺少 monitor-pages 分包')
  assert.ok(pkg.pages.indexOf('rocket-compare') >= 0, '分包未注册 rocket-compare')
  assert.ok((appJson.pages || []).every((p) => p.indexOf('rocket-compare') < 0), '对比页写进了主包 pages')
  const pageJs = path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.js')
  const utilJs = path.join(ROOT, 'subpackages/monitor-pages/utils/rocket-compare.js')
  assert.equal(fs.existsSync(pageJs), true)
  assert.equal(fs.existsSync(utilJs), true)
  assert.equal(fs.existsSync(path.join(ROOT, 'pages/rocket-compare/rocket-compare.js')), false)
  const routes = fs.readFileSync(path.join(ROOT, 'utils/routes.js'), 'utf8')
  assert.match(routes, /ROCKET_COMPARE:\s*'\/subpackages\/monitor-pages\/rocket-compare'/)
  const modelJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.js'), 'utf8')
  const modelWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.wxml'), 'utf8')
  const modelWxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.wxss'), 'utf8')
  assert.match(modelJs, /onTapRocketCompare/)
  assert.match(modelJs, /openRocketCompare/)
  assert.match(modelJs, /ensureShareImageHttpUrl/)
  assert.match(modelJs, /pickRocketModelShareImageUrl/)
  assert.match(modelWxml, /mission-pk-fab/)
  assert.match(modelWxml, /onTapRocketCompare/)
  assert.match(modelWxml, /ic-pk\.svg/)
  assert.doesNotMatch(modelWxml, /对比其他型号/)
  assert.doesNotMatch(modelJs, /\bonTapCompare\b/)
  const modelFab = modelWxss.match(/\.mission-pk-fab\s*\{[^}]+\}/)
  assert.ok(modelFab, '型号详情缺少 .mission-pk-fab')
  assert.match(modelFab[0], /backdrop-filter/)
  assert.match(modelFab[0], /--bg-glass/)
  const geneJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/booster-genealogy.js'), 'utf8')
  const geneWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/booster-genealogy.wxml'), 'utf8')
  const geneWxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/booster-genealogy.wxss'), 'utf8')
  assert.match(geneJs, /onTapRocketCompare/)
  assert.match(geneJs, /openRocketCompare/)
  assert.match(geneWxml, /mission-pk-fab/)
  assert.match(geneWxml, /onTapRocketCompare/)
  assert.match(geneWxml, /ic-pk\.svg/)
  assert.doesNotMatch(geneWxml, /对比型号/)
  assert.doesNotMatch(geneJs, /\bonTapCompare\b/)
  const geneFab = geneWxss.match(/\.mission-pk-fab\s*\{[^}]+\}/)
  assert.ok(geneFab, '族谱列表缺少 .mission-pk-fab')
  assert.match(geneFab[0], /backdrop-filter/)
  assert.match(geneFab[0], /--bg-glass/)
  const missionJs = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/mission-detail.js'), 'utf8')
  const missionWxml = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/mission-detail.wxml'), 'utf8')
  const boosterNav = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/utils/booster-nav.js'), 'utf8')
  assert.match(missionJs, /onTapRocketCompare/)
  assert.match(missionWxml, /mission-pk-fab/)
  assert.match(missionWxml, /onTapRocketCompare/)
  assert.match(missionWxml, /ic-pk\.svg/)
  assert.doesNotMatch(missionWxml, /mission-pk-fab-lab/)
  assert.doesNotMatch(missionWxml, />PK</)
  assert.match(boosterNav, /openRocketCompare/)
  const compareWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  assert.match(compareWxml, /综合/)
  assert.match(compareWxml, /参数/)
  assert.match(compareWxml, /PK/)
  assert.match(compareWxml, /更换/)
  assert.match(compareWxml, /开始对比/)
  assert.match(compareWxml, /外形对比/)
  assert.match(compareWxml, /对比结果仅供娱乐参考，不具备任何意义/)
  assert.match(compareWxml, /class="bar-duel"/)
  assert.match(compareWxml, /class="bar-pair"/)
  assert.match(compareWxml, /bar-fill--weak/)
  assert.doesNotMatch(compareWxml, /class="bar-mid"/)
  assert.equal((compareWxml.match(/class="top-nav-wrapper"/g) || []).length, 1, '选型不应再挂第二根顶栏')
  assert.doesNotMatch(compareWxml, /top-nav-wrapper" wx:if/)
})

test('对比页与型号详情共用同一套详情骨架', () => {
  const compareWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  const modelWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.wxml'), 'utf8')
  const boosterWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/booster-detail.wxml'), 'utf8')
  ;[compareWxml, modelWxml, boosterWxml].forEach((wxml) => {
    assert.match(wxml, /class="top-nav-wrapper"/)
    assert.match(wxml, /page-progress/)
    assert.match(wxml, /class="detail-scroll"/)
    assert.match(wxml, /detail-skeleton detail-skeleton--pad/)
    assert.match(wxml, /skeleton-card-body/)
    assert.match(wxml, /skeleton-line--title/)
    assert.match(wxml, /skeleton-line--sub/)
    assert.match(wxml, /skeleton-line--label/)
    assert.match(wxml, /skeleton-line--short/)
    assert.match(wxml, /class="hero-float"/)
    assert.match(wxml, /hero-float-card/)
    assert.match(wxml, /glass-card/)
  })
  const compareWxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxss'), 'utf8')
  assert.doesNotMatch(compareWxss, /@keyframes shimmer/, '对比页不应覆盖全局骨架动画')
  assert.doesNotMatch(compareWxss, /#FFD60A|#FF9F0A|#FFB340/, '对比页不应再使用黄色主题')
  assert.match(compareWxss, /picker-fab/)
  assert.match(compareWxml, /picker-fab/)
  assert.match(compareWxss, /\.nav-tab--on::after\s*\{[^}]*width:\s*44rpx/)
  assert.match(compareWxss, /\.nav-tab--on::after\s*\{[^}]*height:\s*6rpx/)
  assert.match(compareWxss, /\.nav-tab--on::after\s*\{[^}]*var\(--color-brand/)
  assert.match(compareWxss, /#07C160/)
  assert.doesNotMatch(compareWxss, /#FF453A/)
  assert.match(compareWxss, /var\(--color-brand, #3B82F6\)/)
  assert.doesNotMatch(compareWxss, /#1D4ED8|#1E3A8A/)
  assert.match(compareWxss, /\.picker-fab\s*\{[^}]*position:\s*fixed/)
  assert.match(compareWxss, /\.pk-change\s*\{[^}]*margin-top:\s*auto/)
})

test('对比页 wxml 绑定在页面或 page-base 中都有处理器', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.js'), 'utf8')
  const base = fs.readFileSync(path.join(ROOT, 'utils/page-base.js'), 'utf8')
  const handlers = new Set()
  const re = /\b(?:bind|catch)[:]?[A-Za-z]+="([A-Za-z_$][\w$]*)"/g
  let m
  while ((m = re.exec(wxml))) handlers.add(m[1])
  assert.ok(handlers.size >= 8, '绑定过少: ' + [...handlers].join(','))
  for (const name of handlers) {
    const inPage = new RegExp(name + '\\s*\\(').test(js)
    const inBase = new RegExp(name + '\\s*\\(').test(base)
    assert.ok(inPage || inBase, '缺少处理器 ' + name)
  }
})

test('选型入口返回离开对比页，结果页浮层返回只关列表', () => {
  assert.equal(compare.isPickerEntry([]), true)
  assert.equal(compare.isPickerEntry(['164']), true)
  assert.equal(compare.isPickerEntry(['164', '215']), false)
  assert.equal(compare.shouldClosePickerOnBack({ pickerOpen: true, pickerFromResult: false }), false)
  assert.equal(compare.shouldClosePickerOnBack({ pickerOpen: true, pickerFromResult: true }), true)
  assert.equal(compare.shouldClosePickerOnBack({ pickerOpen: false, pickerFromResult: true }), false)
  assert.equal(compare.shouldClosePickerOnBack({}), false)
  assert.equal(compare.shouldReturnToPickerOnBack({ pickerOpen: false, selected: [{}, {}] }), true)
  assert.equal(compare.shouldReturnToPickerOnBack({ pickerOpen: true, selected: [{}, {}] }), false)
  assert.equal(compare.shouldReturnToPickerOnBack({ pickerOpen: false, selected: [{}] }), false)
  assert.equal(compare.shouldReturnToPickerOnBack({}), false)

  const js = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.js'), 'utf8')
  assert.match(js, /isPickerEntry\(this\._pendingIds\)/)
  assert.match(js, /shouldClosePickerOnBack\(this\.data\)/)
  assert.match(js, /shouldReturnToPickerOnBack/)
  assert.match(js, /pickerFromResult:\s*false/)
  assert.match(js, /pickerFromResult:\s*true/)
  assert.doesNotMatch(js, /if \(\(this\.data\.selected \|\| \[\]\)\.length > 0 \|\| this\.data\.pickerMode === 'replace'\)/)

  const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  assert.match(wxml, /暂无型号/)

  const modelJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.js'), 'utf8')
  assert.match(modelJs, /openRocketCompare\(model\.configId\)/)
})

test('型号/助推器/对比详情页浅色主题走 page-meta 与 token 反色', () => {
  const pages = [
    'subpackages/monitor-pages/rocket-model-detail',
    'subpackages/monitor-pages/booster-detail',
    'subpackages/monitor-pages/rocket-compare'
  ]
  pages.forEach((rel) => {
    const wxml = fs.readFileSync(path.join(ROOT, rel + '.wxml'), 'utf8')
    const wxss = fs.readFileSync(path.join(ROOT, rel + '.wxss'), 'utf8')
    assert.match(wxml, /<page-meta background-color="\{\{pageBgColor\}\}"/)
    assert.doesNotMatch(wxss, /page\s*\{\s*background:\s*#0B0C0E/)
    assert.doesNotMatch(wxss, /page\s*\{\s*background:\s*#0B0C0E;\s*color:\s*#fff/)
    assert.match(wxss, /\.container\s*\{[\s\S]*?color:\s*var\(--color-text-primary\)/)
    assert.match(wxss, /\.theme-light \.glass-card/)
  })
  const modelWxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.wxss'), 'utf8')
  assert.match(modelWxss, /\.theme-light \.recovery-icon\s*\{\s*filter:\s*invert/)
  assert.match(modelWxss, /color:\s*var\(--color-text-primary\)/)
})

test('外形对比图撑满框，PK 徽章夹在两卡中间且不叠卡片', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxss'), 'utf8')
  const js = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.js'), 'utf8')
  assert.match(wxml, /class="pk-thumb"/)
  assert.match(wxml, /pk-left\.imageUrl|pk\.left\.imageUrl/)
  const photoStart = wxml.indexOf("mainTab === 'overview' && subTab === 'photo'")
  const photoEnd = wxml.indexOf("mainTab === 'overview' && subTab === 'record'")
  assert.ok(photoStart >= 0 && photoEnd > photoStart)
  const photoBlock = wxml.slice(photoStart, photoEnd)
  assert.match(photoBlock, /mode="aspectFill"/)
  assert.doesNotMatch(photoBlock, /mode="aspectFit"/)
  assert.match(photoBlock, /pk\.slots/)
  assert.equal((wxml.match(/class="pk-badge"/g) || []).length, 1)
  assert.match(wxml, /pk-badge[\s\S]*ic-pk\.svg/)
  const badgeBlock = wxss.match(/\.pk-badge\s*\{[^}]+\}/)
  assert.ok(badgeBlock, '缺少 .pk-badge')
  assert.doesNotMatch(badgeBlock[0], /position:\s*absolute/)
  assert.match(badgeBlock[0], /flex-shrink:\s*0/)
  assert.match(badgeBlock[0], /align-self:\s*center/)
  assert.match(wxss, /\.pk-head\s*\{[^}]*display:\s*flex/)
  assert.match(js, /onSlotImageError\s*\(/)
})

test('胜出徽章：左胜在左且微信绿，右胜在右且蓝色', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxss'), 'utf8')
  const leftSvg = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/images/ic-win-left.svg'), 'utf8')
  const rightSvg = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/images/ic-win-right.svg'), 'utf8')
  assert.match(wxml, /win-stamp--\{\{sec\.winner\}\}/)
  assert.match(wxml, /ic-win-\{\{sec\.winner\}\}\.svg/)
  assert.doesNotMatch(wxml, />胜出</)
  assert.match(wxss, /\.win-stamp--left\s*\{[^}]*left:\s*0/)
  assert.match(wxss, /\.win-stamp--right\s*\{[^}]*right:\s*0/)
  assert.match(leftSvg, /#07C160/)
  assert.match(rightSvg, /#3B82F6/)
  assert.doesNotMatch(leftSvg, /#3B82F6|#FF453A/)
  assert.doesNotMatch(rightSvg, /#FF453A|#07C160/)
  assert.match(wxss, /\.bar-duel\s*\{[^}]*display:\s*flex/)
  assert.match(wxss, /\.bar-pair\s*\{[^}]*display:\s*flex/)
  assert.match(wxss, /\.bar-fill--weak\s*\{[^}]*opacity:\s*0\.5/)
  assert.match(wxss, /\.bar-num--weak\s*\{[^}]*opacity:\s*0\.5/)

  const a = { name: '猎鹰 9', cfg: falcon9() }
  const b = { name: '长征五号', cfg: longMarch5() }
  const pk = compare.buildPkView(a, b)
  const size = pk.sections.find((s) => s.id === 'size')
  assert.ok(size.winner === 'left' || size.winner === 'right')
  const power = pk.sections.find((s) => s.id === 'power')
  assert.ok(power.winner === 'left' || power.winner === 'right' || power.winner === '')
})

test('PK 条形图有生长动效，门控用 rocket_compare 且允许看广告', () => {
  assert.equal(compare.GATE_PRODUCT_ID, 'rocket_compare')
  assert.equal(compare.GATE_PRODUCT_NAME, '火箭型号对比')
  const pageJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxss'), 'utf8')
  const monitorNav = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/utils/booster-nav.js'), 'utf8')
  const missionNav = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/utils/booster-nav.js'), 'utf8')
  assert.match(pageJs, /gateCheck\(GATE_PRODUCT_ID, GATE_PRODUCT_NAME\)/)
  assert.match(pageJs, /ensureCompareAccess/)
  assert.match(pageJs, /onShareAppMessage/)
  assert.match(pageJs, /onShareTimeline/)
  assert.match(pageJs, /ensureShareImageHttpUrl/)
  assert.match(pageJs, /_syncShareImage/)
  assert.match(pageJs, /pickRocketModelShareImageUrl/)
  assert.match(pageJs, /withShareStampPath/)
  assert.match(pageJs, /\/subpackages\/monitor-pages\/rocket-compare/)
  assert.match(pageJs, /onRetryLoad[\s\S]{0,180}ensureCompareAccess/)
  assert.doesNotMatch(pageJs, /path:\s*['"]\/pages\/monitor\/monitor['"]/)
  assert.match(pageJs, /_playBarAnim/)
  assert.match(pageJs, /barAnimOn:\s*true/)
  assert.doesNotMatch(pageJs, /allowAd:\s*false/)
  assert.match(wxml, /bar-fill--run/)
  assert.match(wxml, /animation-delay/)
  assert.match(wxss, /@keyframes pk-bar-grow/)
  assert.match(wxss, /\.bar-fill--run\s*\{[^}]*pk-bar-grow/)
  assert.match(wxss, /transform:\s*scaleX\(0\)/)
  ;[monitorNav, missionNav].forEach((src) => {
    const fn = src.slice(src.indexOf('function openRocketCompare'))
    assert.match(fn, /gateCheck\('rocket_compare',\s*'火箭型号对比'\)/)
    assert.doesNotMatch(fn.slice(0, 500), /booster_genealogy/)
  })
})

test('任务详情 PK 用无底框字标且胶囊磨砂，选型底栏贴底', () => {
  const missionWxml = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/mission-detail.wxml'), 'utf8')
  const missionWxss = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/mission-detail.wxss'), 'utf8')
  const mark = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/images/ic-pk.svg'), 'utf8')
  assert.match(missionWxml, /ic-pk\.svg/)
  assert.doesNotMatch(missionWxml, /mission-pk-fab-lab/)
  assert.doesNotMatch(mark, /opacity="\.6"/)
  assert.doesNotMatch(mark, /fill="#000000"/)
  const fab = missionWxss.match(/\.mission-pk-fab\s*\{[^}]+\}/)
  assert.ok(fab, '缺少 .mission-pk-fab')
  assert.match(fab[0], /backdrop-filter/)
  assert.match(fab[0], /--bg-glass/)

  const compareWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  assert.match(compareWxml, /padding-bottom: calc\(16px \+ env\(safe-area-inset-bottom\)\)/)
  assert.doesNotMatch(compareWxml, /picker-fab[\s\S]*tabBarReservedHeight/)
})

test('选 4 款时综合 PK 用全部型号，不再只打头两款', () => {
  const a = { name: '猎鹰 9', cfg: falcon9(), manufacturerDisplay: 'SpaceX' }
  const b = { name: '长征五号', cfg: longMarch5(), manufacturerDisplay: '中国航天科技集团' }
  const c = {
    name: '电子号',
    cfg: Object.assign({}, falcon9(), { id: 1, name: 'Electron', leo_capacity: 300, launch_cost: 6000000 }),
    manufacturerDisplay: 'Rocket Lab'
  }
  const d = {
    name: '朱雀三号',
    cfg: Object.assign({}, falcon9(), { id: 888, name: 'Zhuque-3', leo_capacity: 18000, launch_cost: 45000000 }),
    manufacturerDisplay: '蓝箭航天'
  }
  const pk = compare.buildPkView([a, b, c, d])
  assert.equal(pk.pair, false)
  assert.equal(pk.slots.length, 4)
  assert.deepEqual(pk.slots.map((s) => s.name), ['猎鹰 9', '长征五号', '电子号', '朱雀三号'])
  assert.deepEqual(compare.SLOT_TONES, ['orange', 'blue', 'amber', 'purple'])
  assert.deepEqual(pk.slots.map((s) => s.tone), compare.SLOT_TONES)
  pk.overview.forEach((row) => {
    assert.equal(row.values.length, 4, row.key + ' 综合项未铺满 4 款')
  })
  const leo = pk.sections.find((s) => s.id === 'power').rows.find((r) => r.key === 'leo_capacity')
  assert.equal(leo.values.length, 4)
  assert.ok(leo.values.some((v) => v.text.indexOf('25,000') >= 0))
  assert.ok(leo.values.some((v) => v.text.indexOf('300') >= 0))
  assert.equal(pk.sections[0].winner, '')

  const pair = compare.buildPkView(a, b)
  assert.equal(pair.pair, true)
  assert.equal(pair.slots.length, 2)

  const pageJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxss'), 'utf8')
  assert.match(pageJs, /buildPkView\(selected\)/)
  assert.doesNotMatch(pageJs, /buildPkView\(selected\[0\]/)
  assert.match(pageJs, /ll2RocketConfigDetail/)
  assert.doesNotMatch(pageJs, /ll2RocketConfigList/)
  assert.doesNotMatch(pageJs, /enrichCatalogFromLl2/)
  assert.match(pageJs, /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/)
  assert.match(pageJs, /fillMissingConfigs/)
  assert.match(pageJs, /buildPickerView/)
  assert.match(pageJs, /pickerViewPatch/)

  const galleries = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/utils/monitor-galleries.js'), 'utf8')
  assert.doesNotMatch(galleries, /getRocketConfigMeta/)

  const geneJs2 = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/booster-genealogy.js'), 'utf8')
  const geneWxml2 = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/booster-genealogy.wxml'), 'utf8')
  const geneJson2 = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/booster-genealogy.json'), 'utf8')
  assert.match(geneJs2, /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/)
  assert.match(geneJs2, /m\.reusable === true/)
  assert.match(geneJs2, /ensureCatalogAccess/)
  assert.match(geneJs2, /checkShareEntryGate\(this,\s*options,\s*'booster_genealogy'/)
  assert.match(geneJs2, /gateCheck\('booster_genealogy',\s*'全球可回收火箭族谱'\)/)
  assert.match(geneJs2, /if\s*\(\s*!this\._catalogAllowed\s*\)\s*return/)
  assert.match(geneJs2, /withShareStampPath/)
  assert.match(geneJs2, /withShareStampQuery/)
  const accessIdx = geneJs2.indexOf('async ensureCatalogAccess')
  const loadIdx = geneJs2.indexOf('async loadData')
  const guardIdx = geneJs2.indexOf('if (!this._catalogAllowed) return')
  const metaIdx = geneJs2.indexOf('getRocketConfigMeta({ afterGate: true })')
  assert.ok(accessIdx >= 0 && accessIdx < loadIdx, '族谱须先 ensureCatalogAccess 再 loadData')
  assert.ok(guardIdx > loadIdx && guardIdx < metaIdx, '族谱须先过门控再拉 _config_meta')
  assert.match(geneWxml2, /share-gate-countdown/)
  assert.match(geneJson2, /share-gate-countdown/)
  assert.match(pageJs, /idsMissingFromArchive\([^)]+\)\.slice\(0,\s*MAX_COMPARE\)/)

  const services = fs.readFileSync(path.join(ROOT, 'utils/api-app-services.js'), 'utf8')
  assert.match(services, /afterGate/)
  assert.match(services, /canUsePaidCloudSync/)

  const compareWxml2 = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-compare.wxml'), 'utf8')
  assert.match(compareWxml2, /pickerTruncated/)
  assert.match(compareWxml2, /搜索型号或发射商查看更多/)

  const apiProxy = fs.readFileSync(path.join(ROOT, 'cloudfunctions/apiProxy/index.js'), 'utf8')
  assert.match(apiProxy, /is_placeholder=false/)

  const syncJs = fs.readFileSync(path.join(ROOT, 'cloudfunctions/syncSpaceDevsData/_legacy.js'), 'utf8')
  assert.match(syncJs, /config-meta-catalog/)
  assert.doesNotMatch(syncJs, /reusable=true&is_placeholder/)

  const agencyJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/agency-detail.js'), 'utf8')
  assert.match(agencyJs, /hasDetail:\s*entry\.id != null/)
  assert.match(agencyJs, /archiveId:\s*entry\.id != null \? entry\.id : null/)
  assert.match(wxml, /pk\.pair/)
  assert.match(wxml, /pk\.slots/)
  assert.match(wxml, /class="fact-multi/)
  assert.match(wxml, /class="bar-stack"/)
  assert.match(wxml, /class="pk-head--multi"|pk-head--multi/)
  assert.match(wxss, /\.pk-head--multi/)
  assert.match(wxss, /\.bar-stack/)
  assert.match(wxss, /\.bar-fill--amber/)
  assert.match(wxss, /\.bar-fill--purple/)
})

test('对比页 JS 语法通过 node --check', () => {
  const { spawnSync } = require('node:child_process')
  ;[
    'subpackages/monitor-pages/utils/rocket-compare.js',
    'subpackages/monitor-pages/rocket-compare.js'
  ].forEach((rel) => {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
    assert.equal(r.status, 0, rel + ' 语法错误:\n' + (r.stderr || r.stdout))
  })
})
