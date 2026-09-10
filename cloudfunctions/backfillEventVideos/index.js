/**
 * 事件长视频回填：把同步时未存 COS 的推文视频（>120s 长视频 / 超 50MB 被跳过的）
 * 搬进 COS 并生成压缩预览片，彻底解决「长视频只有站外链接、境内打不开」。
 *
 * 为什么独立函数：syncSpaceXTweets 总超时仅 60s（要保推文不漏抓），
 * 大视频下载必须有自己的时间预算（本函数 800s，每次最多下载 1 条）。
 *
 * media 条目状态机（按 COS 对象存在性驱动）：
 *   A) url 非 COS 且有 mp4 直链（videoUrl）
 *      → 经代理流式下载到 /tmp（≤200MB）→ 分片上传 COS 原片 → 提交预览转码。
 *      保留 videoUrl / isLongVideo：预览未就绪前，小程序维持「复制链接」行为不回退。
 *   B) url 已是 COS 但仍带 videoUrl / isLongVideo（回填中间态）
 *      → HEAD 预览片；就绪则写 previewUrl 并摘掉 videoUrl / isLongVideo（转普通可播视频，
 *        原打标 isLongVideo 的记为 wasLongVideo 供成稿标注），连续 3 轮未见则重新提交转码。
 *   下载失败 cosFetchTries 累计 ≥3 放弃，保持现状（封面 + 复制链接）。
 *
 * 环境变量：SPACEX_PROXY_URL（twimg 下载代理，与 syncSpaceXTweets 共用）
 */
const cloud = require('wx-server-sdk')
const COS = require('cos-nodejs-sdk-v5')
const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { URL } = require('url')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COS_BUCKET = 'mars-1397421562'
const COS_REGION = 'ap-guangzhou'
const COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'
const COLLECTION = 'starship_event_updates'

// 200MB：/tmp（512MB）安全，且不超过小程序 wx.downloadFile 单文件上限（会员下载原片仍可用）
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const MIN_VIDEO_BYTES = 256 * 1024
const DOWNLOAD_TIMEOUT_MS = 480 * 1000
const MAX_FETCH_TRIES = 3
const SCAN_EVENTS = 40
// 预览转码参数与 syncSpaceXTweets 保持一致（同一 preview/ 目录约定）
const EVENT_PREVIEW_WIDTH = 720
const EVENT_PREVIEW_BITRATE = 800
const WORKER_PROXY_URL = process.env.SPACEX_PROXY_URL || ''

let _cosClient = null
function createCOSClient() {
  if (_cosClient) return _cosClient
  _cosClient = new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })
  return _cosClient
}

function cosKeyFromPublicUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith(COS_BASE_URL)) return ''
  try {
    return decodeURI(url.slice(COS_BASE_URL.length).split('?')[0])
  } catch (e) {
    return ''
  }
}

function isMp4Like(s) {
  return /\.(mp4|mov|m4v)(\?|#|$)/i.test(String(s || '').split('#')[0])
}

/** 与 syncSpaceXTweets.eventPreviewKey 相同的预览片命名约定 */
function eventPreviewKey(sourceKey) {
  const parts = String(sourceKey || '').split('/')
  const file = parts.pop() || `video_${Date.now()}.mp4`
  const folder = parts.join('/')
  const name = file.replace(/\.(mp4|mov|webm)$/i, '') + '_fast.mp4'
  return folder ? `${folder}/preview/${name}` : `preview/${name}`
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function headExists(cos, key) {
  return new Promise((resolve) => {
    cos.headObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, (err) => resolve(!err))
  })
}

function submitPreviewJob(cos, inputKey, outputKey) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Tag>Transcode</Tag>
  <Input><Object>${escapeXml(inputKey)}</Object></Input>
  <Operation>
    <Transcode>
      <Container><Format>mp4</Format></Container>
      <Video>
        <Codec>H.264</Codec>
        <Profile>main</Profile>
        <Bitrate>${EVENT_PREVIEW_BITRATE}</Bitrate>
        <Width>${EVENT_PREVIEW_WIDTH}</Width>
        <Fps>24</Fps>
        <Preset>medium</Preset>
      </Video>
      <Audio>
        <Codec>aac</Codec>
        <Bitrate>64</Bitrate>
        <Channels>2</Channels>
        <Samplerate>44100</Samplerate>
      </Audio>
      <TransConfig>
        <AdjDarMethod>scale</AdjDarMethod>
        <IsCheckReso>false</IsCheckReso>
        <ResoAdjMethod>1</ResoAdjMethod>
      </TransConfig>
    </Transcode>
    <Output>
      <Region>${COS_REGION}</Region>
      <Bucket>${COS_BUCKET}</Bucket>
      <Object>${escapeXml(outputKey)}</Object>
    </Output>
  </Operation>
  <CallBackFormat>JSON</CallBackFormat>
</Request>`
  return new Promise((resolve, reject) => {
    cos.request(
      {
        Method: 'POST',
        Url: `https://${COS_BUCKET}.ci.${COS_REGION}.myqcloud.com/jobs`,
        Headers: { 'Content-Type': 'application/xml' },
        Body: body
      },
      (err, data) => (err ? reject(err) : resolve(data))
    )
  })
}

function looksLikeMp4Head(buf) {
  if (!buf || buf.length < 12) return false
  const head = buf.slice(0, 64).toString('latin1')
  return head.includes('ftyp') || head.includes('moov')
}

/**
 * 流式下载到本地文件（不占内存）：跟随重定向、限大小、总超时
 * @returns {Promise<number>} 字节数
 */
function downloadToFile(url, filePath, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    let settled = false
    let ws = null
    const done = (err, size) => {
      if (settled) return
      settled = true
      clearTimeout(killer)
      if (ws) {
        try { ws.destroy() } catch (e) {}
      }
      if (err) reject(err)
      else resolve(size)
    }
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SpaceXTrackerBot/1.0)',
          Accept: 'video/mp4,video/*,*/*'
        },
        timeout: 60000
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) return done(new Error('重定向过多'))
          const next = new URL(res.headers.location, url).toString()
          clearTimeout(killer)
          settled = true
          downloadToFile(next, filePath, redirectsLeft - 1).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          return done(new Error(`下载失败 HTTP ${res.statusCode}`))
        }
        const declared = Number(res.headers['content-length'] || 0)
        if (declared > MAX_VIDEO_BYTES) {
          res.resume()
          return done(new Error(`视频过大 ${(declared / 1048576).toFixed(0)}MB（上限 200MB）`))
        }
        ws = fs.createWriteStream(filePath)
        let total = 0
        let firstChunk = null
        res.on('data', (c) => {
          total += c.length
          if (!firstChunk) firstChunk = c
          if (total > MAX_VIDEO_BYTES) {
            req.destroy()
            done(new Error('视频过大（下载中止，上限 200MB）'))
          }
        })
        res.pipe(ws)
        ws.on('finish', () => {
          if (total < MIN_VIDEO_BYTES) return done(new Error(`文件过小（${total}B），疑似错误页`))
          if (!looksLikeMp4Head(firstChunk)) return done(new Error('响应不是 MP4 内容'))
          done(null, total)
        })
        ws.on('error', (e) => done(e))
        res.on('error', (e) => done(e))
      }
    )
    req.on('error', (e) => done(e))
    req.on('timeout', () => {
      req.destroy()
      done(new Error('连接超时'))
    })
    const killer = setTimeout(() => {
      try { req.destroy() } catch (e) {}
      done(new Error(`下载超时（>${DOWNLOAD_TIMEOUT_MS / 1000}s）`))
    }, DOWNLOAD_TIMEOUT_MS)
  })
}

function uploadFileToCos(cos, key, filePath) {
  return new Promise((resolve, reject) => {
    cos.uploadFile(
      {
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        FilePath: filePath,
        SliceSize: 8 * 1024 * 1024,
        Headers: { 'Content-Type': 'video/mp4' }
      },
      (err, data) => (err ? reject(err) : resolve(data))
    )
  })
}

/** 从事件已有 COS 素材推导存储目录（与该账号推文图片同目录）；兜底 EventVideos */
function deriveCosFolder(mediaList) {
  for (const m of mediaList || []) {
    for (const field of ['thumbnailUrl', 'url', 'previewUrl']) {
      const key = cosKeyFromPublicUrl(m && m[field])
      if (key && key.includes('/')) {
        const folder = key.split('/').slice(0, -1).join('/')
        // 预览子目录回到父目录
        return folder.replace(/\/preview$/, '') || 'EventVideos'
      }
    }
  }
  return 'EventVideos'
}

/** 是否为「未存 COS 的推文视频」（长视频或超大被跳过的） */
function needsCosBackfill(m) {
  if (!m || m.type !== 'video') return false
  if (cosKeyFromPublicUrl(m.url)) return false
  return !!(m.isLongVideo || m.videoUrl)
}

/** 是否为「原片已在 COS、预览未就绪」的中间态 */
function isMidBackfillState(m) {
  if (!m || m.type !== 'video') return false
  const key = cosKeyFromPublicUrl(m.url)
  if (!key || !isMp4Like(key)) return false
  return !!(m.videoUrl || m.isLongVideo)
}

async function patchMediaList(docId, nextList) {
  await db.collection(COLLECTION).doc(docId).update({
    data: { mediaList: nextList, updatedAt: Date.now() }
  })
}

/** 中间态 → 终态：预览就绪后转普通可播视频（保留 wasLongVideo 供公众号成稿标注） */
async function finalizeMidStates(cos, docs, summary) {
  for (const doc of docs) {
    const list = Array.isArray(doc.mediaList) ? doc.mediaList : []
    let changed = false
    const nextList = []
    for (const m of list) {
      if (!isMidBackfillState(m)) {
        nextList.push(m)
        continue
      }
      const sourceKey = cosKeyFromPublicUrl(m.url)
      const previewKey = eventPreviewKey(sourceKey)
      const ready = await headExists(cos, previewKey)
      if (ready) {
        const next = { ...m, previewUrl: `${COS_BASE_URL}${encodeURI(previewKey)}` }
        if (m.isLongVideo) next.wasLongVideo = true
        delete next.videoUrl
        delete next.isLongVideo
        delete next.cosFetchTries
        delete next.cosFetchError
        delete next.previewTries
        nextList.push(next)
        changed = true
        summary.finalized++
        console.log(`[Backfill] 预览就绪，转普通视频: ${doc._id} ${previewKey}`)
        continue
      }
      const tries = Number(m.previewTries || 0) + 1
      const next = { ...m, previewTries: tries }
      if (tries >= 3) {
        try {
          await submitPreviewJob(cos, sourceKey, previewKey)
          next.previewTries = 0
          summary.previewJobs++
          console.log(`[Backfill] 预览 ${tries} 轮未就绪，重新提交转码: ${sourceKey}`)
        } catch (e) {
          console.warn('[Backfill] 重提预览转码失败:', e.message || e)
        }
      }
      nextList.push(next)
      changed = true
    }
    if (changed) {
      try {
        await patchMediaList(doc._id, nextList)
        doc.mediaList = nextList
      } catch (e) {
        console.warn(`[Backfill] 更新事件失败 ${doc._id}:`, e.message)
      }
    }
  }
}

/** 状态 A：下载直链 → COS 原片 → 提交预览转码（每次调用最多处理 maxDownloads 条） */
async function backfillOriginals(cos, docs, summary, maxDownloads) {
  let downloads = 0
  for (const doc of docs) {
    if (downloads >= maxDownloads) break
    const list = Array.isArray(doc.mediaList) ? doc.mediaList : []
    let changed = false
    const nextList = list.slice()
    for (let i = 0; i < nextList.length; i++) {
      if (downloads >= maxDownloads) break
      const m = nextList[i]
      if (!needsCosBackfill(m)) continue
      const tries = Number(m.cosFetchTries || 0)
      if (tries >= MAX_FETCH_TRIES) continue

      const directUrl = String(m.videoUrl || '').trim()
      if (!directUrl || !isMp4Like(directUrl)) {
        nextList[i] = { ...m, cosFetchTries: MAX_FETCH_TRIES, cosFetchError: '无 mp4 直链，无法回填' }
        changed = true
        summary.skipped++
        continue
      }

      const folder = deriveCosFolder(list)
      const baseId = String(doc.tweetId || doc._id || Date.now())
      const key = `${folder}/${baseId}_video_bf${i}.mp4`
      const cosUrl = `${COS_BASE_URL}${encodeURI(key)}`
      const tmpFile = path.join(os.tmpdir(), `bf_${baseId}_${i}.mp4`)

      try {
        if (await headExists(cos, key)) {
          // 上轮已传成功但事件补写失败：直接挂链，不占本轮下载名额
          console.log(`[Backfill] 原片已在 COS（上轮补写失败），直接挂链: ${key}`)
        } else {
          downloads++
          const downloadUrl = WORKER_PROXY_URL
            ? `${WORKER_PROXY_URL}/image?url=${encodeURIComponent(directUrl)}`
            : directUrl
          const t0 = Date.now()
          const size = await downloadToFile(downloadUrl, tmpFile)
          console.log(
            `[Backfill] 下载完成 ${(size / 1048576).toFixed(1)}MB (${Math.round((Date.now() - t0) / 1000)}s): ${directUrl}`
          )
          await uploadFileToCos(cos, key, tmpFile)
          console.log(`[Backfill] 原片上传 COS: ${key}`)
        }
        try {
          const previewKey = eventPreviewKey(key)
          if (!(await headExists(cos, previewKey))) {
            await submitPreviewJob(cos, key, previewKey)
            summary.previewJobs++
            console.log(`[Backfill] 已提交预览转码: ${key} -> ${previewKey}`)
          }
        } catch (e) {
          console.warn('[Backfill] 提交预览转码失败（下轮重试）:', e.message || e)
        }
        // 保留 videoUrl / isLongVideo：预览就绪前小程序维持「复制链接」，就绪后 finalize 摘除
        nextList[i] = { ...m, url: cosUrl, previewTries: 0, cosFetchError: '' }
        summary.uploaded++
        changed = true
      } catch (e) {
        const msg = String(e.message || e).slice(0, 120)
        nextList[i] = { ...m, cosFetchTries: tries + 1, cosFetchError: msg }
        summary.failed++
        changed = true
        console.warn(`[Backfill] 回填失败（第 ${tries + 1} 次）${doc._id}#${i}:`, msg)
      } finally {
        try { fs.unlinkSync(tmpFile) } catch (e) {}
      }
    }
    if (changed) {
      try {
        await patchMediaList(doc._id, nextList)
      } catch (e) {
        console.warn(`[Backfill] 更新事件失败 ${doc._id}:`, e.message)
      }
    }
  }
}

exports.main = async (event = {}) => {
  const summary = { scanned: 0, uploaded: 0, finalized: 0, previewJobs: 0, failed: 0, skipped: 0 }
  const maxDownloads = Math.max(1, Math.min(3, Number(event.maxDownloads) || 1))
  try {
    const res = await db
      .collection(COLLECTION)
      .where({ status: 'published' })
      .orderBy('publishedAt', 'desc')
      .limit(SCAN_EVENTS)
      .field({ _id: true, tweetId: true, mediaList: true })
      .get()
    const docs = (res.data || []).filter(
      (d) => Array.isArray(d.mediaList) && d.mediaList.some((m) => m && m.type === 'video')
    )
    summary.scanned = docs.length

    const cos = createCOSClient()
    // 先做轻量的预览终态收敛，再做重量级下载（保证 800s 预算主要留给下载）
    await finalizeMidStates(cos, docs, summary)
    await backfillOriginals(cos, docs, summary, maxDownloads)

    console.log('[Backfill] done', JSON.stringify(summary))
    return { code: 0, data: summary }
  } catch (e) {
    console.error('[Backfill] fatal:', e)
    return { code: 5000, message: e.message || String(e), data: summary }
  }
}

/** 仅供本地冒烟脚本测试纯函数（生产不引用） */
exports._internal = {
  cosKeyFromPublicUrl,
  isMp4Like,
  eventPreviewKey,
  deriveCosFolder,
  needsCosBackfill,
  isMidBackfillState,
  looksLikeMp4Head
}
