// subpackages/news-extra/utils/api-news.js — articles & events (moved out of main package)
const {
  request,
  getCacheKey,
  unwrapCacheData
} = require('../../../utils/api-request.js')
const { emptyListResult } = require('../../../utils/api-booster-extract.js')
const { pickLocalized, zhField } = require('../../../utils/locale.js')
const {
  translateEventType,
  translateDatePrecision,
  translateLocation
} = require('../../../utils/space-terms-i18n.js')

/**
 * Spaceflight News（云缓存 / 直连）按固定 offset 截取一页，sliceLimit 为条数
 */
function manualNewsDocToFormattedItem(doc) {
  if (!doc || !doc._id) return null
  let publishedAt = doc.publishedAt || doc.date || ''
  if (!publishedAt && doc.updatedAt) {
    publishedAt = new Date(doc.updatedAt).toISOString()
  }
  if (!publishedAt) {
    publishedAt = new Date().toISOString()
  }
  const authorName = (doc.author && String(doc.author).trim())
    ? String(doc.author).trim()
    : '火星探索日志'
  return {
    id: `manual_${doc._id}`,
    title: doc.title || '无标题',
    summary: doc.summary || '',
    author: authorName,
    newsSite: doc.newsSite || '官方',
    publishedAt,
    image: doc.image || '',
    url: doc.url || '',
    type: 'article',
    content: doc.content || '',
    isManual: true
  }
}

async function fetchSpaceflightArticlesSlice(apiOffset, sliceLimit) {
  const offset = apiOffset
  const limit = sliceLimit

  if (!wx.cloud || !wx.cloud.database) {
    throw new Error('云开发未初始化')
  }
  if (!limit || limit < 1) {
    return { list: [], total: 0, page: 1, limit: 0, hasMore: false }
  }

  const db = wx.cloud.database()

  const exactCacheKey = getCacheKey('/articles/', { format: 'json', limit, offset, ordering: '-published_at' })

  let exactData = null
  try {
    const docResult = await Promise.race([
      db.collection('space_devs_cache').doc(exactCacheKey).get(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('数据库查询超时')), 5000)
      )
    ])

    if (docResult.data && docResult.data.data) {
      const docData = docResult.data.data
      const now = Date.now()

      if (!docData.expireAt || now <= docData.expireAt) {
        let apiData = docData.data

        apiData = unwrapCacheData(apiData)

        if (apiData && apiData.results && Array.isArray(apiData.results)) {
          exactData = apiData
        }
      }
    }
  } catch (error) {}

  const pageNum = Math.floor(offset / limit) + 1
  if (exactData) {
    return formatArticlesData(exactData, pageNum, limit)
  }

  const similarParams = { format: 'json', limit: 100, offset: 0, ordering: '-published_at' }
  const similarKey = getCacheKey('/articles/', similarParams)

  try {
    const similarResult = await Promise.race([
      db.collection('space_devs_cache').doc(similarKey).get(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('数据库查询超时')), 5000)
      )
    ])

    if (similarResult.data && similarResult.data.data) {
      const similarDocData = similarResult.data.data
      const now = Date.now()

      if (!similarDocData.expireAt || now <= similarDocData.expireAt) {
        let similarApiData = null

        if (similarDocData.data) {
          similarApiData = similarDocData.data
        } else if (similarDocData.results && Array.isArray(similarDocData.results)) {
          similarApiData = similarDocData
        } else {
          for (const key in similarDocData) {
            if (key !== 'timestamp' && key !== 'expireAt' && key !== 'updatedAt') {
              const value = similarDocData[key]
              if (value && typeof value === 'object' && value.results && Array.isArray(value.results)) {
                similarApiData = value
                break
              }
            }
          }
        }

        if (similarApiData && typeof similarApiData === 'object' && !Array.isArray(similarApiData)) {
          if (!similarApiData.results && similarApiData.data && typeof similarApiData.data === 'object') {
            if (similarApiData.data.results && Array.isArray(similarApiData.data.results)) {
              similarApiData = similarApiData.data
            }
          }
        }

        if (similarApiData && similarApiData.results && Array.isArray(similarApiData.results)) {
          const startIndex = offset
          const endIndex = offset + limit
          const totalAvailable = similarApiData.results.length
          const limitedResults = similarApiData.results.slice(startIndex, endIndex)

          const hasMore = endIndex < totalAvailable || similarApiData.next !== null

          const limitedData = {
            ...similarApiData,
            results: limitedResults,
            count: similarApiData.count || totalAvailable,
            next: hasMore ? (similarApiData.next || 'has_more') : null
          }

          return formatArticlesData(limitedData, pageNum, limit)
        }
      }
    }
  } catch (error) {
    try {
      const fallbackParams = { format: 'json', limit: 20, offset: 0, ordering: '-published_at' }
      const fallbackKey = getCacheKey('/articles/', fallbackParams)

      const fallbackResult = await Promise.race([
        db.collection('space_devs_cache').doc(fallbackKey).get(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('数据库查询超时')), 5000)
        )
      ])

      if (fallbackResult.data && fallbackResult.data.data) {
        const fallbackDocData = fallbackResult.data.data
        const now = Date.now()

        if (!fallbackDocData.expireAt || now <= fallbackDocData.expireAt) {
          let fallbackApiData = fallbackDocData.data || fallbackDocData

          if (fallbackApiData && typeof fallbackApiData === 'object' && !Array.isArray(fallbackApiData)) {
            if (fallbackApiData.data && fallbackApiData.data.results && Array.isArray(fallbackApiData.data.results)) {
              fallbackApiData = fallbackApiData.data
            }
          }

          if (fallbackApiData && fallbackApiData.results && Array.isArray(fallbackApiData.results)) {
            const startIndex = offset
            const endIndex = offset + limit
            const limitedResults = fallbackApiData.results.slice(startIndex, endIndex)

            const limitedData = {
              ...fallbackApiData,
              results: limitedResults,
              count: fallbackApiData.count || fallbackApiData.results.length,
              next: endIndex < fallbackApiData.results.length ? (fallbackApiData.next || 'has_more') : null
            }

            return formatArticlesData(limitedData, pageNum, limit)
          }
        }
      }
    } catch (fallbackError) {}
  }

  try {
    const directApiData = await new Promise((resolve, reject) => {
      wx.request({
        url: 'https://api.spaceflightnewsapi.net/v4/articles/',
        method: 'GET',
        data: {
          format: 'json',
          limit,
          offset,
          ordering: '-published_at'
        },
        timeout: 8000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
            resolve(res.data)
          } else {
            reject(new Error(`事件API请求失败: ${res.statusCode}`))
          }
        },
        fail: (err) => {
          reject(new Error(err.errMsg || '事件API请求失败'))
        }
      })
    })

    if (directApiData && directApiData.results && Array.isArray(directApiData.results)) {
      return formatArticlesData(directApiData, pageNum, limit)
    }
  } catch (directError) {}

  throw new Error('数据库中没有找到文章数据')
}

const NEWS_MANUAL_GLOBAL_DOC = 'news_manual_config'
const NEWS_MANUAL_MAX = 30

/** 供 news 页清理旧版合并缓存时调用（当前 getArticlesList 无模块级缓存） */
function invalidateArticlesMergeCache() {}

const USER_DATA_CLOUD_FN = 'userDataGateway'

/** 通过云函数服务端读手写稿（绕开小程序端数据库读权限限制） */
async function fetchNewsManualBundleViaCloud() {
  if (!wx.cloud || !wx.cloud.callFunction) return null
  try {
    const res = await wx.cloud.callFunction({
      name: USER_DATA_CLOUD_FN,
      data: { action: 'getNewsManualForApp' },
      timeout: 12000
    })
    const r = (res && res.result) || {}
    if (r.success !== true) return null
    return {
      enabled: r.enabled === true,
      docs: Array.isArray(r.items) ? r.items : []
    }
  } catch (e) {
    return null
  }
}

async function fetchNewsManualDetailViaCloud(docIdWithoutPrefix) {
  if (!wx.cloud || !wx.cloud.callFunction || !docIdWithoutPrefix) return null
  try {
    const res = await wx.cloud.callFunction({
      name: USER_DATA_CLOUD_FN,
      data: { action: 'getNewsManualArticleById', docId: docIdWithoutPrefix },
      timeout: 12000
    })
    const r = (res && res.result) || {}
    if (r.success !== true || !r.item) return null
    return r.item
  } catch (e) {
    return null
  }
}

async function fetchNewsManualEnabled() {
  if (!wx.cloud || !wx.cloud.database) return false
  try {
    const db = wx.cloud.database()
    try {
      const mainRes = await db.collection('global_config').doc('main').get()
      const m = mainRes.data
      if (m && Object.prototype.hasOwnProperty.call(m, 'newsManualArticlesEnabled')) {
        return m.newsManualArticlesEnabled === true
      }
    } catch (e) {}

    const res = await db.collection('global_config').doc(NEWS_MANUAL_GLOBAL_DOC).get()
    return !!(res.data && res.data.enabled === true)
  } catch (e) {
    return false
  }
}

async function fetchPublishedManualNewsDocs(maxN) {
  if (!wx.cloud || !wx.cloud.database) return []
  const db = wx.cloud.database()
  const cap = Math.max(1, Math.min(Number(maxN) || NEWS_MANUAL_MAX, 50))

  function sortManualDocs(rows) {
    const arr = (rows || []).slice()
    arr.sort((a, b) => {
      const w = (Number(b.weight) || 0) - (Number(a.weight) || 0)
      if (w !== 0) return w
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
    })
    return arr.slice(0, cap)
  }

  try {
    const res = await db.collection('news_articles')
      .where({ published: true })
      .orderBy('weight', 'desc')
      .orderBy('updatedAt', 'desc')
      .limit(cap)
      .get()
    return res.data || []
  } catch (e) {
    try {
      const res2 = await db.collection('news_articles')
        .where({ published: true })
        .orderBy('weight', 'desc')
        .limit(cap)
        .get()
      return res2.data || []
    } catch (e2) {
      try {
        // 未建立复合索引时，退化为不按字段排序查询后在前端排序
        const res3 = await db.collection('news_articles')
          .where({ published: true })
          .limit(cap)
          .get()
        return sortManualDocs(res3.data || [])
      } catch (e3) {
        if (typeof __wxConfig !== 'undefined' && __wxConfig && __wxConfig.debug) {
          console.warn('[getArticlesList] news_articles 查询失败（多为数据库权限或未建索引）:', e && e.message, e2 && e2.message, e3 && e3.message)
        }
        return []
      }
    }
  }
}

/**
 * 获取文章列表（直接查询云数据库 + 可选合并后台 news_articles）
 * @param {Number} page 页码（从1开始）
 * @param {Number} limit 每页数量
 * @returns {Promise} 返回事件列表
 */
async function getArticlesList(page = 1, limit = 10) {
  const pageN = Math.max(1, Number(page) || 1)
  const pageSize = Math.max(1, Number(limit) || 10)

  try {
    if (!wx.cloud || !wx.cloud.database) {
      throw new Error('云开发未初始化')
    }

    let manualEnabled = false
    let manualDocs = []

    const cloudBundle = await fetchNewsManualBundleViaCloud()
    if (cloudBundle != null) {
      manualEnabled = cloudBundle.enabled
      manualDocs = cloudBundle.docs || []
    } else {
      try {
        manualEnabled = await fetchNewsManualEnabled()
      } catch (e) {
        manualEnabled = false
      }
      if (manualEnabled && pageN === 1) {
        manualDocs = await fetchPublishedManualNewsDocs(NEWS_MANUAL_MAX)
      }
    }

    let manualItems = []
    let pinsOnPage1 = 0

    if (manualEnabled && pageN === 1) {
      manualItems = manualDocs.map(manualNewsDocToFormattedItem).filter(Boolean)
      pinsOnPage1 = Math.min(manualItems.length, NEWS_MANUAL_MAX, pageSize)
    }

    const apiTake = pageN === 1 ? Math.max(0, pageSize - pinsOnPage1) : pageSize
    const apiOffset = pageN === 1 ? 0 : (pageN - 1) * pageSize - pinsOnPage1

    let apiResult = { list: [], hasMore: false, page: pageN, limit: pageSize }

    if (apiTake > 0 && apiOffset >= 0) {
      apiResult = await fetchSpaceflightArticlesSlice(apiOffset, apiTake)
    } else if (apiTake === 0 && pageN === 1 && manualEnabled && pinsOnPage1 > 0) {
      const probe = await fetchSpaceflightArticlesSlice(0, 1)
      apiResult = {
        list: [],
        hasMore: probe.hasMore || (probe.list && probe.list.length > 0),
        page: pageN,
        limit: pageSize
      }
    }

    const mergedList = pageN === 1 && pinsOnPage1 > 0
      ? manualItems.slice(0, pinsOnPage1).concat(apiResult.list || [])
      : (apiResult.list || [])

    const hasMore = !!apiResult.hasMore

    return {
      list: mergedList,
      total: (apiResult.total || 0) + (pageN === 1 ? pinsOnPage1 : 0),
      page: pageN,
      limit: pageSize,
      hasMore
    }
  } catch (error) {
    throw {
      errMsg: error.message || '数据暂不可用，请稍后再试',
      statusCode: 404,
      type: 'database_error',
      retryable: false
    }
  }
}

function formatArticleItem(article) {
  const authorName = article.authors && article.authors.length > 0
    ? article.authors[0].name
    : '未知作者'

  return {
    id: article.id,
    // 默认展示英文原文，预翻译中文随数据带下去，由页面"翻译"按钮本地切换
    title: article.title || '无标题',
    titleZh: zhField(article, 'title'),
    summary: article.summary || '',
    summaryZh: zhField(article, 'summary'),
    author: authorName,
    newsSite: article.news_site || '',
    publishedAt: article.published_at,
    image: article.image_url || '',
    url: article.url || '',
    type: 'article'
  }
}

function formatEventItem(event) {
  const mainInfoUrl = event.info_urls && event.info_urls.length > 0
    ? event.info_urls[0].url
    : ''

  const videoUrl = event.vid_urls && event.vid_urls.length > 0
    ? event.vid_urls[0].url
    : ''

  const imageUrl = event.image
    ? (event.image.image_url || event.image.thumbnail_url || '')
    : (event.feature_image || '')

  // 列表卡片专用小图：LL2 image 对象自带 ~350px 缩略图，避免列表加载数 MB 原图；
  // image 字段保持大图供详情页使用
  const listImageUrl = event.image
    ? (event.image.thumbnail_url || event.image.image_url || '')
    : (event.feature_image || '')

  const typeEn = (event.type && event.type.name) || '未知类型'
  const typeZh = (event.type && zhField(event.type, 'name')) || translateEventType(typeEn)
  const datePrecisionEn = (event.date_precision && event.date_precision.name) || ''
  const datePrecisionZh = (event.date_precision && zhField(event.date_precision, 'name')) || translateDatePrecision(datePrecisionEn)
  const locationEn = event.location || ''
  const locationZh = zhField(event, 'location') || translateLocation(locationEn)

  return {
    id: event.id,
    // 标题/描述默认英文原文（页面翻译按钮切换）；类型/地点等词典字段恒中文
    title: event.name || '无标题事件',
    titleZh: zhField(event, 'name'),
    description: event.description || '',
    descriptionZh: zhField(event, 'description'),
    date: event.date,
    datePrecision: pickLocalized(datePrecisionZh, datePrecisionEn),
    type: pickLocalized(typeZh, typeEn),
    location: pickLocalized(locationZh, locationEn),
    image: imageUrl,
    listImage: listImageUrl,
    infoUrls: event.info_urls || [],
    videoUrls: event.vid_urls || [],
    mainInfoUrl: mainInfoUrl,
    videoUrl: videoUrl,
    webcastLive: event.webcast_live || false,
    slug: event.slug || '',
    url: event.url || ''
  }
}

async function getArticleDetail(articleId) {
  if (articleId == null || articleId === '') {
    throw new Error('文章ID不能为空')
  }

  const id = String(articleId).trim()

  if (id.startsWith('manual_')) {
    if (!wx.cloud) {
      throw new Error('云开发未初始化')
    }
    const docIdRaw = id.replace(/^manual_/, '').trim()

    const cloudDoc = await fetchNewsManualDetailViaCloud(docIdRaw)
    if (cloudDoc && cloudDoc._id) {
      const item = manualNewsDocToFormattedItem(cloudDoc)
      if (!item) throw new Error('文章详情暂不可用')
      return item
    }

    if (!wx.cloud.database) throw new Error('云开发未初始化')
    const enabled = await fetchNewsManualEnabled()
    if (!enabled) {
      throw new Error('内容暂不可用')
    }
    const docRes = await wx.cloud.database().collection('news_articles').doc(docIdRaw).get()
    const doc = docRes.data
    if (!doc || !doc.published) {
      throw new Error('文章不存在或未发布')
    }
    const item = manualNewsDocToFormattedItem(doc)
    if (!item) throw new Error('文章详情暂不可用')
    return item
  }

  try {
    const directApiData = await new Promise((resolve, reject) => {
      wx.request({
        url: `https://api.spaceflightnewsapi.net/v4/articles/${encodeURIComponent(id)}/`,
        method: 'GET',
        timeout: 8000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
            resolve(res.data)
          } else {
            reject(new Error(`文章详情请求失败: ${res.statusCode}`))
          }
        },
        fail: (err) => {
          reject(new Error(err.errMsg || '文章详情请求失败'))
        }
      })
    })

    if (directApiData && directApiData.id != null) {
      return formatArticleItem(directApiData)
    }
  } catch (error) {}

  const fallback = await getArticlesList(1, 50)
  const article = (fallback.list || []).find((item) => String(item.id) === id)
  if (article) return article

  throw new Error('文章详情暂不可用')
}

async function getEventDetail(eventId) {
  if (eventId == null || eventId === '') {
    throw new Error('事件ID不能为空')
  }

  const id = String(eventId).trim()

  try {
    const directData = await request(`/event/${encodeURIComponent(id)}/`, {}, 8000, true)
    if (directData && directData.id != null) {
      return formatEventItem(directData)
    }
  } catch (error) {}

  try {
    const legacyData = await request(`/events/${encodeURIComponent(id)}/`, {}, 8000, true)
    if (legacyData && legacyData.id != null) {
      return formatEventItem(legacyData)
    }
  } catch (error) {}

  const fallback = await getEventsList(1, 50)
  const event = (fallback.list || []).find((item) => String(item.id) === id)
  if (event) return event

  throw new Error('事件详情暂不可用')
}

/**
 * 格式化文章数据
 * @param {Object} data API返回的原始数据
 * @param {Number} page 页码
 * @param {Number} limit 每页数量
 * @returns {Object|null} 格式化后的文章列表数据
 */
function formatArticlesData(data, page, limit) {
  if (!data || !data.results) {
    return {
      list: [],
      total: 0,
      page: page,
      limit: limit,
      hasMore: false
    }
  }

  const articlesList = data.results.map(formatArticleItem)
  
  return {
    list: articlesList,
    total: data.count || articlesList.length,
    page: page,
    limit: limit,
    hasMore: data.next !== null
  }
}

/**
 * 获取事件列表（直接查询云数据库）
 * @param {Number} page 页码（从1开始）
 * @param {Number} limit 每页数量
 * @returns {Promise} 返回事件列表
 */
async function getEventsList(page = 1, limit = 10) {
  const offset = (page - 1) * limit
  
  try {
    // 检查云开发是否已初始化
    if (!wx.cloud || !wx.cloud.database) {
      throw new Error('云开发未初始化')
    }
    
    const db = wx.cloud.database()
    
    // 云函数保存事件数据时使用的参数是 { limit: 100, offset: 0 }（启用分页，最多200条）
    // 优先尝试 limit=100，如果失败再尝试 limit=10
    let similarParams = { limit: 100, offset: 0 }
    let similarKey = getCacheKey('/events/upcoming/', similarParams)
    
    // 尝试查询精确匹配的记录（使用云函数保存的参数格式）
    let exactData = null
    try {
      const docResult = await Promise.race([
        db.collection('space_devs_cache').doc(similarKey).get(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('数据库查询超时')), 5000)
        )
      ])
      
      if (docResult.data && docResult.data.data) {
        const docData = docResult.data.data
        const now = Date.now()
        
        // 检查数据是否过期
        if (!docData.expireAt || now <= docData.expireAt) {
          // 获取实际的API数据 - 尝试多种可能的数据结构
          let apiData = null
          
          // 情况1: docData.data 存在（标准结构）
          if (docData.data) {
            apiData = docData.data
          }
          // 情况2: docData 本身就是 API 数据（直接包含 results）
          else if (docData.results && Array.isArray(docData.results)) {
            apiData = docData
          }
          // 情况3: 检查是否有其他嵌套结构
          else {
            // 尝试查找 results 字段
            for (const key in docData) {
              if (key !== 'timestamp' && key !== 'expireAt' && key !== 'updatedAt') {
                const value = docData[key]
                if (value && typeof value === 'object' && value.results && Array.isArray(value.results)) {
                  apiData = value
                  break
                }
              }
            }
          }
          
          // 如果数据是嵌套结构，尝试解包
          apiData = unwrapCacheData(apiData)
          
          if (apiData && apiData.results && Array.isArray(apiData.results)) {
            exactData = apiData
          }
        }
      }
    } catch (error) {
      
      try {
        const fallbackParams = { limit: 10, offset: 0 }
        const fallbackKey = getCacheKey('/events/upcoming/', fallbackParams)
        
        const fallbackResult = await Promise.race([
          db.collection('space_devs_cache').doc(fallbackKey).get(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('数据库查询超时')), 5000)
          )
        ])
        
        if (fallbackResult.data && fallbackResult.data.data) {
          const fallbackDocData = fallbackResult.data.data
          const now = Date.now()
          
          if (!fallbackDocData.expireAt || now <= fallbackDocData.expireAt) {
            let fallbackApiData = fallbackDocData.data || fallbackDocData
            
            // 解包嵌套结构
            if (fallbackApiData && typeof fallbackApiData === 'object' && !Array.isArray(fallbackApiData)) {
              if (fallbackApiData.data && fallbackApiData.data.results && Array.isArray(fallbackApiData.data.results)) {
                fallbackApiData = fallbackApiData.data
              }
            }
            
            if (fallbackApiData && fallbackApiData.results && Array.isArray(fallbackApiData.results)) {
              exactData = fallbackApiData
            }
          }
        }
      } catch (fallbackError) {}
    }
    
    // 如果查询成功，从数据中截取所需的部分
    if (exactData && exactData.results && Array.isArray(exactData.results)) {
      // 从缓存数据中截取所需的数据
      const startIndex = offset
      const endIndex = offset + limit
      const totalAvailable = exactData.results.length
      const limitedResults = exactData.results.slice(startIndex, endIndex)
      
      // 判断是否还有更多数据
      const hasMore = endIndex < totalAvailable || exactData.next !== null
      
      const limitedData = {
        ...exactData,
        results: limitedResults,
        count: exactData.count || totalAvailable,
        next: hasMore ? (exactData.next || 'has_more') : null
      }
      
      return formatEventsData(limitedData, page, limit)
    }
    
    // 如果都找不到，返回错误
    throw new Error('数据库中没有找到事件数据')
    
  } catch (error) {
    throw {
      errMsg: error.message || '数据暂不可用，请稍后再试',
      statusCode: 404,
      type: 'database_error',
      retryable: false
    }
  }
}

/**
 * 格式化事件数据
 * @param {Object} data API返回的原始数据
 * @param {Number} page 页码
 * @param {Number} limit 每页数量
 * @returns {Object|null} 格式化后的事件列表数据
 */
function formatEventsData(data, page, limit) {
  if (!data || !data.results) {
    return {
      list: [],
      total: 0,
      page: page,
      limit: limit,
      hasMore: false
    }
  }

  const newsList = data.results.map(formatEventItem)
  
  return {
    list: newsList,
    total: data.count || newsList.length,
    page: page,
    limit: limit,
    hasMore: data.next !== null
  }
}

module.exports = {
  getArticlesList,
  invalidateArticlesMergeCache,
  getArticleDetail,
  getEventDetail,
  getEventsList,
  manualNewsDocToFormattedItem
}
