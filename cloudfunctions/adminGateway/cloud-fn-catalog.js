/**
 * 云函数清单（对照 cloudfunctions/ 目录）。
 * 手动触发白名单与后台「手动触发」按钮必须一致，避免点了只收到 4001。
 */
const TRIGGER_ALLOWLIST = ['syncSpaceDevsData', 'syncSpaceXTweets', 'sendLaunchReminder']

const CATALOG = [
  { name: 'adminGateway', desc: '后台管理网关', type: 'http' },
  { name: 'publicGateway', desc: '公众 HTTP 只读', type: 'http' },
  { name: 'syncSpaceDevsData', desc: '发射数据同步', type: 'timer' },
  { name: 'syncSpaceXTweets', desc: 'SpaceX 推文同步', type: 'timer' },
  { name: 'sendLaunchReminder', desc: '发射提醒推送', type: 'timer' },
  { name: 'spaceNotices', desc: '航警同步', type: 'timer' },
  { name: 'morningBriefing', desc: '每日简报生成', type: 'timer' },
  { name: 'syncTLE', desc: 'TLE 同步', type: 'timer' },
  { name: 'syncCarouselFromTweets', desc: '推文轮播同步', type: 'timer' },
  { name: 'syncRocketCosIndex', desc: '火箭 COS 索引', type: 'timer' },
  { name: 'astroPhotos', desc: '航天摄影审核', type: 'timer' },
  { name: 'cleanupSecurityData', desc: '安全数据清理', type: 'timer' },
  { name: 'backfillEventVideos', desc: '事件视频回填（一次性）', type: 'timer' },
  { name: 'll2Query', desc: 'LL2 实时查询', type: 'callFunction' },
  { name: 'apiProxy', desc: '公开代理 / Agent', type: 'callFunction' },
  { name: 'userDataGateway', desc: '用户资料与公共只读', type: 'callFunction' },
  { name: 'membership', desc: '会员与支付', type: 'callFunction' },
  { name: 'getLaunchStats', desc: '发射统计（用户路径只读）', type: 'callFunction' },
  { name: 'lunarWishes', desc: '月愿计划', type: 'callFunction' },
  { name: 'oaWebhook', desc: '服务号订阅回调', type: 'http' },
  { name: 'oaPushDraft', desc: '公众号草稿推送（Worker）', type: 'http' },
  { name: 'oaContentDaily', desc: '公众号日更（Worker）', type: 'http' },
  { name: 'oaAuthorTrack', desc: '公众号对标（Worker）', type: 'http' },
  { name: 'oaMenuSetup', desc: '公众号菜单（运维）', type: 'http' }
]

function withTriggerFlags(list) {
  const allow = new Set(TRIGGER_ALLOWLIST)
  return list.map((item) => ({
    ...item,
    canTrigger: allow.has(item.name)
  }))
}

function listCloudFunctionCatalog() {
  return withTriggerFlags(CATALOG)
}

function isCloudFunctionTriggerAllowed(name) {
  return TRIGGER_ALLOWLIST.indexOf(String(name || '')) !== -1
}

module.exports = {
  TRIGGER_ALLOWLIST,
  listCloudFunctionCatalog,
  isCloudFunctionTriggerAllowed
}
