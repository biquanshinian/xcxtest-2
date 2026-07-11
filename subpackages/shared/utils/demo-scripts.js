/**
 * 直播演示脚本配置
 *
 * 改版说明：
 * - 每套脚本只用一个音频文件（audioUrl），不再分步配音
 * - 步骤包含细粒度操作：滑动、点击、切 tab、等待
 * - 默认循环播放
 *
 * step.action 类型：
 *   - navigate:  切换 tab 页  { page, isTab }
 *   - scroll:    滚动页面     { scrollTop }
 *   - bubble:    显示气泡     { bubble, top, left }
 *   - highlight: 高亮区域     { rect, radius, showFinger }
 *   - qrcode:    展示二维码
 *   - wait:      纯等待
 *
 * delay: 该步骤停留毫秒数后自动进入下一步
 */

const QRCODE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%B0%8F%E7%A8%8B%E5%BA%8F%E4%BA%8C%E7%BB%B4%E7%A0%81/1775323336594_jkl6zv.png'

const scripts = {
  /** 完整功能巡览 */
  fullTour: {
    title: '🚀 火星探索日志 · 全功能巡览',
    audioUrl: '', // 后台填入整段配音 URL
    steps: [
      // === 首页 ===
      { action: 'navigate', page: '/pages/index/index', isTab: true, delay: 1000 },
      { action: 'bubble', bubble: '欢迎来到火星探索日志', top: 280, left: 30, delay: 4000 },
      { action: 'scroll', scrollTop: 200, delay: 2000 },
      { action: 'scroll', scrollTop: 500, delay: 2500 },
      { action: 'scroll', scrollTop: 800, delay: 2500 },
      { action: 'scroll', scrollTop: 0, delay: 2000 },
      { action: 'bubble', bubble: '发射任务实时倒计时', top: 350, left: 30, delay: 3500 },

      // === 监控中心 ===
      { action: 'navigate', page: '/pages/monitor/monitor', isTab: true, delay: 1500 },
      { action: 'bubble', bubble: '监控中心 — 系统神经中枢', top: 200, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 300, delay: 2500 },
      { action: 'scroll', scrollTop: 600, delay: 2500 },
      { action: 'bubble', bubble: 'Starlink 卫星实时追踪', top: 250, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 900, delay: 2500 },
      { action: 'scroll', scrollTop: 0, delay: 2000 },

      // === 星舰进度 ===
      { action: 'navigate', page: '/pages/progress/progress', isTab: true, delay: 1500 },
      { action: 'bubble', bubble: '星舰 — 人类最强运载火箭', top: 200, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 300, delay: 2500 },
      { action: 'scroll', scrollTop: 600, delay: 2500 },
      { action: 'scroll', scrollTop: 0, delay: 2000 },

      // === 事件 ===
      { action: 'navigate', page: '/pages/news/news', isTab: true, delay: 1500 },
      { action: 'bubble', bubble: '全球航天动态 · AI 智能搜索', top: 200, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 400, delay: 2500 },
      { action: 'scroll', scrollTop: 0, delay: 2000 },

      // === 我的太空 ===
      { action: 'navigate', page: '/pages/profile/profile', isTab: true, delay: 1500 },
      { action: 'bubble', bubble: '我的太空 — 签到 · 成就 · 竞猜', top: 200, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 400, delay: 2500 },
      { action: 'scroll', scrollTop: 0, delay: 2000 },

      // === 结尾 ===
      { action: 'navigate', page: '/pages/index/index', isTab: true, delay: 1000 },
      { action: 'qrcode', bubble: '扫码加入，星辰大海是日常', delay: 8000 }
    ]
  },

  /** Starlink 卫星追踪专题 */
  starlinkDemo: {
    title: '🛰️ Starlink 卫星追踪演示',
    audioUrl: '',
    steps: [
      // === 首页简介 ===
      { action: 'navigate', page: '/pages/index/index', isTab: true, delay: 1000 },
      { action: 'bubble', bubble: '今晚，亲眼看到星链卫星', top: 280, left: 30, delay: 4000 },

      // === 进入监控中心 ===
      { action: 'navigate', page: '/pages/monitor/monitor', isTab: true, delay: 1500 },
      { action: 'bubble', bubble: '监控中心 — 卫星追踪指挥台', top: 200, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 200, delay: 2000 },
      { action: 'scroll', scrollTop: 400, delay: 2500 },
      { action: 'bubble', bubble: 'Starlink 全球实时分布', top: 250, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 600, delay: 2500 },
      { action: 'bubble', bubble: '过境预报 — 精确到分钟', top: 250, left: 30, delay: 4000 },
      { action: 'scroll', scrollTop: 800, delay: 2500 },
      { action: 'bubble', bubble: '方位角 · 仰角 · 亮度', top: 250, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 0, delay: 2000 },

      // === 结尾 ===
      { action: 'navigate', page: '/pages/index/index', isTab: true, delay: 1000 },
      { action: 'qrcode', bubble: '扫码查看今晚过境预报', delay: 8000 }
    ]
  },

  /** 发射追踪专题 */
  launchDemo: {
    title: '🔥 发射任务追踪演示',
    audioUrl: '',
    steps: [
      // === 首页发射列表 ===
      { action: 'navigate', page: '/pages/index/index', isTab: true, delay: 1000 },
      { action: 'bubble', bubble: '全球发射任务追踪', top: 280, left: 30, delay: 4000 },
      { action: 'scroll', scrollTop: 300, delay: 2500 },
      { action: 'bubble', bubble: '倒计时实时跳动', top: 300, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 600, delay: 2500 },
      { action: 'bubble', bubble: '任务卡片 — 作战简报', top: 250, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 900, delay: 2500 },
      { action: 'scroll', scrollTop: 0, delay: 2000 },

      // === 监控中心看发射场 ===
      { action: 'navigate', page: '/pages/monitor/monitor', isTab: true, delay: 1500 },
      { action: 'bubble', bubble: '发射场地图 · 轨道可视化', top: 200, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 300, delay: 2500 },
      { action: 'scroll', scrollTop: 0, delay: 2000 },

      // === 事件页搜索 ===
      { action: 'navigate', page: '/pages/news/news', isTab: true, delay: 1500 },
      { action: 'bubble', bubble: '航天百科 · 多维度搜索', top: 200, left: 30, delay: 3500 },
      { action: 'scroll', scrollTop: 300, delay: 2500 },
      { action: 'scroll', scrollTop: 0, delay: 2000 },

      // === 结尾 ===
      { action: 'navigate', page: '/pages/index/index', isTab: true, delay: 1000 },
      { action: 'qrcode', bubble: '扫码开始太空追踪之旅', delay: 8000 }
    ]
  }
}

/** 获取演示脚本 */
function getScript(name) {
  return scripts[name] || null
}

/** 获取所有脚本列表 */
function listScripts() {
  return Object.keys(scripts).map(name => ({
    name,
    title: scripts[name].title,
    stepCount: scripts[name].steps.length
  }))
}

module.exports = { getScript, listScripts, scripts, QRCODE_URL }
