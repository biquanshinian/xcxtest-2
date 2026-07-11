#!/usr/bin/env node
/**
 * rebuild-launch-stats.js — 历史年份「批量强制重算」一次性清洗脚本
 *
 * 背景：getLaunchStats 早期的 H2 bug 可能把「count 端点失败 + 翻页截断」的往年
 *       数据写成了永久 final，并把 apiCount 伪造成 launches.length（自我确认完整）。
 *       新代码无法自动识别这类脏 final（length>=length 恒真），需要逐年用
 *       forceRefresh 强制重算，让云函数以真实 count 重写 final 缓存。
 *
 * 它做什么：对 [startYear, endYear] 逐年（串行 + 间隔）触发云函数
 *       getLaunchStats { action:'getGlobalBreakdown', year:Y, countryKey:'_all', forceRefresh:true }
 *       打印每年的 total/success/failure、是否疑似标 final、耗时，最后汇总失败年份。
 *
 * 它怎么连云函数（两种模式，自动选择）：
 *   模式 A（凭证可用，全自动）：若已安装 `@cloudbase/node-sdk` 且配置了腾讯云
 *       API 密钥（环境变量 TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY），
 *       本脚本直接用 node-sdk 的 callFunction 跑通，无需打开微信开发者工具。
 *   模式 B（默认兜底，无凭证）：项目里**没有**内置服务端凭证，verify 脚本也是直连
 *       LL2 而非调云函数。此时脚本不会硬编造密钥，而是打印一段**可直接粘贴到
 *       微信开发者工具控制台**运行的 wx.cloud.callFunction 批量片段（带年份/间隔），
 *       用户贴进去即可跑。
 *
 * 用法（年份重算，默认）：
 *   node scripts/rebuild-launch-stats.js                 # 默认 1957..当前UTC年
 *   node scripts/rebuild-launch-stats.js 2020 2025       # 指定起止年
 *   node scripts/rebuild-launch-stats.js 2025 2025       # 只重算单年
 *   REBUILD_GAP_MS=20000 node scripts/rebuild-launch-stats.js 2020 2025   # 自定义年间隔(毫秒)
 *
 * 用法（清空任务详情型号统计缓存，修复型号过滤参数后用）：
 *   node scripts/rebuild-launch-stats.js missions        # 清空 launch_stats_cache 里所有 mission_* 文档
 *   node scripts/rebuild-launch-stats.js missions --dry-run   # 只统计将删除多少条，不实际删
 *   背景：详情页型号统计缓存 docId 为 mission_<launchId>_<launchTime>，按单发射绑定、数量随
 *         访问增长无法枚举重算；修复型号过滤参数（full_name→name）后旧的 count=0 脏缓存仍会
 *         命中。本子命令调用云函数 action: 'clearMissionStatsCache' 批量删除所有 mission_* 文档
 *         （服务端 admin 权限，绕过小程序端记录权限限制），用户下次打开详情页即按新逻辑重算。
 *         不消耗 LL2 配额，是一次性、可重复执行的安全操作。
 *
 * 凭证（仅模式 A 需要，可选）：
 *   $env:TENCENTCLOUD_SECRETID="AKID...";   $env:TENCENTCLOUD_SECRETKEY="...";
 *   $env:TCB_ENV="cloud1-9gdqgdt5bfaa20fb";  # 可选，默认用项目环境 id
 *   并在项目根 `npm i @cloudbase/node-sdk` 后再运行本脚本。
 *
 * 限流：LL2 免费层 15 次/小时/IP（限的是**云函数出口 IP**，不是本机）。每年重算
 *       约 5~8 次 LL2 请求，没配 LL2_API_TOKEN（云函数侧环境变量）时，一小时大概
 *       只能跑完 2~3 年；脚本会把被限流/未拉全的年份列入「需重试」，过一小时再跑即可。
 */

const DEFAULT_ENV = 'cloud1-9gdqgdt5bfaa20fb'
const DEFAULT_START_YEAR = 1957
const DEFAULT_GAP_MS = 20000

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseArgs() {
  const cur = new Date().getUTCFullYear()
  const argv = process.argv.slice(2)
  const sub = String(argv[0] || '').toLowerCase()

  // 子命令：清空任务详情型号统计缓存（mission_* 文档）
  if (sub === 'missions' || sub === '--target=missions') {
    const dryRun = argv.includes('--dry-run') || argv.includes('--dryRun')
    return { target: 'missions', dryRun, cur }
  }

  const a = Number(argv[0])
  const b = Number(argv[1])
  let start = Number.isFinite(a) ? a : DEFAULT_START_YEAR
  let end = Number.isFinite(b) ? b : cur
  if (start > end) { const t = start; start = end; end = t }
  const gapMs = Number(process.env.REBUILD_GAP_MS) || DEFAULT_GAP_MS
  return { target: 'years', start, end, gapMs, cur }
}

/** 尝试加载 node-sdk + 凭证；不可用时返回 null（转模式 B） */
function tryInitCloud() {
  const secretId = (process.env.TENCENTCLOUD_SECRETID || '').trim()
  const secretKey = (process.env.TENCENTCLOUD_SECRETKEY || '').trim()
  if (!secretId || !secretKey) return null
  let tcb
  try {
    tcb = require('@cloudbase/node-sdk')
  } catch (e) {
    return null
  }
  try {
    const env = (process.env.TCB_ENV || '').trim() || DEFAULT_ENV
    const app = tcb.init({ env, secretId, secretKey })
    return { app, env }
  } catch (e) {
    console.error('[rebuild] node-sdk init 失败:', e && (e.message || e))
    return null
  }
}

/** 从云函数返回里提炼一行摘要 */
function summarize(year, result) {
  const r = result || {}
  if (r.rateLimited) return { year, ok: false, retry: true, reason: 'rateLimited' }
  if (!r.success) return { year, ok: false, retry: true, reason: r.error || 'unknown' }
  const s = r.summary || {}
  const cur = new Date().getUTCFullYear()
  // 云函数不直接回传 final 标记：往年 + 非 partial 即表示本次已写成 final 永久缓存
  const markedFinalLikely = year < cur && r.partial === false
  return {
    year,
    ok: true,
    retry: r.partial === true, // 仍 partial 说明被预算/限流截断，建议稍后重试
    total: s.total,
    success: s.success,
    failure: s.failure,
    partial: !!r.partial,
    markedFinalLikely,
    elapsed: r.elapsed
  }
}

async function runWithSdk({ app }, { start, end, gapMs }) {
  const rows = []
  for (let y = start; y <= end; y++) {
    const t0 = Date.now()
    let result = null
    try {
      const res = await app.callFunction({
        name: 'getLaunchStats',
        data: { action: 'getGlobalBreakdown', year: y, countryKey: '_all', forceRefresh: true }
      })
      result = res && res.result
    } catch (e) {
      result = { success: false, error: e && (e.message || String(e)) }
    }
    const row = summarize(y, result)
    if (!row.elapsed) row.elapsed = Date.now() - t0
    rows.push(row)
    console.log(formatRow(row))
    if (y < end) await sleep(gapMs)
  }
  return rows
}

function formatRow(row) {
  if (!row.ok) return `  [${row.year}] 失败(${row.reason})  -> 需重试`
  const finalTag = row.markedFinalLikely ? 'final✓' : (row.partial ? 'partial!需重试' : '当前年/未final')
  return `  [${row.year}] total=${row.total} success=${row.success} failure=${row.failure}  ${finalTag}  ${row.elapsed}ms`
}

function printSummary(rows) {
  console.log('\n=== 汇总 ===')
  const retry = rows.filter((r) => r.retry || !r.ok).map((r) => r.year)
  const finalOk = rows.filter((r) => r.ok && r.markedFinalLikely).map((r) => r.year)
  console.log(`成功标 final 的往年(${finalOk.length}): ${finalOk.join(', ') || '无'}`)
  if (retry.length) {
    console.log(`需重试的年份(${retry.length}): ${retry.join(', ')}`)
    console.log('提示：多为 LL2 限流/预算截断。等约 1 小时后对这些年重跑，或在云函数侧配 LL2_API_TOKEN 提高额度。')
  } else {
    console.log('全部年份重算完成，无需重试。')
  }
}

/** 模式 B：打印可粘贴到微信开发者工具控制台运行的批量片段 */
function printConsoleSnippet({ start, end, gapMs }) {
  console.log('\n未检测到 @cloudbase/node-sdk + 腾讯云密钥，无法从本机直连云函数。')
  console.log('请把下面这段【整体复制】到微信开发者工具 → 调试器 → Console 面板回车运行：')
  console.log('（前提：已用本项目打开开发者工具，wx.cloud 已在 app.js 初始化）\n')
  console.log('--------8<-------- 复制以下内容 --------8<--------')
  console.log(`(async () => {
  const START = ${start}, END = ${end}, GAP_MS = ${gapMs};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rows = [];
  for (let y = START; y <= END; y++) {
    const t0 = Date.now();
    let r = null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getLaunchStats',
        data: { action: 'getGlobalBreakdown', year: y, countryKey: '_all', forceRefresh: true }
      });
      r = res && res.result;
    } catch (e) {
      r = { success: false, error: (e && e.errMsg) || String(e) };
    }
    const cur = new Date().getUTCFullYear();
    const s = (r && r.summary) || {};
    const finalLikely = r && r.success && y < cur && r.partial === false;
    const line = (r && r.success)
      ? \`[\${y}] total=\${s.total} success=\${s.success} failure=\${s.failure} \${finalLikely ? 'final✓' : (r.partial ? 'partial!需重试' : '当前年/未final')} \${(r.elapsed || (Date.now()-t0))}ms\`
      : \`[\${y}] 失败(\${(r && (r.error || (r.rateLimited && 'rateLimited'))) || 'unknown'}) -> 需重试\`;
    console.log(line);
    rows.push({ y, ok: !!(r && r.success), retry: !r || !r.success || r.partial === true || r.rateLimited, finalLikely });
    if (y < END) await sleep(GAP_MS);
  }
  const retry = rows.filter(x => x.retry).map(x => x.y);
  const finals = rows.filter(x => x.finalLikely).map(x => x.y);
  console.log('=== 汇总 ===');
  console.log('成功标 final:', finals.join(', ') || '无');
  console.log('需重试:', retry.join(', ') || '无（全部完成）');
})();`)
  console.log('--------8<-------- 复制到此为止 --------8<--------')
  console.log(`\n说明：逐年串行、每年间隔 ${gapMs}ms。LL2 免费层 15 次/小时/IP，`)
  console.log('没配 LL2_API_TOKEN 时一小时大概只能跑完 2~3 年，被限流的年份会标「需重试」，过 1 小时再对这些年重跑即可。')
}

/** 模式 A：node-sdk 直连调用 clearMissionStatsCache 清空 mission_* 缓存 */
async function clearMissionsWithSdk({ app }, { dryRun }) {
  let result = null
  try {
    const res = await app.callFunction({
      name: 'getLaunchStats',
      data: { action: 'clearMissionStatsCache', dryRun: !!dryRun }
    })
    result = res && res.result
  } catch (e) {
    result = { success: false, error: e && (e.message || String(e)) }
  }
  if (!result || !result.success) {
    console.log(`  清理失败：${(result && result.error) || 'unknown'}`)
    console.log('  提示：确认 getLaunchStats 已部署最新版本（含 clearMissionStatsCache action）。')
    return
  }
  console.log(
    `  ${dryRun ? '[dry-run] 匹配' : '已删除'} mission_* 文档：` +
    `collection=${result.collection || 'launch_stats_cache'} total=${result.total != null ? result.total : '?'} ` +
    `scanned=${result.scanned} matched=${result.matched}` +
    (dryRun ? '' : ` removed=${result.removed}${result.failed ? ` failed=${result.failed}` : ''}`) +
    `  ${result.elapsed}ms`
  )
  if (Array.isArray(result.sampleIds) && result.sampleIds.length) {
    console.log(`  集合内 docId 抽样：${result.sampleIds.join(', ')}`)
  }
  if (result.matched === 0) {
    console.log('  matched=0：云端没有 mission_ 文档。详情页旧的型号「0」脏值通常来自【前端本地 Storage】，')
    console.log('  云函数（node-sdk 模式）无法清前端 Storage。请在微信开发者工具里操作其一：')
    console.log('   1) 顶部「清缓存」→「清除数据缓存」后重新编译；或')
    console.log('   2) 用本脚本的【模式 B 片段】在小程序 Console 跑（它会一并清 _launch_stats_persist_* 本地缓存）。')
  } else if (dryRun) {
    console.log('  这是预演，未实际删除。去掉 --dry-run 再跑一次即可真正清空。')
  } else {
    console.log('  完成。还需在开发者工具清一次前端 Storage（见上），再打开 Falcon 9 详情页确认 649/66 量级。')
  }
}

/**
 * 模式 B：打印可粘贴到微信开发者工具控制台运行的清理片段。
 * 两步都做：① 调云函数清云端 mission_* 文档（若有）；② 清【前端本地 Storage】里
 * 的 _launch_stats_persist_*mission* 缓存——后者才是详情页旧「0」脏值的真正来源
 * （云端限流失败时客户端会回退到本地 persist 旧值，并显示「数据可能不是最新」）。
 */
function printMissionsConsoleSnippet({ dryRun }) {
  console.log('\n未检测到 @cloudbase/node-sdk + 腾讯云密钥，无法从本机直连云函数。')
  console.log('请把下面这段【整体复制】到微信开发者工具 → 调试器 → Console 面板回车运行：')
  console.log('（前提：已用本项目打开开发者工具，wx.cloud 已在 app.js 初始化，')
  console.log(' 且 getLaunchStats 已部署最新版本——含 clearMissionStatsCache action）\n')
  console.log('--------8<-------- 复制以下内容 --------8<--------')
  console.log(`(async () => {
  const DRY_RUN = ${dryRun ? 'true' : 'false'};
  // 步骤 1：清云端 launch_stats_cache 里的 mission_* 文档（admin 权限，绕过小程序端记录权限）
  let r = null;
  try {
    const res = await wx.cloud.callFunction({
      name: 'getLaunchStats',
      data: { action: 'clearMissionStatsCache', dryRun: DRY_RUN }
    });
    r = res && res.result;
  } catch (e) {
    r = { success: false, error: (e && e.errMsg) || String(e) };
  }
  if (!r || !r.success) {
    console.log('[云端] 清理失败:', (r && r.error) || 'unknown');
    console.log('请确认 getLaunchStats 已部署含 clearMissionStatsCache 的最新版本。');
  } else {
    console.log('[云端] mission_* 文档:',
      'collection=' + (r.collection || 'launch_stats_cache'),
      'total=' + (r.total != null ? r.total : '?'),
      'scanned=' + r.scanned, 'matched=' + r.matched,
      DRY_RUN ? '' : ('removed=' + r.removed + (r.failed ? (' failed=' + r.failed) : '')),
      r.elapsed + 'ms');
    if (Array.isArray(r.sampleIds) && r.sampleIds.length) console.log('[云端] docId 抽样:', r.sampleIds.join(', '));
    if (r.matched === 0) console.log('[云端] 无 mission_ 文档 —— 旧「0」脏值在前端本地 Storage，下面步骤 2 会清掉。');
  }
  // 步骤 2：清前端本地 Storage 的发射统计 persist 缓存（_launch_stats_persist_*，含 mission 与全局）
  try {
    const keys = (wx.getStorageInfoSync().keys) || [];
    const hit = keys.filter((k) => k.indexOf('_launch_stats_persist_') === 0);
    if (DRY_RUN) {
      console.log('[本地] dry-run 命中 persist 缓存 ' + hit.length + ' 个键:', hit.join(', ') || '无');
    } else {
      hit.forEach((k) => { try { wx.removeStorageSync(k); } catch (e) {} });
      console.log('[本地] 已清除 persist 缓存 ' + hit.length + ' 个键:', hit.join(', ') || '无');
    }
  } catch (e) {
    console.log('[本地] 读取/清理 Storage 失败:', (e && e.errMsg) || String(e));
  }
  if (!DRY_RUN) console.log('完成。重新编译后打开/下拉刷新某个 Falcon 9 详情页，型号计数应恢复到 649/66 量级（需 LL2 配额已恢复）。');
})();`)
  console.log('--------8<-------- 复制到此为止 --------8<--------')
  console.log('\n说明：步骤 1 用 admin 权限删云端 mission_* 文档；步骤 2 清前端本地 Storage 的')
  console.log('_launch_stats_persist_* 缓存（详情页旧「0」+「数据可能不是最新」的真正来源）。均不消耗 LL2 配额。')
  console.log('注意：前端本地 persist 当前年 TTL 24h、内存缓存 30min，即使不手动清，过期后也会自动失效。')
}

async function runMissions(args) {
  console.log('\n=== 清空任务详情型号统计缓存（云端 mission_* 文档 + 前端本地 persist）' +
    (args.dryRun ? '【dry-run 预演】' : '') + ' ===')
  const cloud = tryInitCloud()
  if (cloud) {
    console.log(`模式 A：node-sdk 直连云函数 (env=${cloud.env})\n`)
    await clearMissionsWithSdk(cloud, args)
  } else {
    console.log('模式 B：输出微信开发者工具控制台可粘贴片段')
    printMissionsConsoleSnippet(args)
  }
}

async function runYears(args) {
  console.log(`\n=== 历史年份批量强制重算 [${args.start}..${args.end}]，年间隔 ${args.gapMs}ms ===`)
  const cloud = tryInitCloud()
  if (cloud) {
    console.log(`模式 A：node-sdk 直连云函数 (env=${cloud.env})\n`)
    const rows = await runWithSdk(cloud, args)
    printSummary(rows)
  } else {
    console.log('模式 B：输出微信开发者工具控制台可粘贴片段')
    printConsoleSnippet(args)
  }
}

async function main() {
  const args = parseArgs()
  if (args.target === 'missions') {
    await runMissions(args)
  } else {
    await runYears(args)
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
