/**
 * Tab 页 busy/ready 薄封装，减少五页样板代码。
 * 对外 API 全部吞异常；withTabLoad 保证返回可 .catch 的 Promise，且始终 end。
 */
var gate = require('./tab-load-gate.js')

var TAB_ROUTES = {
  index: 'pages/index/index',
  monitor: 'pages/monitor/monitor',
  progress: 'pages/progress/progress',
  news: 'pages/news/news',
  profile: 'pages/profile/profile'
}

function beginPageLoad(route) {
  try { gate.markTabBusy(route) } catch (e) {}
}

function endPageLoad(route) {
  try { gate.markTabReady(route) } catch (e) {}
}

/**
 * 包一层 Promise：开始 busy，结束（成功/失败）ready
 * @param {string} route pages/xxx/xxx
 * @param {Promise|Function} work Promise 或返回 Promise 的函数
 * @returns {Promise}
 */
function withTabLoad(route, work) {
  beginPageLoad(route)
  var settled = false
  function finish() {
    if (settled) return
    settled = true
    endPageLoad(route)
  }

  var p
  try {
    p = typeof work === 'function' ? work() : work
  } catch (e) {
    finish()
    return Promise.resolve()
  }

  if (!p || typeof p.then !== 'function') {
    finish()
    return Promise.resolve(p)
  }

  return Promise.resolve(p).then(
    function (v) {
      finish()
      return v
    },
    function () {
      finish()
      // 吞掉业务错误，避免未处理 rejection / 控制台报错
      return undefined
    }
  )
}

module.exports = {
  beginPageLoad: beginPageLoad,
  endPageLoad: endPageLoad,
  withTabLoad: withTabLoad,
  TAB_ROUTES: TAB_ROUTES
}
