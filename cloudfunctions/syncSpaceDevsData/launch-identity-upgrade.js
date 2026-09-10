/**
 * LL2 发射身份升级（纯函数）
 *
 * 中国航行警告任务常先以 Unknown Payload / 猜测构型入库，成功后再改火箭与载荷。
 * 终态缓存不得把首次占位冻死。本模块判断「谁更像已公布身份」，并就地回写。
 *
 * ⚠ syncSpaceDevsData / ll2Query 双副本，改动必须两边同步（dual-copy-parity）。
 */

function trimStr(s) {
  return String(s == null ? '' : s).trim()
}

function isGenericMissionTitle(s) {
  const t = trimStr(s)
  if (!t) return true
  const lower = t.toLowerCase()
  if (/^unknown(\s+payloads?)?$/.test(lower)) return true
  if (/^unknown\s+payload/.test(lower)) return true
  if (/^未知(有效)?载荷$/.test(t) || /^未知任务$/.test(t)) return true
  if (/[|｜]\s*(未知(有效)?载荷|unknown\s+payloads?)\s*$/i.test(t)) return true
  return false
}

function isGenericRocketName(s) {
  const t = trimStr(s)
  if (!t) return true
  return /^(未知|未知火箭|待定|tbd|n\/?a|-|—|unknown( rocket)?)$/i.test(t)
}

function splitLaunchTitle(name) {
  const parts = trimStr(name)
    .split('|')
    .map((s) => trimStr(s))
    .filter(Boolean)
  if (parts.length >= 2) {
    return { rocketPart: parts[0], missionPart: parts.slice(1).join(' | ') }
  }
  return { rocketPart: '', missionPart: parts[0] || '' }
}

function getRocketCfg(row) {
  if (!row || !row.rocket) return null
  return row.rocket.configuration || (row.rocket.rocket && row.rocket.rocket.configuration) || null
}

function rocketNameFromRow(row) {
  const cfg = getRocketCfg(row)
  if (cfg) {
    const full = trimStr(cfg.full_name || cfg.name)
    if (full && !isGenericRocketName(full)) return full
  }
  const fromTitle = splitLaunchTitle(row && row.name).rocketPart
  return fromTitle
}

function missionNameFromRow(row) {
  const fromMission = row && row.mission ? trimStr(row.mission.name) : ''
  const fromTitle = splitLaunchTitle(row && row.name).missionPart
  if (fromMission && !isGenericMissionTitle(fromMission)) return fromMission
  if (fromTitle && !isGenericMissionTitle(fromTitle)) return fromTitle
  return fromMission || fromTitle
}

/** list / launch_status 常只有 name，没有 mission / configuration */
function resolveIncomingMission(incoming) {
  if (incoming && incoming.mission && typeof incoming.mission === 'object') {
    const name = trimStr(incoming.mission.name)
    const titlePart = splitLaunchTitle(incoming.name).missionPart
    if (isGenericMissionTitle(name) && titlePart && !isGenericMissionTitle(titlePart)) {
      return Object.assign({}, incoming.mission, { name: titlePart })
    }
    return incoming.mission
  }
  const missionPart = splitLaunchTitle(incoming && incoming.name).missionPart
  if (missionPart && !isGenericMissionTitle(missionPart)) {
    return { name: missionPart }
  }
  return null
}

function sameRocketFamily(a, b) {
  const ka = foldRocketKey(a)
  const kb = foldRocketKey(b)
  if (!ka || !kb) return false
  return ka === kb || ka.indexOf(kb) === 0 || kb.indexOf(ka) === 0
}

function resolveIncomingRocketCfg(incoming, current) {
  const cfg = getRocketCfg(incoming)
  const titleRocket = splitLaunchTitle(incoming && incoming.name).rocketPart
  const cfgName = cfg ? trimStr(cfg.full_name || cfg.name) : ''
  const curRocket = rocketNameFromRow(current)
  const curWeak = hasWeakLaunchIdentity(current)
  if ((!cfg || isGenericRocketName(cfgName)) && titleRocket && !isGenericRocketName(titleRocket)) {
    if (curRocket && !isGenericRocketName(curRocket) && sameRocketFamily(titleRocket, curRocket)) {
      return cfg
    }
    return Object.assign({}, cfg || {}, { name: titleRocket, full_name: (cfg && cfg.full_name) || titleRocket })
  }
  // 占位行：title 已改成四号乙，但 list 行 configuration 仍粘着二号丁 / 二号丁/远征三号
  if (
    curWeak &&
    titleRocket &&
    !isGenericRocketName(titleRocket) &&
    foldRocketKey(titleRocket) !== foldRocketKey(curRocket) &&
    (!cfgName || isGenericRocketName(cfgName) || sameRocketFamily(cfgName, curRocket))
  ) {
    return Object.assign({}, cfg || {}, { name: titleRocket, full_name: titleRocket })
  }
  return cfg
}

function foldRocketKey(s) {
  return trimStr(s)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function missionTypeName(type) {
  if (type == null) return ''
  if (typeof type === 'string') return trimStr(type)
  if (typeof type === 'object') return trimStr(type.name || type.abbrev || type.full_name)
  return trimStr(type)
}

function hasOrbit(mission) {
  const orbit = mission && mission.orbit
  if (!orbit || typeof orbit !== 'object') return false
  return !!(orbit.name || orbit.abbrev || orbit.id != null)
}

function hasWeakLaunchIdentity(row) {
  if (!row) return true
  return isGenericMissionTitle(missionNameFromRow(row)) || isGenericRocketName(rocketNameFromRow(row))
}

function isRecentLaunchNet(row, nowMs, windowMs) {
  const netMs = row && row.net ? new Date(row.net).getTime() : NaN
  if (!Number.isFinite(netMs)) return false
  const now = Number(nowMs) || Date.now()
  const win = Number(windowMs) > 0 ? Number(windowMs) : 48 * 60 * 60 * 1000
  return netMs >= now - win && netMs <= now + 60 * 60 * 1000
}

function identityDiffers(current, incoming) {
  if (!current || !incoming) return true
  if (foldRocketKey(rocketNameFromRow(current)) !== foldRocketKey(rocketNameFromRow(incoming))) return true
  const a = missionNameFromRow(current).toLowerCase()
  const b = missionNameFromRow(incoming).toLowerCase()
  if (a !== b) return true
  return false
}

function canFillMissingIdentity(current, incoming) {
  if (!incoming) return false
  const curMission = current && current.mission
  const inMission = incoming.mission
  if (inMission) {
    if (missionTypeName(inMission.type) && !missionTypeName(curMission && curMission.type)) return true
    if (hasOrbit(inMission) && !hasOrbit(curMission)) return true
    if (trimStr(inMission.description) && !trimStr(curMission && curMission.description)) return true
  }
  if (incoming.net_precision && !current.net_precision) return true
  return false
}

/**
 * @param {object|null} current
 * @param {object|null} incoming
 * @param {{ trustIncoming?: boolean }} [opts]
 *   trustIncoming：incoming 来自新鲜 LL2（详情 / previous list），允许用已公布名覆盖另一个已公布名。
 *   未信任来源（upcoming 旧缓存）只能弱→强，禁止强→弱、禁止两强互踩。
 */
function shouldUpgradeLaunchIdentity(current, incoming, opts) {
  if (!incoming) return false
  if (!current) return true
  const inWeak = hasWeakLaunchIdentity(incoming)
  const curWeak = hasWeakLaunchIdentity(current)
  if (inWeak && !curWeak) return false
  if (!inWeak && curWeak) return true
  if (opts && opts.trustIncoming && !inWeak && identityDiffers(current, incoming)) return true
  return canFillMissingIdentity(current, incoming)
}

function applyLaunchIdentityUpgrade(target, incoming, opts) {
  if (!target || !incoming) return { changed: false, fields: [] }
  if (!shouldUpgradeLaunchIdentity(target, incoming, opts)) {
    return { changed: false, fields: [] }
  }
  const trust = !!(opts && opts.trustIncoming)
  const fields = []
  const curWeak = hasWeakLaunchIdentity(target)
  const incomingMission = resolveIncomingMission(incoming)
  const inCfg = resolveIncomingRocketCfg(incoming, target)

  const inName = trimStr(incoming.name)
  const curName = trimStr(target.name)
  const inMissionName = missionNameFromRow(incoming)
  const curMissionName = missionNameFromRow(target)
  if (
    inName &&
    inName !== curName &&
    !isGenericMissionTitle(inMissionName) &&
    (isGenericMissionTitle(curMissionName) || trust)
  ) {
    target.name = inName
    if (incoming.nameZh) target.nameZh = incoming.nameZh
    else delete target.nameZh
    fields.push('name')
  }

  if (incomingMission) {
    if (!target.mission || typeof target.mission !== 'object') target.mission = {}
    const inM = trimStr(incomingMission.name)
    const curM = trimStr(target.mission.name)
    if (inM && inM !== curM && !isGenericMissionTitle(inM) && (isGenericMissionTitle(curM) || trust)) {
      target.mission.name = inM
      if (incomingMission.nameZh) target.mission.nameZh = incomingMission.nameZh
      else delete target.mission.nameZh
      fields.push('mission.name')
    }
    if (trimStr(incomingMission.description) && (trust || !trimStr(target.mission.description))) {
      target.mission.description = incomingMission.description
      if (incomingMission.descriptionZh) target.mission.descriptionZh = incomingMission.descriptionZh
      fields.push('mission.description')
    }
    if (missionTypeName(incomingMission.type) && (trust || !missionTypeName(target.mission.type))) {
      target.mission.type = incomingMission.type
      fields.push('mission.type')
    }
    if (hasOrbit(incomingMission) && (trust || !hasOrbit(target.mission))) {
      target.mission.orbit = incomingMission.orbit
      fields.push('mission.orbit')
    }
  }

  const curCfg = getRocketCfg(target)
  const inRocket = inCfg
    ? trimStr(inCfg.full_name || inCfg.name) || rocketNameFromRow(incoming)
    : rocketNameFromRow(incoming)
  const curRocket = rocketNameFromRow(target)
  if (inCfg && inRocket && !isGenericRocketName(inRocket)) {
    const rocketDiffers = foldRocketKey(inRocket) !== foldRocketKey(curRocket)
    if (
      isGenericRocketName(curRocket) ||
      (trust && rocketDiffers) ||
      (!curCfg && inCfg) ||
      (curWeak && rocketDiffers)
    ) {
      if (!target.rocket || typeof target.rocket !== 'object') target.rocket = {}
      const nextCfg = {
        ...(curCfg || {}),
        id: inCfg.id != null ? inCfg.id : curCfg && curCfg.id,
        name: inCfg.name || (curCfg && curCfg.name) || '',
        full_name: inCfg.full_name || inCfg.name || (curCfg && curCfg.full_name) || '',
        family: inCfg.family != null ? inCfg.family : curCfg && curCfg.family,
        variant: inCfg.variant != null ? inCfg.variant : curCfg && curCfg.variant,
        reusable: inCfg.reusable === true ? true : curCfg && curCfg.reusable
      }
      if (inCfg.nameZh) nextCfg.nameZh = inCfg.nameZh
      else if (rocketDiffers) delete nextCfg.nameZh
      if (inCfg.full_nameZh) nextCfg.full_nameZh = inCfg.full_nameZh
      else if (rocketDiffers) delete nextCfg.full_nameZh
      target.rocket.configuration = nextCfg
      fields.push('rocket')
    }
  }

  if (incoming.net_precision && (trust || !target.net_precision)) {
    target.net_precision = incoming.net_precision
    fields.push('net_precision')
  }

  return { changed: fields.length > 0, fields }
}

/** upcoming 完整行提供工位/回收级，live 提供更新后的火箭/载荷 */
function mergeLaunchSourcesForStub(cached, live) {
  if (!cached) return live || null
  if (!live) return cached
  const out = { ...cached }
  if (cached.rocket) out.rocket = { ...cached.rocket }
  applyLaunchIdentityUpgrade(out, live, { trustIncoming: !hasWeakLaunchIdentity(live) })
  return out
}

/** configuration 与 LL2 name 火箭段不是同族（二号丁 cfg + 四号乙标题） */
function titleCfgRocketMismatch(row) {
  const titleRocket = splitLaunchTitle(row && row.name).rocketPart
  const cfg = getRocketCfg(row)
  const cfgName = cfg ? trimStr(cfg.full_name || cfg.name) : ''
  if (!titleRocket || isGenericRocketName(titleRocket)) return false
  if (!cfgName || isGenericRocketName(cfgName)) return false
  return !sameRocketFamily(titleRocket, cfgName)
}

/** 用行内 LL2 name 纠偏仍粘着的 cfg / mission，不打 LL2 */
function alignLaunchIdentityFromTitle(row) {
  if (!row || !trimStr(row.name)) return { changed: false, fields: [] }
  return applyLaunchIdentityUpgrade(row, { id: row.id, name: row.name }, { trustIncoming: true })
}

function rowNeedsIdentityProbe(row, nowMs) {
  if (!row) return false
  if (!isRecentLaunchNet(row, nowMs, IDENTITY_RECENT_NET_MS)) return false
  if (hasWeakLaunchIdentity(row)) return true
  if (titleCfgRocketMismatch(row)) return true
  return false
}

const IDENTITY_WEAK_TTL_MS = 15 * 60 * 1000
const IDENTITY_RECENT_TTL_MS = 30 * 60 * 1000
const IDENTITY_TERMINAL_TTL_MS = 7 * 24 * 60 * 60 * 1000
const IDENTITY_UPCOMING_TTL_MS = 3.5 * 60 * 60 * 1000
const IDENTITY_WEAK_REFRESH_AGE_MS = 10 * 60 * 1000
const IDENTITY_RECENT_REFRESH_AGE_MS = 20 * 60 * 1000
const IDENTITY_RECENT_NET_MS = 48 * 60 * 60 * 1000

function isTerminalStatusId(id) {
  return id === 3 || id === 4 || id === 7 || id === 9
}

function detailCacheTtlMs(launch, nowMs, opts) {
  if (opts && opts.translateTimedOut) return 10 * 60 * 1000
  const sid = launch && launch.status && launch.status.id != null ? Number(launch.status.id) : 0
  if (!isTerminalStatusId(sid)) return IDENTITY_UPCOMING_TTL_MS
  if (hasWeakLaunchIdentity(launch)) return IDENTITY_WEAK_TTL_MS
  if (isRecentLaunchNet(launch, nowMs, IDENTITY_RECENT_NET_MS)) return IDENTITY_RECENT_TTL_MS
  return IDENTITY_TERMINAL_TTL_MS
}

function shouldRefreshCachedLaunchIdentity(detail, cacheMeta, nowMs) {
  if (!detail) return false
  const cacheAge = Number(cacheMeta && cacheMeta.cacheAge) || 0
  if (hasWeakLaunchIdentity(detail) && cacheAge >= IDENTITY_WEAK_REFRESH_AGE_MS) return true
  const sid = detail.status && detail.status.id != null ? Number(detail.status.id) : 0
  if (
    isTerminalStatusId(sid) &&
    isRecentLaunchNet(detail, nowMs, IDENTITY_RECENT_NET_MS) &&
    cacheAge >= IDENTITY_RECENT_REFRESH_AGE_MS
  ) {
    return true
  }
  return false
}

module.exports = {
  isGenericMissionTitle,
  isGenericRocketName,
  splitLaunchTitle,
  rocketNameFromRow,
  missionNameFromRow,
  hasWeakLaunchIdentity,
  isRecentLaunchNet,
  shouldUpgradeLaunchIdentity,
  applyLaunchIdentityUpgrade,
  mergeLaunchSourcesForStub,
  titleCfgRocketMismatch,
  alignLaunchIdentityFromTitle,
  rowNeedsIdentityProbe,
  detailCacheTtlMs,
  shouldRefreshCachedLaunchIdentity,
  IDENTITY_WEAK_TTL_MS,
  IDENTITY_RECENT_TTL_MS,
  IDENTITY_TERMINAL_TTL_MS,
  IDENTITY_RECENT_NET_MS
}
