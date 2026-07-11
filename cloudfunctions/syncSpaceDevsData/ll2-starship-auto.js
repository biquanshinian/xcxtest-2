/**
 * 自动识别 LL2 上的「星舰」发射任务（火箭配置名为 Starship）
 * - 优先 upcoming 按 net 升序第一条
 * - 若无则 previous 按 net 降序第一条（便于发射后仍能看时间线/动态）
 *
 * @param {(url: string) => Promise<any>} fetchAPI shared.fetchAPI
 * @param {string} LAUNCH_LIBRARY_API 根路径如 https://ll.thespacedevs.com/2.3.0
 */

const CACHE_TTL_MS = 90 * 1000
let _mem = { ts: 0, launchId: '', launchName: '', net: '', source: '' }

function firstLaunch(rows) {
  if (!Array.isArray(rows)) return null
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r && r.id) {
      return {
        launchId: String(r.id),
        launchName: typeof r.name === 'string' ? r.name : '',
        net: r.net || ''
      }
    }
  }
  return null
}

/**
 * @returns {Promise<{ launchId: string, launchName: string, net: string, source: 'upcoming'|'previous'|'', cached: boolean }>}
 */
async function resolveAutoStarshipLaunch(fetchAPI, LAUNCH_LIBRARY_API) {
  const now = Date.now()
  if (_mem.launchId && now - _mem.ts < CACHE_TTL_MS) {
    return {
      launchId: _mem.launchId,
      launchName: _mem.launchName,
      net: _mem.net,
      source: _mem.source || '',
      cached: true
    }
  }

  const baseQs = [
    'format=json',
    'mode=list',
    'rocket__configuration__name=' + encodeURIComponent('Starship'),
    'limit=30'
  ]

  const upcomingUrl =
    LAUNCH_LIBRARY_API + '/launches/upcoming/?' + baseQs.concat(['ordering=' + encodeURIComponent('net')]).join('&')
  const upData = await fetchAPI(upcomingUrl)
  let picked = firstLaunch(upData && upData.results)
  let source = /** @type {'upcoming'|'previous'|''} */ ('')

  if (picked) {
    source = 'upcoming'
  } else {
    const prevUrl =
      LAUNCH_LIBRARY_API +
      '/launches/previous/?' +
      baseQs.concat(['ordering=' + encodeURIComponent('-net')]).join('&')
    const pvData = await fetchAPI(prevUrl)
    picked = firstLaunch(pvData && pvData.results)
    if (picked) source = 'previous'
  }

  if (!picked || !picked.launchId) {
    _mem = { ts: now, launchId: '', launchName: '', net: '', source: '' }
    return { launchId: '', launchName: '', net: '', source: '', cached: false }
  }

  _mem = { ts: now, launchId: picked.launchId, launchName: picked.launchName, net: picked.net, source }
  return {
    launchId: picked.launchId,
    launchName: picked.launchName,
    net: picked.net,
    source,
    cached: false
  }
}

module.exports = {
  resolveAutoStarshipLaunch,
  CACHE_TTL_MS
}
