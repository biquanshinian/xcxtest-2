// 只读排查脚本：用 .auth/storageState.json 的登录 Cookie 拉取最近动态，
// 打印全文与富文本节点类型，确认发布内容里话题是否存在/是否成为真话题
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const statePath = path.resolve(__dirname, '../.auth/storageState.json')
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const cookies = (state.cookies || [])
  .filter((c) => /bilibili\.com$/.test(c.domain) || c.domain.includes('bilibili'))
  .map((c) => `${c.name}=${c.value}`)
  .join('; ')

const uid = process.argv[2] || '485761816'
const url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${uid}&features=itemOpusStyle`

const res = await fetch(url, {
  headers: {
    Cookie: cookies,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Referer: `https://space.bilibili.com/${uid}/dynamic`
  }
})
const j = await res.json()
if (!j.data || !j.data.items) {
  console.log('API 返回异常:', JSON.stringify(j).slice(0, 500))
  process.exit(1)
}
for (const it of j.data.items.slice(0, 5)) {
  const m = it.modules || {}
  const dyn = m.module_dynamic || {}
  const author = m.module_author || {}
  const desc = dyn.desc || (dyn.major && dyn.major.opus && dyn.major.opus.summary) || {}
  const nodes = (desc.rich_text_nodes || []).map((n) => `${n.type}:${(n.text || n.orig_text || '').slice(0, 30)}`)
  console.log('====', it.id_str, it.type, author.pub_time)
  console.log('topic模块:', JSON.stringify(dyn.topic || null))
  console.log('全文:', JSON.stringify(desc.text || ''))
  console.log('节点:', JSON.stringify(nodes, null, 0))
}
