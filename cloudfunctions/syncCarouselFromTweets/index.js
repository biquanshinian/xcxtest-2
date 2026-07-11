/**
 * 扫描 COS 推文视频文件夹，自动同步视频到轮播图。
 * - 扫描所有推文账号的 COS 文件夹，筛选 .mp4 视频
 * - 写入 media_assets 集合，sourceTag = 'auto-carousel'，key 前缀 '首页轮播图/auto/'
 * - 大视频（> PREVIEW_MIN_BYTES）提交万象转码，生成轮播专用压缩预览版
 * - 自动轮播总数超过 MAX_AUTO_CAROUSEL 条时，按 cosSyncedAt 升序删除最旧的自动数据
 * - 仅管理 sourceTag = 'auto-carousel' 的记录，不触碰手动数据
 *
 * 触发：定时器（每 30 分钟）或后台管理手动调用
 */
const cloud = require('wx-server-sdk')
const COS = require('cos-nodejs-sdk-v5')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION = 'media_assets'
const SOURCE_TAG = 'auto-carousel'
const CAROUSEL_KEY_PREFIX = '首页轮播图/'
const AUTO_KEY_PREFIX = '首页轮播图/auto/'
const PREVIEW_KEY_PREFIX = '首页轮播图/preview/'
const MAX_AUTO_CAROUSEL = 10
/** 超过此大小才生成压缩预览（轮播内联播放用） */
const PREVIEW_MIN_BYTES = 1.5 * 1024 * 1024
/** 预览片最长秒数（轮播只需短片段） */
const PREVIEW_DURATION_SEC = 20
/** 预览宽度 / 码率 */
const PREVIEW_WIDTH = 720
const PREVIEW_BITRATE = 800

const COS_BUCKET = 'mars-1397421562'
const COS_REGION = 'ap-guangzhou'
const COS_BASE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/'

// 与 syncSpaceXTweets 中的账号文件夹保持一致
const TWEET_VIDEO_FOLDERS = [
  'SpaceX推文图片',
  'Starlink推文图片',
  'NSF推文图片',
  'StarshipGazer推文图片',
  'NASA推文图片'
]

function createCOSClient() {
  return new COS({
    SecretId: process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.TENCENTCLOUD_SESSIONTOKEN
  })
}

function isVideoKey(key) {
  return /\.(mp4|mov|webm)$/i.test(key)
}

function publicUrlForCosKey(key) {
  if (!key) return ''
  return `${COS_BASE_URL.replace(/\/$/, '')}/${encodeURI(key)}`
}

/**
 * 为视频生成万象截帧封面 URL（取第 1 秒）
 */
function videoSnapshotUrl(cosKey) {
  const base = publicUrlForCosKey(cosKey)
  if (!base) return ''
  return `${base}?ci-process=snapshot&time=1&format=jpg&width=640&height=0`
}

/**
 * 预览对象 key：首页轮播图/preview/{folder}__{filename}.mp4
 */
function toPreviewKey(cosKey) {
  const safe = String(cosKey || '')
    .replace(/^\/+/, '')
    .replace(/\//g, '__')
    .replace(/\.(mov|webm)$/i, '.mp4')
  return `${PREVIEW_KEY_PREFIX}${safe}`
}

/**
 * 从 cosKey 中提取 tweetId（文件名格式: {folder}/{tweetId}_video{index}.mp4 或 {tweetId}_{index}.ext）
 */
function extractTweetIdFromCosKey(cosKey) {
  if (!cosKey) return ''
  const filename = cosKey.split('/').pop() || ''
  const match = filename.match(/^(\d+)_/)
  return match ? match[1] : ''
}

/**
 * 批量查询事件更新，根据 tweetId 列表返回 { tweetId -> { _id, content, title } }
 */
async function batchLookupEventsByTweetIds(tweetIds) {
  const map = {}
  if (!tweetIds.length) return map
  const unique = [...new Set(tweetIds)].filter(Boolean)
  // 分批查询（每批 20 个）
  const batchSize = 20
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize)
    try {
      const res = await db.collection('starship_event_updates')
        .where({ tweetId: db.command.in(batch), status: 'published' })
        .field({ _id: true, tweetId: true, content: true, title: true })
        .limit(batchSize)
        .get()
      for (const doc of (res.data || [])) {
        if (doc.tweetId) {
          map[doc.tweetId] = { eventId: doc._id, content: doc.content || '', title: doc.title || '' }
        }
      }
    } catch (e) {
      console.warn(`[syncCarousel] 查询事件失败: ${e.message}`)
    }
  }
  return map
}

/**
 * 列举单个文件夹下的所有视频对象
 */
async function listVideosInFolder(cos, folder) {
  const prefix = `${folder}/`
  const videos = []
  let marker = ''

  while (true) {
    const resp = await new Promise((resolve, reject) => {
      cos.getBucket({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Prefix: prefix,
        Marker: marker,
        MaxKeys: 1000
      }, (err, data) => (err ? reject(err) : resolve(data || {})))
    })

    const contents = Array.isArray(resp.Contents) ? resp.Contents : []
    for (const obj of contents) {
      const key = (obj.Key || '').trim()
      const size = Number(obj.Size || 0)
      if (!isVideoKey(key) || size <= 0) continue
      // 跳过已生成的预览目录（若误放在推文文件夹下）
      if (key.indexOf('/preview/') >= 0) continue
      videos.push({
        cosKey: key,
        folder,
        size,
        lastModified: obj.LastModified || ''
      })
    }

    if (String(resp.IsTruncated || 'false') !== 'true') break
    marker = resp.NextMarker || (contents.length ? contents[contents.length - 1].Key : '')
    if (!marker) break
  }

  return videos
}

/**
 * 扫描所有推文文件夹的视频
 */
async function listAllTweetVideos() {
  const cos = createCOSClient()
  const all = []
  for (const folder of TWEET_VIDEO_FOLDERS) {
    try {
      const videos = await listVideosInFolder(cos, folder)
      all.push(...videos)
    } catch (e) {
      console.warn(`[syncCarousel] 扫描 ${folder} 失败: ${e.message}`)
    }
  }
  // 按最后修改时间降序，最新的排前面
  all.sort((a, b) => {
    const ta = new Date(a.lastModified || 0).getTime()
    const tb = new Date(b.lastModified || 0).getTime()
    return tb - ta
  })
  return all
}

/**
 * 加载所有 auto-carousel 记录
 */
async function loadAutoCarouselDocs() {
  const all = []
  const batch = 100
  let skip = 0
  while (true) {
    const res = await db.collection(COLLECTION)
      .where({ sourceTag: SOURCE_TAG })
      .field({
        _id: true,
        key: true,
        url: true,
        previewUrl: true,
        thumbnailUrl: true,
        sourceTag: true,
        cosSyncedAt: true,
        cosKey: true,
        previewJobAt: true
      })
      .skip(skip)
      .limit(batch)
      .get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < batch) break
    skip += batch
    if (skip > 2000) break
  }
  return all
}

/**
 * 将 COS key 转换为轮播图 key
 * 例: SpaceX推文图片/123_video0.mp4 -> 首页轮播图/auto/SpaceX推文图片/123_video0.mp4
 */
function toCarouselKey(cosKey) {
  return `${AUTO_KEY_PREFIX}${cosKey}`
}

async function promisePool(items, concurrency, iterator) {
  if (!items.length) return
  let next = 0
  const worker = async () => {
    while (true) {
      const i = next++
      if (i >= items.length) break
      await iterator(items[i], i)
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
}

function headObjectExists(cos, key) {
  return new Promise((resolve) => {
    cos.headObject({
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key
    }, (err) => {
      if (err) return resolve(false)
      resolve(true)
    })
  })
}

/**
 * 提交万象音视频转码任务：输出短时长、低码率预览 mp4（仅供轮播内联）
 * 需桶已开通媒体处理；失败时静默跳过，不影响主同步。
 */
function submitPreviewTranscodeJob(cos, inputKey, outputKey) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Tag>Transcode</Tag>
  <Input>
    <Object>${escapeXml(inputKey)}</Object>
  </Input>
  <Operation>
    <Transcode>
      <Container>
        <Format>mp4</Format>
      </Container>
      <Video>
        <Codec>H.264</Codec>
        <Profile>main</Profile>
        <Bitrate>${PREVIEW_BITRATE}</Bitrate>
        <Width>${PREVIEW_WIDTH}</Width>
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
      <TimeInterval>
        <Start>0</Start>
        <Duration>${PREVIEW_DURATION_SEC}</Duration>
      </TimeInterval>
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
    cos.request({
      Method: 'POST',
      Url: `https://${COS_BUCKET}.ci.${COS_REGION}.myqcloud.com/jobs`,
      Headers: { 'Content-Type': 'application/xml' },
      Body: body
    }, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 为单条轮播视频确保封面 + 压缩预览
 * @returns {{ previewReady: boolean, jobSubmitted: boolean, patched: boolean }}
 */
async function ensurePreviewAndThumb(cos, doc, videoMeta) {
  const result = { previewReady: false, jobSubmitted: false, patched: false }
  if (!doc || !doc._id || !doc.cosKey) return result

  const size = Number((videoMeta && videoMeta.size) || 0)
  const patch = {}
  const now = Date.now()

  if (!doc.thumbnailUrl) {
    patch.thumbnailUrl = videoSnapshotUrl(doc.cosKey)
  }

  // 小文件直接用原片作预览，无需转码
  if (size > 0 && size < PREVIEW_MIN_BYTES) {
    if (!doc.previewUrl || doc.previewUrl !== doc.url) {
      patch.previewUrl = doc.url || publicUrlForCosKey(doc.cosKey)
      result.previewReady = true
    } else {
      result.previewReady = true
    }
  } else {
    const previewKey = toPreviewKey(doc.cosKey)
    const exists = await headObjectExists(cos, previewKey)
    if (exists) {
      const previewUrl = publicUrlForCosKey(previewKey)
      if (doc.previewUrl !== previewUrl) {
        patch.previewUrl = previewUrl
      }
      result.previewReady = true
    } else {
      // 避免短时间内重复提交转码任务（30 分钟冷却）
      const lastJob = Number(doc.previewJobAt || 0)
      if (!lastJob || now - lastJob > 30 * 60 * 1000) {
        try {
          await submitPreviewTranscodeJob(cos, doc.cosKey, previewKey)
          patch.previewJobAt = now
          result.jobSubmitted = true
          console.log(`[syncCarousel] 已提交预览转码: ${doc.cosKey} -> ${previewKey}`)
        } catch (e) {
          console.warn(`[syncCarousel] 预览转码提交失败 ${doc.cosKey}: ${e.message || e}`)
        }
      }
    }
  }

  if (Object.keys(patch).length) {
    try {
      await db.collection(COLLECTION).doc(doc._id).update({ data: patch })
      result.patched = true
    } catch (e) {
      console.warn(`[syncCarousel] 更新预览字段失败 ${doc._id}: ${e.message}`)
    }
  }
  return result
}

/**
 * 核心同步逻辑
 */
async function syncAndPrune(cosVideos) {
  const cos = createCOSClient()

  // 构建 COS 视频 map（以 cosKey 为键）
  const cosMap = new Map()
  for (const v of cosVideos) {
    cosMap.set(v.cosKey, v)
  }

  // 加载现有自动轮播记录
  const existingDocs = await loadAutoCarouselDocs()
  const existingByCosKey = new Map()
  for (const doc of existingDocs) {
    if (doc.cosKey) existingByCosKey.set(doc.cosKey, doc)
  }

  let added = 0
  let removed = 0
  let previewReady = 0
  let previewJobs = 0
  let previewPatched = 0

  // 1. 删除 COS 中已不存在的视频对应的轮播记录（并尽量清理预览文件）
  const toRemove = []
  for (const doc of existingDocs) {
    if (doc.cosKey && !cosMap.has(doc.cosKey)) {
      toRemove.push(doc)
    }
  }
  await promisePool(toRemove, 10, async (doc) => {
    try {
      await db.collection(COLLECTION).doc(doc._id).remove()
      removed++
    } catch (e) {
      console.warn(`[syncCarousel] 删除记录失败 ${doc._id}: ${e.message}`)
    }
    if (doc.cosKey) {
      const previewKey = toPreviewKey(doc.cosKey)
      try {
        await new Promise((resolve) => {
          cos.deleteObject({
            Bucket: COS_BUCKET,
            Region: COS_REGION,
            Key: previewKey
          }, () => resolve())
        })
      } catch (e) {}
    }
  })

  // 2. 新增 COS 中存在但数据库中没有的视频
  const toAdd = []
  for (const [cosKey, video] of cosMap) {
    if (!existingByCosKey.has(cosKey)) {
      toAdd.push(video)
    }
  }

  // 按最新优先排序，只取前 MAX_AUTO_CAROUSEL 条新增候选
  toAdd.sort((a, b) => {
    const ta = new Date(a.lastModified || 0).getTime()
    const tb = new Date(b.lastModified || 0).getTime()
    return tb - ta
  })

  // 计算当前有效记录数（已删除的不算）
  const currentCount = existingDocs.length - toRemove.length
  const canAdd = Math.max(0, MAX_AUTO_CAROUSEL - currentCount)
  const actualToAdd = toAdd.slice(0, canAdd)

  // 批量查询关联的事件更新（获取描述文字和事件ID）
  const tweetIdsToLookup = actualToAdd.map(v => extractTweetIdFromCosKey(v.cosKey)).filter(Boolean)
  const eventMap = await batchLookupEventsByTweetIds(tweetIdsToLookup)

  await promisePool(actualToAdd, 5, async (video) => {
    const carouselKey = toCarouselKey(video.cosKey)
    const url = publicUrlForCosKey(video.cosKey)
    const thumbnailUrl = videoSnapshotUrl(video.cosKey)
    const tweetId = extractTweetIdFromCosKey(video.cosKey)
    const eventInfo = eventMap[tweetId] || {}
    const needsPreview = video.size >= PREVIEW_MIN_BYTES
    const previewKey = toPreviewKey(video.cosKey)
    let previewUrl = needsPreview ? '' : url
    let previewJobAt = 0

    if (needsPreview) {
      const exists = await headObjectExists(cos, previewKey)
      if (exists) {
        previewUrl = publicUrlForCosKey(previewKey)
      } else {
        try {
          await submitPreviewTranscodeJob(cos, video.cosKey, previewKey)
          previewJobAt = Date.now()
          previewJobs++
          console.log(`[syncCarousel] 新增并提交预览转码: ${video.cosKey}`)
        } catch (e) {
          console.warn(`[syncCarousel] 新增预览转码失败 ${video.cosKey}: ${e.message || e}`)
        }
      }
    }

    try {
      await db.collection(COLLECTION).add({
        data: {
          key: carouselKey,
          url,
          previewUrl,
          thumbnailUrl,
          type: 'video',
          sourceTag: SOURCE_TAG,
          enabled: true,
          sort: 1000, // 自动数据排在手动数据之后
          cosKey: video.cosKey,
          cosFolder: video.folder,
          cosSize: video.size,
          cosSyncedAt: Date.now(),
          createdAt: Date.now(),
          previewJobAt,
          // 关联事件数据
          tweetId: tweetId || '',
          eventId: eventInfo.eventId || '',
          caption: eventInfo.content || eventInfo.title || ''
        }
      })
      added++
      if (previewUrl) previewReady++
    } catch (e) {
      console.warn(`[syncCarousel] 新增记录失败 ${video.cosKey}: ${e.message}`)
    }
  })

  // 3. 如果自动轮播总数仍超过上限，删除最旧的
  let pruned = 0
  const afterCount = currentCount + added
  if (afterCount > MAX_AUTO_CAROUSEL) {
    const toPrune = afterCount - MAX_AUTO_CAROUSEL
    // 重新查询，按 cosSyncedAt 升序取最旧的
    const oldDocs = await db.collection(COLLECTION)
      .where({ sourceTag: SOURCE_TAG })
      .orderBy('cosSyncedAt', 'asc')
      .limit(toPrune)
      .field({ _id: true, cosKey: true })
      .get()

    await promisePool(oldDocs.data || [], 10, async (doc) => {
      try {
        await db.collection(COLLECTION).doc(doc._id).remove()
        pruned++
      } catch (e) {}
      if (doc.cosKey) {
        try {
          await new Promise((resolve) => {
            cos.deleteObject({
              Bucket: COS_BUCKET,
              Region: COS_REGION,
              Key: toPreviewKey(doc.cosKey)
            }, () => resolve())
          })
        } catch (e) {}
      }
    })
  }

  // 4. 回填存量记录的封面 / 压缩预览（下一轮同步会捡起已完成的转码）
  const keepDocs = await loadAutoCarouselDocs()
  await promisePool(keepDocs, 3, async (doc) => {
    const meta = cosMap.get(doc.cosKey) || { size: 0 }
    const r = await ensurePreviewAndThumb(cos, doc, meta)
    if (r.previewReady) previewReady++
    if (r.jobSubmitted) previewJobs++
    if (r.patched) previewPatched++
  })

  return {
    totalCosVideos: cosVideos.length,
    added,
    removed,
    pruned,
    previewReady,
    previewJobs,
    previewPatched,
    currentAutoCount: Math.min(afterCount, MAX_AUTO_CAROUSEL)
  }
}

let _syncCarouselCollectionsEnsured = false
async function ensureSyncCarouselCollectionsOnce() {
  if (_syncCarouselCollectionsEnsured) return
  _syncCarouselCollectionsEnsured = true
  for (const n of [COLLECTION, 'starship_event_updates']) {
    try {
      await db.createCollection(n)
    } catch (e) {}
  }
}

exports.main = async (event = {}) => {
  await ensureSyncCarouselCollectionsOnce()
  const from = (event && event.from) || 'timer'
  const startTime = Date.now()
  console.log('[syncCarousel] start, from:', from)
  try {
    const cosVideos = await listAllTweetVideos()

    const stats = await syncAndPrune(cosVideos)
    const elapsed = Date.now() - startTime

    console.log('[syncCarousel] done,', JSON.stringify(stats), elapsed + 'ms')
    return { ok: true, from, ...stats, elapsed }
  } catch (e) {
    return { ok: false, from, error: e.message || String(e) }
  }
}
