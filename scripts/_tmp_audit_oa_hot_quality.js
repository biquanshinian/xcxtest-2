/**
 * 审计：oa-hot-quality 技能 + 入库脚本是否对上「写热点 → 空间号草稿箱」
 * node scripts/_tmp_audit_oa_hot_quality.js
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const skill = 'oa-hot-quality'
let fail = 0
function ok(m) {
  console.log('  [ok]', m)
}
function bad(m) {
  fail += 1
  console.log('  [FAIL]', m)
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

const skillMd = read(`.cursor/skills/${skill}/SKILL.md`)
const examples = read(`.cursor/skills/${skill}/examples.md`)
const importer = read('.cursor/skills/oa-update-log/scripts/import-to-drafts.js')
const updateLog = read('.cursor/skills/oa-update-log/SKILL.md')

console.log('== 文件 ==')
;[
  `.cursor/skills/${skill}/SKILL.md`,
  `.cursor/skills/${skill}/examples.md`,
  'test/oa-hot-import-frontmatter.test.js'
].forEach((rel) => (exists(rel) ? ok(rel) : bad('缺 ' + rel)))

console.log('== 技能发现 ==')
;/写热点/.test(skillMd) ? ok('触发词：写热点') : bad('description/正文缺「写热点」')
;/mars_space/.test(skillMd) ? ok('发稿号 mars_space') : bad('缺 mars_space')
;/disable-model-invocation/.test(skillMd)
  ? bad('不该关掉自动调用')
  : ok('可按「写热点」自动加载')
;/oa-hot-quality/.test(updateLog) ? ok('更新日志技能已分流') : bad('oa-update-log 未指向本技能')

console.log('== 门槛与体裁 ==')
;/不进池|通稿/.test(skillMd) && /财报/.test(skillMd)
  ? ok('门槛含通稿/财报')
  : bad('门槛不完整')
;/type: newspic/.test(skillMd) ? ok('贴图文首 type: newspic') : bad('缺贴图文首')
;/粉丝向/.test(skillMd) && /不要套辟谣|不要「复盘/.test(skillMd)
  ? ok('C 稿不套辟谣结构')
  : bad('C 稿仍可能套辟谣模板')
;/docs\/wechat-oa\/\*\*\/article\.md|wechat-oa\/\*\*/.test(skillMd)
  ? ok('冷却扫描不限 hot-*')
  : bad('冷却仍只扫 hot-*，会漏罗马/更新稿')
;/252|已发表/.test(skillMd) ? ok('提醒仓库没有已发表列表') : bad('没提醒已发表不在仓库')

console.log('== 入库口径 ==')
;/不要.*推微信|未推微信/.test(skillMd) ? ok('禁止推微信') : bad('未写清禁止推微信')
;/OA_BRAND_KEY=mars_space/.test(skillMd) ? ok('入库带空间号') : bad('入库命令未钉死空间号')
;/文首免责|中台仍可能/.test(skillMd)
  ? ok('点明中台可能加免责/小程序名')
  : bad('没提醒导入后可能被加文首导流')

console.log('== 反例 ==')
;/天鹊-12B|财报电话会/.test(examples) ? ok('冷稿反例在 examples') : bad('examples 缺冷稿标题')
;/爆炸图片系 AI/.test(examples) ? ok('热稿正例') : bad('examples 缺热稿正例')

console.log('== 入库脚本 ==')
;/function parseFrontmatter/.test(importer) ? ok('认文首 YAML') : bad('脚本不认文首')
;/function inferBrandFromDir/.test(importer) ? ok('hot-* 默认真空间号') : bad('hot-* 不会默认空间号')
;/function captionFromMarkdown/.test(importer) ? ok('贴图文案会剥标题/图') : bad('贴图可能把 #标题 推进文案')
;/assertExclusiveCover/.test(importer) &&
/assertExclusiveCover\(dirName, markdown, files\)\s*\n\s*if \(dry\)/.test(importer)
  ? ok('--dry 也会查封面')
  : bad('--dry 可能跳过封面检查')
;/startsWith\('--'\)/.test(importer) ? ok('--brand 不吞开关') : bad('--brand 可能吞掉 --newspic')
;/wxArticleType/.test(importer) ? ok('导入传 wxArticleType') : bad('导入没传贴图类型')

console.log('== 单测 ==')
const unit = spawnSync(process.execPath, ['--test', 'test/oa-hot-import-frontmatter.test.js'], {
  cwd: ROOT,
  encoding: 'utf8'
})
unit.status === 0 ? ok('frontmatter 单测通过') : bad('单测失败\n' + (unit.stdout || unit.stderr))

console.log('== dry-run 封面门禁 ==')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-hot-audit-'))
const hotDir = path.join(tmp, 'hot-2026-09-05-audit')
fs.mkdirSync(hotDir)
fs.writeFileSync(
  path.join(hotDir, 'article.md'),
  '---\ntype: news\nbrand: mars_space\n---\n# 审计用标题\n\n没有封面。\n'
)
const dry = spawnSync(
  process.execPath,
  ['.cursor/skills/oa-update-log/scripts/import-to-drafts.js', hotDir, '--dry'],
  { cwd: ROOT, encoding: 'utf8' }
)
const dryOut = String(dry.stderr || '') + String(dry.stdout || '')
if (/缺专属封面/.test(dryOut) && dry.status !== 0) ok('无封面 dry-run 会失败')
else bad('无封面 dry-run 未拦住 status=' + dry.status + '\n' + dryOut)
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch (e) {}

if (fail) {
  console.log('\nAUDIT FAIL', fail)
  process.exit(1)
}
console.log('\nAUDIT OK')
