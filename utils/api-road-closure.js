/**
 * 主包薄壳：封路读库实现已下沉 subpackages/progress-extra/utils/api-road-closure.js
 */
const ROAD_CLOSURE_PKG = '../subpackages/progress-extra/utils/api-road-closure.js'

let _modPromise = null
function loadRoadClosureApi() {
  if (!_modPromise) {
    _modPromise = require.async(ROAD_CLOSURE_PKG)
  }
  return _modPromise
}

async function getRoadClosureNotice() {
  const m = await loadRoadClosureApi()
  return m.getRoadClosureNotice()
}

module.exports = {
  getRoadClosureNotice,
  loadRoadClosureApi
}
