import fs from 'fs'
import os from 'os'
import path from 'path'
import { chromium } from 'playwright'
import { getConfig, storageStatePath, authDir } from './config.js'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function rand(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

async function downloadToTemp(url, idx) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载图片失败 ${res.status}: ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|gif|webp)$/i) || [, 'jpg'])[1]
  const file = path.join(os.tmpdir(), `bili_pub_${Date.now()}_${idx}.${ext}`)
  fs.writeFileSync(file, buf)
  return file
}

/**
 * 使用已登录 storageState 发布图文动态。
 * B 站页面结构会变，选择器做了多套兜底。
 */
export async function publishDynamic({ content, images = [] }) {
  const cfg = getConfig()
  const stateFile = storageStatePath()
  if (!fs.existsSync(stateFile)) {
    const err = new Error('未登录：请先运行 npm run login')
    err.errorType = 'auth'
    throw err
  }

  const browser = await chromium.launch({
    headless: !cfg.headed,
    args: ['--disable-blink-features=AutomationControlled']
  })
  const context = await browser.newContext({
    storageState: stateFile,
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 }
  })
  const page = await context.newPage()
  const tempFiles = []

  try {
    await page.goto('https://t.bilibili.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(rand(800, 1600))

    // 检测登录墙
    const url = page.url()
    if (/passport|login/i.test(url)) {
      const err = new Error('登录已失效，请重新 npm run login')
      err.errorType = 'auth'
      throw err
    }

    // 打开发布框：尝试多种入口
    const openSelectors = [
      'div.bili-dyn-publishing',
      '.bili-dyn-publishing__editor',
      'textarea',
      '[placeholder*="动态"]',
      'text=发布动态',
      'text=分享你的想法'
    ]
    let opened = false
    for (const sel of openSelectors) {
      const el = page.locator(sel).first()
      if (await el.count().catch(() => 0)) {
        try {
          await el.click({ timeout: 3000 })
          opened = true
          break
        } catch (e) {}
      }
    }
    await sleep(rand(400, 900))

    // 填正文
    const editorCandidates = [
      'div.bili-rich-textarea__inner[contenteditable="true"]',
      '[contenteditable="true"]',
      'textarea.bili-dyn-publishing__textarea',
      'textarea'
    ]
    let filled = false
    for (const sel of editorCandidates) {
      const box = page.locator(sel).first()
      if (!(await box.count().catch(() => 0))) continue
      try {
        await box.click({ timeout: 3000 })
        await sleep(200)
        await box.fill('')
        await page.keyboard.type(content, { delay: rand(8, 18) })
        filled = true
        break
      } catch (e) {
        try {
          await box.click()
          await page.keyboard.insertText(content)
          filled = true
          break
        } catch (e2) {}
      }
    }
    if (!filled) {
      const err = new Error('找不到动态编辑框，页面结构可能已变更')
      err.errorType = 'other'
      throw err
    }

    await sleep(rand(500, 1200))

    // 上传图片
    const imgs = (images || []).slice(0, 9)
    if (imgs.length) {
      for (let i = 0; i < imgs.length; i++) {
        tempFiles.push(await downloadToTemp(imgs[i], i))
      }
      const fileInputs = page.locator('input[type="file"]')
      const count = await fileInputs.count()
      if (count > 0) {
        await fileInputs.first().setInputFiles(tempFiles)
        await sleep(rand(1500, 3000) + imgs.length * 400)
      } else {
        console.warn('[publish] 未找到 file input，跳过配图')
      }
    }

    // 发布按钮
    const publishBtns = [
      'button:has-text("发布")',
      '.bili-dyn-publishing__action button',
      'text=发布'
    ]
    let published = false
    for (const sel of publishBtns) {
      const btn = page.locator(sel).last()
      if (!(await btn.count().catch(() => 0))) continue
      try {
        await btn.click({ timeout: 5000 })
        published = true
        break
      } catch (e) {}
    }
    if (!published) {
      const err = new Error('未找到发布按钮')
      err.errorType = 'other'
      throw err
    }

    await sleep(rand(2000, 4000))

    // 检测验证码 / 频率
    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (/验证码|安全验证|极验/i.test(bodyText)) {
      const err = new Error('触发验证码，已暂停')
      err.errorType = 'captcha'
      throw err
    }
    if (/过于频繁|操作太快|请稍后再试/i.test(bodyText)) {
      const err = new Error('发布过于频繁')
      err.errorType = 'rate_limit'
      throw err
    }

    // 尝试从 URL 或页面提取动态 ID（尽力而为）
    let dynamicId = ''
    const dynLink = page.locator('a[href*="t.bilibili.com/"]').first()
    if (await dynLink.count().catch(() => 0)) {
      const href = await dynLink.getAttribute('href')
      const m = String(href || '').match(/t\.bilibili\.com\/(\d+)/)
      if (m) dynamicId = m[1]
    }
    if (!dynamicId) dynamicId = `ok_${Date.now()}`

    await context.storageState({ path: stateFile })
    return { dynamicId }
  } finally {
    for (const f of tempFiles) {
      try {
        fs.unlinkSync(f)
      } catch (e) {}
    }
    await browser.close()
  }
}

export async function ensureAuthDir() {
  const dir = authDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}
