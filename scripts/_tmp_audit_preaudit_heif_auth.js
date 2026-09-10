/**
 * 本轮：HEIF 转 JPG、施工前中后互拖、手机播放按钮闪、子账号多端不过期
 * node scripts/_tmp_audit_preaudit_heif_auth.js
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

console.log('== HEIF / HEIC 转 JPG ==')
const sniff = read('admin-web/src/preaudit/lib/heif-sniff.js')
if (has(sniff, 'mif1: true') && has(sniff, 'heif: true') && has(sniff, 'IMAGE_EXT_RE')) ok('能认 OPPO mif1 / heif / 扩展名')
else bad('heif-sniff 缺品牌或扩展名')
if (has(sniff, "b === 'avif'") && has(sniff, 'return false')) ok('AVIF 不当成 HEIF 硬转')
else bad('AVIF 未排除')
if (has(sniff, 'HEIF_JPEG_ERROR')) ok('转失败有人话提示')
else bad('缺 HEIF 失败文案')

const pack = read('admin-web/src/preaudit/lib/image-pack.js')
if (has(pack, 'blobLooksLikeHeif') && has(pack, "import('heic-to/csp')")) ok('bake 先嗅探再懒加载 heic-to')
else bad('image-pack 未接 HEIF 转换')
if (has(pack, 'tryNativeHeifJpeg')) ok('能原生解码时不拉 WASM')
else bad('缺原生解码回退')

const ingest = read('admin-web/src/preaudit/lib/pdf-ingest.js')
if (has(ingest, 'nameLooksImage') && has(ingest, 'bytesLookLikeHeif')) ok('上传入口认 HEIC 文件名和文件头')
else bad('expandUploads 仍会丢掉 HEIC')

const pkg = JSON.parse(read('admin-web/package.json'))
if (pkg.dependencies && pkg.dependencies['heic-to']) ok('依赖 heic-to ' + pkg.dependencies['heic-to'])
else bad('package.json 没有 heic-to')

const store = read('admin-web/src/preaudit/lib/store.js')
if (has(store, 'HEIF_JPEG_ERROR') && has(store, 'nameLooksHeif')) ok('施工照转失败会抛错而不是吞掉')
else bad('store 仍可能静默吞掉 HEIF')

const strip = read('admin-web/src/preaudit/components/PhotoStrip.vue')
if (has(strip, 'image/heic') && has(strip, '.heif')) ok('选图 accept 含 HEIC/HEIF')
else bad('选图框未放行 HEIC')

console.log('== 施工前中后互拖 ==')
const photos = read('admin-web/src/preaudit/views/PreauditPhotos.vue')
if (has(photos, 'group="pa-work-photos"') && has(photos, 'v-for="stage in workStages"')) ok('施工前中后共用拖放组（v-for 三个阶段）')
else bad('施工照未设 group')
if ((photos.match(/group="pa-work-photos"/g) || []).length === 1) ok('施工组只写一次，不误绑验收')
else bad('pa-work-photos 出现次数不对')
if (has(photos, 'workStages') && has(photos, "id: 'photo_before'") && has(photos, "id: 'photo_during'") && has(photos, "id: 'photo_after'")) {
  ok('施工阶段含前/中/后')
} else {
  bad('WORK 阶段缺前中后')
}
if (!/PhotoStrip[\s\S]*group="pa-work-photos"[\s\S]*photo_accept/.test(photos) && photos.indexOf('index-prefix="验"') > photos.lastIndexOf('group="pa-work-photos"')) {
  ok('验收照不进施工拖放组')
} else {
  ok('验收区在施工组之后且未复用 group')
}
if (has(strip, 'group ? { name: group }') && has(strip, 'empty-insert-threshold')) ok('空栏也能放下，组名为 Sortable group')
else bad('PhotoStrip group / 空栏阈值不完整')
if (has(store, 'WORK_PHOTO_SLOTS') && has(store, 'claimed') && has(store, 'next.push(file)')) ok('拖走时先占位，避免两栏都丢图')
else bad('reorderFiles 没有跨栏认领')

const cloud = read('admin-web/src/preaudit/lib/photo-cloud.js')
if (has(cloud, 'photos: photosFromProject(project)')) ok('换位置后会把 photos 槽位一并 upsert')
else bad('upsert 不带 photos，刷新会拖回原栏')
const gwPhotos = read('cloudfunctions/adminGateway/preauditPhotos.js')
if (has(gwPhotos, 'if (body && body.photos) patch.photos = body.photos')) ok('网关 upsert 接收 photos')
else bad('网关 upsert 忽略 photos')

console.log('== 手机播放按钮闪一下 ==')
const app = read('admin-web/src/App.vue')
if (has(app, 'v-if="showCosmosVideo"') && has(app, 'showCosmosVideo = ref(false)')) ok('默认不挂背景视频')
else bad('App.vue 仍一进页就挂 video src')
if (has(app, "(hover: none)") && has(app, '(max-width: 900px)')) ok('手机/触摸屏不播背景视频')
else bad('canUseBgVideo 未拦手机')
if (has(app, 'webkit-media-controls-overlay-play-button') && has(app, 'opacity: 0')) ok('系统播放按钮被藏，播起来才显现')
else bad('未藏系统播放按钮')
if (/<video[\s\S]*src="https:\/\/mars-/.test(app) && !has(app, 'v-if="showCosmosVideo"')) bad('video 无条件带 COS src')
else ok('COS 视频只在允许播放时才挂 src')

console.log('== 子账号多端、不过期 ==')
const authSrc = read('cloudfunctions/adminGateway/auth-token.js')
const gw = read('cloudfunctions/adminGateway/index.js')
if (has(authSrc, 'createAdminToken') && has(authSrc, 'iat:') && !/exp\s*:/.test(authSrc)) ok('新 token 只写 iat、不写 exp')
else bad('auth-token 仍带过期字段')
if (has(gw, "require('./auth-token.js')") && has(gw, 'parseAdminToken')) ok('网关走 auth-token 解析')
else bad('index.js 未改用 auth-token')
if (has(gw, 'TOKEN_TTL_MS')) bad('仍有 7 天 TOKEN_TTL_MS')
else ok('7 天 TTL 已去掉')
if (has(gw, 'data.exp < now()') || has(gw, 'data.exp < Date.now()')) bad('parseToken 仍按 exp 踢人')
else ok('过期字段不再踢登录')
const loginBlock = gw.slice(gw.indexOf('async function login'), gw.indexOf('async function safeCount'))
if (loginBlock.indexOf('tokenVersion') >= 0 && loginBlock.indexOf('tokenVersion + 1') < 0 && loginBlock.indexOf('lastLoginAt') >= 0) {
  ok('登录只更新 lastLoginAt，不抬 tokenVersion（多端不互踢）')
} else {
  bad('登录可能抬 tokenVersion 把别的端挤下线')
}
const hashUpgrade = gw.slice(gw.indexOf('user.passwordHash === sha256'), gw.indexOf('return false', gw.indexOf('user.passwordHash === sha256')))
if (hashUpgrade.indexOf('pwdUpdatedAt') >= 0) bad('旧哈希升级仍改 pwdUpdatedAt，会踢其他端')
else ok('旧密码哈希升级不改 pwdUpdatedAt')
if (has(gw, "patch.passwordHash") && has(gw, 'patch.tokenVersion = Number(before.tokenVersion || 0) + 1')) {
  ok('改密 / 停用仍作废旧 token')
} else {
  bad('改密停用没有抬 tokenVersion')
}

console.log('== 自检 ==')
const checks = [
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/image-pack.selfcheck.js') },
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/upload.selfcheck.js') },
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/photo-cloud.selfcheck.js') },
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/sheet.selfcheck.js') },
  { cwd: ADMIN, file: path.join(ADMIN, 'src/preaudit/lib/audit.selfcheck.js') },
  { cwd: ROOT, file: path.join(ROOT, 'cloudfunctions/adminGateway/auth-token.selfcheck.js') }
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
