/**
 * 历史/即将发射列表卡完整度：占位识别、从 LL2 name 拆火箭、同 id 选更完整的卡。
 * 终态 previous stub 常缺 rocket.configuration / pad，映射成 Unknown rocket / 未知地点；
 * 详情页走 detailed 所以正常。列表合并时必须跳过占位，不能让瘦卡盖掉完整卡。
 */

const PLACEHOLDER_FIELD_RE =
  /^(未知|未知火箭|未知地点|未知任务|未知载荷|未知有效载荷|待定|TBD|N\/A|-|—|unknown( rocket| location| launch site| mission| payload)?)$/i

function isPlaceholderMissionField(v) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return true
  return PLACEHOLDER_FIELD_RE.test(s)
}

function parseRocketMissionFromLaunchName(name) {
  const parts = String(name || '')
    .split('|')
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return { rocketName: parts[0], missionName: parts.slice(1).join(' | ') }
  }
  return { rocketName: '', missionName: parts[0] || '' }
}

function foldRocketKey(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function sameRocketFamily(a, b) {
  const ka = foldRocketKey(a)
  const kb = foldRocketKey(b)
  if (!ka || !kb) return false
  return ka === kb || ka.indexOf(kb) === 0 || kb.indexOf(ka) === 0
}

/**
 * 列表/详情火箭展示跟 LL2 `name` 对齐。
 * configuration 可能仍粘着航行警告猜测构型（二号丁），而 name 已是四号乙。
 * 同族时保留 cfg（Falcon 9 Block 5 比标题 Falcon 9 更具体）。
 */
function pickLl2AlignedRocketName(cfgName, launchName) {
  const fromCfg = String(cfgName || '').trim()
  const fromName = String(parseRocketMissionFromLaunchName(launchName).rocketName || '').trim()
  const cfgOk = !!(fromCfg && !isPlaceholderMissionField(fromCfg))
  const nameOk = !!(fromName && !isPlaceholderMissionField(fromName))
  if (nameOk && cfgOk && !sameRocketFamily(fromCfg, fromName)) return fromName
  if (cfgOk) return fromCfg
  return nameOk ? fromName : ''
}

function scoreMissionCardIdentity(item) {
  if (!item) return 0
  let score = 0
  if (!isPlaceholderMissionField(item.rocketName)) score += 2
  const missionName = String(item.missionName || '').trim()
  if (missionName && !isPlaceholderMissionField(missionName)) {
    score += 3
    return score
  }
  const parsed = parseRocketMissionFromLaunchName(item.name)
  if (parsed.missionName && !isPlaceholderMissionField(parsed.missionName)) score += 3
  return score
}

function scoreMissionCardCompleteness(item) {
  if (!item) return 0
  let score = 0
  if (!isPlaceholderMissionField(item.rocketName)) score += 4
  if (!isPlaceholderMissionField(item.missionName)) score += 3
  if (
    !isPlaceholderMissionField(item.padLocation) ||
    !isPlaceholderMissionField(item.launchSite)
  ) {
    score += 4
  }
  if (!isPlaceholderMissionField(item.countryDisplay)) score += 1
  if (item.rocketImage || item.image) score += 2
  const cfg = item.rocketConfiguration
  if (cfg && (cfg.name || cfg.full_name)) score += 2
  if (item.boosterInfo) score += 1
  if (Array.isArray(item.recoveryIcons) && item.recoveryIcons.length) score += 1
  if (item.launchAgency && !isPlaceholderMissionField(item.launchAgency)) score += 1
  if (!item._fromRecentSettled && !item._optimisticSettled) score += 1
  return score
}

/** 先比 LL2 身份，再比对完整度；同分取 incoming（后写） */
function pickRicherMissionCard(current, incoming) {
  if (!current) return incoming
  if (!incoming) return current
  const idA = scoreMissionCardIdentity(current)
  const idB = scoreMissionCardIdentity(incoming)
  if (idB !== idA) return idB > idA ? incoming : current
  const a = scoreMissionCardCompleteness(current)
  const b = scoreMissionCardCompleteness(incoming)
  if (b > a) return incoming
  if (a > b) return current
  return incoming
}

function isIncompleteCompletedListCard(item) {
  if (!item) return false
  if (isPlaceholderMissionField(item.rocketName)) return true
  const missionName = String(item.missionName || '').trim()
  if (missionName && isPlaceholderMissionField(missionName)) return true
  if (
    !missionName &&
    item.name &&
    /[|｜]\s*(未知有效载荷|unknown\s+payloads?)\s*$/i.test(String(item.name))
  ) {
    return true
  }
  if (
    isPlaceholderMissionField(item.padLocation) &&
    isPlaceholderMissionField(item.launchSite)
  ) {
    return true
  }
  return false
}

function isWeakListCardIdentity(item) {
  if (!item) return true
  if (isPlaceholderMissionField(item.rocketName)) return true
  const missionName = String(item.missionName || '').trim()
  if (missionName && isPlaceholderMissionField(missionName)) return true
  if (
    !missionName &&
    item.name &&
    /[|｜]\s*(未知(有效)?载荷|unknown\s+payloads?)\s*$/i.test(String(item.name))
  ) {
    return true
  }
  if (!missionName && isPlaceholderMissionField(item.name)) return true
  return false
}

/** 已公布列表身份不得被陈旧详情的占位火箭/载荷打回去 */
function stripWeakerIdentityPatch(item, displayPatch, rawPatch) {
  if (!displayPatch) return displayPatch
  if (!isWeakListCardIdentity(item) && isWeakListCardIdentity(rawPatch || displayPatch)) {
    const out = Object.assign({}, displayPatch)
    delete out.rocketName
    delete out.missionName
    delete out.name
    delete out.rocketConfiguration
    return out
  }
  return displayPatch
}

module.exports = {
  isPlaceholderMissionField,
  parseRocketMissionFromLaunchName,
  sameRocketFamily,
  pickLl2AlignedRocketName,
  scoreMissionCardIdentity,
  scoreMissionCardCompleteness,
  pickRicherMissionCard,
  isIncompleteCompletedListCard,
  isWeakListCardIdentity,
  stripWeakerIdentityPatch
}
