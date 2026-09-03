/**
 * 观礼 UI 本轮改动专项审计（卡片对齐/主题/选点/火箭图/大屏返回/徽章）
 * 运行：node scripts/_tmp_audit_watch_party_ui_round.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let issues = 0
let warns = 0

function issue(msg) { issues++; console.log('  ✗ [问题] ' + msg) }
function warn(msg) { warns++; console.log('  ⚠ [提示] ' + msg) }
function pass(msg) { console.log('  ✓ ' + msg) }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }

console.log('── app.json 定位权限 ──')
const app = JSON.parse(read('app.json'))
const perm = app.permission || {}
if (!perm['scope.userLocation']) issue('缺 scope.userLocation（chooseLocation 必需）')
else pass('scope.userLocation 已声明')
if (!(app.requiredPrivateInfos || []).includes('chooseLocation')) issue('requiredPrivateInfos 缺 chooseLocation')
else pass('chooseLocation 已登记')

console.log('── merchant-edit 任务选择 / 隐私 / 键盘 ──')
const mej = JSON.parse(read('subpackages/watch-party/merchant-edit.json'))
if (!(mej.usingComponents || {})['privacy-modal']) issue('merchant-edit.json 未注册 privacy-modal')
else pass('privacy-modal 已注册')
const mew = read('subpackages/watch-party/merchant-edit.wxml')
const mejs = read('subpackages/watch-party/merchant-edit.js')
if (!mew.includes('<privacy-modal')) issue('merchant-edit.wxml 未挂载 privacy-modal')
else pass('privacy-modal 已挂载')
if (!mew.includes('showMissionSheet')) issue('缺任务选择弹层')
else pass('任务选择弹层存在')
if (!mew.includes('selectedRocketImage')) issue('缺火箭配置图绑定')
else pass('火箭配置图已绑定')
if (/<picker\s+range="\{\{missionLabels\}\}"/.test(mew)) issue('仍用原生 picker（无法显示配图）')
else pass('已去掉原生任务 picker')
if (!mejs.includes('getRocketImage')) issue('merchant-edit.js 未引入 getRocketImage')
else pass('getRocketImage 已引入')
if (!mejs.includes('onChooseLocation')) issue('缺地图选点方法')
else pass('地图选点方法存在')
const cursorCount = (mew.match(/cursor-spacing/g) || []).length
if (cursorCount < 5) warn('cursor-spacing 偏少: ' + cursorCount)
else pass('cursor-spacing 覆盖 ' + cursorCount + ' 处')

console.log('── merchant 场次卡 / 徽章 ──')
const mw = read('subpackages/watch-party/merchant.wxml')
const mjs = read('subpackages/watch-party/merchant.js')
const mwx = read('subpackages/watch-party/merchant.wxss')
if (/<text\s+class="wpm-merchant-status/.test(mw)) {
  issue('「合作中」徽章仍是 <text>（真机 flex 居中不可靠，应改 <view>）')
} else pass('「合作中」徽章容器正确')
if (/<text\s+class="wpm-session-tag/.test(mw)) {
  issue('场次状态标签仍是 <text>（真机 flex 居中不可靠，应改 <view>）')
} else pass('场次状态标签容器正确')
if (!mjs.includes('getRocketImage')) issue('merchant.js 未解析火箭图')
else pass('merchant.js 火箭图解析')
if (!mw.includes('rocketImage')) issue('merchant.wxml 未展示火箭图')
else pass('merchant.wxml 火箭图展示')
if (!mwx.includes('#07C160')) issue('浅色主题未用微信绿')
else pass('浅色主题微信绿已接入')
if (!mwx.includes('theme-light .wpm-merchant-card')) issue('商家头卡缺浅色覆盖')
else pass('商家头卡浅色覆盖')
if (/var\(--color-card\)/.test(mwx)) issue('merchant.wxss 仍有错误变量 --color-card')
else pass('无 --color-card 残留')

console.log('── 大屏退出 / 明暗工具 / 落地页主题 ──')
const sw = read('subpackages/watch-party/screen.wxml')
const swx = read('subpackages/watch-party/screen.wxss')
const sjs = read('subpackages/watch-party/screen.js')
const swNoComment = sw.replace(/<!--[\s\S]*?-->/g, '')
if (/退出/.test(swNoComment)) issue('大屏仍有「退出」文案')
else pass('大屏已去退出文案')
if (!sw.includes('top-nav-slot--back')) issue('大屏未用通用返回图标')
else pass('大屏通用返回图标')
if (/forceDarkTheme:\s*true/.test(sjs)) issue('大屏仍 forceDarkTheme，无法明暗切换')
else pass('大屏已取消 forceDarkTheme')
if (!sw.includes('onToggleTheme') || !sw.includes('scr-tools')) issue('大屏缺明暗工具钮')
else pass('大屏明暗 + 横竖屏工具组存在')
if (!/transform:\s*scale\(0\.8\)/.test(swx)) issue('大屏工具钮未统一 scale(0.8)')
else pass('大屏工具钮 scale(0.8)')
if (!swx.includes('.theme-light .scr-tool') || !swx.includes('.scr.theme-light')) issue('大屏缺浅色反色覆盖')
else pass('大屏浅色反色覆盖存在')
if (!sjs.includes('onToggleTheme') || !sjs.includes('setThemeMode')) issue('大屏缺主题切换逻辑')
else pass('大屏主题切换逻辑存在')
const wpx = read('subpackages/watch-party/watch-party.wxss')
if (!wpx.includes('theme-light .wp-hero')) issue('落地页头卡缺浅色覆盖')
else pass('落地页浅色主题覆盖存在')

console.log('── 简报弹窗令牌 / profile 入口对齐 ──')
const bw = read('subpackages/shared/components/morning-briefing/index.wxss')
if (!bw.includes('--radius-pill: 999rpx')) issue('briefing-mask 缺 --radius-pill')
else pass('briefing-mask 含 --radius-pill')
if (!/briefing-inline[\s\S]{0,200}--color-bg-card/.test(bw)) issue('briefing-inline 未对齐 bg-card')
else pass('briefing-inline 对齐 growth-entry')
const pwx = read('pages/profile/profile.wxss')
if (!pwx.includes('.growth-entry-icon-badge')) issue('缺观礼入口徽章样式')
else pass('观礼入口徽章样式存在')
if (!/width:\s*44rpx/.test(pwx.match(/\.growth-entry-icon-badge\s*\{[\s\S]*?\}/)?.[0] || '')) {
  warn('观礼入口徽章未固定 44rpx 宽（可能与其他入口不对齐）')
} else pass('观礼入口徽章 44rpx 对齐')

console.log('── merchant-edit.wxss 变量 ──')
const mewx = read('subpackages/watch-party/merchant-edit.wxss')
if (/var\(--color-card\)/.test(mewx)) issue('merchant-edit.wxss 仍有 --color-card')
else pass('merchant-edit 无 --color-card')
if (!mewx.includes('.wpe-sheet-mask')) issue('缺任务弹层样式')
else pass('任务弹层样式存在')
const z = mewx.match(/\.wpe-sheet-mask\s*\{[^}]*z-index:\s*(\d+)/)
if (z && Number(z[1]) <= 1000) warn('任务弹层 z-index=' + z[1] + '，与 top-nav(1000) 同级，建议 >1000')
else if (z) pass('任务弹层 z-index=' + z[1])

console.log('\n审计结果：' + issues + ' 个问题 / ' + warns + ' 个提示')
process.exit(issues ? 1 : 0)
