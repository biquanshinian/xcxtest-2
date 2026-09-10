/**
 * 更新日志成品：写完 article.md 后提醒 / 尝试自动导入草稿箱
 * - afterFileEdit：路径命中 docs/wechat-oa/.../article.md → 打 dirty
 * - stop：若有 dirty → 尝试 import-to-drafts.js；失败则 followup 提醒 Agent
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const HOOKS_DIR = __dirname
const ROOT = path.resolve(HOOKS_DIR, '../..')
const FLAG = path.join(HOOKS_DIR, '.oa-update-log-dirty')
const LAST = path.join(HOOKS_DIR, '.oa-update-log-last.json')
const IMPORT_JS = path.join(
  ROOT,
  '.cursor',
  'skills',
  'oa-update-log',
  'scripts',
  'import-to-drafts.js'
)

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => {
      data += c
    })
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch (_) {
        resolve({})
      }
    })
    setTimeout(() => {
      if (!data) resolve({})
    }, 50)
  })
}

function isUpdateArticle(filePath) {
  const n = String(filePath || '').replace(/\\/g, '/')
  return /\/docs\/wechat-oa\/[^/]+\/article\.md$/i.test(n) || /\/docs\/wechat-oa\/article\.md$/i.test(n)
}

function mark(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath)
  fs.writeFileSync(
    FLAG,
    JSON.stringify({ path: abs, at: Date.now() }),
    'utf8'
  )
  fs.writeFileSync(LAST, JSON.stringify({ path: abs, at: Date.now() }), 'utf8')
}

function consume() {
  if (!fs.existsSync(FLAG)) return null
  try {
    const j = JSON.parse(fs.readFileSync(FLAG, 'utf8'))
    fs.unlinkSync(FLAG)
    return j
  } catch (_) {
    try {
      fs.unlinkSync(FLAG)
    } catch (__) {}
    return null
  }
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj || {}))
}

async function main() {
  const mode = process.argv[2] || 'auto'
  const input = await readStdin()
  const event = String(input.hook_event_name || '')
  const filePath = input.file_path || input.filePath || ''

  if (mode === 'mark' || event === 'afterFileEdit' || event === 'afterTabFileEdit') {
    if (isUpdateArticle(filePath)) mark(filePath)
    process.exit(0)
  }

  if (mode === 'stop' || event === 'stop') {
    const dirty = consume()
    if (!dirty) {
      process.exit(0)
    }
    const articlePath = dirty.path
    const dir = path.dirname(articlePath)
    if (!fs.existsSync(IMPORT_JS)) {
      out({
        followup_message:
          `已写更新日志 ${articlePath}，但缺少导入脚本。请运行：` +
          `node .cursor/skills/oa-update-log/scripts/import-to-drafts.js "${dir}"` +
          `；若无 OA_ADMIN_TOKEN，请提醒用户配置 .cursor/oa-admin.local.env 或在后台「导入成品（不洗稿）」粘贴 article.md。`
      })
      process.exit(0)
    }
    const r = spawnSync(process.execPath, [IMPORT_JS, dir], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true
    })
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`
    if (r.status === 0 && /IMPORT_OK/.test(combined)) {
      const m = combined.match(/IMPORT_OK\s+(\{[\s\S]*\})/)
      out({
        followup_message:
          `更新日志已自动导入后台草稿箱。结果：${m ? m[1] : 'OK'}。` +
          `请用一两句话告诉用户：打开「内容中台 → 草稿箱」核对主题/预览，配图就绪后自行点「推微信」。不要再次推送。`
      })
      process.exit(0)
    }
    if (r.status === 2 || /MISSING_TOKEN/.test(combined)) {
      out({
        followup_message:
          `刚写完更新日志（${dir}），自动导入因缺少管理员 JWT 未执行。` +
          `请立刻提醒用户二选一：\n` +
          `1) 后台已登录时，把 localStorage 的 admin_token 写入 .cursor/oa-admin.local.env 的 OA_ADMIN_TOKEN=…，然后运行：` +
          `node .cursor/skills/oa-update-log/scripts/import-to-drafts.js "${dir}"\n` +
          `2) 打开草稿箱 →「导入成品（不洗稿）」粘贴该目录 article.md，配图用 https 或同目录上传后的 URL。\n` +
          `回复用户时不要只说「已写好」，必须带上导入动作。`
      })
      process.exit(0)
    }
    out({
      followup_message:
        `更新日志自动导入失败（${dir}）：${(combined || '').trim().slice(0, 400)}。` +
        `请协助用户改用后台「导入成品（不洗稿）」或修好 token/配图后重跑 import-to-drafts.js。`
    })
    process.exit(0)
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
