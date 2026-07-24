/**
 * 星问「星舰下一飞出卡」闭环结构审计
 * node scripts/_audit_ai_chat_mission_card.js
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
let failed = 0

function assert(cond, msg) {
  if (cond) {
    console.log('OK', msg)
  } else {
    failed += 1
    console.error('FAIL', msg)
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function main() {
  const json = JSON.parse(read('subpackages/shared/components/ai-chat/index.json'))
  assert(json.styleIsolation === 'apply-shared', 'ai-chat styleIsolation=apply-shared（glass-card）')

  const wxss = read('subpackages/shared/components/ai-chat/index.wxss')
  assert(wxss.includes('mission-card.wxss'), 'wxss 导入 styles/mission-card.wxss')
  assert(!/rgba\(120,\s*100,\s*255/.test(wxss) || !wxss.includes('ai-mission-card {'), '不再使用紫色自定义卡底')

  const wxml = read('subpackages/shared/components/ai-chat/index.wxml')
  assert(wxml.includes('glass-card'), 'wxml 使用 glass-card')
  assert(wxml.includes('mission-card'), 'wxml 使用 mission-card')
  assert(wxml.includes('mission-rocket-image'), 'wxml 使用 mission-rocket-image')
  assert(wxml.includes('data-id=') && wxml.includes('data-type='), '跳转用 data-id + data-type')
  assert(!wxml.includes('data-url='), '禁用 data-url（防 & 截断）')
  assert(wxml.includes('themeClass'), '面板挂 themeClass')
  assert(wxml.includes('onMissionCardRocketError'), '配置图 binderror 重试')

  const js = read('subpackages/shared/components/ai-chat/index.js')
  assert(js.includes('matchStarshipNextFlightIntent'), '意图识别接入')
  assert(js.includes('resolveStarshipNextFlightCard'), '取卡接入')
  assert(js.includes('enrichLaunchContextWithCard'), 'focusMission enrich')
  assert(js.includes('enrichLaunchContextNoStarshipSchedule'), '无排期提示 enrich')
  assert(js.includes('_skipTabBarRestore'), '跳转不闪 TabBar')
  assert(js.includes('_sendLock'), '发送防重入')
  assert(js.includes('buildMissionDetailUrl'), '详情 URL 构建')
  assert(js.includes('loadCloudMediaMap'), '预热 media map')
  assert(js.includes('ll2TrackedLaunchId') || js.includes('_trackedStarshipLaunchId'), '对齐 tracked launch id')

  const rich = read('subpackages/shared/utils/ai-chat-rich.js')
  assert(rich.includes('forceRecompute') || rich.includes(', true)'), '配置图 forceRecompute')
  assert(rich.includes('resolveMissionRocketImage'), '复用 resolveMissionRocketImage')
  assert(rich.includes('ai-chat-rich-core'), '纯逻辑下沉 core')

  const core = read('subpackages/shared/utils/ai-chat-rich-core.js')
  assert(core.includes('发射场'), '意图排除发射场')
  assert(core.includes('enrichLaunchContextNoStarshipSchedule'), 'core 含无排期 enrich')

  const svc = read('subpackages/shared/utils/aiService.js')
  assert(svc.includes('星舰下一次试飞是什么时候？'), '快捷问题含闭环测试句')
  assert(svc.includes('focusHint') && svc.includes('focusMission'), 'streamChat 注入聚焦任务')

  const api = read('utils/api-launch-list.js')
  assert(/exports[\s\S]*isStarshipListItem|isStarshipListItem,/.test(api), 'isStarshipListItem 已导出')

  if (failed) {
    console.error('\n' + failed + ' failed')
    process.exit(1)
  }
  console.log('\nall green: structural audit passed')
}

main()
