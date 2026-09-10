const saved = Object.create(null)
let lastPos = 0
let restoreGen = 0
let pendingPath = ''

function historyPos() {
  if (typeof window === 'undefined' || !window.history || !window.history.state) return lastPos
  const pos = window.history.state.position
  return typeof pos === 'number' ? pos : lastPos
}

function mainEl() {
  if (typeof document === 'undefined') return null
  return document.querySelector('.layout-main')
}

function winEl() {
  if (typeof document === 'undefined') return null
  return document.scrollingElement || document.documentElement
}

function readPos() {
  const main = mainEl()
  const win = winEl()
  return {
    main: main ? main.scrollTop : 0,
    win: win ? win.scrollTop : 0,
    left: main ? main.scrollLeft : 0
  }
}

function writePos(rec) {
  const main = mainEl()
  const win = winEl()
  if (main) {
    if (rec.main != null) main.scrollTop = rec.main
    if (rec.left != null) main.scrollLeft = rec.left
  }
  if (win && rec.win != null) win.scrollTop = rec.win
}

function escapeAttr(value) {
  const s = String(value || '')
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s)
  return s.replace(/["\\]/g, '\\$&')
}

export function markLeave(path, anchor) {
  if (!path) return
  const pos = readPos()
  const prev = saved[path] || {}
  saved[path] = {
    main: pos.main,
    win: pos.win,
    left: pos.left,
    anchor: anchor || prev.anchor || ''
  }
}

export function capturePath(path) {
  if (!path) return
  const pos = readPos()
  const prev = saved[path] || {}
  saved[path] = {
    main: pos.main,
    win: pos.win,
    left: pos.left,
    anchor: prev.anchor || ''
  }
}

export function applyRestore(path) {
  const rec = saved[path]
  if (!rec) return false
  if (rec.anchor && typeof document !== 'undefined') {
    const node = document.querySelector('[data-pa-anchor="' + escapeAttr(rec.anchor) + '"]')
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center', inline: 'nearest' })
      return true
    }
  }
  writePos(rec)
  return true
}

export function restoreIfPending(path) {
  if (!path || pendingPath !== path) return false
  return applyRestore(path)
}

export function resetScroller() {
  writePos({ main: 0, win: 0, left: 0 })
}

export function bindRouter(router) {
  lastPos = historyPos()
  router.beforeEach((to, from) => {
    if (from && from.fullPath && String(from.path || '').startsWith('/preaudit')) {
      capturePath(from.fullPath)
    }
  })
  router.afterEach((to, from) => {
    const pos = historyPos()
    const back = pos < lastPos
    lastPos = pos
    if (!String(to.path || '').startsWith('/preaudit')) return
    const my = ++restoreGen
    const path = to.fullPath
    if (back) {
      pendingPath = path
      const run = () => {
        if (restoreGen !== my) return
        applyRestore(path)
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      setTimeout(run, 60)
      setTimeout(run, 180)
      setTimeout(run, 480)
      return
    }
    pendingPath = ''
    if (from && from.fullPath && from.fullPath !== to.fullPath) {
      const run = () => {
        if (restoreGen === my) resetScroller()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else run()
    }
  })
}
