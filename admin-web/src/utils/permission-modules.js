/** 后台功能权限：键与云函数 PERMISSION_MODULES 对齐，文案全部中文 */
export const PERMISSION_MODULES = {
  dashboard: '仪表盘',
  preaudit: '一键预审',
  statistics: '数据统计',
  oa_content: '公众号内容中台',
  news_events: '事件管理',
  news_articles: '文章管理',
  launch_data: '发射数据',
  starship_status: '星舰状态',
  starship_progress: '星舰建设进度',
  starship_events: '事件更新追踪',
  tweet_monitor: '推文同步监控',
  road_closure: '封路通知',
  spacex_stats: 'SpaceX 统计',
  live_mgmt: '直播管理',
  push_notify: '推送通知',
  launch_votes: '发射竞猜',
  lunar_wishes: '月愿计划',
  astro_photos: '航天摄影',
  milestone_rewards: '里程碑彩蛋',
  knowledge_cards: '知识卡',
  watch_party: '观礼服务',
  shop_feed: '小店与弹窗广告',
  carousel: '轮播图',
  splash_screen: '开屏动画与环绕全景',
  announcements: '系统公告',
  cos_storage: '云存储与火箭模型',
  global_config: '全局配置与会员',
  cloud_functions: '云函数',
  data_export: '数据导出',
  users: '用户权限',
  logs: '操作日志'
}

export const ROLE_LABELS = {
  viewer: '观察者',
  reviewer: '审核员',
  editor: '编辑',
  super_admin: '超级管理员'
}

export const STATUS_LABELS = {
  active: '启用',
  disabled: '停用',
  deleted: '已删除'
}

export function mergePermissionModules(fromApi) {
  const extra = {}
  Object.keys(fromApi || {}).forEach((key) => {
    if (!PERMISSION_MODULES[key]) extra[key] = fromApi[key]
  })
  return Object.assign({}, PERMISSION_MODULES, extra)
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || '-'
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || '未知'
}
