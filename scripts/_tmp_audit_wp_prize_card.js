/**
 * 审计：观礼现场奖品卡商业化改版（票券式领奖凭证）
 *  1) utils/prize-card.js 纯逻辑单测（价值分档 / 凭证号 / 限量编号 / 日期 / 场次行）
 *  2) gacha / album 三件套结构断言（共用卡面、分档绑定、既有门槛不回退）
 *  3) 共用样式完整性 + 语法 VM 检查
 * 运行：node scripts/_tmp_audit_wp_prize_card.js
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
const SUB = path.join(ROOT, 'subpackages', 'watch-party')
let passed = 0
let failed = 0

function pass(msg) { passed++; console.log('  ✓ ' + msg) }
function issue(msg) { failed++; console.log('  ✗ ' + msg) }
function check(cond, msg) { cond ? pass(msg) : issue(msg) }
function read(p) { return fs.readFileSync(p, 'utf8') }

// ── 1. 视图模型单测 ──
console.log('── prize-card.js 视图模型 ──')
const prizeCard = require(path.join(SUB, 'utils', 'prize-card.js'))
const { resolvePrizeTier, decoratePrizeCard, PRIZE_TIER_THRESHOLDS } = prizeCard

check(resolvePrizeTier(null).tier === 'N', '无价值 → N 纪念好礼')
check(resolvePrizeTier(0).tier === 'N', '价值 0 → N')
check(resolvePrizeTier(-5).tier === 'N', '负值容错 → N')
check(resolvePrizeTier('abc').tier === 'N', '非数字容错 → N')
check(resolvePrizeTier(1).tier === 'R', '¥1 → R 甄选')
check(resolvePrizeTier(PRIZE_TIER_THRESHOLDS.SR - 0.1).tier === 'R', 'SR 阈值下沿 → R')
check(resolvePrizeTier(PRIZE_TIER_THRESHOLDS.SR).tier === 'SR', `¥${PRIZE_TIER_THRESHOLDS.SR} → SR 珍稀`)
check(resolvePrizeTier(PRIZE_TIER_THRESHOLDS.SSR - 1).tier === 'SR', 'SSR 阈值下沿 → SR')
check(resolvePrizeTier(PRIZE_TIER_THRESHOLDS.SSR).tier === 'SSR', `¥${PRIZE_TIER_THRESHOLDS.SSR} → SSR 压轴大奖`)
check(resolvePrizeTier('288').tier === 'SSR', '字符串价值可解析')
check(resolvePrizeTier(288).label === '压轴大奖' && resolvePrizeTier(288).en === 'GRAND PRIZE', 'SSR 文案齐全')

const ts = new Date(2026, 7, 8, 15, 30).getTime()
const full = decoratePrizeCard(
  { name: '航天模型', image: 'cloud://x/y.png', valueYuan: 199, serialNo: 7, stock: 50, desc: '商家描述' },
  { drawId: 'ab12-CD34ef56gh78', createdAt: ts, sessionTitle: '文昌观礼专场', rocketName: '长征八号', missionName: '某任务' }
)
check(full.tier === 'SSR' && full.tierLabel === '压轴大奖', 'decorate：分档正确')
check(full.valueText === '¥199', 'decorate：价值文本')
check(full.desc === '', 'decorate：有价值时不再重复价值描述')
check(full.serialText === '限量 No.7/50', 'decorate：限量编号')
check(full.voucherNo === 'WP-' + 'ab12CD34ef56gh78'.slice(-8).toUpperCase(), 'decorate：凭证号取 drawId 尾段大写')
check(full.dateText === '2026.08.08', 'decorate：日期格式')
check(full.sessionLine === '文昌观礼专场', 'decorate：场次标题优先')

const fallback = decoratePrizeCard(
  { name: 'x', serialNo: 3, limitTotal: 0 },
  { rocketName: '长征八号', missionName: '任务A' }
)
check(fallback.tier === 'N' && fallback.valueText === '', 'decorate：无价值走 N 且无价值行')
check(fallback.serialText === 'No.3', 'decorate：非限量编号')
check(fallback.voucherNo === '', 'decorate：无 drawId 不出凭证号')
check(fallback.sessionLine === '长征八号 · 任务A', 'decorate：场次回落 火箭·任务')

const noDesc = decoratePrizeCard({ name: 'x', desc: '仅商家文案' }, {})
check(noDesc.desc === '仅商家文案', 'decorate：无价值保留商家文案')
check(decoratePrizeCard(null, null).name === '', 'decorate：空入参容错')

const utilSrc = read(path.join(SUB, 'utils', 'prize-card.js'))
check(!/\bwx\./.test(utilSrc), '视图模型无 wx 依赖（纯逻辑可单测）')

// ── 2. gacha 三件套 ──
console.log('── gacha 抽卡页 ──')
const gjs = read(path.join(SUB, 'gacha.js'))
const gw = read(path.join(SUB, 'gacha.wxml'))
const gss = read(path.join(SUB, 'gacha.wxss'))

check(/require\('\.\/utils\/prize-card\.js'\)/.test(gjs), 'gacha.js 引入共用视图模型')
check(/decoratePrizeCard\(prize,\s*\{/.test(gjs), 'gacha.js 抽卡结果走 decoratePrizeCard')
check(/drawId:\s*res\.drawId/.test(gjs), 'gacha.js 凭证号来源 res.drawId')
check(/sessionTitle:\s*session\.title/.test(gjs) && /rocketName:\s*session\.rocketName/.test(gjs), 'gacha.js 场次行取自场次字段（单链路）')
check(/card\.tier === 'SSR' \|\| card\.tier === 'SR'/.test(gjs) && /'heavy'/.test(gjs), 'gacha.js 高档位重震动')
check(/if \(card && card\.image\) result\.imageUrl = card\.image/.test(gjs), 'gacha.js 分享带奖品图')

check(/pcard pcard--\{\{drawnCard\.tier\}\}/.test(gw), 'gacha.wxml 卡面绑定分档')
check(/pcard-tier--\{\{drawnCard\.tier\}\}/.test(gw), 'gacha.wxml 分档徽章')
check(/pcard-serial-chip/.test(gw) && /drawnCard\.serialText/.test(gw), 'gacha.wxml 限量编号章')
check(/领奖凭证/.test(gw) && /drawnCard\.voucherNo/.test(gw), 'gacha.wxml 凭证行')
check(/凭此卡向现场工作人员领取奖品/.test(gw), 'gacha.wxml 领取指引')
check(/gc-halo gc-halo--\{\{drawnCard\.tier\}\}/.test(gw) && /flipped && drawnCard\.tier !== 'N'/.test(gw), 'gacha.wxml 光晕按档位且翻面后出现')
check(/flipped && \(drawnCard\.tier === 'SR' \|\| drawnCard\.tier === 'SSR'\)/.test(gw), 'gacha.wxml 星屑只给 SR/SSR')
check(/prizeDrawEnabled && fromMaterial && successUnlocked/.test(gw), 'gacha.wxml 抽奖台双门槛未回退')
check(!/gc-rarity-tag|gc-card-image|gc-card-name/.test(gw), 'gacha.wxml 旧卡面结构已移除')

check(/@import "styles\/prize-card\.wxss";/.test(gss), 'gacha.wxss 引入共用卡面')
check(/\.gc-flip--flipped \.pcard-shine/.test(gss), 'gacha.wxss 翻面触发扫光')
check(/\.gc-halo--SSR/.test(gss) && /\.gc-fx-star--6/.test(gss), 'gacha.wxss 光晕/星屑样式齐全')
check(!/\.gc-face--SSR|\.gc-rarity-tag|\.gc-card-image/.test(gss), 'gacha.wxss 旧卡面死样式已清理')

// ── 3. album 三件套 ──
console.log('── album 卡册页 ──')
const ajs = read(path.join(SUB, 'album.js'))
const aw = read(path.join(SUB, 'album.wxml'))
const ass = read(path.join(SUB, 'album.wxss'))

check(/require\('\.\/utils\/prize-card\.js'\)/.test(ajs), 'album.js 引入共用视图模型')
check(/decoratePrizeCard\(c,\s*\{/.test(ajs), 'album.js 列表项走 decoratePrizeCard')
check(/tierCounts/.test(ajs) && /\['SSR', 'SR', 'R', 'N'\]/.test(ajs), 'album.js 汇总分档计数')

check(/pcard pcard--\{\{viewCard\.tier\}\}/.test(aw), 'album.wxml 单卡查看同款卡面')
check(/viewCard\.voucherNo/.test(aw) && /凭此卡向现场工作人员领取奖品/.test(aw), 'album.wxml 凭证信息齐全')
check(/ab-cell ab-cell--\{\{item\.tier\}\}/.test(aw), 'album.wxml 网格分档描边')
check(/ab-rarity-pill ab-rarity-pill--\{\{item\.tier\}\}/.test(aw), 'album.wxml 汇总分档胶囊')
check(!/ab-view-card|ab-view-image|ab-view-meta/.test(aw), 'album.wxml 旧单卡结构已移除')

check(/@import "styles\/prize-card\.wxss";/.test(ass), 'album.wxss 引入共用卡面')
check(/\.ab-view-wrap \.pcard-shine/.test(ass), 'album.wxss 静态查看扫光')

// ── 双主题反色：主题化表面 + 票券卡面浅色覆盖 ──
console.log('── 双主题反色 ──')
const pssRaw = read(path.join(SUB, 'styles', 'prize-card.wxss'))
const pillLight = ['SSR', 'SR', 'R', 'N'].every((t) => ass.includes('.theme-light .ab-rarity-pill--' + t))
check(pillLight, 'album 分档胶囊四档浅色覆盖齐全')
const cellLight = ['R', 'SR', 'SSR'].every((t) => ass.includes('.theme-light .ab-cell--' + t))
check(cellLight && ass.includes('.theme-light .ab-cell'), 'album 网格分档描边浅色覆盖齐全')
check(ass.includes('.theme-light .ab-overlay'), 'album 查看遮罩有浅色覆盖')
check(gss.includes('.theme-light .gc-overlay'), 'gacha 结果遮罩有浅色覆盖')
check(pssRaw.includes('.theme-light .pcard') && pssRaw.includes('.theme-light .pcard-name'),
  '共用卡面含 theme-light 反色')
check(pssRaw.includes('.theme-light .pcard-tear-notch'), '撕裂孔对齐浅色遮罩')
check(!/var\(--/.test(pssRaw), '共用卡面全字面色（不吃 tokens 变量）')

// ── 4. 共用样式完整性 ──
console.log('── styles/prize-card.wxss ──')
const pss = read(path.join(SUB, 'styles', 'prize-card.wxss'))
for (const cls of ['.pcard--N', '.pcard--R', '.pcard--SR', '.pcard--SSR', '.pcard-tier--SSR', '.pcard-value-num', '.pcard-tear-notch', '.pcard-stub-row', '.pcard-redeem', '.pcard-serial-chip', '@keyframes pcard-shine-sweep']) {
  check(pss.includes(cls), `含 ${cls}`)
}
const open = (pss.match(/\{/g) || []).length
const close = (pss.match(/\}/g) || []).length
check(open === close, `花括号配平 ${open}/${close}`)

// ── 5. 语法 VM 检查 ──
console.log('── 语法检查 ──')
for (const f of ['utils/prize-card.js', 'gacha.js', 'album.js']) {
  const p = path.join(SUB, f)
  try {
    new vm.Script(read(p), { filename: f })
    pass(`${f} 语法 OK`)
  } catch (e) {
    issue(`${f} 语法错误: ${e.message}`)
  }
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
