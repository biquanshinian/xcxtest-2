const fs = require('fs')
const path = require('path')
const initSqlJs = require(path.join(process.env.TEMP, 'sqljs-tmp/node_modules/sql.js'))
const dbPath = 'c:/Users/huyuz/Desktop/xcxtest-2/admin-web/图文智能业务-便携版/server/data/tw.sqlite'
const outDir = path.join(__dirname, '../scripts/_tmp_tw_dump')

function keysOf(obj, prefix = '', into = new Set()) {
  if (!obj || typeof obj !== 'object') return into
  if (Array.isArray(obj)) {
    if (obj[0] && typeof obj[0] === 'object') keysOf(obj[0], prefix + '[]', into)
    return into
  }
  for (const k of Object.keys(obj)) {
    into.add(prefix ? prefix + '.' + k : k)
    const v = obj[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) keysOf(v, prefix ? prefix + '.' + k : k, into)
    if (Array.isArray(v) && v[0] && typeof v[0] === 'object') keysOf(v[0], (prefix ? prefix + '.' + k : k) + '[]', into)
  }
  return into
}

function stripImages(o) {
  if (!o || typeof o !== 'object') return o
  if (Array.isArray(o)) return o.map(stripImages)
  const out = {}
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && v.startsWith('data:image')) out[k] = `[data-url ${v.length}]`
    else if (v && typeof v === 'object') out[k] = stripImages(v)
    else out[k] = v
  }
  return out
}

;(async () => {
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(dbPath))
  const row = db.exec('SELECT * FROM workspace WHERE id = "default"')[0]
  const rec = {}
  row.columns.forEach((c, i) => { rec[c] = row.values[0][i] })
  fs.mkdirSync(outDir, { recursive: true })
  const parts = {
    customers: JSON.parse(rec.customers_json || '[]'),
    orders: JSON.parse(rec.orders_json || '[]'),
    expenses: JSON.parse(rec.expenses_json || '[]'),
    suppliers: JSON.parse(rec.suppliers_json || '[]'),
    auditLogs: JSON.parse(rec.audit_logs_json || '[]'),
    afterSales: JSON.parse(rec.after_sales_json || '[]'),
    appSettings: JSON.parse(rec.app_settings_json || '{}')
  }
  console.log('counts', {
    customers: parts.customers.length,
    orders: parts.orders.length,
    expenses: parts.expenses.length,
    suppliers: parts.suppliers.length,
    auditLogs: parts.auditLogs.length,
    afterSales: parts.afterSales.length
  })
  for (const [k, v] of Object.entries(parts)) {
    const sample = Array.isArray(v) ? v[0] : v
    console.log('\n##', k, 'keys', [...keysOf(sample)].join(', '))
  }
  fs.writeFileSync(path.join(outDir, 'order0.json'), JSON.stringify(stripImages(parts.orders[0] || {}), null, 2))
  fs.writeFileSync(path.join(outDir, 'customer0.json'), JSON.stringify(stripImages(parts.customers[0] || {}), null, 2))
  fs.writeFileSync(path.join(outDir, 'expense0.json'), JSON.stringify(stripImages(parts.expenses[0] || {}), null, 2))
  fs.writeFileSync(path.join(outDir, 'settings.json'), JSON.stringify(stripImages(parts.appSettings), null, 2))
  fs.writeFileSync(path.join(outDir, 'audit0.json'), JSON.stringify(stripImages(parts.auditLogs[0] || {}), null, 2))
  console.log('\nwrote', outDir)
})()
