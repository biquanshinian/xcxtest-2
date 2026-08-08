/**
 * 观礼预约频控 + 云资源审计
 * 规则：openid 24h≤5；取消冷却 60s；IP/设备内存短窗
 * 资源：短窗零 DB；同场次合并一次读；日限 field 投影；不落盘 ip/device
 * 运行：node scripts/_tmp_audit_watch_party_reserve_rate.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let issues = 0
let warns = 0
function issue(msg) { issues++; console.log('  ✗ ' + msg) }
function warn(msg) { warns++; console.log('  ⚠ ' + msg) }
function pass(msg) { console.log('  ✓ ' + msg) }
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8') }

const wp = read('cloudfunctions/adminGateway/watchParty.js')
const idx = read('cloudfunctions/adminGateway/index.js')
const page = read('subpackages/watch-party/watch-party.js')

// 截取 reserve 函数体便于断言
const reserveFn = (wp.match(/async function reserve\([\s\S]*?\n  async function getMyReservation/) || [])[0] || ''
const memFn = (wp.match(/function hitReserveShortWindowMem[\s\S]*?\n  \/\*\* 免费预约/) || [])[0] || ''

console.log('── 频控规则 ──')
if (/RESERVE_OPENID_24H_MAX\s*=\s*5/.test(wp)) pass('openid 24h 上限 = 5')
else issue('缺少 RESERVE_OPENID_24H_MAX = 5')
if (/RESERVE_CANCEL_COOLDOWN_MS\s*=\s*60\s*\*\s*1000/.test(wp)) pass('取消冷却 = 60s')
else issue('缺少取消冷却 60s')
if (/RESERVE_IP_MAX\s*=\s*30/.test(wp) && /RESERVE_DEVICE_MAX\s*=\s*20/.test(wp)) {
  pass('IP/设备短窗 30/20 per min')
} else issue('IP/设备阈值异常')
if (/hitReserveShortWindowMem/.test(wp) && /_reserveRateMem/.test(wp)) pass('内存短窗实现存在')
else issue('缺少内存短窗')

console.log('── 云资源（短窗零 DB）──')
if (/security_rate_limits/.test(reserveFn) || /RATE_LIMITS/.test(reserveFn) || /RATE_LIMITS/.test(memFn)) {
  issue('reserve/短窗仍触碰 security_rate_limits（应纯内存）')
} else pass('短窗不写不读 security_rate_limits')
if (/db\.collection\(RATE_LIMITS\)/.test(wp) && /wp_reserve|wp_res:/.test(wp)) {
  issue('仍存在预约相关 rate_limits 落库')
} else pass('无预约 rate_limits 落库路径')
if (/clientIp:/.test(reserveFn) || /deviceKey:/.test(reserveFn)) {
  // add data 里不应再持久化
  const addBlock = (reserveFn.match(/\.add\(\{[\s\S]*?\}\)/) || [])[0] || ''
  if (/clientIp|deviceKey/.test(addBlock)) issue('预约文档仍写入 clientIp/deviceKey（多余存储）')
  else pass('预约文档不落盘 clientIp/deviceKey')
} else pass('预约文档不落盘 clientIp/deviceKey')

console.log('── 读库合并 ──')
if (/Promise\.all\(/.test(reserveFn)
  && /where\(\{\s*openid,\s*sessionId,\s*cycleId\s*\}/.test(reserveFn)
  && /limit\(8\)/.test(reserveFn)
  && /orderBy\('createdAt',\s*'desc'\)/.test(reserveFn)) {
  pass('同场次 + 24h 日限并行；同场次单次 limit(8)')
} else issue('未合并/并行同场次与日限查询')
if (/limit\(20\)/.test(reserveFn)) issue('仍存在 cancelled limit(20) 重读')
else pass('无 cancelled 单独 limit(20)')
const sessGets = (reserveFn.match(/collection\(RESERVATIONS\)/g) || []).length
// 期望：sess + day + 可选 capacity count + add 不算 get；count 也是 collection
if (sessGets > 4) warn('reserve 内 RESERVATIONS 访问偏多: ' + sessGets)
else pass('reserve 内 RESERVATIONS 访问次数可控 (' + sessGets + ')')

if (/\.field\(\{\s*status:\s*true,\s*cancelledAt:\s*true\s*\}/.test(reserveFn)
  && /\.field\(\{\s*createdAt:\s*true\s*\}/.test(reserveFn)) {
  pass('查询使用 field 投影减传输')
} else warn('未使用 field 投影（可选优化）')

console.log('── 业务规则仍在 ──')
if (/您已预约过该场次/.test(reserveFn) && /取消后请/.test(reserveFn) && /24 小时内预约次数已达上限/.test(reserveFn)) {
  pass('重复预约 / 冷却 / 日限文案齐全')
} else issue('业务拦截文案缺失')
if (/cancelledAt:\s*now\(\)/.test(wp)) pass('cancel 写 cancelledAt')
else issue('cancel 未写 cancelledAt')

console.log('── 网关 / 客户端 ──')
if (/clientIp:\s*event\._clientIp/.test(idx) && /deviceKey/.test(idx) && /CLIENTIP/.test(idx)) {
  pass('网关注入 clientIp + deviceKey')
} else issue('网关未注入 clientIp/deviceKey')
if (/_getReserveDeviceKey/.test(page) && /deviceKey:\s*this\._getReserveDeviceKey\(\)/.test(page)) {
  pass('小程序提交 deviceKey')
} else issue('小程序未提交 deviceKey')

// 内存泄漏防护
console.log('── 内存防护 ──')
if (/RESERVE_RATE_MEM_MAX/.test(wp) && /pruneReserveRateMem/.test(wp)) pass('短窗 Map 有上限与清理')
else warn('短窗 Map 未见上限清理')

console.log('\n结果: ' + (issues ? issues + ' 问题' : '全部通过') + (warns ? '，' + warns + ' 提示' : ''))
process.exit(issues ? 1 : 0)
