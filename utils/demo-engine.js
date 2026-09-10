/**
 * 主包薄壳：演示引擎已下沉 subpackages/shared/utils/demo-engine.js
 */
const DEMO_ENGINE_PKG = '../subpackages/shared/utils/demo-engine.js'

let _modPromise = null
let _mod = null
function loadDemoEngine() {
  if (!_modPromise) {
    _modPromise = require.async(DEMO_ENGINE_PKG).then(function (m) {
      _mod = m
      return m
    })
  }
  return _modPromise
}

function initDemoEngine() {
  return loadDemoEngine().then(function (m) { return m.initDemoEngine() })
}

function isLiveAccount() {
  return _mod ? _mod.isLiveAccount() : false
}

function isDemoActive() {
  return _mod ? _mod.isDemoActive() : false
}

function isInitDone() {
  return _mod ? _mod.isInitDone() : false
}

function startDemo() {
  const args = arguments
  return loadDemoEngine().then(function (m) { return m.startDemo.apply(m, args) })
}

function startRemoteControl() {
  const args = arguments
  return loadDemoEngine().then(function (m) { return m.startRemoteControl.apply(m, args) })
}

module.exports = {
  initDemoEngine,
  isLiveAccount,
  isDemoActive,
  isInitDone,
  startDemo,
  startRemoteControl,
  loadDemoEngine
}
