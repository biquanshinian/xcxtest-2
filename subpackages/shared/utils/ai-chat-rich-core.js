/**
 * 星问富消息纯逻辑（无 wx / 无网络，供单测与 ai-chat-rich 共用）
 */

function isStarshipMissionLike(mission) {
  if (!mission || typeof mission !== 'object') return false
  const hay = [mission.rocketName, mission.name, mission.missionName]
    .filter(Boolean)
    .join(' ')
  return /starship|super\s*heavy|星舰|超重/i.test(hay)
}

/** 列表项是否足够生成可展示/可跳转的卡片 */
function isUsableMissionForCard(mission) {
  if (!mission || !mission.id || !isStarshipMissionLike(mission)) return false
  return !!(mission.missionName || mission.name)
}

/**
 * 是否在问「星舰下一次试飞 / 下一飞 / 何时发射」。
 * 排除发射场/进展/封路等非排期问法。
 */
function matchStarshipNextFlightIntent(text) {
  const q = String(text || '').trim()
  if (!q) return false
  if (!/星舰|starship|超重型|super\s*heavy/i.test(q)) return false

  const strongNext = /(下次|下一次|下一飞|下一发|最近一次|最新一次|试飞|next\s*(?:\S+\s*){0,3}(flight|launch)|flight\s*\d+)/i.test(q)
  const whenAsk = /(什么时候|何时|几号)/.test(q)
  const launchWhen = /(什么时候|何时|几号).{0,10}(发射|起飞|升空)|(发射|起飞|升空).{0,10}(什么时候|何时|几号)/.test(q)

  // 地点 / 硬件 / 进展：无强排期信号则不出卡
  if (/发射场|基地|starbase|boca\s*chica|封路|组合体|塔架|热分离|推进剂|加油|测试台|进展|进度/.test(q)) {
    return strongNext || launchWhen
  }

  if (strongNext || launchWhen || whenAsk) return true
  return false
}

function pickStarshipMission(list, trackedId) {
  const rows = Array.isArray(list) ? list.filter(isUsableMissionForCard) : []
  if (!rows.length) return null
  const tid = trackedId != null ? String(trackedId).trim() : ''
  if (tid) {
    const hit = rows.find((m) => String(m.id) === tid)
    if (hit) return hit
  }
  return rows[0]
}

function enrichLaunchContextWithCard(launchContext, card) {
  if (!card || !card.id) return launchContext
  const focus = {
    name: card.name,
    rocketName: card.rocketName,
    launchTime: card.launchTime || card.formattedTime,
    launchAgency: 'SpaceX',
    launchSite: card.padLocation,
    status: card.statusText
  }
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  const upcoming = Array.isArray(base.upcoming) ? base.upcoming.slice() : []
  const focusKey = String(focus.name || '')
  const deduped = upcoming.filter((m) => String((m && m.name) || '') !== focusKey)
  deduped.unshift(focus)
  base.upcoming = deduped
  base.focusMission = focus
  base.focusHint = '用户正在询问星舰下一次试飞；界面会同步展示可点击任务卡片，请基于「聚焦任务」真实数据简要回答（发射时间字段若为 ISO 则按 UTC 转北京时间），并提醒可点击卡片查看详情与倒计时。不要编造发射时间。'
  return base
}

/** 意图命中但日程无星舰任务时，阻止模型编造日期 */
function enrichLaunchContextNoStarshipSchedule(launchContext) {
  const base = launchContext && typeof launchContext === 'object' ? { ...launchContext } : {}
  base.focusHint = '用户在询问星舰下一次试飞，但当前发射日程中暂无已排期的星舰试飞任务。请如实告知尚未公布或数据暂无，建议去小程序「星舰进度」页关注最新动态；不要编造试飞日期或航班号。'
  base.focusMission = null
  return base
}

module.exports = {
  isStarshipMissionLike,
  isUsableMissionForCard,
  matchStarshipNextFlightIntent,
  pickStarshipMission,
  enrichLaunchContextWithCard,
  enrichLaunchContextNoStarshipSchedule
}
