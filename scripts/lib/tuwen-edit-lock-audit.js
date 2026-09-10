/**
 * 图文开单：锁单快照 / 格子连改 / 离开保存 回归审计。
 * 给 test/tuwen-yewu.test.js 与 scripts/_tmp_audit_tuwen_yewu.js 共用，避免两边各写一套漏检。
 */
const ORDER_EDIT_RE = /^\/tuwen\/orders\/(new|[^/]+)$/

function extractFunction(src, name) {
  const text = String(src || '')
  const patterns = [
    new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`),
    new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\()`),
    new RegExp(`${name}\\(\\s*(?:async\\s*)?\\(`)
  ]
  let start = -1
  for (const re of patterns) {
    start = text.search(re)
    if (start >= 0) break
  }
  if (start < 0) return ''
  const paren = text.indexOf('(', start)
  let from = start
  if (paren >= 0) {
    let p = 0
    for (let i = paren; i < text.length; i += 1) {
      if (text[i] === '(') p += 1
      else if (text[i] === ')') {
        p -= 1
        if (p === 0) {
          from = i
          break
        }
      }
    }
  }
  let brace = text.indexOf('{', from)
  if (brace < 0) brace = text.indexOf('{', start)
  if (brace < 0) return ''
  let depth = 0
  for (let i = brace; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return ''
}

function countToken(src, token) {
  const hit = String(src || '').match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
  return hit ? hit.length : 0
}

function viewKeyOf(path) {
  const p = String(path || '')
  if (ORDER_EDIT_RE.test(p)) return 'tuwen-order-edit'
  return p || 'tuwen'
}

function isOrderEditPath(path) {
  return ORDER_EDIT_RE.test(String(path || ''))
}

function collectSourceChecks({ edit, lineTable, twLayout, tuwenCss, client }) {
  const rememberLockFn = extractFunction(edit, 'rememberLock')
  const lockedComputed = (edit.match(/const locked = computed\(\(\) =>[\s\S]*?\)\s*\n/) || [''])[0]
  const saveOrderFn = extractFunction(edit, 'saveOrder')
  const saveIfNeededFn = extractFunction(edit, 'saveIfNeeded')
  const persistOnLeaveFn = extractFunction(edit, 'persistOnLeave')
  const persistOnUnloadFn = extractFunction(edit, 'persistOnUnload')
  const flushFn = extractFunction(edit, 'flushPendingInputs')
  const loadFn = extractFunction(edit, 'load')
  const applyBootstrapFn = extractFunction(edit, 'applyBootstrap')
  const confirmPayFn = extractFunction(edit, 'confirmPay')
  const onSaveFn = extractFunction(edit, 'onSave')
  const onUnmountFn = extractFunction(edit, 'onBeforeUnmount')
  const viewKeyFn = extractFunction(twLayout, 'viewKey')
  const onCellFn = extractFunction(lineTable, 'onCellActivate')
  const patchFn = extractFunction(lineTable, 'patch')
  const autosizeFn = extractFunction(lineTable, 'autosize')
  const resizeAllFn = extractFunction(lineTable, 'resizeAll')

  return [
    ['lock', '打开时记下锁态', edit.includes('lockAtLoad') && rememberLockFn.includes('lockAtLoad.value = isPaidDisplay')],
    ['lock', 'locked 只用快照', /const locked = computed\(\(\) => lockAtLoad\.value\)/.test(edit) && !/const locked = computed\(\(\) => isPaidDisplay\(form/.test(edit)],
    ['lock', 'locked 不算实时未结', !lockedComputed.includes('isPaidDisplay') && !lockedComputed.includes('orderBalance')],
    ['lock', 'rememberLock 只写一次快照', countToken(edit, 'lockAtLoad.value =') === 1],
    ['lock', 'rememberLock 只在打开/收款后', countToken(edit, 'rememberLock(') === 3],
    ['lock', 'load 打开后记锁', applyBootstrapFn.includes('rememberLock(form)') || loadFn.includes('rememberLock(form)')],
    ['lock', '收款后才更新锁', confirmPayFn.includes('rememberLock(data && data.order)')],
    ['lock', '保存不重算锁', !!saveOrderFn && !saveOrderFn.includes('rememberLock') && !!onSaveFn && !onSaveFn.includes('rememberLock') && !!saveIfNeededFn && !saveIfNeededFn.includes('rememberLock')],
    ['lock', '新增行/保存跟 locked', edit.includes(':disabled="locked" @click="addLine">新增行') && edit.includes(':disabled="saving || locked"')],
    ['lock', '收款跟 payDisabled', edit.includes(':disabled="payDisabled"') && /const payDisabled = computed\(\(\) => isNew\.value \|\| locked\.value\)/.test(edit)],
    ['lock', '明细表跟 locked', /<TwLineTable[\s\S]*?:disabled="locked"/.test(edit)],
    ['lock', '控件不直接绑 isPaidDisplay', !edit.includes(':disabled="isPaidDisplay') && !lineTable.includes('isPaidDisplay')],
    ['lock', '复制开单清收款', applyBootstrapFn.includes('data.copied') && applyBootstrapFn.includes("paymentModalConfirmedAt: ''") && applyBootstrapFn.includes('prepay: 0') && applyBootstrapFn.includes('currentPayment: 0')],
    ['leave', '离开默认不回写', saveIfNeededFn.includes('applyResult = false') && persistOnLeaveFn.includes('applyResult: false')],
    ['leave', '离开保存不 blur', flushFn.includes("dispatchEvent(new Event('change'") && !flushFn.includes('.blur(')],
    ['leave', '关页走 keepalive', !!persistOnUnloadFn && persistOnUnloadFn.includes('saveTuwenOrderKeepalive') && client.includes('keepalive: true')],
    ['leave', '关页不因在途放弃', !!persistOnUnloadFn && !persistOnUnloadFn.includes('persistInFlight')],
    ['leave', '卸载不二次保存', !!onUnmountFn && !onUnmountFn.includes('persistOnUnload') && !onUnmountFn.includes('persistOnLeave')],
    ['leave', '关闭走 onClose', edit.includes('@click="onClose"') && !edit.includes('@click="goBack"')],
    ['leave', '离开不误 load', edit.includes('isOrderEditPath') && edit.includes('if (!isOrderEditPath(route.path)) return') && !edit.includes('route.fullPath')],
    ['leave', '无全局 beforeEach', !edit.includes('router.beforeEach')],
    ['focus', '数字失焦才写入', lineTable.includes('@change="onDim') && lineTable.includes('@change="onNum') && !lineTable.includes('@input="onDim') && !lineTable.includes('@input="onNum')],
    ['focus', '文字格 v-model', lineTable.includes('v-model="line.projectName"') && lineTable.includes('v-model="line.material"')],
    ['focus', '改格不换行对象', patchFn.includes('Object.assign(cur, extra)') && !patchFn.includes('{ ...line, ...extra }') && !lineTable.includes('{ ...line, ...extra }')],
    ['focus', '整格可点且不抢焦点', !!onCellFn && onCellFn.includes('e.target !== e.currentTarget') && !onCellFn.includes('preventDefault') && !onCellFn.includes('field.select()')],
    ['focus', '不用 vuedraggable 包表体', !lineTable.includes('vuedraggable') && !lineTable.includes("from 'vuedraggable'") && lineTable.includes('<tbody>') && lineTable.includes(':key="line.id"')],
    ['focus', '排序不跟编辑态互斥', lineTable.includes('onRowDragStart') && !lineTable.includes('cellEditing')],
    ['focus', 'autosize 只动 textarea', autosizeFn.includes("tagName !== 'TEXTAREA'")],
    ['focus', '行列变化才通栏重算高', /watch\(\(\) => props\.lines\.map\(\(l\) => l\.id\)/.test(lineTable) && !!resizeAllFn],
    ['focus', '详情不重挂', viewKeyFn.includes('tuwen-order-edit') && twLayout.includes(':key="viewKey(r)"') && !twLayout.includes('mode="out-in"')],
    ['focus', '开单路径与 viewKey 同规则', viewKeyFn.includes('/^\\/tuwen\\/orders\\/(new|[^/]+)$/') && extractFunction(edit, 'isOrderEditPath').includes('/^\\/tuwen\\/orders\\/(new|[^/]+)$/')],
    ['focus', '格子不撑破', !tuwenCss.includes('field-sizing: content') && !tuwenCss.includes('field-sizing:content') && !/td\.tw-cell-edit[\s\S]{0,80}max-width:\s*0/.test(tuwenCss)]
  ]
}

function collectBehaviorChecks(fe) {
  const almostPaid = {
    paymentModalConfirmedAt: '2026-06-07T00:00:00.000Z',
    prepay: 100,
    currentPayment: 0,
    discount: 0,
    taxRate: 0,
    lines: [{ unitPrice: 200, qty: 1, pricingMode: 'by_piece' }]
  }
  const afterCutPrice = {
    ...almostPaid,
    lines: [{ unitPrice: 100, qty: 1, pricingMode: 'by_piece' }]
  }
  const lockAtLoad = fe.isPaidDisplay(almostPaid)
  const liveAfterEdit = fe.isPaidDisplay(afterCutPrice)

  const noStampSettled = {
    prepay: 50,
    currentPayment: 0,
    discount: 0,
    taxRate: 0,
    lines: [{ unitPrice: 50, qty: 1, pricingMode: 'by_piece' }]
  }
  const zeroConfirm = {
    paymentModalConfirmedAt: '2026-06-07T00:00:00.000Z',
    prepay: 0,
    currentPayment: 0,
    discount: 0,
    taxRate: 0,
    lines: []
  }
  const areaUnpaid = {
    paymentModalConfirmedAt: '2026-06-07T00:00:00.000Z',
    prepay: 20,
    currentPayment: 0,
    discount: 0,
    taxRate: 0,
    lines: [{ pricingMode: 'by_area', qty: 1, widthMm: 1000, heightMm: 2000, unitPrice: 20 }]
  }
  const areaAfterShrink = {
    ...areaUnpaid,
    lines: [{ pricingMode: 'by_area', qty: 1, widthMm: 1000, heightMm: 1000, unitPrice: 20 }]
  }
  const fullyPaid = {
    paymentModalConfirmedAt: '2026-06-07T00:00:00.000Z',
    prepay: 80,
    currentPayment: 0,
    discount: 0,
    taxRate: 0,
    lines: [{ unitPrice: 80, qty: 1, pricingMode: 'by_piece' }]
  }

  return [
    ['lock', '未结清有收款记录不锁', lockAtLoad === false],
    ['lock', '改价归零会被判已收款', liveAfterEdit === true],
    ['lock', '快照不随改价翻转', lockAtLoad === false && liveAfterEdit === true],
    ['lock', '无收款确认即使结清也不锁', fe.isPaidDisplay(noStampSettled) === false],
    ['lock', '零金额确认会锁', fe.isPaidDisplay(zeroConfirm) === true],
    ['lock', '按面积缩小后会被判已收款', fe.isPaidDisplay(areaUnpaid) === false && fe.isPaidDisplay(areaAfterShrink) === true],
    ['lock', '打开已结清应锁', fe.isPaidDisplay(fullyPaid) === true],
    ['lock', '空订单不锁', fe.isPaidDisplay(null) === false && fe.isPaidDisplay({}) === false],
    ['nav', '新建/详情算同一编辑页', viewKeyOf('/tuwen/orders/new') === 'tuwen-order-edit' && viewKeyOf('/tuwen/orders/abc') === 'tuwen-order-edit'],
    ['nav', '列表/仪表盘不共用编辑 key', viewKeyOf('/tuwen/orders') === '/tuwen/orders' && viewKeyOf('/tuwen/dashboard') === '/tuwen/dashboard'],
    ['nav', '离开详情才跳过 load', isOrderEditPath('/tuwen/orders/new') && isOrderEditPath('/tuwen/orders/x1') && !isOrderEditPath('/tuwen/orders') && !isOrderEditPath('/tuwen/dashboard')],
    ['stmt', '旧对账缺合计用应收回填', (() => {
      const rows = fe.hydrateStatementOrders(
        [{ id: 'x', orderNo: 'TW-1', receivable: 30, paid: 5, balance: 25 }],
        [{ orderId: 'x', projectName: '灯带', amount: 10 }, { orderId: 'x', projectName: '横幅', amount: 20 }]
      )
      return rows[0].projectNames === '灯带、横幅' && rows[0].subtotal === 30
    })()],
    ['stmt', '零合计回退应收', fe.statementOrderSubtotal({ subtotal: 0, receivable: 12, paid: 1, balance: 2, discount: 0 }) === 12],
    ['stmt', '记录能搜中文操作', fe.matchesAuditLog({ action: 'order_update', customerName: '登卡社区' }, '更新订单')
      && fe.matchesAuditLog({ action: 'order_update', customerName: '登卡社区' }, '登卡')
      && !fe.matchesAuditLog({ action: 'order_update', customerName: '登卡社区' }, '喜悦')],
    ['stmt', '对账单新日期在前', fe.filterStatementOrders([
      { id: 'old', orderDate: '2026-04-15', balance: 1 },
      { id: 'new', orderDate: '2026-09-04', balance: 1 }
    ])[0].id === 'new'],
    ['stmt', '空公司名不显示', fe.brandCompanyNameOf({ brandCompanyName: '' }) === ''
      && fe.quoteCompanyOf({}, { brandCompanyName: '', printCompanyTitle: '抬头' }) === ''],
    ['stmt', '同名缺ID仍算同一客户', fe.uniqueStatementParty([
      { customerId: 'c1', customerName: '喜悦' },
      { customerName: '喜悦' }
    ])?.customerId === 'c1'],
    ['stmt', '不同名即使只有一个ID也不收款', fe.uniqueStatementParty([
      { customerId: 'c1', customerName: '甲' },
      { customerName: '乙' }
    ]) === null]
  ]
}

function collectSpeedChecks({ edit, page, client, gw, mod }) {
  return [
    ['speed', '工作区内存缓存', mod.includes('wsCache') && mod.includes('wsInflight') && mod.includes('IfNoneMatch') && mod.includes('WS_CACHE_TTL_MS')],
    ['speed', '保存后立刻写回缓存', /function saveWorkspace[\s\S]*?rememberWorkspace\(next/.test(mod)],
    ['speed', '详情一次拉齐', client.includes("request('/tuwen/edit'") && gw.includes("path === '/tuwen/edit'") && mod.includes('function getEditBootstrap')],
    ['speed', '详情页不连打三次', edit.includes('getTuwenOrderEdit') && !edit.includes('Promise.all([loadCustomers(), loadSettings()])') && !edit.includes('listTuwenCustomers()')],
    ['speed', '列表带回设置', /list: slice[\s\S]{0,180}settings: normalizeAppSettings/.test(mod) && page.includes('data.settings')],
    ['speed', '列表不再先等设置', !page.includes('await loadSettings()\n  await load()') && page.includes('onMounted(async () =>')],
    ['speed', '按版本才更新', mod.includes('function sameVersion') && mod.includes('sinceVersion') && mod.includes('unchanged: true')],
    ['speed', '前端版本缓存', client.includes('peekTuwenOrderEdit') && client.includes('sinceVersion') && client.includes('invalidateReads')],
    ['speed', '详情先出缓存', edit.includes('peekTuwenOrderEdit') && edit.includes('data.unchanged') && edit.includes('isDirty()')],
    ['speed', '列表先出缓存', page.includes('peekTuwenOrders') && page.includes('data.unchanged')]
  ]
}

module.exports = {
  ORDER_EDIT_RE,
  extractFunction,
  viewKeyOf,
  isOrderEditPath,
  collectSourceChecks,
  collectBehaviorChecks,
  collectSpeedChecks
}
