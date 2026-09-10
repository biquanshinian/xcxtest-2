const fs = require('fs')
const path = require('path')
const dir = process.env.TEMP
const files = [
  'tw-DashboardPage-fQNYzto4.js',
  'tw-OrdersPage-Ci3SdXE-.js',
  'tw-CustomersPage-C5ep8QUw.js',
  'tw-SuppliersPage-D1QOvo_4.js',
  'tw-StatementPage-C5jBtoDI.js',
  'tw-ReportsPage-BKIWJpcB.js',
  'tw-ExpensesPage-CGbM9CnD.js',
  'tw-AfterSalesPage-BbyuWuOC.js',
  'tw-SettingsPage-BNMOb4lQ.js',
  'tw-AuditLogPage-tVhOtp0R.js'
]
for (const f of files) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8')
  const labels = [...new Set([...s.matchAll(/["'`]([\u4e00-\u9fffA-Za-z0-9（）()%/.\-]{2,24})["'`]/g)].map((m) => m[1]))]
    .filter((x) => /[\u4e00-\u9fff]/.test(x))
  console.log('\n==== ' + f.replace('tw-', '') + ' ====')
  console.log(labels.join(' | '))
}
