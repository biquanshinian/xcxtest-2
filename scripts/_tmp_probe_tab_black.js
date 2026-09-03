global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync: () => ({}),
  setStorageSync: () => {},
  setStorage: () => {},
  removeStorage: () => {},
  removeStorageSync: () => {},
  getFileSystemManager: () => ({
    accessSync() {},
    mkdirSync() {},
    unlink() {},
    readdirSync: () => [],
    unlinkSync() {},
    writeFileSync() {}
  }),
  getNetworkType: (o) => o && o.success && o.success({ networkType: 'wifi' }),
  downloadFile: () => {},
  canIUse: () => true,
  getSystemInfoSync: () => ({
    platform: 'devtools',
    SDKVersion: '3.0.0',
    windowWidth: 390,
    statusBarHeight: 44,
    theme: 'dark'
  }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
  getMenuButtonBoundingClientRect: () => ({
    top: 48,
    bottom: 80,
    left: 300,
    right: 380,
    width: 80,
    height: 32
  }),
  getAppBaseInfo: () => ({ SDKVersion: '3.0.0', theme: 'dark' }),
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 44 }),
  getDeviceInfo: () => ({ platform: 'devtools' }),
  cloud: { database: () => ({}), callFunction: () => Promise.resolve({}) },
  onThemeChange: () => {},
  offThemeChange: () => {},
  request: () => {},
  showToast: () => {},
  createSelectorQuery: () => ({ select() { return this }, boundingClientRect() { return this }, exec() {} })
}
global.getApp = () => ({ globalData: {}, getUiShellLayout: null })
global.getCurrentPages = () => []
global.App = () => {}
global.Component = (o) => o
global.Behavior = (o) => o
let pageOk = false
global.Page = () => {
  pageOk = true
}

const path = require('path')
const Module = require('module')
const origWrap = Module.wrap
Module.wrap = function (script) {
  return origWrap(
    'if (typeof require !== "undefined" && !require.async) { require.async = (p) => Promise.resolve(require(p)) }\n' +
      script
  )
}

const ROOT = path.resolve(__dirname, '..')

function clearCache() {
  Object.keys(require.cache).forEach((k) => {
    if (k.includes('xcxtest-2') || k.includes('Desktop')) delete require.cache[k]
  })
}

function probeCircular() {
  clearCache()
  const icon = require(path.join(ROOT, 'utils/icon-cache.js'))
  const img = require(path.join(ROOT, 'utils/image-config.js'))
  console.log('icon exports', Object.keys(icon).join(','))
  console.log('getCachedRocketConfig', typeof icon.getCachedRocketConfig)
  console.log('wrap via image-config resolveMediaUrl', typeof img.resolveMediaUrl)
  // call paths used on tab pages
  const u1 = icon.getCachedMediaImage(
    'https://thespacedevs-prod.nyc3.digitaloceanspaces.com/media/x.jpg',
    'thumb'
  )
  const u2 = icon.getCachedMediaImage(
    'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/SpaceX.jpg',
    'thumb'
  )
  console.log('external ->', u1)
  console.log('cos ->', u2)
}

const pages = [
  'components/popup-ad/popup-ad.js',
  'custom-tab-bar/index.js',
  'pages/monitor/monitor.js',
  'pages/progress/progress.js',
  'pages/news/news.js',
  'pages/profile/profile.js',
  'pages/index/index.js'
]

probeCircular()

for (const r of pages) {
  clearCache()
  pageOk = false
  try {
    require(path.join(ROOT, r))
    console.log('OK', r, 'Page/Component registered=', pageOk || r.includes('component') || r.includes('tab-bar'))
  } catch (e) {
    console.log('FAIL', r)
    console.log(String(e.stack || e).split('\n').slice(0, 25).join('\n'))
  }
}
