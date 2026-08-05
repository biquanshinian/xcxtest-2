const apiBaseEl = document.getElementById('apiBase')
const tokenEl = document.getElementById('token')
const statusEl = document.getElementById('status')
const collectBtn = document.getElementById('collect')
const collect5Btn = document.getElementById('collect5')

function setStatus(text, ok) {
  statusEl.textContent = text || ''
  statusEl.className = 'status ' + (ok ? 'ok' : 'err')
}

function setBusy(busy) {
  collectBtn.disabled = !!busy
  collect5Btn.disabled = !!busy
}

chrome.storage.sync.get(['apiBase', 'token'], (cfg) => {
  if (cfg.apiBase) apiBaseEl.value = cfg.apiBase
  if (cfg.token) tokenEl.value = cfg.token
})

document.getElementById('save').onclick = () => {
  chrome.storage.sync.set(
    { apiBase: apiBaseEl.value.trim(), token: tokenEl.value.trim() },
    () => setStatus('配置已保存', true)
  )
}

async function getConfig() {
  const cfg = await new Promise((resolve) => {
    chrome.storage.sync.get(['apiBase', 'token'], resolve)
  })
  if (!cfg.apiBase || !cfg.token) throw new Error('请先填写 API Base 与 Token')
  return cfg
}

async function postAdmin(cfg, path, body) {
  const res = await fetch(cfg.apiBase.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-oa-collector-token': cfg.token
    },
    body: JSON.stringify({
      path,
      method: 'POST',
      body,
      headers: { 'x-oa-collector-token': cfg.token }
    })
  })
  const data = await res.json()
  if (data.code !== 0) throw new Error(data.message || '请求失败')
  return data.data
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id) throw new Error('无活动标签页')
  if (!/^https:\/\/mp\.weixin\.qq\.com\//i.test(tab.url || '')) {
    throw new Error('请在 mp.weixin.qq.com 页面使用')
  }
  return tab
}

/** 单篇文章页解析 */
function scrapeCurrentArticleFn() {
  const title =
    document.querySelector('#activity-name')?.innerText?.trim() ||
    document.title ||
    ''
  const accountName =
    document.querySelector('#js_name')?.innerText?.trim() ||
    document.querySelector('.profile_nickname')?.innerText?.trim() ||
    ''
  const contentNode = document.querySelector('#js_content')
  const content = contentNode ? contentNode.innerText.trim() : ''
  const reads =
    Number(
      (document.querySelector('#readNum') || document.querySelector('.js_read_num') || {})
        .innerText || 0
    ) || 0
  const likes =
    Number(
      (document.querySelector('#likeNum') || document.querySelector('.js_like_num') || {})
        .innerText || 0
    ) || 0
  const images = []
  if (contentNode) {
    contentNode.querySelectorAll('img').forEach((img) => {
      const u = (img.getAttribute('data-src') || img.getAttribute('data-original') || img.src || '').trim()
      if (!u || u.startsWith('data:')) return
      if (/emoji|icon|avatar|logo|spacer|blank|pixel/i.test(u)) return
      if (!images.includes(u)) images.push(u)
    })
  }
  const coverUrl = images[0] || ''
  const bizMatch = location.href.match(/[?&]__biz=([^&]+)/)
  return {
    title,
    accountName,
    content,
    reads,
    likes,
    coverUrl,
    images: images.slice(0, 8),
    url: location.href,
    accountBiz: bizMatch ? decodeURIComponent(bizMatch[1]) : ''
  }
}

/** 历史消息页：取最新 N 条链接并抓正文 */
async function scrapeLatestFiveFn(limit) {
  const n = Math.min(10, Math.max(1, Number(limit) || 5))
  const seen = new Set()
  const links = []

  const pushLink = (title, href, cover, publishedAt) => {
    if (!href) return
    let url = href
    try {
      url = new URL(href, location.href).toString()
    } catch (e) {}
    if (!/mp\.weixin\.qq\.com\/s/.test(url) && !/\/s\?/.test(url)) return
    const key = url.split('#')[0]
    if (seen.has(key)) return
    seen.add(key)
    links.push({
      title: (title || '').trim(),
      url: key,
      coverUrl: cover || '',
      publishedAt: publishedAt || ''
    })
  }

  try {
    const html = document.documentElement.innerHTML
    const m =
      html.match(/msgList\s*=\s*(\{[\s\S]*?\})\s*\.msg_list/) ||
      html.match(/var\s+msgList\s*=\s*(\{[\s\S]*?\});/)
    if (m && m[1]) {
      const parsed = JSON.parse(m[1])
      const list = parsed.list || parsed.msg_list || []
      for (const item of list) {
        const apps = (item.app_msg_ext_info && [item.app_msg_ext_info]) || []
        const multi =
          (item.app_msg_ext_info && item.app_msg_ext_info.multi_app_msg_item_list) || []
        for (const app of [...apps, ...multi]) {
          if (!app || !app.content_url) continue
          pushLink(
            app.title,
            (app.content_url || '').replace(/&amp;/g, '&'),
            app.cover || app.cover_url || '',
            item.comm_msg_info && item.comm_msg_info.datetime
              ? String(item.comm_msg_info.datetime)
              : ''
          )
        }
      }
    }
  } catch (e) {}

  if (links.length < n) {
    document.querySelectorAll('a[href*="/s?"], a[href*="mp.weixin.qq.com/s"]').forEach((a) => {
      const title =
        a.getAttribute('title') ||
        a.querySelector('.weui_media_title, .js_title, h4, strong')?.innerText ||
        a.innerText
      const img = a.querySelector('img')
      pushLink(title, a.href, img ? img.getAttribute('data-src') || img.src : '', '')
    })
  }

  const accountName =
    document.querySelector('#js_name')?.innerText?.trim() ||
    document.querySelector('.profile_nickname')?.innerText?.trim() ||
    document.querySelector('.nickname')?.innerText?.trim() ||
    ''
  const bizMatch =
    location.href.match(/[?&]__biz=([^&]+)/) ||
    (links[0] && links[0].url.match(/[?&]__biz=([^&]+)/))
  const accountBiz = bizMatch ? decodeURIComponent(bizMatch[1]) : ''

  const isArticlePage = !!(
    document.querySelector('#js_content') && document.querySelector('#activity-name')
  )
  const isHistoryLike =
    /profile_ext|getappmsgext|history/i.test(location.href) ||
    links.length >= 2 ||
    !!document.querySelector('.weui_msg_card, .history, #js_history_list')

  if (isArticlePage && !isHistoryLike && links.length < 2) {
    return {
      error:
        '当前是单篇文章页。请先打开该公众号「历史消息」页，再用本按钮采集最新 5 篇；或点「采集当前文章」。',
      accountName,
      accountBiz,
      articles: []
    }
  }

  const picked = links.slice(0, n)
  if (!picked.length) {
    return {
      error: '未解析到文章列表，请确认已打开「查看历史消息」页面并滚动加载出文章。',
      accountName,
      accountBiz,
      articles: []
    }
  }

  const articles = []
  for (const it of picked) {
    try {
      const res = await fetch(it.url, { credentials: 'include' })
      const html = await res.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const title =
        doc.querySelector('#activity-name')?.innerText?.trim() || it.title || ''
      const contentNode = doc.querySelector('#js_content')
      const content = contentNode?.innerText?.trim() || ''
      const images = []
      if (contentNode) {
        contentNode.querySelectorAll('img').forEach((img) => {
          const u = (
            img.getAttribute('data-src') ||
            img.getAttribute('data-original') ||
            img.src ||
            ''
          ).trim()
          if (!u || u.startsWith('data:')) return
          if (/emoji|icon|avatar|logo|spacer|blank|pixel/i.test(u)) return
          if (!images.includes(u)) images.push(u)
        })
      }
      const name = doc.querySelector('#js_name')?.innerText?.trim() || accountName
      const reads =
        Number(
          (doc.querySelector('#readNum') || doc.querySelector('.js_read_num') || {})
            .innerText || 0
        ) || 0
      const likes =
        Number(
          (doc.querySelector('#likeNum') || doc.querySelector('.js_like_num') || {})
            .innerText || 0
        ) || 0
      const coverUrl = it.coverUrl || images[0] || ''
      const biz = (it.url.match(/[?&]__biz=([^&]+)/) || [])[1] || accountBiz
      articles.push({
        title,
        content,
        url: it.url,
        coverUrl,
        images: images.slice(0, 8),
        reads,
        likes,
        publishedAt: it.publishedAt,
        accountName: name,
        accountBiz: biz ? decodeURIComponent(biz) : accountBiz
      })
    } catch (e) {
      articles.push({
        title: it.title,
        content: '',
        url: it.url,
        coverUrl: it.coverUrl,
        publishedAt: it.publishedAt,
        accountName,
        accountBiz,
        error: e.message || String(e)
      })
    }
  }
  return { accountName, accountBiz, articles }
}

document.getElementById('collect').onclick = async () => {
  setBusy(true)
  setStatus('采集中…', true)
  try {
    const cfg = await getConfig()
    const tab = await activeTab()
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeCurrentArticleFn
    })
    if (!result || (!result.title && !result.content)) {
      throw new Error('未解析到文章内容，请确认在公众号文章页')
    }
    await postAdmin(cfg, '/oa-content/collector/ingest', result)
    setStatus('采集成功（已入库，可去对标账号查看）', true)
  } catch (e) {
    setStatus(e.message || String(e), false)
  } finally {
    setBusy(false)
  }
}

document.getElementById('collect5').onclick = async () => {
  setBusy(true)
  setStatus('正在解析历史列表并拉取正文…\n（约需 10–30 秒）', true)
  try {
    const cfg = await getConfig()
    const tab = await activeTab()
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeLatestFiveFn,
      args: [5]
    })
    if (!result) throw new Error('页面脚本无返回')
    if (result.error) throw new Error(result.error)
    const articles = (result.articles || []).filter((a) => a.title || a.content || a.url)
    if (!articles.length) throw new Error('没有可入库的文章')
    const data = await postAdmin(cfg, '/oa-content/collector/ingest-batch', {
      accountName: result.accountName || '',
      accountBiz: result.accountBiz || '',
      limit: 5,
      articles
    })
    setStatus(
      `完成：新增 ${data.created || 0}，更新 ${data.updated || 0}，失败 ${data.failed || 0}\n请到后台「对标账号 → 文章」查看并洗稿`,
      true
    )
  } catch (e) {
    setStatus(e.message || String(e), false)
  } finally {
    setBusy(false)
  }
}
