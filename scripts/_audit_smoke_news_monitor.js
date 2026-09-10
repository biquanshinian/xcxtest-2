// news-lazy / monitor-weather 委托模块运行时冒烟：mock wx 后 attachTo 并调用关键方法
const path = require('path')
let failures = 0
const ok = (m) => console.log('[ok]', m)
const bad = (m) => { failures++; console.log('[FAIL]', m) }

global.wx = {
  getStorage: (o) => o.fail && o.fail(),
  setStorage: () => {},
  request: (o) => o.fail && o.fail(new Error('offline')),
  previewImage: (o) => { global.__previewed = o.urls },
  showToast: () => {},
  vibrateShort: () => {}
}
global.getApp = () => ({
  fetchNewsManualLatestUpdatedMs: (cb) => cb(0)
})

function mockPage(data) {
  return {
    data,
    setData(patch) { Object.assign(this.data, patch) },
    showQRCode() { this.data.showQRCodeModal = true }
  }
}

// --- news-lazy ---
const newsLazy = require(path.resolve('subpackages/news-extra/utils/news-lazy.js'))
const np = mockPage({
  showArticlesNavDot: true, newsList: [], contentType: 'articles',
  buttonX: 10, buttonY: 10, buttonSize: 50, windowWidth: 400, windowHeight: 800,
  qrcodeImage: 'http://x/qr.png', showQRCodeModal: false
})
np.NEWS_QR_IMAGE_FALLBACK_URL = 'http://fallback/qr.jpg'
np.getNewsQrImageUrl = () => 'http://x/qr.png'
newsLazy.attachTo(np)
np.__newsLazyAttached === true ? ok('news-lazy attachTo 标记') : bad('news-lazy attachTo 标记缺失')
np._refreshArticlesNavDot()
np.data.showArticlesNavDot === false ? ok('导航红点按云端 0 值收起') : bad('导航红点未收起')
np.onQrcodeEntryTouchStart({ touches: [{ clientX: 100, clientY: 100 }] })
np.onQrcodeEntryTouchMove({ touches: [{ clientX: 160, clientY: 130 }] })
np._qrcodeIsDragging === true ? ok('拖拽状态判定') : bad('拖拽状态未判定')
np.onQrcodeEntryTouchEnd()
np.data.buttonX === 0 || np.data.buttonX === 350 ? ok('松手贴边: buttonX=' + np.data.buttonX) : bad('贴边异常: ' + np.data.buttonX)
np._qrcodeIsDragging = false
np.onQrcodeEntryTouchEnd()
np.data.showQRCodeModal === true ? ok('点按打开二维码弹窗') : bad('弹窗未打开')
np.onQRCodeImageTap()
Array.isArray(global.__previewed) && global.__previewed[0] === 'http://x/qr.png' ? ok('二维码预览 URL') : bad('预览 URL 异常')
np.onQRCodeImageError()
np.data.qrcodeImage === 'http://fallback/qr.jpg' ? ok('图片失败回退兜底 URL') : bad('兜底 URL 未生效')

// --- monitor-weather ---
const weather = require(path.resolve('subpackages/monitor-pages/utils/monitor-weather.js'))
const mp = mockPage({ starbaseWeather: { loaded: false } })
weather.attachTo(mp)
mp.__weatherAttached === true ? ok('monitor-weather attachTo 标记') : bad('attachTo 标记缺失')
const map = mp._mapWeatherCode(95)
map.text === '雷暴' ? ok('天气码映射: 95→雷暴') : bad('天气码映射异常: ' + JSON.stringify(map))
mp._hydrateStarbaseWeatherFromCache() // getStorage fail 分支不抛错
ok('缓存回填 fail 分支无异常')
const pr = mp.loadStarbaseWeather(false)
;(pr && typeof pr.then === 'function') ? ok('loadStarbaseWeather 返回 Promise') : bad('未返回 Promise')
Promise.resolve(pr).then(() => {
  // 首次失败且无旧数据：按设计保持 loading 并安排 4s 重试（与原主包实现一致）
  mp._starbaseWeatherRetried === true ? ok('首次失败安排重试') : bad('未进入重试分支')
  mp._starbaseWeatherInFlight === false ? ok('in-flight 标记复位') : bad('in-flight 未复位')
  console.log(failures ? ('共 ' + failures + ' 项失败') : '全部通过')
  process.exit(failures ? 1 : 0)
})
