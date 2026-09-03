/**
 * 诊断：SciNews 频道列表解析 + Starlink 412 匹配
 * node scripts/_diag_clip_list.js
 */
import { spawn } from 'child_process'
import { getConfig } from '../src/config.js'
import { buildProxyCandidates } from '../src/proxy-discover.js'
import { scoreClipText, parseUploadDateMs, pickBestClipCandidate, hits, tokenVariantGroups } from '../src/clip-match.js'

function run(bin, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let so = '', se = ''
    const t = setTimeout(() => { try { child.kill() } catch (e) {}; reject(new Error('timeout')) }, timeoutMs)
    child.stdout.on('data', (d) => { so += d })
    child.stderr.on('data', (d) => { se += d })
    child.on('error', (e) => { clearTimeout(t); reject(e) })
    child.on('exit', (code) => { clearTimeout(t); resolve({ code, so, se }) })
  })
}

async function probeProxy(proxy) {
  const args = ['-sS', '-m', '5', '-o', 'NUL', '-w', '%{http_code}', 'https://www.youtube.com/generate_204']
  if (proxy) args.unshift('-x', proxy)
  const r = await run('curl', args, 15000)
  return /^[23]\d\d$/.test(String(r.so || '').trim())
}

async function main() {
  const cfg = getConfig()
  const { candidates, discoveredPorts } = await buildProxyCandidates(cfg.proxies || [])
  console.log('discoveredPorts', discoveredPorts)
  let proxy = ''
  for (const c of candidates) {
    const p = c.toLowerCase() === 'direct' ? '' : c
    if (await probeProxy(p)) { proxy = p; console.log('proxy', p || 'direct'); break }
  }

  const channel = 'https://www.youtube.com/channel/UCjU6ZwoTQtKWfz1urL7XcbA/videos'
  // 与 index.js findClipVideo 相同的 print 格式（真实 TAB）
  const printFmt = '%(id)s\t%(duration)s\t%(upload_date)s\t%(title)s'
  const args = ['--flat-playlist', '--playlist-end', '20', '--print', printFmt, channel]
  if (proxy) args.unshift('--proxy', proxy)

  const out = await run(cfg.ytdlpPath, args, 180000)
  console.log('ytdlp_exit', out.code)
  if (out.se) console.log('stderr_tail', out.se.slice(-400).replace(/\r?\n/g, ' | '))

  const lines = out.so.split(/\r?\n/).filter(Boolean)
  console.log('raw_lines', lines.length)

  const rows = lines.map((line) => {
    const parts = line.split('\t')
    if (parts.length < 4) return { bad: true, n: parts.length, sample: line.slice(0, 100) }
    return {
      bad: false,
      id: parts[0].trim(),
      durationSec: Math.round(Number(parts[1])) || 0,
      uploadDate: parts[2].trim(),
      title: parts.slice(3).join('\t').trim()
    }
  })
  const good = rows.filter((r) => !r.bad)
  const bad = rows.filter((r) => r.bad)
  console.log({ good: good.length, bad: bad.length, badSamples: bad.slice(0, 2) })
  console.log('titles', good.slice(0, 8).map((r) => ({
    id: r.id, dur: r.durationSec, up: r.uploadDate, title: r.title.slice(0, 90)
  })))

  const clipSearch = {
    dateText: '8 August 2026',
    tokens: ['starlink', '17-38'],
    rocketTokens: ['falcon'],
    netMs: Date.parse('2026-08-08T16:35:00Z'),
    maxDurationSec: 300
  }
  const dateText = clipSearch.dateText.toLowerCase()
  const tokens = tokenVariantGroups(clipSearch.tokens)
  const rocketTokens = tokenVariantGroups(clipSearch.rocketTokens)
  const maxDurSec = clipSearch.maxDurationSec + 30
  const pre = good.filter((r) => !r.durationSec || r.durationSec <= maxDurSec)
  const dateInTitle = pre.filter((r) => r.title.toLowerCase().includes(dateText))
  const needVerify = pre.filter((r) => {
    const t = r.title.toLowerCase()
    return !t.includes(dateText) && /launch/i.test(r.title) &&
      (hits(tokens, t) > 0 || hits(rocketTokens, t) > 0)
  })
  console.log({
    pre: pre.length,
    dateInTitle: dateInTitle.length,
    dateInTitleSample: dateInTitle.slice(0, 3).map((r) => r.title.slice(0, 80)),
    needVerify: needVerify.length
  })

  const candidates2 = dateInTitle.concat(needVerify.slice(0, 3))
  const scoredItems = []
  for (const r of candidates2.slice(0, 8)) {
    const scored = scoreClipText(r.title, '', clipSearch)
    console.log('score', {
      title: r.title.slice(0, 80),
      ok: scored.ok,
      strict: scored.strict,
      fuzzy: scored.fuzzy,
      dateOk: scored.dateOk
    })
    if (!scored.ok) continue
    scoredItems.push({ r, scored, uploadMs: parseUploadDateMs(r.uploadDate) })
  }
  const best = pickBestClipCandidate(scoredItems, clipSearch.netMs)
  console.log('best', best ? { id: best.r.id, title: best.r.title.slice(0, 100), fuzzy: best.scored.fuzzy } : null)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
