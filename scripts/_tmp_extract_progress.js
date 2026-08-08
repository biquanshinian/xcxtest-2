// 从 progress.js 按行区间抽出事件动态 / LL2 折叠区方法，写入临时文件供并入 progress-lazy.js
const fs = require('fs')
const src = 'pages/progress/progress.js'
const s = fs.readFileSync(src, 'utf8')
const lines = s.split('\n')

// 1-based inclusive；倒序删除防止行号漂移
const ranges = [
  { name: 'topConsts', from: 46, to: 47 },   // PROGRESS_LIVE_STATUS_DEFER_MS
  { name: 'cloudErrImport', from: 49, to: 50 }, // formatCloudError import + 空行
  { name: 'formatLl2AutoError', from: 51, to: 59 }, // 函数 + 尾随空行
  { name: 'll2Cluster', from: 685, to: 776 },
  { name: 'eventCluster1', from: 1149, to: 1436 },
  { name: 'openEventDetail', from: 1464, to: 1472 },
  { name: 'eventCluster2', from: 1484, to: 1720 }
]

// 边界自检
const checks = [
  [46, '/** 事件列表直播状态批量查询延后'],
  [47, 'const PROGRESS_LIVE_STATUS_DEFER_MS'],
  [49, "const { formatCloudError }"],
  [51, '/** LL2 自动解析星舰发射失败时的可读文案 */'],
  [685, '  loadLl2LaunchUpdates() {'],
  [776, ''],
  [777, '  onStarshipImageError(e) {'],
  [1149, '  async loadEventVideoConfig() {'],
  [1436, ''],
  [1437, '  findEventUpdateItem(id, idx) {'],
  [1464, '  openEventDetail(e) {'],
  [1473, '  onEventItemTouchStart(e) {'],
  [1484, '  openEventShareSheet(e) {'],
  [1720, ''],
  [1721, '  onShareAppMessage(e) {']
]
for (const [ln, expect] of checks) {
  const actual = lines[ln - 1]
  if (!actual.startsWith(expect)) {
    console.error('边界不符 行' + ln + ': 期待「' + expect + '」实际「' + actual.slice(0, 60) + '」')
    process.exit(1)
  }
}

const extracted = {}
for (const r of ranges) extracted[r.name] = lines.slice(r.from - 1, r.to).join('\n')

const sorted = [...ranges].sort((a, b) => b.from - a.from)
let out = lines
for (const r of sorted) out = out.slice(0, r.from - 1).concat(out.slice(r.to))
fs.writeFileSync(src, out.join('\n'))

fs.writeFileSync('scripts/_tmp_extracted_progress.txt', ranges.map((r) => '// ===== ' + r.name + ' =====\n' + extracted[r.name]).join('\n\n'))
console.log('progress.js:', (s.length / 1024).toFixed(1) + 'KB →', (out.join('\n').length / 1024).toFixed(1) + 'KB')
