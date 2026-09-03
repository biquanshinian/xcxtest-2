/**
 * Tab 切换全屏加载门控：仅目标页 busy 时显示遮罩，ready 后立刻消失。
 * 80ms 延迟防热切闪一下；最长 4s 兜底揭开。
 * 所有对外 API 均吞异常，保证调用方绝无 JS 报错。
 */

var SHOW_DELAY_MS = 80
var MAX_SHOW_MS = 4000

var _listeners = []
var _state = {
  visible: false,
  pendingPath: '',
  busyPath: '',
  warm: Object.create(null)
}

var _delayTimer = null
var _maxTimer = null

function _normalizePath(path) {
  try {
    var p = String(path == null ? '' : path).trim()
    if (!p) return ''
    if (p.charAt(0) === '/') p = p.slice(1)
    var q = p.indexOf('?')
    if (q >= 0) p = p.slice(0, q)
    return p
  } catch (e) {
    return ''
  }
}

function _emit() {
  var snap = {
    visible: !!_state.visible,
    path: _state.pendingPath || _state.busyPath || ''
  }
  for (var i = 0; i < _listeners.length; i += 1) {
    try { _listeners[i](snap) } catch (e) {}
  }
}

function _clearDelay() {
  if (_delayTimer) {
    try { clearTimeout(_delayTimer) } catch (e) {}
    _delayTimer = null
  }
}

function _clearMax() {
  if (_maxTimer) {
    try { clearTimeout(_maxTimer) } catch (e) {}
    _maxTimer = null
  }
}

function _show() {
  if (_state.visible) return
  _state.visible = true
  _clearMax()
  try {
    _maxTimer = setTimeout(function () {
      _maxTimer = null
      try { _hide() } catch (e) {}
    }, MAX_SHOW_MS)
  } catch (e) {
    _maxTimer = null
  }
  _emit()
}

function _hide() {
  _clearDelay()
  _clearMax()
  _state.visible = false
  _state.pendingPath = ''
  _state.busyPath = ''
  _emit()
}

function subscribe(fn) {
  if (typeof fn !== 'function') return function () {}
  try { _listeners.push(fn) } catch (e) { return function () {} }
  try {
    fn({
      visible: !!_state.visible,
      path: _state.pendingPath || _state.busyPath || ''
    })
  } catch (e) {}
  return function unsubscribe() {
    try {
      var i = _listeners.indexOf(fn)
      if (i >= 0) _listeners.splice(i, 1)
    } catch (e) {}
  }
}

/**
 * Tab 开始切换：记录目标；80ms 后若仍 busy 或冷页未 ready 才显示。
 * 热页且未 busy：延迟窗口内无 busy 则不显示。
 */
function beginTabSwitch(path) {
  try {
    var p = _normalizePath(path)
    if (!p) return
    _clearDelay()
    _state.pendingPath = p

    var warm = !!_state.warm[p]
    _delayTimer = setTimeout(function () {
      try {
        _delayTimer = null
        if (_state.pendingPath !== p) return
        if (_state.busyPath === p) {
          _show()
          return
        }
        if (!warm) {
          // 冷页：onLoad 可能稍晚才 markBusy，先盖住卡顿
          _show()
          return
        }
        // 热页且当前目标未 busy：不显示；揭开上一趟残留遮罩（含其它页 busy）
        _state.pendingPath = ''
        if (_state.visible) {
          _hide()
        }
      } catch (e) {}
    }, SHOW_DELAY_MS)
  } catch (e) {}
}

function markTabBusy(path) {
  try {
    var p = _normalizePath(path)
    if (!p) return
    _state.busyPath = p
    if (_state.pendingPath === p) {
      _clearDelay()
      _show()
    }
  } catch (e) {}
}

function markTabReady(path) {
  try {
    var p = _normalizePath(path)
    if (!p) return
    _state.warm[p] = true
    if (_state.busyPath === p) _state.busyPath = ''
    // 仅目标匹配时揭开，避免其它页 ready 误关当前切换遮罩
    if (_state.pendingPath === p) {
      _hide()
    }
  } catch (e) {}
}

/** 取消一次切换（如 switchTab fail）：揭开遮罩，但不记入 warm */
function cancelTabSwitch(path) {
  try {
    var p = _normalizePath(path)
    if (!p) return
    if (_state.pendingPath === p) {
      _hide()
      return
    }
    if (_state.busyPath === p) _state.busyPath = ''
  } catch (e) {}
}

function isTabWarm(path) {
  try {
    return !!_state.warm[_normalizePath(path)]
  } catch (e) {
    return false
  }
}

function getState() {
  try {
    return {
      visible: !!_state.visible,
      pendingPath: _state.pendingPath,
      busyPath: _state.busyPath
    }
  } catch (e) {
    return { visible: false, pendingPath: '', busyPath: '' }
  }
}

module.exports = {
  beginTabSwitch: beginTabSwitch,
  markTabBusy: markTabBusy,
  markTabReady: markTabReady,
  cancelTabSwitch: cancelTabSwitch,
  isTabWarm: isTabWarm,
  subscribe: subscribe,
  getState: getState,
  normalizePath: _normalizePath
}
