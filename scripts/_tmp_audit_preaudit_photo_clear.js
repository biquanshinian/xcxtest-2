/**
 * 本轮：施工照片一键清空（整栏 / 前中后全部）
 * node scripts/_tmp_audit_preaudit_photo_clear.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const ADMIN = path.join(ROOT, 'admin-web')

let fail = 0
function ok(msg) { console.log('  [ok] ' + msg) }
function bad(msg) { fail++; console.log('  [FAIL] ' + msg) }
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}
function has(src, needle) {
  return src.indexOf(needle) >= 0
}

console.log('== 施工照页按钮 ==')
const photos = read('admin-web/src/preaudit/views/PreauditPhotos.vue')
if (has(photos, 'clearAllWork') && has(photos, '>清空全部<')) ok('施工现场有「清空全部」')
else bad('施工现场缺清空全部')
if ((photos.match(/@click="clearSlot\(/g) || []).length >= 2) ok('阶段栏 / 验收各有清空')
else bad('阶段或验收缺清空按钮')
if (has(photos, "clearing === 'work'") && has(photos, 'clearing === stage.id')) ok('清空中有 loading，避免连点')
else bad('清空按钮没有 loading 锁')
if (has(photos, 'closePreview()') && has(photos, 'previewSlot.value === key')) ok('清空后关掉预览')
else bad('清空后可能留着大图预览')
if (has(photos, '会从云端永久删掉') && has(photos, "confirmButtonText: '清空全部'")) ok('清空前二次确认，文案写明云端删除')
else bad('缺确认框或未提示云端删除')

console.log('== store 批量删 ==')
const store = read('admin-web/src/preaudit/lib/store.js')
if (has(store, 'export async function clearFiles') && has(store, 'export async function clearFileSlots')) {
  ok('clearFiles / clearFileSlots 已导出')
} else {
  bad('store 没有批量清空')
}
if (has(store, '有照片正在保存，请稍后再清空')) ok('保存中禁止清空，避免和上传打架')
else bad('保存中仍允许清空')
if (has(store, 'deleteCloudPhotoRetry') && has(store, 'kept.push(file)')) ok('云端删失败的留下，成功的本地先清掉')
else bad('批量删失败时可能整栏回滚或半删半留对不齐')
if (has(store, 'pairedPhotoPatch(project, itemId, kept)')) ok('清空后同步成对照片标记')
else bad('清空未更新 pairedPhoto')
if (has(photos, 'clearFileSlots(project.value.id, WORK.map') && has(photos, "id: 'photo_before'")) {
  ok('清空全部只动施工前/中/后，不动验收')
} else {
  bad('清空全部槽位不对')
}

console.log('== 自检 ==')
const checks = [
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/photo-cloud.selfcheck.js') },
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/upload.selfcheck.js') },
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/image-pack.selfcheck.js') },
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/sheet.selfcheck.js') },
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/audit.selfcheck.js') }
]
checks.forEach((item) => {
  const r = spawnSync(process.execPath, [item.file], { encoding: 'utf8', cwd: item.cwd })
  const name = path.basename(item.file)
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
  if (r.status === 0) ok(name + (out ? ' · ' + out.split('\n').pop() : ''))
  else bad(name + ' 退出 ' + r.status + '\n' + out)
})

if (fail) {
  console.log('\n审计未通过：' + fail + ' 项')
  process.exit(1)
}
console.log('\n本轮审计全绿')
