/**
 * 网络性能改动审计：失败接口降级、慢请求缓存、404 猜路径
 * 运行：node scripts/_tmp_audit_network_perf_round.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
let pass = 0
let fail = 0

function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log('PASS  ' + name)
  } else {
    fail += 1
    console.log('FAIL  ' + name + (extra ? ' → ' + extra : ''))
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function syntax(rel) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' })
    return true
  } catch (e) {
    return false
  }
}

const files = [
  'utils/ll2-image.js',
  'utils/image-config.js',
  'utils/icon-cache.js',
  'utils/agency-logo-cache.js',
  'pages/nasa-data/nasa-api.js',
  'pages/monitor/monitor.js',
  'subpackages/monitor-pages/utils/roman-tracker.js',
  'subpackages/monitor-pages/utils/artemis-arow.js',
  'subpackages/monitor-pages/utils/monitor-weather.js',
  'subpackages/monitor-pages/utils/tle-fetch.js',
  'cloudflare-worker/spacex-proxy.js'
]
files.forEach((rel) => check('语法 ' + rel, syntax(rel)))

const roman = read('subpackages/monitor-pages/utils/roman-tracker.js')
const romanFn = roman.slice(roman.indexOf('async function fetchBriefing'), roman.indexOf('module.exports'))
check('罗曼 briefing 不再打 Horizons', !/fetchFromHorizons|artemis-horizons/.test(romanFn))
check('罗曼有本地旧快照', /STALE_KEY = '_roman_tracker_last'/.test(roman) && /readStaleSnapshot/.test(romanFn))
check('罗曼精简接口允许 1 次重试', /requestJson\(base \+ '\/roman-tracker', 25000, 1\)/.test(roman))

const artemis = read('subpackages/monitor-pages/utils/artemis-arow.js')
const artemisFn = artemis.slice(artemis.indexOf('async function fetchBriefing'), artemis.indexOf('module.exports'))
check('Artemis briefing 不再打 Horizons', !/fetchFromHorizons|artemis-horizons/.test(artemisFn))
check('Artemis 无客户端 Horizons 函数', !/function fetchFromHorizons/.test(artemis))
check('Artemis 优先旧快照', /_artemis_briefing_last/.test(artemis))

const imgCfg = read('utils/image-config.js')
check('火箭未命中不猜 COS', /不再按字典文件名直拼 COS/.test(imgCfg) && /default\.jpg/.test(imgCfg))
check('火箭未命中回落 default', /fallbackKey = \/\\\/default\\.jpg/.test(imgCfg) || /火箭配置图\/default\.jpg/.test(imgCfg))

const icon = read('utils/icon-cache.js')
check('代理图不 downloadFile', /isWorkerImageProxyUrl\(raw\)/.test(icon))
check('轮播不 downloadFile', /_isHomeCarouselUrl\(raw\)/.test(icon))
check('落盘也跳过代理/轮播', /persistMediaImageAfterRemoteLoad[\s\S]*!isRemoteCacheableImageUrl\(raw\)/.test(icon))

const logo = read('utils/agency-logo-cache.js')
check('logo 代理不落盘', /isWorkerImageProxyUrl\(u\)/.test(logo))

const ll2 = read('utils/ll2-image.js')
check('导出 isWorkerImageProxyUrl', /isWorkerImageProxyUrl/.test(ll2) && /module\.exports[\s\S]*isWorkerImageProxyUrl/.test(ll2))

const nasa = read('pages/nasa-data/nasa-api.js')
check('CAD 优先 Worker', /\/nasa-cad/.test(nasa) && /ssd-api\.jpl\.nasa\.gov/.test(nasa))

const weather = read('subpackages/monitor-pages/utils/monitor-weather.js')
check('天气优先 Worker', /\/starbase\/weather/.test(weather) && /OPEN_METEO_URL/.test(weather))
check('天气缓存 30 分钟', /CACHE_MS = 30 \* 60 \* 1000/.test(weather))

const tle = read('subpackages/monitor-pages/utils/tle-fetch.js')
check('TLE 失败回落内存', /if \(!force && _mem\) return _mem/.test(tle))

const worker = read('cloudflare-worker/spacex-proxy.js')
const imgBlock = worker.slice(worker.indexOf("url.pathname === '/image'"), worker.indexOf("if (url.pathname === '/translate')"))
check('/image 边缘缓存', /caches\.default/.test(imgBlock) && /cache\.match/.test(imgBlock) && /cache\.put/.test(imgBlock))
check('/image 拒绝非 http', /Invalid url/.test(imgBlock))
check('/image 缓存失败不挡响应', /try \{ await cache\.put/.test(imgBlock))
check('/nasa-cad 路由', /pathname === '\/nasa-cad'/.test(worker))
check('/nasa-cad 白名单 query', /date-min/.test(worker) && /dist-max/.test(worker))
const romanWorker = read('cloudflare-worker/roman-tracker.js')
const unguardedPut = [worker, romanWorker].join('\n').split('\n').filter((l) => /await cache\.put/.test(l) && !/try \{/.test(l))
check('Worker cache.put 均不挡响应', unguardedPut.length === 0, unguardedPut.join(' | '))

// runtime
global.wx = global.wx || {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync() { return {} },
  setStorageSync() {},
  setStorage() {},
  getStorage() {},
  removeStorage() {},
  getFileSystemManager() {
    return { accessSync() { throw new Error('no') }, mkdirSync() {}, unlink() {}, unlinkSync() {}, readdirSync() { return [] } }
  },
  getNetworkType(o) { o && o.success && o.success({ networkType: 'wifi' }) },
  downloadFile(o) { o && o.fail && o.fail(new Error('mock')) }
}

const { resolveMediaUrl } = require('../utils/image-config.js')
const zhuque = String(resolveMediaUrl('火箭配置图/ZhuQue-3.jpg', ''))
const starship = String(resolveMediaUrl('火箭配置图/Starship V3 Flight 12.jpg', ''))
check('runtime ZhuQue 不猜路径', zhuque.indexOf('ZhuQue-3.jpg') === -1 && /default\.jpg/.test(zhuque), zhuque)
check('runtime Starship 不猜路径', starship.indexOf('Starship V3 Flight 12') === -1 && /default\.jpg/.test(starship), starship)

const { isWorkerImageProxyUrl, proxiedImageUrl } = require('../utils/ll2-image.js')
const proxied = proxiedImageUrl('https://thespacedevs-prod.nyc3.digitaloceanspaces.com/x.jpg')
check('runtime 代理识别', isWorkerImageProxyUrl(proxied))

let downloads = 0
const orig = wx.downloadFile
wx.downloadFile = function (o) {
  downloads += 1
  o && o.fail && o.fail(new Error('mock'))
}
const { getCachedMediaImage, persistMediaImageAfterRemoteLoad } = require('../utils/icon-cache.js')
getCachedMediaImage(proxied, 'thumb')
persistMediaImageAfterRemoteLoad(proxied, function () {})
check('runtime 代理 0 次 downloadFile', downloads === 0, String(downloads))
wx.downloadFile = orig

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
