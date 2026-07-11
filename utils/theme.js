/**
 * utils/theme.js — 全局主题（深色 / 明亮 / 跟随系统）管理器
 *
 * 机制：
 * 1. 主题模式持久化在本地 storage（_app_theme）：'dark' | 'light' | 'system'，默认深色；
 *    system 模式实际生效值取系统主题（需 app.json 开启 "darkmode": true 才能读取与监听）。
 * 2. 页面根 view 绑定 class="{{themeClass}}"，theme-light 时 tokens.wxss 的浅色变量
 *    沿 DOM 继承覆盖整棵页面树（含自定义组件）；
 * 3. setThemeMode() 遍历 getCurrentPages() 即时刷新所有在栈页面 + 自定义 TabBar，
 *    其他 Tab 页靠各自 onShow 的 applyThemeToPage 兜底；
 * 4. 系统主题变化经 wx.onThemeChange 监听（app.js onLaunch 注册），system 模式下全局重刷；
 * 5. 沉浸式页面（AR/全屏视频/图片查看器等）不接入 themeClass，恒定深色。
 */
const THEME_STORAGE_KEY = '_app_theme'
const THEME_DARK = 'dark'
const THEME_LIGHT = 'light'
const THEME_SYSTEM = 'system'

let _mode = ''
let _systemTheme = ''

/** 当前主题模式：'dark' | 'light' | 'system'（未显式选择过时默认跟随系统） */
function getThemeModeSync() {
  if (_mode) return _mode
  try {
    const saved = wx.getStorageSync(THEME_STORAGE_KEY)
    _mode = (saved === THEME_LIGHT || saved === THEME_DARK) ? saved : THEME_SYSTEM
  } catch (e) {
    _mode = THEME_SYSTEM
  }
  return _mode
}

/** 系统当前主题（需 app.json "darkmode": true；读不到时回退深色） */
function getSystemThemeSync() {
  if (_systemTheme) return _systemTheme
  let t = ''
  try {
    if (typeof wx.getAppBaseInfo === 'function') {
      t = (wx.getAppBaseInfo() || {}).theme || ''
    }
  } catch (e) {}
  if (!t) {
    try {
      t = (wx.getSystemInfoSync() || {}).theme || ''
    } catch (e) {}
  }
  _systemTheme = t === THEME_LIGHT ? THEME_LIGHT : THEME_DARK
  return _systemTheme
}

/** 实际生效主题（模式解析后）：'dark' | 'light' */
function getThemeSync() {
  const mode = getThemeModeSync()
  if (mode === THEME_SYSTEM) return getSystemThemeSync()
  return mode
}

function isLightSync() {
  return getThemeSync() === THEME_LIGHT
}

/**
 * 状态栏前景色同步：浅色主题下把系统状态栏文字（时间/信号）切为黑色。
 * 节流 + 异步：所有接线页面 onLoad 都会调 getThemeClassSync()，借此保证
 * 每个新 webview 的状态栏前景色正确；未接线的恒深色页面不受影响
 * （它们不调本方法，沿用页面 json 的 navigationBarTextStyle）。
 */
let _lastNavSyncAt = 0
function _scheduleNavBarSync(force) {
  const now = Date.now()
  if (!force && now - _lastNavSyncAt < 200) return
  _lastNavSyncAt = now
  setTimeout(() => {
    try {
      wx.setNavigationBarColor({
        frontColor: isLightSync() ? '#000000' : '#ffffff',
        backgroundColor: getPageBgSync(),
        fail: () => {}
      })
    } catch (e) {}
  }, 0)
}

/** 页面根 view 的主题类名（深色为空串，保持现有样式零改动） */
function getThemeClassSync() {
  const cls = isLightSync() ? 'theme-light' : ''
  _scheduleNavBarSync(false)
  return cls
}

/** page-meta / wx.setBackgroundColor 用的页面底色 */
function getPageBgSync() {
  return isLightSync() ? '#F2F2F7' : '#000000'
}

/** 把当前主题写入某个页面实例（data.themeClass / data.themeLight） */
function applyThemeToPage(page) {
  if (!page || typeof page.setData !== 'function') return
  // Tab 页的自定义 TabBar 是独立组件实例（每页一份），切主题时 refreshAllPages
  // 只能刷到当前页面栈里的那份，其余 Tab 页回显时须在这里补刷（非 Tab 页安全 no-op）
  applyThemeToTabBar(page)
  const cls = getThemeClassSync()
  const data = page.data || {}
  if (data.themeClass === cls && data.themeLight === (cls !== '')) return
  page.setData({
    themeClass: cls,
    themeLight: cls !== '',
    pageBgColor: getPageBgSync()
  })
}

/** 刷新自定义 TabBar 的主题（TabBar 组件实现 applyTheme 方法） */
function applyThemeToTabBar(page) {
  try {
    if (page && typeof page.getTabBar === 'function') {
      const tabBar = page.getTabBar()
      if (tabBar && typeof tabBar.applyTheme === 'function') tabBar.applyTheme()
    }
  } catch (e) {}
}

/** 同步下拉刷新背景区（page{} 的静态底色无法运行时改，用原生 API 补） */
function syncWindowBackground() {
  const c = getPageBgSync()
  try {
    wx.setBackgroundColor({ backgroundColor: c, backgroundColorTop: c, backgroundColorBottom: c })
  } catch (e) {}
  try {
    wx.setBackgroundTextStyle({ textStyle: isLightSync() ? 'dark' : 'light' })
  } catch (e) {}
}

/**
 * 轻量主题变更监听：refreshAllPages 只刷页面 data 与 TabBar，不通知组件；
 * 需要感知全局主题切换的组件（如贴图讨论区的原生组件外壳）在 attached 注册、detached 注销。
 */
let _themeListeners = []

/** 注册主题变更监听器（refreshAllPages 触发时回调，无参数） */
function onThemeChange(fn) {
  if (typeof fn !== 'function') return
  if (_themeListeners.indexOf(fn) === -1) _themeListeners.push(fn)
}

/** 注销主题变更监听器 */
function offThemeChange(fn) {
  const i = _themeListeners.indexOf(fn)
  if (i !== -1) _themeListeners.splice(i, 1)
}

/** 按当前生效主题即时重刷所有在栈页面、TabBar、窗口背景与状态栏 */
function refreshAllPages() {
  const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || []
  pages.forEach((p) => {
    applyThemeToPage(p)
    applyThemeToTabBar(p)
  })
  syncWindowBackground()
  _scheduleNavBarSync(true)
  // 通知已注册组件（单个监听器异常不阻断其余监听器与主流程）
  _themeListeners.slice().forEach((fn) => {
    try {
      fn()
    } catch (e) {}
  })
}

/**
 * 切换主题模式：持久化 + 全局即时生效。
 * @param {string} mode 'dark' | 'light' | 'system'
 */
function setThemeMode(mode) {
  const m = (mode === THEME_LIGHT || mode === THEME_SYSTEM) ? mode : THEME_DARK
  if (m === _mode) return
  _mode = m
  try {
    wx.setStorageSync(THEME_STORAGE_KEY, m)
  } catch (e) {}
  if (m === THEME_SYSTEM) {
    _systemTheme = ''
    getSystemThemeSync()
  }
  refreshAllPages()
}

/** 兼容旧调用：直接指定深/浅（等价于 setThemeMode） */
function setTheme(theme) {
  setThemeMode(theme)
}

/**
 * 监听系统主题变化（app.js onLaunch 调一次）：
 * system 模式下随系统即时切换；其他模式只更新缓存不动 UI。
 */
let _systemListenerInstalled = false
function initSystemThemeListener() {
  if (_systemListenerInstalled) return
  if (typeof wx.onThemeChange !== 'function') return
  _systemListenerInstalled = true
  try {
    wx.onThemeChange((res) => {
      const t = res && res.theme === THEME_LIGHT ? THEME_LIGHT : THEME_DARK
      if (t === _systemTheme) return
      _systemTheme = t
      if (getThemeModeSync() === THEME_SYSTEM) {
        refreshAllPages()
      }
    })
  } catch (e) {}
}

module.exports = {
  THEME_DARK,
  THEME_LIGHT,
  THEME_SYSTEM,
  getThemeModeSync,
  getSystemThemeSync,
  getThemeSync,
  isLightSync,
  getThemeClassSync,
  getPageBgSync,
  applyThemeToPage,
  applyThemeToTabBar,
  syncWindowBackground,
  onThemeChange,
  offThemeChange,
  refreshAllPages,
  setThemeMode,
  setTheme,
  initSystemThemeListener
}
