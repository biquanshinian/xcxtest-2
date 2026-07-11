/**
 * 直播演示模式引擎
 *
 * 负责：
 * 1. 检测当前用户是否为直播账号
 * 2. 从云数据库读取演示模式状态
 * 3. 协调 demo-overlay 组件执行脚本
 */
const DEMO_SCRIPTS_PKG = '../subpackages/shared/utils/demo-scripts.js'

let _demoScriptsPromise = null
function loadDemoScripts() {
  if (!_demoScriptsPromise) {
    _demoScriptsPromise = require.async(DEMO_SCRIPTS_PKG)
  }
  return _demoScriptsPromise
}

const DEMO_MODE_COLLECTION = 'demo_mode'
const DEMO_CONTROL_DOC_ID = 'control'

/** 直播账号的 openid 列表（在后台配置后会从云端读取） */
let _liveAccountOpenids = []
let _currentOpenid = ''
let _isDemoMode = false
let _initDone = false

/**
 * 初始化演示引擎
 * 在 app.onLaunch 中调用
 */
async function initDemoEngine() {
  await _getOpenidViaCloud()
  await _loadDemoConfig()
  _initDone = true
}

/**
 * 通过云函数获取当前用户 openid
 */
async function _getOpenidViaCloud() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'apiProxy',
      data: { action: 'getOpenid' }
    })
    if (res.result && res.result.openid) {
      _currentOpenid = res.result.openid
    }
  } catch (e) {}
}

/**
 * 从云数据库加载演示模式配置
 */
async function _loadDemoConfig() {
  try {
    const db = wx.cloud.database()
    const res = await db.collection(DEMO_MODE_COLLECTION).doc(DEMO_CONTROL_DOC_ID).get()
    const doc = res.data

    if (doc) {
      _liveAccountOpenids = doc.liveAccountOpenids || []
      if (doc.liveOpenid && !_liveAccountOpenids.includes(doc.liveOpenid)) {
        _liveAccountOpenids.push(doc.liveOpenid)
      }
      _isDemoMode = !!doc.active
    }
  } catch (e) {
    _isDemoMode = false
  }
}

function isLiveAccount() {
  if (!_currentOpenid) return false
  return _liveAccountOpenids.includes(_currentOpenid)
}

function isDemoActive() {
  return _isDemoMode && isLiveAccount()
}

function isInitDone() {
  return _initDone
}

/**
 * 在页面中启动演示
 * @param {Object} page - 当前页面实例
 * @param {string} scriptName - 脚本名称
 */
async function startDemo(page, scriptName) {
  const { scripts, getScript } = await loadDemoScripts()
  const allNames = Object.keys(scripts)
  const db = wx.cloud.database()

  const scriptList = []
  for (const name of allNames) {
    const script = getScript(name)
    if (!script) continue

    try {
      const res = await db.collection(DEMO_MODE_COLLECTION).doc(`audio_${name}`).get()
      const data = res.data
      if (data && data.audioUrl) {
        script.audioUrl = data.audioUrl
      } else if (data && data.audioUrls && data.audioUrls[0]) {
        script.audioUrl = data.audioUrls[0]
      }
    } catch (e) {}

    scriptList.push(script)
  }

  const overlay = page.selectComponent('#demoOverlay')
  if (!overlay) {
    return
  }

  overlay.startScriptLoop(scriptList)
}

function startRemoteControl(page) {
  const overlay = page.selectComponent('#demoOverlay')
  if (overlay) {
    overlay.startRemoteControl()
  }
}

module.exports = {
  initDemoEngine,
  isLiveAccount,
  isDemoActive,
  isInitDone,
  startDemo,
  startRemoteControl
}
