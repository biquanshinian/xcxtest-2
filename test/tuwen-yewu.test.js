/**
 * 图文智能业务：COS 工作区 + 订单金额 + 权限接入。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  COS_PREFIX,
  WORKSPACE_ID,
  workspaceKey,
  sampleKeyFromPublicUrl,
  lineAmount,
  orderReceivable,
  orderPaid,
  orderBalance,
  nextOrderNo,
  normalizeOrder,
  stripLineImages,
  summarizeOrder,
  createTuwenYewuApi,
  chinaYmd
} = require('../cloudfunctions/adminGateway/tuwenYewu.js')
const { collectSourceChecks, collectBehaviorChecks, collectSpeedChecks } = require('../scripts/lib/tuwen-edit-lock-audit')

assert.strictEqual(workspaceKey('default'), '图文智能业务/default/workspace.json')
assert.ok(COS_PREFIX.includes('图文'))
assert.strictEqual(WORKSPACE_ID, 'default')

const piece = { qty: 3, unitPrice: 2, pricingMode: 'by_piece' }
assert.strictEqual(lineAmount(piece), 6)

const area = { qty: 2, widthMm: 1000, heightMm: 2000, unitPrice: 10, pricingMode: 'by_area' }
assert.strictEqual(lineAmount(area), 40)

const order = {
  discount: 5,
  taxRate: 0,
  prepay: 10,
  currentPayment: 5,
  lines: [piece]
}
assert.strictEqual(orderReceivable(order), 1)
assert.strictEqual(orderPaid(order), 15)
assert.strictEqual(orderBalance({ ...order, prepay: 0, currentPayment: 0 }), 1)

const no = nextOrderNo([], '2026-09-03')
assert.ok(/^TW-202609-\d{4}$/.test(no), no)

const stripped = stripLineImages({
  id: 'l1',
  sampleImageDataUrl: 'data:image/png;base64,aaaa'
})
assert.strictEqual(stripped.sampleImageDataUrl, undefined)

const summary = summarizeOrder({
  id: 'o1',
  orderNo: 'TW-202609-1001',
  customerName: '环宇',
  status: 'pending',
  lines: [piece],
  prepay: 0,
  currentPayment: 0,
  discount: 0,
  taxRate: 0
})
assert.strictEqual(summary.statusLabel, '待制作')
assert.strictEqual(summary.customerId, '')
assert.strictEqual(summarizeOrder({ customerId: 'c1', customerName: '甲', lines: [] }).customerId, 'c1')
assert.strictEqual(summary.receivable, 6)
assert.strictEqual(summarizeOrder({
  lines: [{ sampleImageDataUrl: 'https://mars.example/a.jpg' }]
}).sampleImageUrl, 'https://mars.example/a.jpg')

const normalized = normalizeOrder({
  customerName: 'A',
  lines: [{ projectName: '打印', qty: 1, unitPrice: 2, sampleImageDataUrl: 'https://example.com/a.jpg' }]
}, { nowIso: '2026-09-04T00:00:00.000Z', actor: { username: 'tester' } })
assert.strictEqual(normalized.salesperson, 'tester')
assert.strictEqual(normalized.lines[0].sampleImageDataUrl, 'https://example.com/a.jpg')
assert.strictEqual(normalized.quotePlans.length, 3)
assert.strictEqual(normalized.quotePlans[0].name, '经济方案')
assert.strictEqual(normalized.quotePlans[1].name, '标准方案')

const quoted = normalizeOrder({
  customerName: 'A',
  quotePlans: [{ name: '经济方案', unitPrice: 10.126, total: 88, note: '内部档' }],
  lines: [{ projectName: '打印', qty: 1, unitPrice: 2 }]
}, { nowIso: '2026-09-04T00:00:00.000Z', actor: { username: 'tester' } })
assert.strictEqual(quoted.quotePlans[0].unitPrice, 10.13)
assert.strictEqual(quoted.quotePlans[0].total, 88)
assert.strictEqual(quoted.quotePlans[0].note, '内部档')
assert.strictEqual(quoted.quotePlans[0].companyName, '')
assert.strictEqual(quoted.quotePlans[2].name, '加急方案')

const namedCo = normalizeOrder({
  customerName: 'A',
  printDocTitle: '施工单',
  quotePlans: [{ companyName: '文昌广告装饰' }],
  lines: [{ projectName: '打印', qty: 1, unitPrice: 2 }]
}, { nowIso: '2026-09-04T00:00:00.000Z', actor: { username: 'tester' } })
assert.strictEqual(namedCo.quotePlans[0].companyName, '文昌广告装饰')
assert.strictEqual(namedCo.printDocTitle, '施工单')

const quotedItems = normalizeOrder({
  customerName: 'A',
  quotePlans: [{
    companyName: '文昌广告',
    customerName: '色然村',
    items: [{ projectName: '喷绘', qty: 2, unitPrice: 50, sampleImageDataUrl: 'https://x.com/a.jpg' }]
  }],
  lines: [{ projectName: '原单', qty: 1, unitPrice: 1, sampleImageDataUrl: 'https://x.com/b.jpg' }]
}, { nowIso: '2026-09-04T00:00:00.000Z', actor: { username: 'tester' } })
assert.strictEqual(quotedItems.quotePlans[0].customerName, '色然村')
assert.strictEqual(quotedItems.quotePlans[0].items[0].projectName, '喷绘')
assert.strictEqual(quotedItems.quotePlans[0].items[0].qty, 2)
assert.ok(!quotedItems.quotePlans[0].items[0].sampleImageDataUrl)

assert.strictEqual(chinaYmd('2026-09-04'), '2026-09-04')
assert.strictEqual(chinaYmd('2026-09-03T16:30:00.000Z'), '2026-09-04')
assert.strictEqual(chinaYmd('2026-09-04T12:00:00.000Z'), '2026-09-04')

function ok(data) { return { code: 0, data } }
function fail(code, message) { return { code, message } }
function checkPerm(user, mod) {
  if (!user) return fail(4010, '未授权或登录已过期')
  if (user.role !== 'super_admin' && !(user.permissions || []).includes(mod)) {
    return fail(4030, '无权限访问该模块')
  }
  return null
}

function createMockApi() {
  const store = {}
  const etags = {}
  let etagSeq = 0
  let gets = 0
  const api = createTuwenYewuApi({
    ok,
    fail,
    now: () => Date.parse('2026-09-04T12:00:00.000Z'),
    writeOpLog: async () => {},
    checkPerm,
    COS_BUCKET: 'mars-1397421562',
    COS_REGION: 'ap-guangzhou',
    COS_BASE_URL: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/',
    createCOSClient: () => ({
      putObject(opts, cb) {
        store[opts.Key] = Buffer.from(opts.Body)
        etagSeq += 1
        etags[opts.Key] = `"${etagSeq}"`
        cb(null, { ETag: etags[opts.Key] })
      },
      getObject(opts, cb) {
        gets += 1
        if (!store[opts.Key]) return cb({ code: 'NoSuchKey', message: 'The specified key does not exist' })
        const tag = etags[opts.Key]
        if (opts.IfNoneMatch && tag && String(opts.IfNoneMatch) === tag) {
          return cb({ statusCode: 304, code: 'NotModified' })
        }
        cb(null, { Body: store[opts.Key], ETag: tag })
      }
    })
  })
  api._gets = () => gets
  api._putRaw = (key, buf) => {
    store[key] = Buffer.from(buf)
    etagSeq += 1
    etags[key] = `"${etagSeq}"`
  }
  return api
}

;(async () => {
  const denied = createMockApi()
  const noPerm = await denied.listOrders({ username: 'x', permissions: [] }, {})
  assert.strictEqual(noPerm.code, 4030)

  const api = createMockApi()
  const user = { id: 'u1', username: '胡雨泽', role: 'editor', permissions: ['tuwen_yewu'] }

  const empty = await api.listOrders(user, {})
  assert.strictEqual(empty.code, 0)
  assert.strictEqual(empty.data.total, 0)

  const created = await api.upsertOrder(user, {
    order: {
      customerName: '环宇大酒店装修',
      phone: '13800000000',
      lines: [{ projectName: '彩色打印', qty: 4, unitPrice: 2, unitLabel: '张' }],
      quotePlans: [
        { name: '经济方案', companyName: '文昌广告', unitPrice: 1.5, total: 6 },
        { name: '标准方案', unitPrice: 2, total: 8 },
        { name: '加急方案', unitPrice: 2.5, total: 10 }
      ]
    }
  })
  assert.strictEqual(created.code, 0)
  assert.ok(created.data.order.orderNo.startsWith('TW-'))
  assert.strictEqual(created.data.order.receivable, 8)
  assert.strictEqual(created.data.order.quotePlans[2].total, 10)
  assert.strictEqual(created.data.order.quotePlans[0].companyName, '文昌广告')
  const orderId = created.data.order.id

  const listed = await api.listOrders(user, { q: '环宇' })
  assert.strictEqual(listed.data.total, 1)
  assert.strictEqual(listed.data.list[0].customerName, '环宇大酒店装修')
  const listedByProject = await api.listOrders(user, { q: '彩色打印' })
  assert.strictEqual(listedByProject.data.total, 1)
  assert.strictEqual(listedByProject.data.list[0].id, orderId)
  assert.ok(Array.isArray(listed.data.list[0].lines))
  assert.ok(listed.data.settings && typeof listed.data.settings === 'object')

  const bootNew = await api.getEditBootstrap(user, {})
  assert.strictEqual(bootNew.code, 0)
  assert.ok(!bootNew.data.order)
  assert.ok(Array.isArray(bootNew.data.customers))
  assert.ok(bootNew.data.settings)

  const bootGot = await api.getEditBootstrap(user, { id: orderId })
  assert.strictEqual(bootGot.data.order.id, orderId)
  assert.ok(bootGot.data.customers.some((c) => c.name === '环宇大酒店装修'))

  const bootCopy = await api.getEditBootstrap(user, { copyFrom: orderId })
  assert.ok(bootCopy.data.copied)
  assert.strictEqual(bootCopy.data.order.id, orderId)
  assert.ok(listed.data.version > 0)
  const listedSame = await api.listOrders(user, { q: '环宇', sinceVersion: listed.data.version })
  assert.ok(listedSame.data.unchanged, '工作区没变时列表应直接 unchanged')
  const bootSame = await api.getEditBootstrap(user, { id: orderId, sinceVersion: bootGot.data.version })
  assert.ok(bootSame.data.unchanged, '工作区没变时详情应直接 unchanged')
  const bootStale = await api.getEditBootstrap(user, { id: orderId, sinceVersion: 1 })
  assert.ok(!bootStale.data.unchanged)
  assert.strictEqual(bootStale.data.order.id, orderId)

  const cachedGets = api._gets()
  await api.listOrders(user, {})
  await api.getSettings(user)
  await api.listCustomers(user, {})
  assert.strictEqual(api._gets(), cachedGets, '热缓存不应再拉 COS 工作区')

  api._expireWorkspaceCache()
  const listedAgain = await api.listOrders(user, { q: '环宇' })
  assert.strictEqual(listedAgain.data.total, 1)
  assert.ok(api._gets() > cachedGets)

  const cold = createMockApi()
  await Promise.all([cold.listOrders(user, {}), cold.getSettings(user), cold.listCustomers(user, {})])
  assert.ok(cold._gets() <= 1, '并发读应合并成一次 COS 拉取')

  const dash = await api.dashboard(user)
  assert.strictEqual(dash.code, 0)
  assert.ok(dash.data.orderCount >= 1)
  assert.ok(dash.data.receivable >= 8)
  assert.ok(dash.data.paid >= 0)
  assert.ok(dash.data.todayCount >= 1)

  const cust = await api.upsertCustomer(user, { name: '星标客户', phone: '13900000000', starred: true })
  assert.strictEqual(cust.code, 0)
  const custList = await api.listCustomers(user, {})
  assert.ok(custList.data.list[0].starred)

  const sup = await api.upsertSupplier(user, { name: '板材行' })
  assert.strictEqual(sup.code, 0)
  const exp = await api.upsertExpense(user, { category: '材料采购', amount: -20, expenseDate: '2026-09-04' })
  assert.strictEqual(exp.code, 0)
  assert.strictEqual(exp.data.expense.amount, -20)
  const after = await api.upsertAfterSale(user, { customerName: '环宇大酒店装修', issueType: '褪色' })
  assert.strictEqual(after.code, 0)
  assert.ok(String(after.data.afterSale.ticketNo).startsWith('AS-'))

  const paid = await api.payOrder(user, orderId, { amount: 3, paymentMethod: '微信' })
  assert.strictEqual(paid.code, 0)
  assert.strictEqual(paid.data.order.paid, 3)

  const copied = await api.copyOrder(user, orderId)
  assert.strictEqual(copied.code, 0)
  assert.notStrictEqual(copied.data.order.id, orderId)
  assert.strictEqual(copied.data.order.status, 'pending')

  const oldDated = await api.upsertOrder(user, {
    order: {
      customerName: '旧开单日客户',
      orderDate: '2026-01-15',
      lines: [{ projectName: '旧单', qty: 1, unitPrice: 1 }],
      quotePlans: [{ name: '经济方案', orderDate: '2026-01-15' }]
    }
  })
  assert.strictEqual(oldDated.data.order.orderDate, '2026-01-15')
  const recopied = await api.copyOrder(user, oldDated.data.order.id)
  assert.strictEqual(recopied.code, 0)
  assert.strictEqual(recopied.data.order.orderDate, '2026-09-04')
  assert.ok(String(recopied.data.order.orderNo).startsWith('TW-202609-'), recopied.data.order.orderNo)
  assert.strictEqual(recopied.data.order.quotePlans[0].orderDate, '2026-09-04')

  const batched = await api.batchStatus(user, { ids: [orderId], status: 'producing' })
  assert.strictEqual(batched.data.changed, 1)

  const sorted = await api.sortOrders(user, { ids: [copied.data.order.id, orderId] })
  assert.strictEqual(sorted.code, 0)
  const listedSorted = await api.listOrders(user, { pageSize: 50 })
  assert.strictEqual(listedSorted.data.list[0].id, copied.data.order.id)
  assert.ok(listedSorted.data.list[0].lines[0].projectName)

  const settle = await api.payOrder(user, orderId, { amount: 5, remark: '结清' })
  assert.strictEqual(settle.code, 0)
  assert.ok(settle.data.order.lastPaymentRemark === '结清')
  const paidLockedBatch = await api.batchStatus(user, { ids: [orderId], status: 'done' })
  assert.strictEqual(paidLockedBatch.data.changed, 0)
  const listedPaid = await api.listOrders(user, { status: '__paid__' })
  assert.ok(listedPaid.data.list.some((o) => o.id === orderId))

  const stmt = await api.getStatements(user, { customer: '环宇大酒店装修' })
  assert.ok(stmt.data.unpaid >= 0)
  assert.ok(Array.isArray(stmt.data.orders))
  assert.ok(stmt.data.orders.some((o) => o.orderNo && 'projectNames' in o && 'subtotal' in o))
  assert.ok((stmt.data.lines || []).every((l) => 'sampleImageUrl' in l && 'widthMm' in l && 'remark' in l))
  const collected = await api.collectStatement(user, { customer: '环宇大酒店装修', amount: 1, paymentMethod: '现金' })
  assert.strictEqual(collected.code, 0)

  const reports = await api.getReports(user, { from: '2026-09-01', to: '2026-09-30' })
  assert.ok(reports.data.income >= 0)
  assert.ok(Array.isArray(reports.data.expenseByCategory))

  const savedSet = await api.saveSettings(user, { brandCompanyName: '正大广告', printCompanyTitle: '正大广告装饰业务单', printDocTitle: '施工单' })
  assert.strictEqual(savedSet.data.settings.brandCompanyName, '正大广告')
  assert.strictEqual(savedSet.data.settings.printDocTitle, '施工单')
  assert.ok(Array.isArray(savedSet.data.settings.orderLineColumns))
  assert.ok(savedSet.data.settings.orderLineColumns.some((c) => c.key === 'unit'))
  const logs = await api.listAuditLogs(user, { page: 1, pageSize: 20 })
  assert.ok(logs.data.total >= 1)
  const logsByCustomer = await api.listAuditLogs(user, { q: '环宇大酒店装修', page: 1, pageSize: 50 })
  assert.ok(logsByCustomer.data.total >= 1)
  assert.ok(logsByCustomer.data.list.every((row) => String(row.customerName || '').includes('环宇')))
  const logsByAction = await api.listAuditLogs(user, { q: '新建订单', page: 1, pageSize: 50 })
  assert.ok(logsByAction.data.total >= 1)
  assert.ok(logsByAction.data.list.every((row) => row.action === 'order_create'))
  const logsMiss = await api.listAuditLogs(user, { q: '绝对不存在的词xyz', page: 1, pageSize: 20 })
  assert.strictEqual(logsMiss.data.total, 0)

  const got = await api.getOrder(user, orderId)
  assert.strictEqual(got.data.order.phone, '13800000000')

  const imported = await api.importWorkspace(user, {
    orders: [{
      id: 'imp-1',
      orderNo: 'TW-202609-9999',
      customerName: '导入客户',
      lines: [{ projectName: 'KT板', qty: 1, unitPrice: 80, sampleImageDataUrl: 'data:image/png;base64,xxxx' }]
    }],
    suppliers: [{ id: 's-imp', name: '导入供应商' }],
    appSettings: { brandCompanyName: '导入公司' }
  })
  assert.strictEqual(imported.data.imported, 1)
  const ws = await api.getWorkspace(user)
  assert.ok(ws.data.suppliers.some((s) => s.name === '导入供应商'))
  assert.strictEqual(ws.data.appSettings.brandCompanyName, '导入公司')
  assert.ok(Array.isArray(ws.data.expenses), '备份应含支出数组')
  const expSaved = await api.upsertExpense(user, { expenseDate: '2026-04-27', category: '材料采购', amount: 41, note: '切纸刀-京东' })
  assert.equal(expSaved.code, 0)
  const wsWithExp = await api.getWorkspace(user)
  assert.ok(wsWithExp.data.expenses.some((e) => e.note === '切纸刀-京东' && e.amount === 41), '导出备份应包含支出')
  const expOnly = await api.importWorkspace(user, {
    expenses: [{ id: 'e-imp', expenseDate: '2026-03-01', category: '房租物业', amount: 1200, note: '三月房租' }]
  })
  assert.equal(expOnly.code, 0)
  assert.ok(expOnly.data.expenseCount >= 2)
  const wsExpImp = await api.getWorkspace(user)
  assert.ok(wsExpImp.data.expenses.some((e) => e.id === 'e-imp' && e.amount === 1200))
  const importedOrder = await api.getOrder(user, 'imp-1')
  assert.ok(!String(importedOrder.data.order.lines[0].sampleImageDataUrl || '').startsWith('data:'))

  const st = await api.status(user)
  assert.strictEqual(st.data.storage, 'cos')
  assert.ok(st.data.orderCount >= 2)

  const removed = await api.removeOrder(user, orderId)
  assert.strictEqual(removed.code, 0)
  const afterDel = await api.listOrders(user, {})
  assert.ok(afterDel.data.total >= 1)

  const ROOT = path.join(__dirname, '..')
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const gw = read('cloudfunctions/adminGateway/index.js')
  const perm = read('admin-web/src/utils/permission-modules.js')
  const client = read('admin-web/src/api/client.js')
  const router = read('admin-web/src/router/index.js')
  const layout = read('admin-web/src/views/shell/LayoutPage.vue')
  const page = read('admin-web/src/views/tuwen/TuwenYewuPage.vue')
  const edit = read('admin-web/src/views/tuwen/TuwenOrderEditPage.vue')
  const twLayout = read('admin-web/src/views/tuwen/TuwenLayout.vue')
  const settingsPage = read('admin-web/src/views/tuwen/TuwenSettingsPage.vue')
  const feUtil = read('admin-web/src/utils/tuwen-yewu.js')
  const printUtil = read('admin-web/src/utils/tuwen-print.js')
  const twGw = read('cloudfunctions/adminGateway/tuwenYewu.js')
  const sampleCell = read('admin-web/src/views/tuwen/TwSampleCell.vue')

  assert.ok(/tuwen_yewu:\s*'智能业务系统'/.test(gw), '网关 PERMISSION_MODULES 缺智能业务系统')
  assert.ok(/tuwen_yewu:\s*'智能业务系统'/.test(perm), '前端 PERMISSION_MODULES 缺智能业务系统')
  assert.ok(layout.includes('智能业务系统'), '侧栏展示名应为智能业务系统')
  assert.ok(!gw.includes('图文广告智能业务系统') && !perm.includes('图文广告智能业务系统'), '展示名不应再写图文广告')
  assert.ok(gw.includes("path === '/tuwen/orders'"), '网关缺订单列表路由')
  assert.ok(gw.includes("path === '/tuwen/import'"), '网关缺导入路由')
  assert.ok(gw.includes("path === '/tuwen/dashboard'"), '网关缺仪表盘路由')
  const dashPage = read('admin-web/src/views/tuwen/TuwenDashboardPage.vue')
  const tuwenCss = read('admin-web/src/views/tuwen/tuwen.css')
  assert.ok(dashPage.includes('记账总金额') && dashPage.includes('累计已收'), '仪表盘应显示记账总金额和累计已收')
  assert.ok(dashPage.includes('TwCountUp') && tuwenCss.includes('scaleX(var(--tw-bar'), '仪表盘数字与进度条应有动效')
  assert.ok(twLayout.includes('tw-fade'), '模块切换应有短淡入')
  assert.ok(twGw.includes('paid: round2(paid)'), '仪表盘应汇总已收')
  assert.ok(gw.includes("path === '/tuwen/customers'"), '网关缺客户路由')
  assert.ok(gw.includes("path === '/tuwen/statements/collect'"), '网关缺对账单收款')
  assert.ok(gw.includes("path === '/tuwen/orders/batch-status'"), '网关缺批量改状态')
  assert.ok(gw.includes('createCOSClient'), '网关未把 COS 交给图文模块')
  assert.ok(client.includes("['tuwen_yewu', '/tuwen/dashboard']"), 'HOME_PATHS 缺图文入口')
  assert.ok(client.includes("request('/tuwen/orders'"), 'client 缺订单 API')
  assert.ok(client.includes("request('/tuwen/import'"), 'client 缺导入 API')
  assert.ok(client.includes("request('/tuwen/dashboard'"), 'client 缺仪表盘 API')
  assert.ok(router.includes("path: 'tuwen'") && router.includes("perm: 'tuwen_yewu'"), '路由未接权限')
  assert.ok(router.includes("redirect: '/tuwen/dashboard'"), '图文根路径应跳到模块内仪表盘，不能相对跳到 /dashboard')
  assert.ok(layout.includes("hasPerm('tuwen_yewu')") && layout.includes('index="/tuwen/dashboard"'), '侧栏未接权限菜单')
  assert.ok(router.includes("path: 'orders/new'"), '缺新建订单路由')
  assert.ok(router.includes('TuwenLayout.vue'), '缺图文模块布局')
  assert.ok(twLayout.includes('仪表盘') && twLayout.includes('/tuwen/settings'), '顶栏缺模块导航')
  assert.ok(page.includes('listTuwenOrders') && page.includes('goNew'), '列表页缺云端订单')
  assert.ok(page.includes('batchTuwenOrderStatus') && page.includes('copyTuwenOrder'), '列表页缺批量改状态/复制')
  assert.ok(page.includes('全部展开') && page.includes('deleteTuwenOrder') && page.includes('sortTuwenOrders'), '列表页应含展开/删除/排序')
  assert.ok(page.includes('payTuwenOrder') && page.includes('确认收款') && page.includes('openPay'), '列表页应能直接收款')
  assert.ok(page.includes('isCancelled') && page.includes('!row.paidLocked') && page.includes('keep.has(id)'), '列表收款应禁用已收/取消，并清掉已锁勾选')
  assert.ok(settingsPage.includes('tw-settings-split') && settingsPage.includes('打印与开单') && settingsPage.includes('数据备份'), '设置页应按打印/分类/收款码/备份分组')
  assert.ok(gw.includes("path === '/tuwen/orders/sort'"), '网关缺订单排序路由')
  assert.ok(edit.includes('saveTuwenOrder') && edit.includes('新建订单') === false, '编辑页应能保存')
  assert.ok(edit.includes('saveIfNeeded') && edit.includes('已自动保存'), '返回列表应自动保存')
  assert.ok(edit.includes('persistOnLeave') && edit.includes('flushPendingInputs'), '离开订单应先提交当前输入再保存')
  assert.ok(edit.includes('onClose') && edit.includes('persistOnUnload') && edit.includes('visibilitychange') && edit.includes('pagehide'), '关闭、跳转、关页都要自动保存')
  assert.ok(edit.includes('onBeforeRouteLeave(async (to)') && !edit.includes('next(ok !== false)'), '路由守卫应返回值而不是 next 回调')
  assert.ok(edit.includes('lineAreaM2') && edit.includes('printOrderSheet'), '开单应含面积与打印')
  assert.ok(edit.includes('列设置') && edit.includes('打印预览') && edit.includes('粘贴明细'), '详情应含列设置/打印预览/粘贴明细')
  assert.ok(edit.includes('内部比价方案') && edit.includes('按本单生成三档'), '详情应含内部比价')
  assert.ok(edit.includes('plan.companyName') && edit.includes('defaultQuoteCompany'), '方案应能自定义公司抬头')
  assert.ok(edit.includes('openQuotePreview') && printUtil.includes('quotePlanSheetHtml'), '内部报价应能预览')
  assert.ok(edit.includes('currentQuotePlan.docTitle') && edit.includes('单据标题'), '内部比价应能改报价单标题')
  assert.ok(feUtil.includes('function quoteDocTitleOf'), '报价标题工具函数')
  assert.ok(twGw.includes('docTitle:'), '网关应持久化报价单标题')
  assert.ok(!printUtil.includes('内部方案档位'), '报价单不应出现内部档位')
  assert.ok(printUtil.includes('qsheet--classic') && printUtil.includes('qsheet--formal') && printUtil.includes('qsheet--modern'), '三种本公司报价版式')
  assert.ok(!printUtil.includes('出具单位') && !printUtil.includes('function quoteFoot'), '报价档不应再印客户栏和签字栏')
  assert.ok(printUtil.includes('内部方案对照表'), '应有内部对照表')
  assert.ok(printUtil.includes('quoteCompanyOf') && !printUtil.includes('vendorName'), '报价抬头应走自定义公司名')
  assert.ok(feUtil.includes('function emptyQuotePlans') && feUtil.includes('function suggestQuotePlans'), '缺内部方案工具函数')
  assert.ok(feUtil.includes('function stripQuoteSeeFigure'), '报价应去掉参看图说明')
  assert.ok(twGw.includes('quotePlans: normalizeQuotePlans'), '网关应持久化内部方案')
  assert.ok(edit.includes('TwSampleCell') && edit.includes('Ctrl+S'), '样图应支持粘贴且支持快捷保存')
  assert.ok(sampleCell.includes('@click="focusPaste"') && !/@click="pick"/.test(sampleCell), '空样图框点击不应弹出上传')
  assert.ok(sampleCell.includes('@click.stop="pick"') && sampleCell.includes('点此粘贴 / 拖入'), '选文件应走上传按钮')
  assert.ok(!sampleCell.includes('window.open') && sampleCell.includes('tw-sample-lightbox'), '样图应弹窗预览而不是新窗口')
  assert.ok(sampleCell.includes('@click="closePreview"'), '样图预览应点击任意位置关闭')
  assert.ok(/\.tw-sample-cell__preview img[\s\S]{0,180}object-fit:\s*contain/.test(tuwenCss), '样图应按原图比例完整显示')
  const datePicker = read('admin-web/src/views/tuwen/TwDatePicker.vue')
  assert.ok(datePicker.includes('el-date-picker') && datePicker.includes('YYYY-MM-DD'), '日期应使用日历选择')
  const stmtPage = read('admin-web/src/views/tuwen/TuwenStatementsPage.vue')
  assert.ok(stmtPage.includes('filteredOrders') && stmtPage.includes('filterStatementOrders'), '对账单应按订单即时筛选')
  const stmtSearch = (stmtPage.match(/<el-autocomplete[\s\S]*?\/>/) || [''])[0]
  assert.ok(stmtSearch.includes('v-model="keyword"') && !stmtSearch.includes('@change="load"') && !stmtSearch.includes('@keyup.enter'), '对账单搜索不应等确定再请求')
  assert.ok(!stmtPage.includes('v-for="(line, i) in data.lines'), '对账单主表不应再散成明细行')
  assert.ok(stmtPage.includes('statementSheetHtml') && stmtPage.includes('printStatementSheet'), '对账单应按当前结果预览打印')
  assert.ok(stmtPage.includes('exportStatementJpg') && stmtPage.includes('exportStatementExcel'), '对账单预览应能导出图片和表格')
  assert.ok(stmtPage.includes('导出图片') && stmtPage.includes('导出表格'), '对账单预览应露出导出按钮')
  assert.ok(stmtPage.includes('orderIds') && stmtPage.includes('uniqueStatementParty'), '对账单收款应只冲当前结果且区分同名客户')
  assert.ok(!page.includes('@keyup.enter="onSearch"') && page.includes('watch(keyword') && page.includes('searchLater'), '订单搜索应即时生效')
  const custPage = read('admin-web/src/views/tuwen/TuwenCustomersPage.vue')
  const supPage = read('admin-web/src/views/tuwen/TuwenSuppliersPage.vue')
  const afterSrc = read('admin-web/src/views/tuwen/TuwenAfterSalesPage.vue')
  const expSrc = read('admin-web/src/views/tuwen/TuwenExpensesPage.vue')
  const auditSrc = read('admin-web/src/views/tuwen/TuwenAuditPage.vue')
  assert.ok(!custPage.includes('@keyup.enter') && custPage.includes('matchesKeyword'), '客户搜索应即时生效')
  assert.ok(supPage.includes('matchesKeyword') && !supPage.includes('@keyup.enter'), '供应商搜索应即时生效')
  assert.ok(afterSrc.includes('matchesKeyword') && !afterSrc.includes('@keyup.enter'), '售后搜索应即时生效')
  assert.ok(expSrc.includes('matchesKeyword') && !expSrc.includes('@keyup.enter="load"'), '支出搜索应即时生效')
  assert.ok(auditSrc.includes('watch(keyword') && !auditSrc.includes('@keyup.enter'), '记录搜索应即时生效')
  assert.ok(auditSrc.includes('matchesAuditLog'), '记录页应对搜索结果做中文操作名兜底')
  assert.ok(feUtil.includes('function matchesKeyword') && feUtil.includes('function debounce') && feUtil.includes('function uniqueStatementParty'), '应有即时搜索与对账帮助函数')
  assert.ok(feUtil.includes('function matchesAuditLog') && feUtil.includes('function hydrateStatementOrders'), '应有记录搜索与旧对账回填')
  assert.ok(stmtPage.includes('ordersFromStatementPayload'), '对账单应兼容旧接口只有明细的情况')
  assert.ok(twGw.includes('orderIds') && twGw.includes('customerId'), '收款应能按当前订单和客户ID摊分')
  assert.ok(printUtil.includes('function statementSheetHtml') && printUtil.includes('print-statement__sum') && printUtil.includes('样图'), '对账单打印应含样图与欠款合计')
  assert.ok(feUtil.includes('function filterStatementOrders') && feUtil.includes('function statementLinesForOrders'), '对账单筛选工具函数')
  assert.ok(twGw.includes('projectNames:') && twGw.includes('sampleImageUrl:'), '对账单接口应按订单汇总并带样图')
  ;['TuwenOrderEditPage', 'TuwenYewuPage', 'TuwenReportsPage', 'TuwenExpensesPage', 'TuwenStatementsPage', 'TuwenAfterSalesPage'].forEach((name) => {
    const src = read(`admin-web/src/views/tuwen/${name}.vue`)
    assert.ok(src.includes('TwDatePicker'), `${name} 应使用日期选择`)
    assert.ok(!/<el-input[^>]*type="date"/.test(src) && !/<input[^>]*type="date"/.test(src), `${name} 不应再用原生日期框`)
  })
  assert.ok(settingsPage.includes('printDocTitle') && edit.includes('单据名称'), '单据名称应可自定义')
  assert.ok(settingsPage.includes('tw-settings-grid'), '设置页应多列排版')
  assert.ok(printUtil.includes('orderDocTitle'), '打印中间标题应走自定义单据名称')
  assert.ok(settingsPage.includes('chunkImportBatches'), '设置页应分批导入')
  assert.ok(feUtil.includes('function dimensionToMm') && feUtil.includes('dimensionUnit: \'mm\''), '应支持自定义尺寸录入单位')
  assert.ok(twGw.includes('dimensionUnit:') && twGw.includes('function normalizeDimensionUnit'), '网关应持久化尺寸录入单位')
  assert.ok(twGw.includes('function normalizeColumnAlign') && twGw.includes('align:'), '网关应持久化列对齐')
  const colSettings = read('admin-web/src/views/tuwen/TwColumnSettings.vue')
  const lineTable = read('admin-web/src/views/tuwen/TwLineTable.vue')
  for (const [, name, ok] of collectSourceChecks({ edit, lineTable, twLayout, tuwenCss, client })) {
    assert.ok(ok, name)
  }
  for (const [, name, ok] of collectSpeedChecks({ edit, page, client, gw, mod: twGw })) {
    assert.ok(ok, name)
  }
  assert.ok(lineTable.includes('onCellActivate') && lineTable.includes('tw-cell-edit') && tuwenCss.includes('td.tw-cell-edit'), '明细应点整格即可编辑，不必点中文字')
  assert.ok(tuwenCss.includes('min-width: 0') && !/td\.tw-cell-edit[\s\S]{0,80}max-width:\s*0/.test(tuwenCss), '格子不要 max-width:0 缩成点不中')
  assert.ok(colSettings.includes('尺寸录入单位') && colSettings.includes('dimensionUnit'), '列设置应能改尺寸单位')
  assert.ok(lineTable.includes('onDim') && lineTable.includes('dimDisplay'), '开单宽高应按自定义单位录入')
  assert.ok(lineTable.includes('table-layout') === false && tuwenCss.includes('table-layout: fixed'), '明细表应固定布局自适应列宽')
  assert.ok(lineTable.includes('colWidthPercents') && lineTable.includes('columnAlignClass'), '明细表应按比例列宽并对齐')
  assert.ok(!lineTable.includes('minWidth +'), '明细表不应再写死最小宽度导致横向滚动')
  assert.ok(tuwenCss.includes('overflow-x: hidden') && tuwenCss.includes('.tw-line-text'), '明细表应禁止横向拖动并支持换行')
  assert.ok(colSettings.includes('COLUMN_ALIGNS') && colSettings.includes('对齐'), '列设置应能改每列对齐')
  assert.ok(printUtil.includes('print-center') && printUtil.includes('printAlignClass'), '打印应对齐跟随列设置')
  assert.ok(settingsPage.includes('DIMENSION_UNITS') && settingsPage.includes('尺寸录入单位'), '设置页应能改尺寸单位')
  assert.ok(printUtil.includes('mmToDimension') && printUtil.includes('visibleLineColumnsOf'), '打印宽高应按自定义单位')
  assert.ok(feUtil.includes("SAMPLE_COS_PREFIX = '图文智能业务/default/samples/'"), '样图 COS 前缀不对')
  assert.ok(feUtil.includes('function chunkImportBatches'), '缺分批导入')
  assert.ok(feUtil.includes('function workspaceBackupOf') && feUtil.includes('expenses'), '备份导出应显式带上支出')
  assert.ok(settingsPage.includes('workspaceBackupOf') && settingsPage.includes('workspaceBackupSummary'), '设置页导出应列出订单和支出条数')
  assert.ok(!page.includes('iframe'), '列表页不应再嵌 8787')
  assert.ok(!gw.includes("path === '/tuwen/health'"), '应去掉 8787 health 路由')

  const cache = await import('../admin-web/src/utils/tuwen-cache.js')
  cache.resetTuwenCache()
  cache.putList({ q: '环宇', page: 1, pageSize: 100 }, { list: [{ id: 'x' }], total: 1, version: 9, settings: { printCompanyTitle: '测' } })
  assert.strictEqual(cache.peekList({ q: '环宇', page: 1, pageSize: 100 }).version, 9)
  assert.strictEqual(cache.peekList({ q: '环宇', page: 1, pageSize: 100 }).data.list[0].id, 'x')
  cache.invalidateReads()
  assert.ok(!cache.peekList({ q: '环宇', page: 1, pageSize: 100 }), '写操作后列表缓存应失效')
  cache.resetTuwenCache()

  const fe = await import('../admin-web/src/utils/tuwen-yewu.js')
  for (const [, name, ok] of collectBehaviorChecks(fe)) {
    assert.ok(ok, name)
  }
  const extracted = fe.extractImportPayload({
    orders: [{
      id: 'a',
      lines: [{ id: 'l1', sampleImageDataUrl: 'data:image/png;base64,xxxx' }]
    }]
  })
  assert.ok(extracted.orders[0].lines[0].sampleImageDataUrl.startsWith('data:'))
  const found = fe.collectLineDataUrls(extracted.orders)
  assert.strictEqual(found.length, 1)

  const parsed = fe.parseImportPayload({
    orders_json: JSON.stringify([{
      id: 'a',
      customerName: '环宇',
      lines: [{ projectName: '打印', sampleImageDataUrl: 'data:image/png;base64,xxxx' }]
    }]),
    expenses: [{ id: 'e1', receiptImage: 'data:image/jpeg;base64,yyyy' }]
  })
  assert.strictEqual(parsed.orders.length, 1)
  assert.ok(!parsed.orders[0].lines[0].sampleImageDataUrl)
  assert.strictEqual(parsed.expenses[0].receiptImage, '')
  const chunks = fe.chunkImportBatches({
    orders: Array.from({ length: 12 }, (_, i) => ({ id: String(i) })),
    customers: [{ id: 'c1' }],
    expenses: []
  }, 5)
  assert.strictEqual(chunks.length, 3)
  assert.strictEqual(chunks[0].orders.length, 5)
  assert.strictEqual(chunks[0].customers.length, 1)
  assert.strictEqual(chunks[1].customers.length, 0)
  assert.strictEqual(chunks[2].orders.length, 2)
  const backup = fe.workspaceBackupOf({
    orders: [{ id: 'o1' }],
    customers: [{ id: 'c1' }],
    expenses: [{ id: 'e1', amount: 41, note: '切纸刀' }],
    suppliers: [],
    afterSales: [],
    auditLogs: [{ id: 'l1', action: 'order_create' }]
  })
  assert.equal(backup.kind, 'tuwen-workspace')
  assert.equal(backup.counts.expenses, 1)
  assert.equal(backup.expenses[0].note, '切纸刀')
  assert.ok(fe.workspaceBackupSummary(backup).includes('支出 1'))
  assert.ok(fe.hasImportPayload({ expenses: [{ id: 'e1' }] }))
  assert.strictEqual(fe.pricingModeFromUnit('延米'), 'by_length')
  assert.strictEqual(fe.pricingModeFromUnit('㎡'), 'by_area')
  assert.strictEqual(fe.emptyLine().unitLabel, '平方米')
  assert.strictEqual(fe.emptyQuotePlans().length, 3)
  assert.strictEqual(fe.normalizeQuotePlans([{ unitPrice: 1 }])[0].id, 'economy')
  assert.strictEqual(fe.quoteCompanyOf({ companyName: '文昌广告' }, { brandCompanyName: '正大广告' }), '文昌广告')
  assert.strictEqual(fe.quoteCompanyOf({}, { brandCompanyName: '正大广告' }), '正大广告')
  assert.strictEqual(fe.quoteCompanyOf({}, { brandCompanyName: '', printCompanyTitle: '左上角抬头' }), '')
  assert.strictEqual(fe.brandCompanyNameOf({ brandCompanyName: '  ' }), '')
  assert.strictEqual(fe.orderDocTitle({}, { printDocTitle: '施工单' }), '施工单')
  assert.strictEqual(fe.orderDocTitle({ printDocTitle: '报价确认单' }, { printDocTitle: '业务单' }), '报价确认单')
  assert.strictEqual(fe.orderDocTitle({}, {}), '业务单')
  const suggested = fe.suggestQuotePlans({
    discount: 0,
    taxRate: 0,
    lines: [{ projectName: 'KT板', qty: 1, unitPrice: 100, pricingMode: 'by_piece' }]
  })
  assert.strictEqual(suggested[1].total, 100)
  assert.strictEqual(suggested[0].total, 85)
  assert.strictEqual(suggested[2].total, 120)
  const recaled = fe.recaclQuotePlan({ items: [{ qty: 2, unitPrice: 10, pricingMode: 'by_piece' }] })
  assert.strictEqual(recaled.total, 20)
  const strippedQuote = fe.stripQuoteLine({ projectName: '喷绘', sampleImageDataUrl: 'https://x.com/a.jpg', qty: 1, unitPrice: 8 })
  assert.ok(!strippedQuote.sampleImageDataUrl)
  const printMod = await import('../admin-web/src/utils/tuwen-print.js')
  const stmtHtml = printMod.statementSheetHtml({
    customerName: '环宇大酒店',
    from: '2026-04-01',
    to: '2026-04-30',
    subtotal: 120,
    discount: 5,
    paid: 20,
    unpaid: 95,
    lines: [{
      orderDate: '2026-04-15',
      orderNo: 'TW-202604-7060',
      material: '无边发光字',
      projectName: 'XIYUE',
      spec: '1.2 * 2.4',
      qty: 1,
      unitLabel: '项',
      unitPrice: 120,
      amount: 120,
      remark: '对账',
      sampleImageUrl: 'https://cdn.example/sample.jpg'
    }]
  }, { brandCompanyName: '正大广告' })
  assert.ok(stmtHtml.includes('2026-04-01 ~ 2026-04-30'))
  assert.ok(stmtHtml.includes('环宇大酒店 对账单'))
  assert.ok(stmtHtml.includes('订单日期') && stmtHtml.includes('样图') && stmtHtml.includes('备注'))
  assert.ok(stmtHtml.includes('cdn.example/sample.jpg'))
  assert.ok(stmtHtml.includes('总金额') && stmtHtml.includes('欠款') && stmtHtml.includes('¥95.00'))
  assert.ok(stmtHtml.includes('公司名称 正大广告'))
  const stmtHtmlBare = printMod.statementSheetHtml({
    customerName: '环宇大酒店',
    subtotal: 0,
    discount: 0,
    paid: 0,
    unpaid: 0,
    lines: []
  }, { brandCompanyName: '' })
  assert.ok(!stmtHtmlBare.includes('正大广告'))
  assert.ok(!stmtHtmlBare.includes('公司名称'))
  assert.ok(!stmtHtmlBare.includes('本公司'))
  assert.equal(printMod.statementExportBasename({ customerName: '登卡社区' }), '登卡社区对账单')
  assert.equal(printMod.statementExportBasename({ customerName: '' }), '对账单')
  const stmtXls = printMod.statementExcelHtml({
    customerName: '登卡社区',
    from: '',
    to: '',
    subtotal: 924,
    discount: 0,
    paid: 0,
    unpaid: 924,
    lines: [{
      orderDate: '2026-09-05',
      orderNo: 'TW-202609-5864',
      material: '10mm PVC板',
      projectName: '海报',
      spec: '1120*1400',
      qty: 1,
      unitLabel: '个',
      unitPrice: 300,
      amount: 924,
      remark: '',
      sampleImageUrl: 'https://cdn.example/sample.jpg'
    }]
  }, { brandCompanyName: '' })
  assert.ok(stmtXls.includes('订单日期') && stmtXls.includes('样图') && stmtXls.includes('欠款'))
  assert.ok(stmtXls.includes('登卡社区对账单') && stmtXls.includes('全部期间'))
  assert.ok(stmtXls.includes('TW-202609-5864'))
  assert.ok(!stmtXls.includes('cdn.example/sample.jpg'), '表格样图不应再写成链接')
  assert.ok(!stmtXls.includes('正大广告') && !stmtXls.includes('公司名称') && !stmtXls.includes('本公司'))
  const stmtModel = printMod.statementExcelModel({
    customerName: '登卡社区',
    subtotal: 924,
    discount: 0,
    paid: 0,
    unpaid: 924,
    lines: [{
      orderDate: '2026-09-05',
      orderNo: 'TW-202609-5864',
      projectName: '海报',
      amount: 924,
      sampleImageUrl: 'https://cdn.example/sample.jpg'
    }]
  }, { brandCompanyName: '' })
  assert.equal(stmtModel.sampleUrls[0], 'https://cdn.example/sample.jpg')
  assert.equal(stmtModel.rows[0][10], '')
  const png1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  const { buildStatementXlsx } = await import('../admin-web/src/utils/tuwen-xlsx.js')
  const xlsx = buildStatementXlsx(stmtModel, [{ row: 0, bytes: png1, ext: 'png', width: 1, height: 1 }])
  const xlsxText = Buffer.from(xlsx).toString('latin1')
  assert.ok(xlsxText.includes('xl/media/image1.png') && xlsxText.includes('drawing1.xml'), 'xlsx 应嵌入样图而不是链接')
  assert.ok(!xlsxText.includes('cdn.example/sample.jpg'))
  assert.equal(
    sampleKeyFromPublicUrl(
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%9B%BE%E6%96%87%E6%99%BA%E8%83%BD%E4%B8%9A%E5%8A%A1/default/samples/a/b',
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'
    ),
    '图文智能业务/default/samples/a/b'
  )
  assert.equal(sampleKeyFromPublicUrl('https://evil.example/x.jpg', 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'), '')
  const proxyApi = createMockApi()
  const pngBuf = Buffer.from(png1)
  proxyApi._putRaw('图文智能业务/default/samples/a/b', pngBuf)
  const proxied = await proxyApi.proxySampleImage({ username: 'boss', role: 'super_admin' }, {
    url: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%9B%BE%E6%96%87%E6%99%BA%E8%83%BD%E4%B8%9A%E5%8A%A1/default/samples/a/b'
  })
  assert.equal(proxied.code, 0)
  assert.ok(String(proxied.data.dataUrl).startsWith('data:image/png;base64,'))
  const badProxy = await proxyApi.proxySampleImage({ username: 'boss', role: 'super_admin' }, { url: 'https://evil.example/x.jpg' })
  assert.equal(badProxy.code, 4000)
  const stmtXlsNamed = printMod.statementExcelHtml({
    customerName: '环宇大酒店',
    subtotal: 0,
    discount: 0,
    paid: 0,
    unpaid: 0,
    lines: []
  }, { brandCompanyName: '正大广告' })
  assert.ok(stmtXlsNamed.includes('公司名称 正大广告'))
  const quoteHtml = printMod.quotePlanSheetHtml({
    customerName: '色然村',
    orderNo: 'TW-202608-5075',
    orderDate: '2026-08-29',
    lines: [{ projectName: '喷绘', qty: 1, unitPrice: 80, sampleImageDataUrl: 'https://evil.example/shot.jpg' }],
    quotePlans: [
      {},
      {
        companyName: '正大广告',
        name: '标准方案',
        customerName: '色然村',
        items: [{ projectName: '喷绘', qty: 2, unitPrice: 40, pricingMode: 'by_piece' }]
      }
    ]
  }, { brandCompanyName: '正大广告' }, 1)
  assert.ok(!quoteHtml.includes('内部方案档位'), '报价预览不应出现内部档位')
  assert.ok(!quoteHtml.includes('标准方案'), '报价预览不应出现方案档位名')
  assert.ok(!quoteHtml.includes('shot.jpg') && !quoteHtml.includes('print-sample'), '报价预览不应出现样图')
  assert.ok(!quoteHtml.includes('客户名称') && !quoteHtml.includes('出具单位') && !quoteHtml.includes('客户确认') && !quoteHtml.includes('关联单号'), '报价档不应出现客户栏和签字栏')
  assert.ok(quoteHtml.includes('¥80.00'))
  assert.strictEqual(fe.stripQuoteSeeFigure('公厕标识 参看图二三'), '公厕标识')
  assert.strictEqual(fe.stripQuoteSeeFigure('喷绘（见图2、3）灯布'), '喷绘灯布')
  assert.strictEqual(fe.stripQuoteSeeFigure('宣传栏画面（参看图二）'), '宣传栏画面')
  assert.strictEqual(fe.stripQuoteSeeFigure('台账文化墙\n(参看图三)'), '台账文化墙')
  assert.strictEqual(fe.stripQuoteSeeFigure('公厕标识（附图二）'), '公厕标识')
  const quoteSeeHtml = printMod.quotePlanSheetHtml({
    customerName: '色然村',
    quotePlans: [{
      companyName: '正航',
      items: [{ projectName: '宣传栏画面（参看图二）', spec: '见图2', material: '灯布', qty: 1, unitPrice: 10, pricingMode: 'by_piece' }]
    }]
  }, { brandCompanyName: '正航' }, 0)
  assert.ok(!/参看图|见图2|附图/.test(quoteSeeHtml), '报价预览不应出现参看图说明')
  assert.ok(quoteSeeHtml.includes('宣传栏画面'))
  assert.ok(!quoteSeeHtml.includes('出具单位') && !/qsheet__foot/.test(quoteSeeHtml), '报价档不应出现出具单位')
  const titledHtml = printMod.quotePlanSheetHtml({
    quotePlans: [{
      docTitle: '工程报价',
      companyName: '本公司',
      items: [{ projectName: '喷绘', qty: 1, unitPrice: 8, pricingMode: 'by_piece' }]
    }]
  }, {}, 0)
  assert.ok(titledHtml.includes('工程报价'), '报价单标题应可自定义')
  assert.ok(!/qsheet-classic__doc">报价单</.test(titledHtml), '自定义标题后不应再写默认报价单')
  const compareSeeHtml = printMod.quoteCompareSheetHtml({
    lines: [{ projectName: '宣传栏画面（参看图二）', qty: 1, unitPrice: 1, pricingMode: 'by_piece' }]
  }, { brandCompanyName: '正航' })
  assert.ok(!compareSeeHtml.includes('参看图'), '对照表也不应出现参看图说明')
  assert.ok(compareSeeHtml.includes('宣传栏画面'))
  assert.ok(!compareSeeHtml.includes('客户名称') && !compareSeeHtml.includes('出具单位'), '对照表也不应出现客户栏和签字栏')
  assert.strictEqual(fe.moneyInWords(123.45), '壹佰贰拾叁元肆角伍分')
  const reversed = fe.reverseFromAmount({ qty: 2, unitPrice: 10, pricingMode: 'by_piece' }, 40)
  assert.strictEqual(reversed.unitPrice, 20)
  assert.strictEqual(fe.normalizeDimensionUnit('厘米'), 'cm')
  assert.strictEqual(fe.dimensionToMm(2400, 'mm'), 2400)
  assert.strictEqual(fe.dimensionToMm(240, 'cm'), 2400)
  assert.strictEqual(fe.dimensionToMm(2.4, 'm'), 2400)
  assert.strictEqual(fe.mmToDimension(2400, 'cm'), 240)
  assert.strictEqual(fe.mmToDimension(2400, { dimensionUnit: 'm' }), 2.4)
  const mmArea = fe.lineAreaM2({ widthMm: 2400, heightMm: 1720 })
  const cmArea = fe.lineAreaM2({
    widthMm: fe.dimensionToMm(240, 'cm'),
    heightMm: fe.dimensionToMm(172, 'cm')
  })
  const mArea = fe.lineAreaM2({
    widthMm: fe.dimensionToMm(2.4, 'm'),
    heightMm: fe.dimensionToMm(1.72, 'm')
  })
  assert.strictEqual(mmArea, cmArea)
  assert.strictEqual(mmArea, mArea)
  assert.strictEqual(fe.lineAmount({
    qty: 1,
    widthMm: fe.dimensionToMm(240, 'cm'),
    heightMm: fe.dimensionToMm(172, 'cm'),
    unitPrice: 10,
    pricingMode: 'by_area'
  }), fe.lineAmount({
    qty: 1,
    widthMm: 2400,
    heightMm: 1720,
    unitPrice: 10,
    pricingMode: 'by_area'
  }))
  const labeled = fe.applyDimensionColumnLabels(fe.defaultLineColumns(), 'cm')
  assert.strictEqual(labeled.find((c) => c.key === 'widthMm').label, '宽(cm)')
  assert.strictEqual(labeled.find((c) => c.key === 'heightMm').label, '高(cm)')
  assert.strictEqual(fe.applyDimensionColumnLabels([{ key: 'widthMm', label: '宽度', visible: true }], 'cm')[0].label, '宽度')
  assert.strictEqual(fe.visibleLineColumnsOf({ dimensionUnit: 'm' }).find((c) => c.key === 'widthMm').label, '宽(m)')
  assert.strictEqual(fe.withDimensionUnit({}, 'cm').dimensionUnit, 'cm')
  assert.strictEqual(fe.normalizeColumnAlign(''), 'center')
  assert.strictEqual(fe.normalizeColumnAlign('left'), 'left')
  assert.strictEqual(fe.normalizeColumnAlign('RIGHT'), 'right')
  assert.strictEqual(fe.normalizeLineColumns()[0].align, 'center')
  assert.strictEqual(fe.normalizeLineColumns([{ key: 'projectName', align: 'left' }]).find((c) => c.key === 'projectName').align, 'left')
  assert.strictEqual(fe.normalizeLineColumns([{ key: 'qty', align: 'bogus' }]).find((c) => c.key === 'qty').align, 'center')
  assert.strictEqual(fe.columnAlignClass('left'), 'is-left')
  const stmtRows = [
    { id: 'a', customerName: '环宇大酒店', orderNo: 'TW-1', phone: '138', balance: 10, subtotal: 12, discount: 1, paid: 1 },
    { id: 'b', customerName: '别的店', orderNo: 'TW-2', phone: '139', balance: 0, subtotal: 8, discount: 0, paid: 8 }
  ]
  assert.strictEqual(fe.filterStatementOrders(stmtRows, { q: '环宇' }).length, 1)
  assert.strictEqual(fe.filterStatementOrders(stmtRows, { unpaidOnly: true }).length, 1)
  assert.strictEqual(fe.filterStatementOrders(stmtRows, { q: 'TW-2' })[0].id, 'b')
  assert.strictEqual(fe.filterStatementOrders([
    { id: 'old', orderDate: '2026-04-15', orderNo: 'TW-1', balance: 1 },
    { id: 'new', orderDate: '2026-09-04', orderNo: 'TW-2', balance: 1 }
  ])[0].id, 'new')
  assert.ok(fe.matchesKeyword({ name: '环宇酒店' }, '环宇', ['name']))
  assert.ok(!fe.matchesKeyword({ name: '环宇酒店' }, '别的', ['name']))
  assert.strictEqual(fe.filterStatementOrders([{ id: 'p', projectNames: '灯带', balance: 1 }], { q: '灯带' }).length, 1)
  assert.deepStrictEqual(fe.uniqueStatementParty([{ customerId: 'c1', customerName: '甲' }]), { customerId: 'c1', customerName: '甲' })
  assert.strictEqual(fe.uniqueStatementParty([
    { customerId: 'c1', customerName: '同名店' },
    { customerId: 'c2', customerName: '同名店' }
  ]), null)
  assert.deepStrictEqual(fe.uniqueStatementParty([{ customerName: '甲' }, { customerName: '甲' }]), { customerId: '', customerName: '甲' })
  assert.deepStrictEqual(fe.uniqueStatementParty([
    { customerId: 'c1', customerName: '喜悦' },
    { customerName: '喜悦' }
  ]), { customerId: 'c1', customerName: '喜悦' })
  assert.strictEqual(fe.uniqueStatementParty([
    { customerId: 'c1', customerName: '甲' },
    { customerName: '乙' }
  ]), null)
  assert.deepStrictEqual(fe.statementTotals(stmtRows), { subtotal: 20, discount: 1, paid: 9, unpaid: 10 })
  assert.strictEqual(fe.statementPrintCustomer(fe.filterStatementOrders(stmtRows, { q: '环宇' }), '环宇'), '环宇大酒店')
  assert.strictEqual(fe.statementLinesForOrders([{ orderId: 'a' }, { orderId: 'c' }], [{ id: 'a' }]).length, 1)
  assert.strictEqual(fe.statementOrderSubtotal({ subtotal: 0, receivable: 12, paid: 1, balance: 2, discount: 0 }), 12)
  assert.ok(fe.matchesAuditLog({ action: 'order_update', customerName: '登卡社区' }, '更新订单'))
  assert.ok(!fe.matchesAuditLog({ action: 'order_update', customerName: '登卡社区' }, '喜悦'))
  const hydrated = fe.hydrateStatementOrders(
    [{ id: 'x', orderNo: 'TW-1', receivable: 30, paid: 5, balance: 25 }],
    [{ orderId: 'x', projectName: '灯带', amount: 10 }, { orderId: 'x', projectName: '横幅', amount: 20 }]
  )
  assert.strictEqual(hydrated[0].projectNames, '灯带、横幅')
  assert.strictEqual(hydrated[0].subtotal, 30)
  const oldCloud = fe.ordersFromStatementPayload({
    orders: [{ id: 'x', orderNo: 'TW-1', customerName: '喜悦', receivable: 50, paid: 50, balance: 0 }],
    lines: [{ orderId: 'x', projectName: '发光字', amount: 50 }]
  })
  assert.strictEqual(oldCloud[0].projectNames, '发光字')
  assert.strictEqual(oldCloud[0].subtotal, 50)
  const grouped = fe.ordersFromStatementPayload({
    lines: [
      { orderId: 'x', orderNo: 'TW-1', customerName: '环宇', projectName: '灯带', amount: 10 },
      { orderId: 'x', orderNo: 'TW-1', customerName: '环宇', projectName: '横幅', amount: 20 }
    ]
  })
  assert.strictEqual(grouped.length, 1)
  assert.strictEqual(grouped[0].lineCount, 2)
  assert.strictEqual(grouped[0].subtotal, 30)
  assert.strictEqual(grouped[0].projectNames, '灯带、横幅')
  assert.strictEqual(fe.applyDimensionColumnLabels([{ key: 'widthMm', label: '宽(mm)', align: 'right', visible: true }], 'cm')[0].align, 'right')
  const percents = fe.colWidthPercents(fe.defaultLineColumns().slice(0, 3), [28])
  assert.strictEqual(percents.length, 4)
  assert.strictEqual(percents.reduce((sum, x) => sum + Number(String(x).replace('%', '')), 0), 100)
  assert.strictEqual(fe.normalizeQty(0.5), 0.5)
  assert.strictEqual(fe.lineAmount({ qty: 0.5, unitPrice: 10, pricingMode: 'by_piece' }), 5)
  const scaledQuote = fe.applyQuoteUnitPrice({
    items: [
      { qty: 2, unitPrice: 10, pricingMode: 'by_piece' },
      { qty: 1, unitPrice: 20, pricingMode: 'by_piece' }
    ]
  }, 20)
  assert.strictEqual(scaledQuote.total, 80)
  assert.strictEqual(scaledQuote.unitPrice, 20)

  const loopApi = createMockApi()
  const cancelled = await loopApi.upsertOrder(user, {
    order: {
      customerName: '作废客户',
      lines: [{ projectName: '喷绘', qty: 1, unitPrice: 200, unitLabel: '张' }]
    }
  })
  assert.strictEqual(cancelled.code, 0)
  const cancelRes = await loopApi.setOrderStatus(user, cancelled.data.order.id, { status: 'cancelled' })
  assert.strictEqual(cancelRes.code, 0)
  const cancelPay = await loopApi.payOrder(user, cancelled.data.order.id, { amount: 10 })
  assert.strictEqual(cancelPay.code, 4001)
  const cancelDash = await loopApi.dashboard(user)
  assert.strictEqual(cancelDash.data.receivable, 0)
  assert.strictEqual(cancelDash.data.paid, 0)
  assert.strictEqual(cancelDash.data.unpaid, 0)
  assert.strictEqual(cancelDash.data.statusCounts.cancelled, 1)
  const cancelStmt = await loopApi.getStatements(user, { customer: '作废客户' })
  assert.strictEqual(cancelStmt.data.unpaid, 0)
  assert.strictEqual((cancelStmt.data.lines || []).length, 0)
  const cancelledProjectStmt = await loopApi.getStatements(user, { q: '喷绘' })
  assert.strictEqual(cancelledProjectStmt.data.orders.length, 0)
  const missStmt = await loopApi.getStatements(user, { q: '绝对不存在的词xyz' })
  assert.strictEqual(missStmt.data.orders.length, 0)
  const cancelReport = await loopApi.getReports(user, {})
  assert.strictEqual(cancelReport.data.income, 0)

  const twinA = await loopApi.upsertOrder(user, {
    order: {
      customerName: '同名店',
      isNewCustomer: true,
      lines: [{ projectName: 'A', qty: 1, unitPrice: 10, unitLabel: '张' }]
    }
  })
  const twinB = await loopApi.upsertOrder(user, {
    order: {
      customerName: '同名店',
      isNewCustomer: true,
      lines: [{ projectName: 'B', qty: 1, unitPrice: 10, unitLabel: '张' }]
    }
  })
  assert.notStrictEqual(twinA.data.order.customerId, twinB.data.order.customerId)
  const twins = (await loopApi.listCustomers(user, {})).data.list.filter((c) => c.name === '同名店')
  assert.strictEqual(twins.length, 2)
  const twinPay = await loopApi.collectStatement(user, {
    customer: '同名店',
    customerId: twinA.data.order.customerId,
    amount: 10,
    paymentMethod: '微信'
  })
  assert.strictEqual(twinPay.data.applied, 10)
  const twinAAfter = await loopApi.getOrder(user, twinA.data.order.id)
  const twinBAfter = await loopApi.getOrder(user, twinB.data.order.id)
  assert.strictEqual(twinAAfter.data.order.balance, 0)
  assert.strictEqual(twinBAfter.data.order.balance, 10)

  const due = await loopApi.upsertOrder(user, {
    order: {
      customerName: '对账客户',
      lines: [{ projectName: '灯箱', qty: 1, unitPrice: 80, unitLabel: '个' }]
    }
  })
  const stmtByProject = await loopApi.getStatements(user, { q: '灯箱' })
  assert.ok(stmtByProject.data.orders.some((o) => o.id === due.data.order.id && String(o.projectNames).includes('灯箱')))
  assert.ok(stmtByProject.data.orders.every((o) => String(o.projectNames || '').includes('灯箱')))
  const stmtByDueName = await loopApi.getStatements(user, { q: '对账客户' })
  assert.ok(stmtByDueName.data.orders.length >= 1)
  assert.ok(stmtByDueName.data.orders.every((o) => o.customerName === '对账客户'))
  const oldDatedStmt = await loopApi.upsertOrder(user, {
    order: { customerName: '日期序', orderDate: '2026-04-15', lines: [{ projectName: '旧', qty: 1, unitPrice: 1 }] }
  })
  const newDatedStmt = await loopApi.upsertOrder(user, {
    order: { customerName: '日期序', orderDate: '2026-09-04', lines: [{ projectName: '新', qty: 1, unitPrice: 1 }] }
  })
  const datedStmt = await loopApi.getStatements(user, { q: '日期序' })
  assert.strictEqual(datedStmt.data.orders[0].id, newDatedStmt.data.order.id)
  assert.strictEqual(datedStmt.data.orders[1].id, oldDatedStmt.data.order.id)
  const collectedFull = await loopApi.collectStatement(user, { customer: '对账客户', amount: 80, paymentMethod: '微信' })
  assert.strictEqual(collectedFull.code, 0)
  assert.strictEqual(collectedFull.data.applied, 80)
  const collectedOrder = await loopApi.getOrder(user, due.data.order.id)
  assert.ok(collectedOrder.data.order.paymentModalConfirmedAt)
  assert.strictEqual(collectedOrder.data.order.balance, 0)
  const listedLocked = await loopApi.listOrders(user, { status: '__paid__' })
  assert.ok(listedLocked.data.list.some((o) => o.id === due.data.order.id && o.paidLocked))
  const lockedEdit = await loopApi.upsertOrder(user, {
    order: { ...collectedOrder.data.order, customerName: '改名应失败' }
  })
  assert.strictEqual(lockedEdit.code, 4001)
  const lockedStatus = await loopApi.setOrderStatus(user, due.data.order.id, { status: 'done' })
  assert.strictEqual(lockedStatus.code, 4001)

  const splitA = await loopApi.upsertOrder(user, {
    order: { customerName: '分摊客户', lines: [{ projectName: 'A', qty: 1, unitPrice: 40, unitLabel: '个' }] }
  })
  const splitB = await loopApi.upsertOrder(user, {
    order: { customerName: '分摊客户', lines: [{ projectName: 'B', qty: 1, unitPrice: 40, unitLabel: '个' }] }
  })
  const splitPay = await loopApi.collectStatement(user, {
    customer: '分摊客户',
    orderIds: [splitA.data.order.id],
    amount: 40,
    paymentMethod: '微信'
  })
  assert.strictEqual(splitPay.data.applied, 40)
  assert.strictEqual((await loopApi.getOrder(user, splitA.data.order.id)).data.order.balance, 0)
  assert.strictEqual((await loopApi.getOrder(user, splitB.data.order.id)).data.order.balance, 40)

  const earlyDue = await loopApi.upsertOrder(user, {
    order: { customerName: '冲账序', orderDate: '2026-01-01', lines: [{ projectName: '旧欠', qty: 1, unitPrice: 40, unitLabel: '个' }] }
  })
  const lateDue = await loopApi.upsertOrder(user, {
    order: { customerName: '冲账序', orderDate: '2026-09-01', lines: [{ projectName: '新欠', qty: 1, unitPrice: 40, unitLabel: '个' }] }
  })
  const agePay = await loopApi.collectStatement(user, {
    customer: '冲账序',
    customerId: lateDue.data.order.customerId,
    orderIds: [lateDue.data.order.id, earlyDue.data.order.id],
    amount: 40,
    paymentMethod: '微信'
  })
  assert.strictEqual(agePay.data.applied, 40)
  assert.strictEqual((await loopApi.getOrder(user, earlyDue.data.order.id)).data.order.balance, 0)
  assert.strictEqual((await loopApi.getOrder(user, lateDue.data.order.id)).data.order.balance, 40)

  const named = await loopApi.upsertOrder(user, {
    order: { customerName: '缺ID同名', isNewCustomer: true, lines: [{ projectName: 'A', qty: 1, unitPrice: 20, unitLabel: '个' }] }
  })
  const orphan = await loopApi.upsertOrder(user, {
    order: { customerName: '缺ID同名', isNewCustomer: true, lines: [{ projectName: 'B', qty: 1, unitPrice: 20, unitLabel: '个' }] }
  })
  const planted = await loopApi.importWorkspace(user, {
    orders: [{ ...orphan.data.order, customerId: '' }]
  })
  assert.strictEqual(planted.code, 0)
  const mixPay = await loopApi.collectStatement(user, {
    customer: '缺ID同名',
    customerId: named.data.order.customerId,
    orderIds: [named.data.order.id, orphan.data.order.id],
    amount: 40,
    paymentMethod: '微信'
  })
  assert.strictEqual(mixPay.data.applied, 40)
  assert.strictEqual((await loopApi.getOrder(user, named.data.order.id)).data.order.balance, 0)
  assert.strictEqual((await loopApi.getOrder(user, orphan.data.order.id)).data.order.balance, 0)

  const prepaid = await loopApi.upsertOrder(user, {
    order: {
      customerName: '预付结清',
      prepay: 50,
      lines: [{ projectName: '写真', qty: 1, unitPrice: 50, unitLabel: '张' }]
    }
  })
  assert.strictEqual(prepaid.data.order.balance, 0)
  assert.ok(!prepaid.data.order.paymentModalConfirmedAt)
  const confirmZero = await loopApi.payOrder(user, prepaid.data.order.id, { amount: 0, paymentMethod: '微信' })
  assert.strictEqual(confirmZero.code, 0)
  assert.ok(confirmZero.data.order.paymentModalConfirmedAt)
  assert.ok(fe.isPaidDisplay(confirmZero.data.order))

  console.log('tuwen-yewu tests passed')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
