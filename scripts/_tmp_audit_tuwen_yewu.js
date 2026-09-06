/**
 * 图文智能业务：对照「全模块搬迁」计划审计
 */
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { collectSourceChecks, collectBehaviorChecks, collectSpeedChecks, extractFunction } = require('./lib/tuwen-edit-lock-audit')

const ROOT = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

let failed = 0
function check(group, name, ok) {
  if (ok) console.log(`  OK  [${group}] ${name}`)
  else {
    failed += 1
    console.log(`  FAIL[${group}] ${name}`)
  }
}

console.log('── 智能业务系统 COS ──')
;[
  ['网关模块', 'cloudfunctions/adminGateway/tuwenYewu.js'],
  ['前端工具', 'admin-web/src/utils/tuwen-yewu.js'],
  ['打印', 'admin-web/src/utils/tuwen-print.js'],
  ['表格导出', 'admin-web/src/utils/tuwen-xlsx.js'],
  ['模块布局', 'admin-web/src/views/tuwen/TuwenLayout.vue'],
  ['仪表盘', 'admin-web/src/views/tuwen/TuwenDashboardPage.vue'],
  ['列表页', 'admin-web/src/views/tuwen/TuwenYewuPage.vue'],
  ['编辑页', 'admin-web/src/views/tuwen/TuwenOrderEditPage.vue'],
  ['客户', 'admin-web/src/views/tuwen/TuwenCustomersPage.vue'],
  ['供应商', 'admin-web/src/views/tuwen/TuwenSuppliersPage.vue'],
  ['对账单', 'admin-web/src/views/tuwen/TuwenStatementsPage.vue'],
  ['支出', 'admin-web/src/views/tuwen/TuwenExpensesPage.vue'],
  ['售后', 'admin-web/src/views/tuwen/TuwenAfterSalesPage.vue'],
  ['报表', 'admin-web/src/views/tuwen/TuwenReportsPage.vue'],
  ['记录', 'admin-web/src/views/tuwen/TuwenAuditPage.vue'],
  ['设置', 'admin-web/src/views/tuwen/TuwenSettingsPage.vue'],
  ['单测', 'test/tuwen-yewu.test.js'],
  ['锁单审计', 'scripts/lib/tuwen-edit-lock-audit.js'],
  ['版本缓存', 'admin-web/src/utils/tuwen-cache.js']
].forEach(([name, rel]) => check('files', name, exists(rel)))

const gw = read('cloudfunctions/adminGateway/index.js')
const mod = read('cloudfunctions/adminGateway/tuwenYewu.js')
const permFe = read('admin-web/src/utils/permission-modules.js')
const permGwMatch = gw.match(/const PERMISSION_MODULES = \{([\s\S]*?)\n\}/)
const permFeMatch = permFe.match(/export const PERMISSION_MODULES = \{([\s\S]*?)\n\}/)
check('perm', '网关模块表可解析', !!permGwMatch)
check('perm', '前端模块表可解析', !!permFeMatch)

function keysOf(block) {
  return [...String(block || '').matchAll(/^\s*([a-z0-9_]+):/gm)].map((m) => m[1])
}
const gwKeys = keysOf(permGwMatch && permGwMatch[1])
const feKeys = keysOf(permFeMatch && permFeMatch[1])
check('perm', '前后端权限键一致', JSON.stringify(gwKeys) === JSON.stringify(feKeys))
check('perm', '含 tuwen_yewu', gwKeys.includes('tuwen_yewu') && feKeys.includes('tuwen_yewu'))
check('perm', '展示名', /tuwen_yewu:\s*'智能业务系统'/.test(gw) && /tuwen_yewu:\s*'智能业务系统'/.test(permFe))

const client = read('admin-web/src/api/client.js')
const router = read('admin-web/src/router/index.js')
const layout = read('admin-web/src/views/shell/LayoutPage.vue')
const page = read('admin-web/src/views/tuwen/TuwenYewuPage.vue')
const edit = read('admin-web/src/views/tuwen/TuwenOrderEditPage.vue')
const twLayout = read('admin-web/src/views/tuwen/TuwenLayout.vue')
const settingsPage = read('admin-web/src/views/tuwen/TuwenSettingsPage.vue')
const dashPage = read('admin-web/src/views/tuwen/TuwenDashboardPage.vue')
const custPage = read('admin-web/src/views/tuwen/TuwenCustomersPage.vue')
const stmtPage = read('admin-web/src/views/tuwen/TuwenStatementsPage.vue')
const expPage = read('admin-web/src/views/tuwen/TuwenExpensesPage.vue')
const afterPage = read('admin-web/src/views/tuwen/TuwenAfterSalesPage.vue')
const reportPage = read('admin-web/src/views/tuwen/TuwenReportsPage.vue')
const auditPage = read('admin-web/src/views/tuwen/TuwenAuditPage.vue')
const printUtil = read('admin-web/src/utils/tuwen-print.js')
const xlsxUtil = read('admin-web/src/utils/tuwen-xlsx.js')
const feUtil = read('admin-web/src/utils/tuwen-yewu.js')
const tuwenCss = read('admin-web/src/views/tuwen/tuwen.css')

check('wire', 'HOME_PATHS', /'\s*tuwen_yewu'\s*,\s*'\/tuwen\/dashboard'/.test(client.replace(/\s+/g, '')))
check('wire', 'client 订单/导入/仪表盘', client.includes('/tuwen/orders') && client.includes('/tuwen/import') && client.includes('/tuwen/dashboard'))
check('wire', 'client 客户/对账单/设置', client.includes('/tuwen/customers') && client.includes('/tuwen/statements/collect') && client.includes('/tuwen/settings') && client.includes('/tuwen/sample-image'))
check('wire', 'client 售后/报表/记录', client.includes('/tuwen/after-sales') && client.includes('/tuwen/reports') && client.includes('/tuwen/audit-logs'))
check('wire', 'router perm', /path:\s*'tuwen'[\s\S]*perm:\s*'tuwen_yewu'/.test(router))
check('wire', '嵌套路由', router.includes('TuwenLayout.vue') && router.includes("path: 'orders/new'") && router.includes("path: 'after-sales'"))
check('wire', '侧栏单项', layout.includes('index="/tuwen/dashboard"') && layout.includes("hasPerm('tuwen_yewu')"))
check('wire', 'gateway COS', gw.includes('createCOSClient') && gw.includes("'/tuwen/orders'"))
check('wire', 'gateway 模块路由', [
  '/tuwen/dashboard', '/tuwen/customers', '/tuwen/suppliers', '/tuwen/expenses',
  '/tuwen/after-sales', '/tuwen/statements/collect', '/tuwen/reports',
  '/tuwen/audit-logs', '/tuwen/settings', '/tuwen/orders/batch-status', '/tuwen/edit', '/tuwen/sample-image'
].every((p) => gw.includes(`'${p}'`)))
check('wire', '批量改状态在 :id 前', gw.indexOf("path === '/tuwen/orders/batch-status'") < gw.indexOf("path.startsWith('/tuwen/orders/')"))
check('cos', 'workspace 前缀未改', mod.includes('图文智能业务/') && mod.includes("WORKSPACE_ID = 'default'") && feUtil.includes("SAMPLE_COS_PREFIX = '图文智能业务/default/samples/'"))
check('cos', '列表不带 data URL', mod.includes('sampleImageUrl:') && mod.includes('/^https?:') && !gw.includes("path === '/tuwen/health'"))
check('cos', '导出去掉 data URL', /async function getWorkspace[\s\S]{0,900}stripLineImages/.test(mod))
check('cos', '导入合并全实体', mod.includes('incomingSuppliers') && mod.includes('incomingAfterSales') && mod.includes('incomingSettings'))
check('ux', '顶栏十模块', ['仪表盘', '订单', '客户', '供应商', '对账单', '支出', '售后', '报表', '记录', '设置'].every((t) => twLayout.includes(t)))
check('ux', '订单筛选复制批量打印', page.includes('paidLocked') && page.includes('copyTuwenOrder') && page.includes('batchTuwenOrderStatus'))
check('ux', '列表直接收款', page.includes('payTuwenOrder') && page.includes('确认收款') && page.includes('openPay') && page.includes('canPay'))
check('ux', '复制订单用今日开单', /copyOrder[\s\S]{0,500}orderDate:\s*today/.test(mod) && edit.includes('orderDate: todayDate()'))
check('ux', '开单明细列', ['outsource', 'code', 'spec', 'material', 'widthMm', 'lineAreaM2', 'RECEIVE_METHODS'].every((k) => edit.includes(k)))
check('ux', '返回自动保存', edit.includes('saveIfNeeded') && edit.includes('persistOnLeave') && edit.includes('onClose') && edit.includes('persistOnUnload'))
check('ux', '关页事件', edit.includes('visibilitychange') && edit.includes('pagehide'))
const lineTable = read('admin-web/src/views/tuwen/TwLineTable.vue')
check('ux', '点整格可编辑', lineTable.includes('onCellActivate') && lineTable.includes('tw-cell-edit') && tuwenCss.includes('.tw-cell-edit:focus-within'))
for (const [group, name, ok] of collectSourceChecks({ edit, lineTable, twLayout, tuwenCss, client })) {
  check(group, name, ok)
}
for (const [group, name, ok] of collectSpeedChecks({ edit, page, client, gw, mod })) {
  check(group, name, ok)
}
check('ux', '客户星标', custPage.includes('starred'))
check('ux', '对账单摊分', stmtPage.includes('collectTuwenStatement'))
check('ux', '对账单按订单热搜', stmtPage.includes('filteredOrders') && stmtPage.includes('filterStatementOrders') && !stmtPage.includes('v-for="(line, i) in data.lines'))
const stmtSearch = (stmtPage.match(/<el-autocomplete[\s\S]*?\/>/) || [''])[0]
check('ux', '对账单搜索即时', stmtSearch.includes('v-model="keyword"') && !stmtSearch.includes('@change="load"') && !stmtSearch.includes('@keyup.enter'))
check('ux', '对账单打印跟筛选', stmtPage.includes('statementSheetHtml') && printUtil.includes('print-statement__sum') && printUtil.includes('样图'))
check('ux', '对账单预览可导出', stmtPage.includes('exportStatementJpg') && stmtPage.includes('exportStatementExcel') && printUtil.includes('function exportStatementJpg') && printUtil.includes('function statementExcelHtml') && !printUtil.includes("|| '正大广告'"))
check('ux', '对账单表格嵌样图', printUtil.includes('buildStatementXlsx') && printUtil.includes('.xlsx') && !printUtil.includes('statementSampleText') && xlsxUtil.includes('xl/media/'))
check('ux', '对账单新日期在前', feUtil.includes('function sortStatementOrders') && /orders\.sort\(\(a, b\) => \{[\s\S]{0,160}b\.orderDate/.test(mod))
const collectFn = extractFunction(mod, 'collectStatement')
check('loop', '收款仍从早到晚', collectFn.includes('a.orderDate || a.createdAt') && collectFn.includes('.localeCompare(String(b.orderDate'))
check('ux', '空公司名不兜底', !printUtil.includes("|| '正大广告'") && !printUtil.includes('|| "正大广告"') && feUtil.includes("brandCompanyName: ''") && feUtil.includes('function brandCompanyNameOf'))
check('ux', '对账单收款跟当前结果', stmtPage.includes('orderIds') && stmtPage.includes('uniqueStatementParty') && mod.includes('orderIds'))
check('ux', '订单搜索即时', !page.includes('@keyup.enter="onSearch"') && page.includes('watch(keyword') && page.includes('searchLater'))
check('ux', '客户搜索即时', !custPage.includes('@keyup.enter') && custPage.includes('matchesKeyword'))
check('ux', '供应商搜索即时', read('admin-web/src/views/tuwen/TuwenSuppliersPage.vue').includes('matchesKeyword'))
check('ux', '售后搜索即时', afterPage.includes('matchesKeyword'))
check('ux', '支出搜索即时', expPage.includes('matchesKeyword'))
check('ux', '记录搜索即时', auditPage.includes('watch(keyword') && !auditPage.includes('@keyup.enter'))
check('ux', '记录能搜中文且本地兜底', auditPage.includes('matchesAuditLog') && mod.includes('auditLogSearchBlob') && mod.includes("order_create: '新建订单'"))
check('ux', '对账单兼容旧汇总', stmtPage.includes('ordersFromStatementPayload') && feUtil.includes('function hydrateStatementOrders'))
check('loop', '对账单按订单汇总', mod.includes('projectNames:') && feUtil.includes('function statementLinesForOrders'))
check('loop', '同名客户收款不串', feUtil.includes('function uniqueStatementParty') && mod.includes('customerId'))
check('loop', '汇总带客户ID', /function summarizeOrder[\s\S]{0,400}customerId:/.test(mod))
check('loop', '对账单热搜含项目', /async function getStatements[\s\S]{0,900}projectName/.test(mod))
check('ux', '支出可为负', expPage.includes('可为负'))
check('ux', '售后保修字段', afterPage.includes('warrantyFrom') && afterPage.includes('printAfterSaleSheet'))
check('ux', '报表分类', reportPage.includes('expenseByCategory') && reportPage.includes('getTuwenReports'))
check('ux', '操作记录', auditPage.includes('listTuwenAuditLogs'))
check('ux', '设置打印与导入', settingsPage.includes('printCompanyTitle') && settingsPage.includes('chunkImportBatches') && settingsPage.includes('paymentQrDataUrl'))
check('ux', '备份导出含支出', settingsPage.includes('workspaceBackupOf') && feUtil.includes('function workspaceBackupOf') && /expenses: Array.isArray\(ws.expenses\)/.test(mod))
check('ux', '仪表盘数字', dashPage.includes('getTuwenDashboard') && dashPage.includes('statusCounts'))
check('ux', 'TAB 蓝杠加高', tuwenCss.includes('.tw-tab.is-active::after') && /font-size:\s*16px/.test(tuwenCss) && tuwenCss.includes('#3d8bfd'))
check('ux', '仪表盘金额默认隐藏', dashPage.includes('moneyVisible') && dashPage.includes('¥••••••') && dashPage.includes('tuwen-dash-money-visible'))
check('ux', '明细表头吸顶', tuwenCss.includes('position: sticky') && tuwenCss.includes('.tw-line-table thead th') && edit.includes('tw-line-block'))
check('ux', '结算区一排', edit.includes('order-finance__row') && tuwenCss.includes('.order-finance__row'))
check('ux', '打印抬头收款码', printUtil.includes('printCompanyTitle') && printUtil.includes('paymentQrDataUrl') && printUtil.includes('.print()'))
check('ux', '今日用东八区', mod.includes('function chinaYmd') && mod.includes('8 * 3600 * 1000'))
check('ux', '无 iframe 业务台', !page.includes('<iframe') && !twLayout.includes('8787'))
check('ux', '无 8787', !page.includes('8787') && !mod.includes('127.0.0.1:8787') && !gw.includes("path === '/tuwen/health'"))
check('loop', '取消单不进财务', mod.includes('function isBillableOrder') && mod.includes('已取消订单不能收款'))
check('loop', '对账单收款锁单', mod.includes('order.paymentModalConfirmedAt = nowIso'))
check('loop', '新客户不按名合并', mod.includes('const forceNew = !!order.isNewCustomer'))
check('loop', '已收款不可改', mod.includes('已收款订单不可修改') && edit.includes('locked.value'))
check('ux', '手机端收重复按钮', tuwenCss.includes('tw-dup-action') && tuwenCss.includes('96vw'))
check('ux', '售后能选关联订单', afterPage.includes('listTuwenOrders') && afterPage.includes('onRelatedOrder'))

;(async () => {
  const fe = await import(pathToFileURL(path.join(ROOT, 'admin-web/src/utils/tuwen-yewu.js')).href)
  for (const [group, name, ok] of collectBehaviorChecks(fe)) {
    check(group, name, ok)
  }
  if (failed) {
    console.log(`\n审计失败 ${failed} 项`)
    process.exit(1)
  }
  console.log('\n审计通过')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
