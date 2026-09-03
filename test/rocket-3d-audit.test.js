/**
 * 火箭 3D 全链路审计：语法、模块加载、空输入不炸、展陈逻辑走通。
 * node --test test/rocket-3d-audit.test.js
 */
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.join(__dirname, '..')

function installMiniProgramStubs() {
  if (global.wx && global.Page && global.Component && global.Behavior) {
    if (!global.wx.env) global.wx.env = { USER_DATA_PATH: '/tmp' }
    return
  }
  global.wx = {
    env: { USER_DATA_PATH: '/tmp' },
    showShareMenu() {},
    showToast() {},
    navigateTo() {},
    vibrateShort() {},
    getStorageSync() { return '' },
    getStorage({ fail }) { if (fail) fail() },
    setStorage() {},
    getWindowInfo() { return { pixelRatio: 2, windowWidth: 375, windowHeight: 812 } },
    getDeviceInfo() { return { system: 'iOS' } },
    getAppBaseInfo() { return { theme: 'dark' } },
    getSystemInfoSync() { return { pixelRatio: 2, windowWidth: 375, windowHeight: 812, theme: 'dark' } },
    getMenuButtonBoundingClientRect() {
      return { width: 87, height: 32, top: 48, right: 368, bottom: 80, left: 281 }
    },
    createSelectorQuery() {
      return {
        in() { return this },
        select() { return this },
        boundingClientRect() { return this },
        exec(cb) { cb([{ width: 375, height: 700 }]) }
      }
    }
  }
  global.getApp = function () {
    return { globalData: {} }
  }
  global.getCurrentPages = function () {
    return []
  }
  global.Behavior = function (def) {
    return def
  }
  global.Page = function (def) {
    global.__lastPage = def
    if (def && typeof def.onViewerStatus === 'function') global.__r3dViewerPage = def
    if (def && typeof def.onTapRocket3d === 'function' && def.onHeroImageTap) {
      global.__r3dModelPage = def
    }
    return def
  }
  global.Component = function (def) {
    global.__r3dViewerComp = def
    return def
  }
}

const JS_FILES = [
  'subpackages/rocket-3d/exhibit.js',
  'subpackages/rocket-3d/models.js',
  'subpackages/rocket-3d/runtime.js',
  'subpackages/rocket-3d/share.js',
  'subpackages/rocket-3d/share-gate.js',
  'subpackages/rocket-3d/stand-flip-pref.js',
  'subpackages/rocket-3d/viewer.js',
  'subpackages/rocket-3d/components/rocket-3d-viewer/index.js',
  'utils/rocket-3d-ready.js',
  'utils/rocket-3d-slug.js',
  'subpackages/monitor-pages/utils/rocket-3d-bind.js',
  'pages/mission-detail/utils/rocket-3d-gate.js',
  'subpackages/monitor-pages/rocket-model-detail.js'
]

test('3D 分包 JS 全部通过 node --check', () => {
  const { spawnSync } = require('node:child_process')
  for (const rel of JS_FILES) {
    const file = path.join(ROOT, rel)
    assert.equal(fs.existsSync(file), true, '缺少文件 ' + rel)
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    assert.equal(r.status, 0, rel + ' 语法错误:\n' + (r.stderr || r.stdout))
  }
  const three = path.join(ROOT, 'subpackages/rocket-3d/lib/three-wx.js')
  const r3 = spawnSync(process.execPath, ['--check', three], { encoding: 'utf8' })
  assert.equal(r3.status, 0, 'three-wx.js 语法错误:\n' + (r3.stderr || r3.stdout))
})

test('3D 页与组件 JSON / 绑定方法齐全', () => {
  const viewerJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/viewer.json'), 'utf8'))
  const compJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/components/rocket-3d-viewer/index.json'), 'utf8'))
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const pkg = (appJson.subPackages || appJson.subpackages || []).find((p) => p.name === 'rocket-3d')
  assert.ok(pkg, 'app.json 未注册 rocket-3d 分包')
  assert.deepEqual(pkg.pages, ['viewer'])
  assert.equal(viewerJson.usingComponents['rocket-3d-viewer'], './components/rocket-3d-viewer/index')
  assert.equal(compJson.component, true)

  const viewerJs = fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/viewer.js'), 'utf8')
  const pageBaseJs = fs.readFileSync(path.join(ROOT, 'utils/page-base.js'), 'utf8')
  const viewerWxml = fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/viewer.wxml'), 'utf8')
  const binds = ['goBack', 'toggleIntro', 'onExhibitTab', 'onRetryViewer', 'onViewerStatus', 'onFlipStand', 'onFlipChange']
  for (const name of binds) {
    assert.match(viewerWxml, new RegExp(name))
    const inPage = new RegExp(name + '\\s*:').test(viewerJs)
    const inBase = new RegExp(name + '\\s*\\(').test(pageBaseJs)
    assert.ok(inPage || inBase, 'wxml 绑定 ' + name + ' 在页面或 page-base 中找不到')
  }

  const compJs = fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/components/rocket-3d-viewer/index.js'), 'utf8')
  const compWxml = fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/components/rocket-3d-viewer/index.wxml'), 'utf8')
  const compBinds = ['onStageTap', 'onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel', 'onExpand', 'onFlipStand']
  for (const name of compBinds) {
    assert.match(compWxml, new RegExp(name))
    assert.match(compJs, new RegExp(name + '\\s*:'))
  }

  const modelJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.js'), 'utf8')
  const modelWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.wxml'), 'utf8')
  assert.match(modelWxml, /onTapRocket3d/)
  assert.match(modelWxml, /rocket3dEnabled/)
  assert.match(modelJs, /onTapRocket3d\s*\(/)
  assert.match(modelJs, /alignDedicatedRocket3d/)
  assert.match(modelJs, /rocket3dEnabled:\s*!!rocket3d\.aligned/)
  assert.match(viewerWxml, /bind:flipchange="onFlipChange"/)
  assert.match(viewerWxml, /翻转/)
  assert.match(compWxml, /翻转方向/)
})

test('页面与组件模块可加载，不抛 JS 错', () => {
  installMiniProgramStubs()
  assert.doesNotThrow(() => require('../subpackages/rocket-3d/viewer.js'))
  assert.doesNotThrow(() => require('../subpackages/rocket-3d/components/rocket-3d-viewer/index.js'))
  assert.doesNotThrow(() => require('../subpackages/monitor-pages/rocket-model-detail.js'))
  const page = global.__r3dViewerPage
  const modelPage = global.__r3dModelPage
  const comp = global.__r3dViewerComp
  assert.equal(typeof page.onLoad, 'function')
  assert.equal(typeof page.onExhibitTab, 'function')
  assert.equal(typeof page.onViewerStatus, 'function')
  assert.equal(typeof page._playExhibitView, 'function')
  assert.equal(typeof page.onFlipStand, 'function')
  assert.equal(typeof page.onFlipChange, 'function')
  assert.equal(typeof comp.methods.flipStand, 'function')
  assert.doesNotThrow(() => page.onFlipStand.call({
    selectComponent: function () { return null },
    setData: function () {},
    data: { standFlipped: false }
  }))
  assert.doesNotThrow(() => page.onFlipChange.call({
    data: { standFlipped: false },
    setData: function () {}
  }, { detail: { flipped: true } }))
  assert.equal(typeof modelPage.onTapRocket3d, 'function')
  assert.equal(typeof modelPage.processAndSetData, 'function')
  assert.equal(typeof comp.methods.startViewer, 'function')
  assert.equal(typeof comp.methods.playExhibitView, 'function')
  assert.equal(typeof comp.methods._teardown, 'function')
})

test('组件空会话方法全部早退，不抛错', () => {
  installMiniProgramStubs()
  require('../subpackages/rocket-3d/components/rocket-3d-viewer/index.js')
  const methods = global.__r3dViewerComp.methods
  const fake = {
    _session: null,
    _adapter: null,
    data: { started: false, loading: false, live: false, dimLabels: [] },
    properties: { rocketName: '', rocketNameEn: '', modelUrl: '', active: true, autoLoad: false, dimLength: '', dimDiameter: '' },
    setData() {},
    triggerEvent() {},
    _syncMeta: methods._syncMeta,
    _emitStatus: methods._emitStatus,
    _setDimLabels: methods._setDimLabels,
    _applyDimGuides: methods._applyDimGuides,
    _syncLoop: methods._syncLoop,
    _shouldRun: methods._shouldRun,
    flipStand: methods.flipStand
  }
  assert.doesNotThrow(() => methods.playExhibitView.call(fake, 'size'))
  assert.doesNotThrow(() => methods.flipStand.call(fake))
  assert.equal(methods.flipStand.call(fake), false)
  assert.doesNotThrow(() => methods.onFlipStand.call(fake))
  assert.doesNotThrow(() => methods._applyDimGuides.call(fake))
  assert.doesNotThrow(() => methods._syncLoop.call(fake))
  assert.doesNotThrow(() => methods._teardown.call(fake))
  assert.doesNotThrow(() => methods._teardown.call({
    _session: {
      renderer: {
        dispose() {
          throw new TypeError("Cannot read properties of null (reading 'cancelAnimationFrame')")
        },
        setAnimationLoop() {
          throw new TypeError("null is not an object (evaluating 'e.cancelAnimationFrame')")
        }
      },
      nativeCanvas: {
        cancelAnimationFrame() {
          throw new Error('dead canvas')
        }
      },
      raf: 1,
      running: true,
      scene: { remove() {}, traverse() {} }
    },
    _adapter: { dispose() {} },
    data: { dimLabels: [] },
    setData() {},
    _setDimLabels: methods._setDimLabels
  }))
  assert.doesNotThrow(() => methods._setDimLabels.call(fake, null))
  assert.doesNotThrow(() => methods.onTouchStart.call(fake, {}))
  assert.doesNotThrow(() => methods.onTouchMove.call(fake, {}))
  assert.doesNotThrow(() => methods.onTouchEnd.call(fake, {}))
  assert.doesNotThrow(() => methods.onTouchCancel.call(fake, {}))
})

test('runtime 空输入 API 全部绿灯', () => {
  const runtime = require('../subpackages/rocket-3d/runtime.js')
  assert.doesNotThrow(() => runtime.applyClearColor(null, true))
  assert.doesNotThrow(() => runtime.stopLoop(null))
  assert.doesNotThrow(() => runtime.startLoop(null))
  assert.doesNotThrow(() => runtime.startLoop({ running: false }))
  assert.doesNotThrow(() => runtime.disposeSession(null))
  assert.doesNotThrow(() => runtime.stopLoop({
    raf: 7,
    nativeCanvas: {
      cancelAnimationFrame() {
        throw new TypeError("Cannot read properties of null (reading 'cancelAnimationFrame')")
      }
    }
  }))
  assert.doesNotThrow(() => runtime.disposeSession({
    renderer: {
      dispose() {
        throw new TypeError("Cannot read properties of null (reading 'cancelAnimationFrame')")
      },
      setAnimationLoop() {
        throw new TypeError("null is not an object (evaluating 'e.cancelAnimationFrame')")
      }
    },
    controls: {
      dispose() {
        throw new Error('dom gone')
      }
    },
    scene: { remove() {}, traverse() {} },
    nativeCanvas: {
      cancelAnimationFrame() {
        throw new Error('dead canvas')
      }
    },
    raf: 3,
    running: true
  }))
  assert.doesNotThrow(() => runtime.setModel(null, {}))
  assert.doesNotThrow(() => runtime.setModel({ scene: {} }, null))
  assert.doesNotThrow(() => runtime.playExhibitView(null, 'size'))
  assert.doesNotThrow(() => runtime.playExhibitView({}, 'feat'))
  assert.doesNotThrow(() => runtime.setDimensionGuides(null, true, {}))
  assert.doesNotThrow(() => runtime.resizeSession(null, { width: 100, height: 100 }))
  assert.doesNotThrow(() => runtime.cancelExhibitTween(null))
  assert.doesNotThrow(() => runtime.wrapStandingModel(null, { Group: function () {} }))
  assert.equal(runtime.wrapStandingModel(null, { Group: function () {} }), null)
  assert.doesNotThrow(() => runtime.applyManualStandFlip(null, true))
  assert.doesNotThrow(() => runtime.toggleManualStandFlip(null))
  assert.equal(runtime.isStandFlipped(null), false)
  assert.equal(runtime.findStandGroup(null), null)
  assert.equal(runtime.prepareModel(null), null)
  assert.equal(runtime.exhibitStandRotation(null).x, 0)
  assert.equal(runtime.exhibitStandRotation(null).y, 0)
  assert.equal(runtime.exhibitStandRotation(null).z, 0)
  assert.equal(runtime.pickStandRotationFromSize(null).x, 0)
  assert.equal(runtime.autoStandRotation(null, {}).x, 0)
  assert.equal(runtime.isUprightExhibitSize(null), false)
  assert.equal(runtime.finalizeStandRotation(null, null).x, 0)
  assert.doesNotThrow(() => runtime.ensureDrawableModel(null, {}))
  assert.doesNotThrow(() => runtime.downgradeUint32Index(null, {}))
  assert.doesNotThrow(() => runtime.autoFixExhibitShading(null, null, {}))
  assert.equal(typeof runtime.isWxIOS(), 'boolean')
  assert.equal(runtime.isFragileTextureOnlyModel(null), false)
  assert.doesNotThrow(() => runtime.dropBrokenMaps(null))
  assert.ok(runtime.scoreStandSize({ x: 0, y: 0, z: 0 }) < 0)
  const mockThree = (function createBoxThree() {
    class Vector3 {
      constructor(x = 0, y = 0, z = 0) {
        this.x = x
        this.y = y
        this.z = z
      }
    }
    class Box3 {
      constructor() {
        this.min = new Vector3(Infinity, Infinity, Infinity)
        this.max = new Vector3(-Infinity, -Infinity, -Infinity)
      }
      isEmpty() {
        return this.min.x > this.max.x
      }
      setFromObject() {
        return this
      }
    }
    return { Box3, Vector3 }
  })()
  assert.doesNotThrow(() => runtime.getRenderableBox(null, mockThree))
  assert.equal(runtime.getRenderableBox(null, mockThree).isEmpty(), true)
  assert.doesNotThrow(() => runtime.getExhibitFrameBox(null, mockThree))
  assert.equal(runtime.getExhibitFrameBox(null, mockThree).isEmpty(), true)
})

test('逻辑走通：详情 → slug → 系列/专用 → 展陈开关', () => {
  const { ingestMediaMap } = require('../utils/rocket-3d-ready.js')
  const { resolveRocketModel } = require('../subpackages/rocket-3d/models.js')
  const { hasReadyRocketModel, resolveReadyModelUrl } = require('../pages/mission-detail/utils/rocket-3d-gate.js')
  const { buildExhibit, matchRocketConfig, configFromDetailSpecs } = require('../subpackages/rocket-3d/exhibit.js')
  const { exhibitStandRotation } = require('../subpackages/rocket-3d/runtime.js')

  ingestMediaMap({
    'models/rockets/long-march-series.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/long-march-series.glb',
    'models/rockets/long-march-5.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/long-march-5.glb',
    'models/rockets/falcon-9.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/falcon-9.glb',
    'models/rockets/falcon-heavy.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/falcon-heavy.glb',
    'models/rockets/starship.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/starship.glb'
  })
  try {
    const cz12a = resolveRocketModel({ rocketName: '长征十二号甲' })
    assert.equal(cz12a.series, true)
    assert.match(cz12a.url, /long-march-series\.glb/)
    assert.equal(hasReadyRocketModel({ rocketName: '长征十二号甲' }), true)
    const cz12aExhibit = buildExhibit(
      { length: 69, diameter: 3.8, launch_mass: 433, descriptionZh: '示意' },
      { rocketName: '长征十二号甲', series: cz12a.series }
    )
    assert.equal(cz12aExhibit.hasSize, false)
    assert.equal(cz12aExhibit.hasFeat, false)

    const cz5 = resolveRocketModel({ rocketName: '长征五号' })
    assert.equal(cz5.series, false)
    assert.match(cz5.url, /long-march-5\.glb/)
    const cz5Exhibit = buildExhibit(
      { length: 57, diameter: 5, launch_mass: 800, reusable: false, descriptionZh: '长征五号' },
      { rocketName: '长征五号', series: cz5.series }
    )
    assert.equal(cz5Exhibit.hasSize, true)
    assert.equal(cz5Exhibit.hasFeat, true)

    const f9 = resolveRocketModel({ rocketName: 'Falcon 9' })
    assert.equal(f9.series, false)
    assert.match(f9.url, /falcon-9\.glb/)

    const fh = resolveRocketModel({ rocketName: 'Falcon Heavy' })
    assert.equal(fh.series, false)
    const fhStand = exhibitStandRotation({ x: 52.5, y: 21.6, z: 296.8 })
    assert.ok(Math.abs(fhStand.x + Math.PI / 2) < 1e-6)
    const board = exhibitStandRotation({ x: 80, y: 55, z: 8 })
    assert.equal(board.x, 0)
    assert.ok(Math.abs(board.z + Math.PI / 2) < 1e-6)

    const missing = resolveRocketModel({ rocketName: '未知火箭xyz' })
    assert.equal(missing.source, 'none')
    assert.equal(missing.series, false)
    assert.equal(missing.url, '')

    const starshipSpecs = configFromDetailSpecs([
      { label: '长度', line: '124.4 米' },
      { label: '直径', line: '9 米' },
      { label: '发射质量', line: '5250 吨' }
    ])
    const starship = matchRocketConfig(
      {
        10: { id: 10, name: 'Starship', nameZh: '星舰', length: 50, launch_mass: 45 },
        11: { id: 11, name: 'Starship', nameZh: '星舰', length: 124.4, launch_mass: 5250, to_thrust: 80807 }
      },
      { rocketName: '星舰', rocketNameEn: 'Starship', detailSpecs: [
        { label: '长度', line: '124.4 米' },
        { label: '直径', line: '9 米' },
        { label: '发射质量', line: '5250 吨' }
      ] }
    )
    assert.equal(starship.length, 124.4)
    assert.equal(starship.launch_mass, 5250)
    assert.equal(starshipSpecs.length, 124.4)
    const starshipExhibit = buildExhibit(starship, { rocketName: '星舰' })
    assert.equal(starshipExhibit.length, '124.4 m')
    assert.equal(starshipExhibit.hasSize, true)

    assert.match(resolveReadyModelUrl({ rocketName: '猎鹰9号' }), /falcon-9\.glb/)
  } finally {
    ingestMediaMap({})
  }
})

test('three-wx 动画 stop 对空 context 有守卫', () => {
  const src = fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/lib/three-wx.js'), 'utf8')
  assert.equal(src.includes('stop:function(){r.cancelAnimationFrame(n),e=!1}'), false)
  assert.match(src, /stop:function\(\)\{try\{r&&typeof r\.cancelAnimationFrame=="function"/)
  assert.match(src, /typeof self!="undefined"&&self&&Tt\.setContext\(self\)/)
})

test('分享与分享门控纯函数不抛错', () => {
  installMiniProgramStubs()
  const { buildRocket3dShareOptions, buildRocket3dSharePath } = require('../subpackages/rocket-3d/share.js')
  const { parseShareStamp, withShareStampPath, withShareStampQuery, appendShareStamp } = require('../subpackages/rocket-3d/share-gate.js')
  assert.doesNotThrow(() => buildRocket3dShareOptions(null, 'app'))
  assert.doesNotThrow(() => buildRocket3dSharePath(null))
  assert.equal(parseShareStamp(null), 0)
  assert.equal(parseShareStamp({}), 0)
  const page = { _shareSst: 0, _shareEntitled: false }
  assert.doesNotThrow(() => appendShareStamp(page))
  assert.doesNotThrow(() => withShareStampPath('/subpackages/rocket-3d/viewer', page))
  assert.doesNotThrow(() => withShareStampQuery('', page))
})
