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
  const Module = require('node:module')
  if (Module.wrapper && Module.wrapper[0] && Module.wrapper[0].indexOf('require.async') < 0) {
    Module.wrapper[0] +=
      'if(typeof require.async!=="function")require.async=function(id){try{return Promise.resolve(require(id))}catch(e){return Promise.resolve({})}};'
  }
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
  'subpackages/rocket-3d/catalog.js',
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
  'utils/ip-scale-ref.js',
  'utils/ip-reference-ready.js',
  'subpackages/rocket-3d/ip-intro.js',
  'subpackages/rocket-3d/ip-fx.js',
  'subpackages/rocket-3d/ip-chat-3d.js',
  'subpackages/rocket-3d/ip-anim.js',
  'subpackages/rocket-3d/xingwen-exhibit-client.js',
  'subpackages/monitor-pages/utils/rocket-3d-bind.js',
  'pages/mission-detail/utils/rocket-3d-gate.js',
  'utils/rocket-3d-list-flag.js',
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
  const binds = ['onNavBack', 'toggleIntro', 'onExhibitTab', 'onRetryViewer', 'onViewerStatus', 'onFlipStand', 'onFlipYaw', 'onFlipChange', 'onIpIntro', 'onTogglePicker', 'onClosePicker', 'onPickModel', 'onTapExhibitTitle']
  for (const name of binds) {
    assert.match(viewerWxml, new RegExp(name))
    const inPage = new RegExp(name + '\\s*:').test(viewerJs)
    const inBase = new RegExp(name + '\\s*\\(').test(pageBaseJs)
    assert.ok(inPage || inBase, 'wxml 绑定 ' + name + ' 在页面或 page-base 中找不到')
  }

  const compJs = fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/components/rocket-3d-viewer/index.js'), 'utf8')
  const compWxml = fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/components/rocket-3d-viewer/index.wxml'), 'utf8')
  const compBinds = ['onStageTap', 'onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel', 'onExpand', 'onFlipStand', 'onFlipYaw', 'onIpIntroBubble', 'onXingwenInput', 'onXingwenSend', 'onXingwenFocus', 'onXingwenBlur', 'onXingwenKeyboard', 'onXingwenComposerTap', 'onXwScreenTap', 'onXwScreenTouch']
  for (const name of compBinds) {
    assert.match(compWxml, new RegExp(name))
    assert.match(compJs, new RegExp(name + '\\s*:'))
  }

  const modelJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.js'), 'utf8')
  const modelWxml = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/rocket-model-detail.wxml'), 'utf8')
  const indexWxml = fs.readFileSync(path.join(ROOT, 'pages/index/index.wxml'), 'utf8')
  const listCardWxml = fs.readFileSync(path.join(ROOT, 'subpackages/progress-extra/components/mission-list-card/index.wxml'), 'utf8')
  assert.match(indexWxml, /item\.hasRocket3d/)
  assert.match(indexWxml, /mission-card-3d/)
  assert.doesNotMatch(indexWxml, /item\.hasOrbitPano/)
  assert.doesNotMatch(indexWxml, /mission-card-pano-360/)
  assert.match(listCardWxml, /item\.hasRocket3d/)
  assert.doesNotMatch(listCardWxml, /item\.hasOrbitPano/)

  assert.match(modelWxml, /onTapRocket3d/)
  assert.match(modelWxml, /rocket3dEnabled/)
  assert.match(modelJs, /onTapRocket3d\s*\(/)
  assert.match(modelJs, /alignDedicatedRocket3d/)
  assert.match(modelJs, /rocket3dEnabled:\s*!!rocket3d\.aligned/)
  assert.match(viewerWxml, /bind:flipchange="onFlipChange"/)
  assert.match(viewerWxml, /上下/)
  assert.match(viewerWxml, /左右/)
  assert.match(viewerWxml, /onFlipYaw/)
  assert.match(viewerWxml, /选择型号/)
  assert.match(viewerWxml, /class="r3d-nav-pick"/)
  assert.match(viewerWxml, /r3d-nav-pick"[\s\S]*?catchtap="onTogglePicker"/)
  assert.match(viewerWxml, /r3d-nav-caret/)
  assert.match(viewerWxml, /pickerTitle \|\| '3D 展陈'/)
  assert.match(viewerWxml, /\{\{pickerSub\}\}/)
  assert.match(viewerJs, /navFromDisplayedSlug\(resolved\.slug/)
  assert.match(viewerJs, /navFromDisplayedSlug\(that\._modelSlug/)
  assert.doesNotMatch(viewerWxml, /exhibit\.title \|\| pickerTitle/)
  assert.match(viewerWxml, /onTapExhibitTitle/)
  assert.match(viewerJs, /ROUTES\.ROCKET_MODEL_DETAIL/)
  assert.match(viewerJs, /gateCheck\('booster_genealogy'/)
  assert.doesNotMatch(viewerJs, /monitor-pages/)
  assert.doesNotMatch(viewerJs, /navFromExhibit/)
  assert.doesNotMatch(viewerWxml, /nav-title-wrap--page-grid/)
  const viewerWxss = fs.readFileSync(path.join(ROOT, 'subpackages/rocket-3d/viewer.wxss'), 'utf8')
  assert.match(viewerWxss, /\.r3d-nav-pick\s*\{[^}]*pointer-events:\s*auto/)
  assert.match(viewerWxss, /\.r3d-exhibit-title\s*\{[^}]*pointer-events:\s*auto/)
  assert.match(viewerWxss, /\.r3d-nav-pick\s*\{[^}]*min-width:\s*280rpx/)
  assert.doesNotMatch(viewerWxss, /\.top-nav-wrapper[^{]*\{[^}]*z-index:\s*40/)
  assert.match(compWxml, /上下翻转/)
  assert.match(compWxml, /左右翻转/)
  assert.match(viewerWxml, /bind:ipintro="onIpIntro"/)
  assert.match(compWxml, /onIpIntroBubble/)
  assert.match(compWxml, /轻点空白处返回/)
  assert.match(compWxml, /AI太空助手/)
  assert.match(compWxml, /r3d-xw-screen/)
  assert.match(compWxml, /r3d-xw-bar/)
  assert.match(compWxml, /r3d-xw-field/)
  assert.match(compWxml, /r3d-xw-go/)
  assert.match(compWxml, /问问星问/)
  assert.doesNotMatch(compWxml, /r3d-xw-dock/)
  assert.match(viewerWxml, /exhibit-intro/)
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
  assert.equal(typeof page.onFlipYaw, 'function')
  assert.equal(typeof page.onFlipChange, 'function')
  assert.equal(typeof page.onIpIntro, 'function')
  assert.equal(typeof comp.methods.openIpIntro, 'function')
  assert.equal(typeof comp.methods.closeIpIntro, 'function')
  assert.equal(typeof page.onTogglePicker, 'function')
  assert.equal(typeof page.onClosePicker, 'function')
  assert.equal(typeof page.onPickModel, 'function')
  assert.equal(typeof page.onNavBack, 'function')
  assert.equal(typeof page._refreshCatalog, 'function')
  assert.equal(typeof page._sharePayload, 'function')
  assert.equal(typeof comp.methods.flipStand, 'function')
  assert.equal(typeof comp.methods.flipYaw, 'function')
  assert.doesNotThrow(() => page.onFlipStand.call({
    selectComponent: function () { return null },
    setData: function () {},
    data: { standFlipped: false, standYawFlipped: false }
  }))
  assert.doesNotThrow(() => page.onFlipYaw.call({
    selectComponent: function () { return null },
    setData: function () {},
    data: { standFlipped: false, standYawFlipped: false }
  }))
  assert.doesNotThrow(() => page.onFlipChange.call({
    data: { standFlipped: false, standYawFlipped: false },
    setData: function () {}
  }, { detail: { flipped: true, flippedLeft: true } }))
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
    data: { started: false, loading: false, live: false, dimLabels: [], ipTags: [], ipIntro: { open: false }, xwChat: { open: false, armed: false, sending: false, draft: '', messages: [] }, xwScreen: { visible: false } },
    properties: { rocketName: '', rocketNameEn: '', modelUrl: '', active: true, autoLoad: false, dimLength: '', dimDiameter: '' },
    setData() {},
    triggerEvent() {},
    _syncMeta: methods._syncMeta,
    _emitStatus: methods._emitStatus,
    _setDimLabels: methods._setDimLabels,
    _setIpTags: methods._setIpTags,
    _clearIpType: methods._clearIpType,
    _applyDimGuides: methods._applyDimGuides,
    closeIpIntro: methods.closeIpIntro,
    dismissIpWindows: methods.dismissIpWindows,
    _dismissAllIpUi: methods._dismissAllIpUi,
    openIpIntro: methods.openIpIntro,
    _resetXingwenChat: methods._resetXingwenChat,
    _relayoutXingwenPanel: methods._relayoutXingwenPanel,
    _paintXingwenPanel: methods._paintXingwenPanel,
    _syncXwView: methods._syncXwView,
    _viewXwMessages: methods._viewXwMessages,
    _xwScrollId: methods._xwScrollId,
    _xwPanelOpen: methods._xwPanelOpen,
    _setXwScreen: methods._setXwScreen,
    _toggleXingwenIme: methods._toggleXingwenIme,
    _closeXingwenIme: methods._closeXingwenIme,
    _focusXingwenChat: methods._focusXingwenChat,
    _xwPanelFooter: methods._xwPanelFooter,
    _syncLoop: methods._syncLoop,
    _syncIpScaleRefs: methods._syncIpScaleRefs,
    _ensureIpRefCatalog: methods._ensureIpRefCatalog,
    _shouldRun: methods._shouldRun,
    flipStand: methods.flipStand,
    flipYaw: methods.flipYaw,
    _emitFlipState: methods._emitFlipState
  }
  assert.doesNotThrow(() => methods.dismissIpWindows.call(fake))
  assert.doesNotThrow(() => methods.playExhibitView.call(fake, 'size'))
  assert.doesNotThrow(() => methods.flipStand.call(fake))
  assert.equal(methods.flipStand.call(fake), false)
  assert.doesNotThrow(() => methods.flipYaw.call(fake))
  assert.equal(methods.flipYaw.call(fake), false)
  assert.doesNotThrow(() => methods.onFlipStand.call(fake))
  assert.doesNotThrow(() => methods.onFlipYaw.call(fake))
  assert.doesNotThrow(() => methods._applyDimGuides.call(fake))
  assert.doesNotThrow(() => methods.openIpIntro.call(fake, 'astro'))
  assert.doesNotThrow(() => methods.closeIpIntro.call(fake))
  assert.doesNotThrow(() => methods.onXingwenInput.call(fake, { detail: { value: 'hi' } }))
  assert.doesNotThrow(() => methods.onXingwenFocus.call(fake))
  assert.doesNotThrow(() => methods.onXingwenBlur.call(fake))
  assert.doesNotThrow(() => methods.onXingwenKeyboard.call(fake, { detail: { height: 0 } }))
  assert.doesNotThrow(() => methods.onXwScreenTouch.call(fake))
  assert.doesNotThrow(() => methods.onXwScreenTap.call(fake))
  assert.doesNotThrow(() => methods.onXingwenComposerTap.call(fake))
  assert.doesNotThrow(() => methods.onXingwenSend.call(fake))
  assert.doesNotThrow(() => methods._onCanvasTap.call(fake, 10, 10))
  assert.doesNotThrow(() => methods._resetXingwenChat.call(fake, true))
  assert.doesNotThrow(() => methods._syncIpScaleRefs.call(fake))
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
  assert.doesNotThrow(() => runtime.clearIpScaleRefs(null))
  assert.equal(runtime.placeIpScaleRefs(null, 70), false)
  assert.equal(runtime.placeIpScaleRefs({ ipRefLoaded: [] }, 70), false)
  assert.equal(runtime.exhibitStageClearance(), 0)
  assert.equal(runtime.playIpFigureClips(null), 0)
  assert.equal(runtime.playIpFigureClips({ ipRefLoaded: [] }), 0)
  assert.equal(runtime.getIpCollisionBox(null, null), null)
  assert.equal(runtime.pickIpRefAt(null, 10, 10), '')
  assert.equal(runtime.playIpIntroView(null, 'astro'), false)
  assert.doesNotThrow(() => runtime.clearIpIntroView(null))
  assert.doesNotThrow(() => runtime.unlockIpIntroControls(null))
  assert.equal(runtime.pickIpChatPanelAt(null, 1, 1), false)
  assert.equal(runtime.attachIpChatPanel(null), false)
  assert.equal(runtime.attachMuskIntroPanel(null), false)
  assert.equal(runtime.layoutMuskIntroPanel(null), false)
  assert.doesNotThrow(() => runtime.clearMuskIntroPanel(null))
  assert.equal(runtime.layoutIpChatPanel(null), false)
  assert.equal(runtime.faceIpFiguresToCamera(null), false)
  const faceFig = {
    rotation: { x: 0, y: 2, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z } }
  }
  assert.equal(runtime.faceIpFiguresToCamera({ ipRefLoaded: [{ object: faceFig }] }), true)
  assert.equal(faceFig.rotation.y, 0)
  assert.equal(runtime.updateIpChatPanelTexture(null, {}), false)
  assert.doesNotThrow(() => runtime.clearIpChatPanel(null))
  assert.doesNotThrow(() => runtime.setXingwenHaloTalking(null, true))
  assert.doesNotThrow(() => runtime.updateXingwenHalo(null, 1))
  assert.doesNotThrow(() => runtime.ensureXingwenHalo(null))
  assert.equal(runtime.ensureXingwenHalo(null), false)
  assert.doesNotThrow(() => runtime.attachIpScaleRefs(null, {}))
  assert.equal(typeof runtime.attachIpScaleRefs(null, { figures: [{ url: 'x' }], rocketLengthM: 70 }), 'object')
  assert.doesNotThrow(() => runtime.playExhibitView(null, 'size'))
  assert.doesNotThrow(() => runtime.playExhibitView({}, 'feat'))
  assert.doesNotThrow(() => runtime.setDimensionGuides(null, true, {}))
  assert.doesNotThrow(() => runtime.resizeSession(null, { width: 100, height: 100 }))
  assert.doesNotThrow(() => runtime.cancelExhibitTween(null))
  assert.doesNotThrow(() => runtime.wrapStandingModel(null, { Group: function () {} }))
  assert.equal(runtime.wrapStandingModel(null, { Group: function () {} }), null)
  assert.doesNotThrow(() => runtime.applyManualStandFlip(null, true))
  assert.doesNotThrow(() => runtime.applyManualStandYaw(null, true))
  assert.doesNotThrow(() => runtime.toggleManualStandFlip(null))
  assert.doesNotThrow(() => runtime.toggleManualStandYaw(null))
  assert.equal(runtime.isStandFlipped(null), false)
  assert.equal(runtime.isStandYawFlipped(null), false)
  assert.equal(runtime.findYawGroup(null), null)
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
    assert.equal(board.z, 0)
    const floor = exhibitStandRotation({ x: 80, y: 8, z: 55 })
    assert.ok(Math.abs(floor.x + Math.PI / 2) < 1e-6)

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

test('3D 顶部换型号：空操作不炸，切模会卸掉旧地址并带 slug 分享', () => {
  installMiniProgramStubs()
  require('../subpackages/rocket-3d/viewer.js')
  const page = global.__r3dViewerPage
  assert.doesNotThrow(() => page.onClosePicker.call({
    data: { pickerOpen: false },
    setData: function (d) { Object.assign(this.data, d) }
  }))
  assert.doesNotThrow(() => page.onTogglePicker.call({
    data: { isMomentsPreview: true, pickerOpen: false, catalog: [{ slug: 'falcon-9' }] },
    setData: function () {}
  }))
  const tog = {
    data: { isMomentsPreview: false, pickerOpen: true, catalog: [{ slug: 'falcon-9' }] },
    setData: function (d) { Object.assign(this.data, d) }
  }
  page.onTogglePicker.call(tog)
  assert.equal(tog.data.pickerOpen, false)
  const emptyPick = {
    data: { catalog: [], modelUrl: '', pickerOpen: true },
    _modelSlug: '',
    setData: function (d, cb) { Object.assign(this.data, d); if (cb) cb.call(this) },
    _resolveAndBindModel: function () { this._resolved = true }
  }
  assert.doesNotThrow(() => page.onPickModel.call(emptyPick, {}))
  assert.doesNotThrow(() => page.onPickModel.call(emptyPick, { currentTarget: { dataset: {} } }))
  assert.equal(emptyPick._resolved, undefined)
  emptyPick.data.catalog = [{
    slug: 'falcon-9',
    title: '猎鹰 9 号',
    nameEn: 'Falcon 9',
    subtitle: 'SpaceX',
    configId: '164'
  }]
  emptyPick._modelSlug = 'falcon-9'
  emptyPick.data.modelUrl = 'https://example.com/f9.glb'
  page.onPickModel.call(emptyPick, { currentTarget: { dataset: { slug: 'falcon-9' } } })
  assert.equal(emptyPick.data.pickerOpen, false)
  assert.equal(emptyPick._resolved, undefined)
  emptyPick._modelSlug = 'starship'
  emptyPick.data.modelUrl = 'https://example.com/ss.glb'
  emptyPick.data.pickerOpen = true
  page.onPickModel.call(emptyPick, { currentTarget: { dataset: { slug: 'falcon-9' } } })
  assert.equal(emptyPick._hintSlug, 'falcon-9')
  assert.equal(emptyPick._hintUrl, '')
  assert.equal(emptyPick.data.modelUrl, '')
  assert.equal(emptyPick.data.currentSlug, 'falcon-9')
  assert.equal(emptyPick._resolved, true)
  const share = page._sharePayload.call({
    data: { rocketName: '猎鹰 9 号', rocketNameEn: 'Falcon 9', poster: '', currentSlug: 'falcon-9' },
    _modelSlug: 'falcon-9'
  })
  assert.equal(share.slug, 'falcon-9')
  const nav = {
    data: { pickerOpen: true },
    setData: function (d) { Object.assign(this.data, d) },
    goBack: function () { this._left = true }
  }
  page.onNavBack.call(nav)
  assert.equal(nav.data.pickerOpen, false)
  assert.equal(nav._left, undefined)
  page.onNavBack.call(nav)
  assert.equal(nav._left, true)
})

function makeIpDimThree() {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }
    clone() {
      return new Vector3(this.x, this.y, this.z)
    }
    set(x, y, z) {
      this.x = x
      this.y = y
      this.z = z
      return this
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
    clone() {
      const box = new Box3()
      box.min = this.min.clone()
      box.max = this.max.clone()
      return box
    }
    getSize(target) {
      target.x = this.max.x - this.min.x
      target.y = this.max.y - this.min.y
      target.z = this.max.z - this.min.z
      return target
    }
    getCenter(target) {
      const out = target || new Vector3()
      out.x = (this.min.x + this.max.x) * 0.5
      out.y = (this.min.y + this.max.y) * 0.5
      out.z = (this.min.z + this.max.z) * 0.5
      return out
    }
    union(box) {
      if (!box || !box.min || !box.max) return this
      this.min.x = Math.min(this.min.x, box.min.x)
      this.min.y = Math.min(this.min.y, box.min.y)
      this.min.z = Math.min(this.min.z, box.min.z)
      this.max.x = Math.max(this.max.x, box.max.x)
      this.max.y = Math.max(this.max.y, box.max.y)
      this.max.z = Math.max(this.max.z, box.max.z)
      return this
    }
    setFromObject(obj) {
      if (obj && obj._worldBox) {
        this.min = obj._worldBox.min.clone()
        this.max = obj._worldBox.max.clone()
        return this
      }
      const kids = obj && obj.children
      if (kids && kids.length) {
        this.min = new Vector3(Infinity, Infinity, Infinity)
        this.max = new Vector3(-Infinity, -Infinity, -Infinity)
        for (let i = 0; i < kids.length; i++) {
          const child = new Box3().setFromObject(kids[i])
          this.min.x = Math.min(this.min.x, child.min.x)
          this.min.y = Math.min(this.min.y, child.min.y)
          this.min.z = Math.min(this.min.z, child.min.z)
          this.max.x = Math.max(this.max.x, child.max.x)
          this.max.y = Math.max(this.max.y, child.max.y)
          this.max.z = Math.max(this.max.z, child.max.z)
        }
        return this
      }
      const sx = (obj && obj.scale && obj.scale.x) || 1
      const sy = (obj && obj.scale && obj.scale.y) || 1
      const sz = (obj && obj.scale && obj.scale.z) || 1
      const px = (obj && obj.position && obj.position.x) || 0
      const py = (obj && obj.position && obj.position.y) || 0
      const pz = (obj && obj.position && obj.position.z) || 0
      const hw = 0.2 * sx
      const h = 1.88 * sy
      const hd = 0.2 * sz
      this.min = new Vector3(px - hw, py, pz - hd)
      this.max = new Vector3(px + hw, py + h, pz + hd)
      return this
    }
  }
  class Group {
    constructor() {
      this.children = []
      this.parent = null
      this.name = ''
      this.userData = {}
      this.renderOrder = 0
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x
          this.y = y
          this.z = z
        }
      }
      this.scale = {
        x: 1,
        y: 1,
        z: 1,
        set(x, y, z) {
          this.x = x
          this.y = y
          this.z = z
        }
      }
    }
    add() {
      for (let i = 0; i < arguments.length; i++) {
        const obj = arguments[i]
        if (!obj) continue
        if (obj.parent && obj.parent.remove) obj.parent.remove(obj)
        this.children.push(obj)
        obj.parent = this
      }
      return this
    }
    remove(obj) {
      this.children = this.children.filter((child) => child !== obj)
      if (obj && obj.parent === this) obj.parent = null
      return this
    }
    attach(obj) {
      return this.add(obj)
    }
    updateWorldMatrix() {}
  }
  class LineBasicMaterial {
    constructor(opts) {
      Object.assign(this, opts || {})
    }
  }
  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array
      this.itemSize = itemSize
      this.needsUpdate = false
    }
  }
  class BufferGeometry {
    constructor() {
      this.attributes = {}
    }
    setAttribute(key, value) {
      this.attributes[key] = value
    }
    computeBoundingSphere() {}
  }
  class Line {
    constructor(geometry, material) {
      this.geometry = geometry
      this.material = material
      this.visible = true
    }
  }
  return {
    Vector3,
    Box3,
    Group,
    LineBasicMaterial,
    BufferAttribute,
    BufferGeometry,
    Line
  }
}

test('尺寸模式给人一条高度，人挂 scene 不跟火箭转', () => {
  const runtime = require('../subpackages/rocket-3d/runtime.js')
  const THREE = makeIpDimThree()
  const sceneAdds = []
  const scene = new THREE.Group()
  const origAdd = scene.add.bind(scene)
  scene.add = function () {
    for (let i = 0; i < arguments.length; i++) sceneAdds.push(arguments[i])
    return origAdd.apply(this, arguments)
  }
  const modelRoot = {
    _worldBox: {
      min: new THREE.Vector3(-2, 0, -2),
      max: new THREE.Vector3(2, 70, 2)
    }
  }
  const musk = {
    name: 'ip-musk',
    userData: { r3dIpRef: true },
    parent: null,
    scale: {
      x: 1,
      y: 1,
      z: 1,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      }
    },
    position: {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      }
    },
    updateWorldMatrix() {}
  }
  const session = {
    THREE,
    scene,
    modelRoot,
    ipRefLoaded: [{ object: musk, slug: 'musk', highestPointM: 1.88, modelHeight: 1.88 }],
    rocketLengthM: 70,
    cssW: 375,
    cssH: 700
  }
  assert.equal(runtime.placeIpScaleRefs(session, '70 m'), true)
  const ipRoot = sceneAdds.find((obj) => obj && obj.name === 'r3d-ip-refs')
  assert.ok(ipRoot, '人根节点应加到 scene')
  assert.equal(ipRoot.parent, scene)
  assert.equal(musk.parent, ipRoot)
  assert.equal(session.ipRefRoot, ipRoot)

  const labels = []
  session.onDimLabels = function (items) {
    labels.splice(0, labels.length, ...(items || []))
  }
  runtime.setDimensionGuides(session, true, { length: '70 m', diameter: '3.7 m' })
  assert.equal(session.dimMeta.captions.length, '70 m')
  assert.equal(session.dimMeta.captions.diameter, '3.7 m')
  assert.equal(session.dimMeta.captions.ipHeight, '1.88 m')
  assert.ok(session.dimMeta.ipHeight, '应有 IP 高度线')
  assert.equal(session.dimMeta.ipWidth, undefined)
  assert.ok(session.dimGuides)
  assert.equal(session.dimGuides.parent, scene)
  const ipKeys = labels.filter((item) => item && String(item.key || '').indexOf('iph') === 0)
  assert.equal(ipKeys.length, 1)
  assert.equal(ipKeys[0].key, 'iph')
  assert.equal(ipKeys[0].text, '1.88 m')
})

test('两人并排按身高收肩，不跟臂展 / 火箭高度走', () => {
  installMiniProgramStubs()
  const runtime = require('../subpackages/rocket-3d/runtime.js')
  const { ipStandingStride } = require('../utils/ip-scale-ref.js')
  const THREE = makeIpDimThree()
  const scene = new THREE.Group()
  function makeFig(slug) {
    return {
      name: 'ip-' + slug,
      userData: { r3dIpRef: true },
      parent: null,
      rotation: {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x
          this.y = y
          this.z = z
        }
      },
      scale: {
        x: 1,
        y: 1,
        z: 1,
        set(x, y, z) {
          this.x = x
          this.y = y
          this.z = z
        }
      },
      position: {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x
          this.y = y
          this.z = z
        }
      },
      _worldBox: {
        min: new THREE.Vector3(-0.9, 0, -0.25),
        max: new THREE.Vector3(0.9, 1.88, 0.25)
      },
      updateWorldMatrix() {}
    }
  }
  const musk = makeFig('musk')
  const astro = makeFig('astro')
  const session = {
    THREE,
    scene,
    modelRoot: {
      _worldBox: {
        min: new THREE.Vector3(-2, 0, -2),
        max: new THREE.Vector3(2, 70, 2)
      }
    },
    ipRefLoaded: [
      { object: musk, slug: 'musk', highestPointM: 1.88, modelHeight: 1.88 },
      { object: astro, slug: 'astro', highestPointM: 1.88, modelHeight: 1.88 }
    ],
    rocketLengthM: 70,
    cssW: 375,
    cssH: 700
  }
  assert.equal(runtime.placeIpScaleRefs(session, '70 m'), true)
  const stride = ipStandingStride({ x: 1.8, y: 1.88, z: 0.5 })
  const dist = Math.abs(astro.position.x - musk.position.x)
  assert.ok(astro.position.x < musk.position.x, '星问应在左，马斯克在右')
  assert.ok(Math.abs(dist - stride.step) < 1e-6, '中心距应等于步长，实际 ' + dist)
  assert.ok(dist > 1.8, '举手姿态还在穿模: ' + dist)
  assert.ok(dist < 1.8 + 1.88 * 0.7, '两人被整臂展拉开了: ' + dist)
})

test('赛博皮卡按车长缩放，停在两个 IP 身后', () => {
  installMiniProgramStubs()
  const runtime = require('../subpackages/rocket-3d/runtime.js')
  const THREE = makeIpDimThree()
  const scene = new THREE.Group()
  function makeFig(slug, box) {
    return {
      name: 'ip-' + slug,
      userData: { r3dIpRef: true },
      parent: null,
      rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z } },
      scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z } },
      position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z } },
      _worldBox: box,
      updateWorldMatrix() {}
    }
  }
  const musk = makeFig('musk', {
    min: new THREE.Vector3(-0.9, 0, -0.25),
    max: new THREE.Vector3(0.9, 1.88, 0.25)
  })
  const astro = makeFig('astro', {
    min: new THREE.Vector3(-0.9, 0, -0.25),
    max: new THREE.Vector3(0.9, 1.88, 0.25)
  })
  const truck = makeFig('cyber-pickup', {
    min: new THREE.Vector3(-2.8415, 0, -1.016),
    max: new THREE.Vector3(2.8415, 1.794, 1.016)
  })
  const session = {
    THREE,
    scene,
    modelRoot: {
      _worldBox: {
        min: new THREE.Vector3(-2, 0, -2),
        max: new THREE.Vector3(2, 70, 2)
      }
    },
    ipRefLoaded: [
      { object: musk, slug: 'musk', highestPointM: 1.88, modelHeight: 1.88 },
      { object: astro, slug: 'astro', highestPointM: 1.88, modelHeight: 1.88 },
      {
        object: truck,
        slug: 'cyber-pickup',
        highestPointM: 1.794,
        modelHeight: 1.794,
        lengthM: 5.683,
        widthM: 2.032
      }
    ],
    rocketLengthM: 70,
    cssW: 375,
    cssH: 700
  }
  assert.equal(runtime.placeIpScaleRefs(session, '70 m'), true)
  assert.ok(astro.position.x < musk.position.x, '星问仍应在左')
  assert.ok(truck.position.z < astro.position.z, '车辆应在两个 IP 身后')
  assert.ok(Math.abs(truck.position.x - (astro.position.x + musk.position.x) / 2) < 1.2, '车辆应落在两人中线附近')
  assert.ok(Math.abs(truck.scale.x - 1) < 1e-6, '1:1 车模应按车长保持比例')
  const labels = []
  session.onDimLabels = function (items) {
    labels.splice(0, labels.length, ...(items || []))
  }
  runtime.setDimensionGuides(session, true, { length: '70 m', diameter: '3.7 m' })
  assert.equal(session.dimMeta.captions.ipHeight, '1.88 m')
  assert.equal(session.dimMeta.captions.vehLength, '5.683 m')
  assert.equal(session.dimMeta.captions.vehHeight, '1.794 m')
  assert.ok(session.dimMeta.vehLen, '应有车辆长度线')
  assert.ok(session.dimMeta.ipHFrom, '应有 IP 高度线坐标')
  assert.ok(session.dimMeta.vehHFrom, '应有车辆高度线坐标')
  assert.ok(
    session.dimMeta.ipHFrom[0] < session.dimMeta.vehHFrom[0] - 0.5,
    '1.88 m 应标在人侧，不跟车高线叠在一起'
  )
  assert.ok(
    session.dimMeta.ipHExtA0[0] < truck._worldBox.max.x,
    'IP 高度引出线应贴人，不应从车身拉出'
  )
})

test('点选赛博皮卡认车身，不跟身前小人热区抢', () => {
  installMiniProgramStubs()
  const runtime = require('../subpackages/rocket-3d/runtime.js')
  const THREE = makeIpDimThree()
  THREE.Vector3.prototype.project = function () {
    const sx = 187 + this.x * 8
    const sy = 500 - this.y * 8
    this.x = (sx / 375) * 2 - 1
    this.y = -((sy / 700) * 2 - 1)
    this.z = 0
    return this
  }
  const musk = {
    _worldBox: {
      min: new THREE.Vector3(9, 0, -0.3),
      max: new THREE.Vector3(11, 1.88, 0.3)
    },
    updateWorldMatrix() {}
  }
  const truck = {
    _worldBox: {
      min: new THREE.Vector3(6, 0, -4),
      max: new THREE.Vector3(14, 1.79, -2)
    },
    updateWorldMatrix() {}
  }
  const session = {
    THREE,
    camera: {},
    cssW: 375,
    cssH: 700,
    rocketLengthM: 70,
    modelRoot: {
      _worldBox: {
        min: new THREE.Vector3(-2, 0, -2),
        max: new THREE.Vector3(2, 70, 2)
      }
    },
    ipRefLoaded: [
      { object: musk, slug: 'musk', highestPointM: 1.88 },
      {
        object: truck,
        slug: 'cyber-pickup',
        lengthM: 5.683,
        widthM: 2.032,
        highestPointM: 1.794
      }
    ]
  }
  assert.equal(runtime.pickIpRefAt(session, 267, 492), 'musk')
  assert.equal(runtime.pickIpRefAt(session, 267, 486), 'musk', '头顶应按全身盒点中，不能只用特写裁切盒')
  assert.equal(runtime.pickIpRefAt(session, 240, 492), 'cyber-pickup')
  const hitBox = runtime.ipFigureHitWorldBox(session.ipRefLoaded[1], THREE, session)
  assert.ok(hitBox)
  assert.ok(hitBox.max.x - hitBox.min.x < 8.5, '车长不应被网格垃圾尺寸撑开')
  assert.ok(hitBox.max.y - hitBox.min.y < 2.4, '车高应贴近手册 1.794')
})

test('大体积火箭按船体碰撞预测站位，不被体积挡住', () => {
  installMiniProgramStubs()
  const runtime = require('../subpackages/rocket-3d/runtime.js')
  const { xzOverlap, ipViewBlocked, ipStandingStride } = require('../utils/ip-scale-ref.js')
  const THREE = makeIpDimThree()
  const scene = new THREE.Group()
  function makeFig(slug) {
    return {
      name: 'ip-' + slug,
      userData: { r3dIpRef: true },
      parent: null,
      rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z } },
      scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z } },
      position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z } },
      _worldBox: {
        min: new THREE.Vector3(-0.9, 0, -0.25),
        max: new THREE.Vector3(0.9, 1.88, 0.25)
      },
      updateWorldMatrix() {}
    }
  }
  const musk = makeFig('musk')
  const astro = makeFig('astro')
  const hull = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  const session = {
    THREE,
    scene,
    camera: { position: { x: 0, y: 12, z: 40 } },
    modelRoot: {
      _worldBox: {
        min: new THREE.Vector3(-10, 0, -10),
        max: new THREE.Vector3(10, 40, 10)
      }
    },
    ipRefLoaded: [
      { object: musk, slug: 'musk', highestPointM: 1.88, modelHeight: 1.88 },
      { object: astro, slug: 'astro', highestPointM: 1.88, modelHeight: 1.88 }
    ],
    rocketLengthM: 70,
    cssW: 375,
    cssH: 700
  }
  assert.equal(runtime.placeIpScaleRefs(session, '70 m'), true)
  const stride = ipStandingStride({ x: 1.8, y: 1.88, z: 0.5 })
  const pairW = stride.step + stride.bodyW
  const pairD = Math.max(0.5, stride.bodyW * 0.72)
  const pairX = (musk.position.x + astro.position.x) / 2
  const pairZ = (musk.position.z + astro.position.z) / 2
  const fp = {
    minX: pairX - pairW / 2,
    maxX: pairX + pairW / 2,
    minZ: pairZ - pairD / 2,
    maxZ: pairZ + pairD / 2
  }
  assert.equal(xzOverlap(fp, hull), false, '人还叠在船体里')
  assert.equal(ipViewBlocked(session.camera.position, pairX, pairZ, hull), false, '镜头仍被船体挡住')
  assert.ok(astro.position.x < musk.position.x, '碰撞外推后仍应星问左马斯克右')
  assert.ok(Math.abs(astro.position.x - musk.position.x) > 1.8, '碰撞外推后两人还在穿模')
  assert.ok(Math.abs(astro.position.x - musk.position.x) < 1.8 + 1.88 * 0.7, '碰撞外推后两人被拉开')
  assert.ok(!(Math.abs(musk.position.x - 10) < 1e-6 && Math.abs(musk.position.z) < 1e-6), '还钉死在箭右侧中线')
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
