/**
 * LL2 网系回收 enrich（云端）
 *
 * 背景：LL2 landing_types 词表没有 Net/Arrestor；长十甲/乙等拦阻网驳船回收
 * 常被填成 Ocean / ASDS。前端会优先信 stage.landing.type，从而画出海上图标，
 * 构型级 NET_CATCH 兜底（icons.length===0 才触发）永远走不到。
 *
 * 策略：在云函数落库/返回前，对可识别为网系回收的任务，把误标的海上类
 * landing.type 改写成前端 normalizeLandingTypeShort 已能识别的：
 *   { abbrev: 'NET', name: 'Arrestor Net' } → NET_CATCH
 *
 * 不改前端；与 utils/landing-icons.js 的 inferNetRecoveryFromLaunch 口径对齐。
 */

const NET_LANDING_TYPE = {
  abbrev: 'NET',
  name: 'Arrestor Net'
}

const NET_RECOVERY_DESC_REGEX = /arrestor\s*net|recovery\s*net|net\s*catch|拦阻网|网系回收/i
const NET_RECOVERY_ROCKET_REGEX = /long\s*march\s*10\s*[ab]?\b|cz[-\s]*10[ab]?\b|长征十号|长十[甲乙]/i

/** 已是网系 → 不动 */
function isAlreadyNetType(raw) {
  const v = String(
    (raw && typeof raw === 'object' ? (raw.abbrev || raw.name) : raw) || ''
  ).toUpperCase().replace(/[\s_-]+/g, '')
  return v === 'NET' || v === 'NC' || v.includes('NETCATCH') || v.includes('ARRESTOR')
}

/**
 * LL2 常用来「顶替」网系回收的海上类类型；以及明确不应覆盖的类型。
 * RTLS / EXP / ATM / Tower 等保留原值。
 */
function shouldRewriteToNet(raw) {
  if (raw == null || raw === '') return true
  if (isAlreadyNetType(raw)) return false
  const v = String(
    typeof raw === 'object' ? (raw.abbrev || raw.name || '') : raw
  ).toUpperCase().replace(/[\s_-]+/g, '')
  if (!v) return true
  if (
    v === 'RTLS' ||
    v === 'EXP' ||
    v === 'EXPENDED' ||
    v === 'EXPENDABLE' ||
    v === 'ATM' ||
    v === 'VL' ||
    v === 'HL' ||
    v === 'TC' ||
    v === 'HC' ||
    v.includes('RETURNTOLAUNCHSITE') ||
    v.includes('TOWER') ||
    v.includes('CHOPSTICK') ||
    v.includes('MECHAZILLA') ||
    v.includes('HELICOPTER') ||
    v.includes('VERTICALLANDING') ||
    v.includes('HORIZONTALLANDING') ||
    v.includes('DESTRUCTIVE')
  ) {
    return false
  }
  // Ocean / ASDS / Splashdown / droneship 等海上顶替 → 改写
  if (
    v === 'ASDS' ||
    v === 'OCEAN' ||
    v === 'SD' ||
    v === 'OCISLY' ||
    v === 'JRTI' ||
    v === 'ASOG' ||
    v.includes('OCEAN') ||
    v.includes('SPLASHDOWN') ||
    v.includes('DRONESHIP') ||
    v.includes('AUTONOMOUSSPACEPORT') ||
    v.includes('ASDS')
  ) {
    return true
  }
  // 其它未知类型：对网系火箭保守改写（避免再出海上误标）
  return true
}

function resolveConfig(launch) {
  if (!launch || !launch.rocket) return null
  return (
    launch.rocket.configuration ||
    (launch.rocket.rocket && launch.rocket.rocket.configuration) ||
    null
  )
}

function isNetRecoveryRocket(launch) {
  const cfg = resolveConfig(launch)
  if (!cfg || cfg.reusable !== true) return false
  if (NET_RECOVERY_DESC_REGEX.test(String(cfg.description || ''))) return true
  const name = [cfg.full_name, cfg.name, cfg.alias].filter(Boolean).join(' ')
  if (NET_RECOVERY_ROCKET_REGEX.test(name)) return true
  // 任务名兜底（构型名偶发不含 10B）
  const launchName = [launch.name, launch.mission && launch.mission.name].filter(Boolean).join(' ')
  return NET_RECOVERY_ROCKET_REGEX.test(launchName)
}

function patchLandingObject(landing) {
  if (!landing || typeof landing !== 'object') {
    return { landing: { type: { ...NET_LANDING_TYPE }, attempt: true }, changed: true }
  }
  const cur = landing.type
  if (!shouldRewriteToNet(cur)) {
    return { landing, changed: false }
  }
  const next = {
    ...landing,
    type: { ...NET_LANDING_TYPE },
    // 未显式标 attempt:false 时，补 true，避免前端把可回收构型判成不回收
    attempt: landing.attempt === false ? false : (landing.attempt != null ? landing.attempt : true)
  }
  return { landing: next, changed: true }
}

function stageListFromRocket(rocket) {
  if (!rocket) return { key: null, arr: null }
  const paths = [
    ['launcher_stage', rocket.launcher_stage],
    ['Launcher_stage', rocket.Launcher_stage],
    ['first_stage', rocket.first_stage]
  ]
  if (rocket.rocket) {
    paths.push(['launcher_stage_nested', rocket.rocket.launcher_stage])
  }
  for (let i = 0; i < paths.length; i++) {
    const [key, raw] = paths[i]
    if (raw == null) continue
    const arr = Array.isArray(raw) ? raw : [raw]
    if (!arr.length) continue
    // nested 写回 rocket.rocket.launcher_stage
    if (key === 'launcher_stage_nested') {
      return { key: 'nested', arr, parent: rocket.rocket }
    }
    return { key, arr, parent: rocket }
  }
  return { key: null, arr: null, parent: null }
}

/**
 * 就地 enrich 单条 launch；返回是否有改动。
 */
function enrichLaunchNetRecovery(launch) {
  if (!launch || typeof launch !== 'object') return false
  if (!isNetRecoveryRocket(launch)) return false

  const rocket = launch.rocket
  if (!rocket) return false

  const found = stageListFromRocket(rocket)
  let changed = false

  if (found.arr && found.arr.length) {
    const nextArr = found.arr.map((st) => {
      if (!st || typeof st !== 'object') return st
      // 明确不回收的 stage 不改
      if (st.landing && st.landing.attempt === false) return st
      const { landing, changed: c } = patchLandingObject(st.landing)
      if (!c) return st
      changed = true
      return { ...st, landing }
    })
    if (changed) {
      if (found.key === 'nested' && found.parent) {
        found.parent.launcher_stage = Array.isArray(rocket.rocket.launcher_stage)
          ? nextArr
          : nextArr[0]
      } else if (found.parent) {
        const raw = found.parent[found.key]
        found.parent[found.key] = Array.isArray(raw) ? nextArr : nextArr[0]
      }
    }
  } else {
    // 无 stage：补一条最小 launcher_stage，让前端结构化链路直接出 NET_CATCH，
    // 而不必依赖 icons.length===0 的构型兜底（与有 Ocean stage 时行为一致）
    rocket.launcher_stage = [{
      type: 'Core',
      reused: false,
      landing: {
        type: { ...NET_LANDING_TYPE },
        attempt: true,
        success: null
      }
    }]
    changed = true
  }

  return changed
}

/** 列表 results 批量 enrich；返回改写条数 */
function enrichLaunchListNetRecovery(apiData) {
  if (!apiData || !Array.isArray(apiData.results)) return 0
  let n = 0
  for (let i = 0; i < apiData.results.length; i++) {
    if (enrichLaunchNetRecovery(apiData.results[i])) n++
  }
  return n
}

module.exports = {
  enrichLaunchNetRecovery,
  enrichLaunchListNetRecovery,
  isNetRecoveryRocket,
  NET_LANDING_TYPE
}
