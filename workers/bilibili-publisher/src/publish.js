import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'
import { getConfig, storageStatePath, authDir } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logsDir = path.resolve(__dirname, '../logs')

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function rand(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function guessImageExt(url, contentType) {
  if (/ci-process=snapshot/i.test(url || '')) return 'jpg'
  const pathExt = (String(url || '').split('?')[0].match(/\.(jpe?g|png|gif|webp)$/i) || [])[1]
  if (pathExt) return pathExt.toLowerCase().replace('jpeg', 'jpg')
  const ct = String(contentType || '').toLowerCase()
  if (ct.includes('png')) return 'png'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  return 'jpg'
}

/**
 * 下载单张配图到临时文件。
 * 失败不再抛错中断整单：404/403/410 视为图片已从 COS 删除，直接跳过；
 * 其他网络错误重试 1 次后跳过。返回 null 表示该图放弃。
 */
async function downloadToTemp(url, idx) {
  // 本地路径直接复用，便于 demo / 调试
  if (url && !/^https?:\/\//i.test(url) && fs.existsSync(url)) {
    return url
  }

  const tryOnce = async () => {
    const res = await fetch(url)
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const ext = guessImageExt(url, res.headers.get('content-type'))
    const file = path.join(os.tmpdir(), `bili_pub_${Date.now()}_${idx}.${ext}`)
    fs.writeFileSync(file, buf)
    return file
  }

  try {
    return await tryOnce()
  } catch (e) {
    const status = Number(e.status || 0)
    if (status === 404 || status === 403 || status === 410) {
      console.warn(`[publish] 配图已失效(${status})，跳过: ${url}`)
      return null
    }
    // 非永久失效：重试一次，仍失败则跳过该图（不让整单失败）
    await sleep(800)
    try {
      return await tryOnce()
    } catch (e2) {
      console.warn(`[publish] 配图下载失败(${e2.status || e2.message})，跳过: ${url}`)
      return null
    }
  }
}

async function waitImageUploadReady(page, expectCount) {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const thumbs = page.locator(
      '.bili-pics-uploader__item, .bili-pics-uploader img, .bili-dyn-publishing__image-upload img'
    )
    const n = await thumbs.count().catch(() => 0)
    if (n >= expectCount) return true
    // 上传中常见 loading / progress
    await sleep(500)
  }
  return false
}

async function saveDebug(page, name) {
  try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true })
    const stamp = Date.now()
    const shot = path.join(logsDir, `${name}-${stamp}.png`)
    const html = path.join(logsDir, `${name}-${stamp}.html`)
    await page.screenshot({ path: shot, fullPage: true })
    fs.writeFileSync(html, await page.content())
    console.warn('[publish] debug saved', shot)
  } catch (e) {
    console.warn('[publish] debug save failed', e.message || e)
  }
}

async function ensureLoggedIn(page) {
  const url = page.url()
  if (/passport|login/i.test(url)) {
    const err = new Error('登录已失效，请重新 npm run login')
    err.errorType = 'auth'
    throw err
  }
  // 未登录常见入口
  const loginBtn = page.getByText('登录', { exact: true }).first()
  if (await loginBtn.isVisible().catch(() => false)) {
    const headerLogin = page.locator('.header-login-entry, .unlogin-avatar, a[href*="passport"]').first()
    if (await headerLogin.count().catch(() => 0)) {
      const err = new Error('登录已失效，请重新 npm run login')
      err.errorType = 'auth'
      throw err
    }
  }
}

async function openPublisher(page) {
  // 只点开「正文」编辑区，避免点到标题（.bili-dyn-publishing__title）
  const openers = [
    page.locator('.bili-dyn-publishing__editor [contenteditable="true"]').first(),
    page.locator('.bili-dyn-publishing .bili-rich-textarea__inner[contenteditable="true"]').first(),
    page.locator('.bili-dyn-publishing [contenteditable="true"]').first(),
    page.getByText('有什么想和大家分享的吗', { exact: false }).first(),
    page.getByText('分享你的想法', { exact: false }).first(),
    page.getByPlaceholder(/想法|动态|分享|说点什么/).first(),
    page.locator('.bili-dyn-publishing').first()
  ]
  for (const el of openers) {
    try {
      if (await el.count() && (await el.isVisible().catch(() => false))) {
        await el.click({ timeout: 4000 })
        await sleep(rand(600, 1200))
        return true
      }
    } catch (e) {}
  }
  return false
}

function looksLikeTitleEditor(elHandleAttrs) {
  const { cls, placeholder, aria, role } = elHandleAttrs
  const blob = `${cls} ${placeholder} ${aria} ${role}`.toLowerCase()
  return /title|标题|headline|subject/.test(blob)
}

async function clearTitleFields(page) {
  // 若页面有「标题」输入框，确保留空（不把正文写进去）
  const titleCandidates = [
    page.locator('.bili-dyn-publishing input[placeholder*="标题"]').first(),
    page.locator('.bili-dyn-publishing textarea[placeholder*="标题"]').first(),
    page.locator('.bili-dyn-publishing [contenteditable="true"][placeholder*="标题"]').first(),
    page.locator('.bili-dyn-publishing__title input, .bili-dyn-publishing__title textarea, .bili-dyn-publishing__title [contenteditable="true"]').first(),
    page.getByPlaceholder(/标题/).first()
  ]
  for (const box of titleCandidates) {
    try {
      if (!(await box.count()) || !(await box.isVisible().catch(() => false))) continue
      await box.click({ timeout: 2000 })
      await sleep(150)
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Backspace')
      console.log('[publish] 已清空标题栏，只保留正文')
    } catch (e) {}
  }
}

/**
 * 逐行输入正文。
 * B 站动态编辑器对一次性 insertText 的多行文本只会保留第一行（其余行发布时被丢弃，
 * 导致来源/话题/页脚全部消失），必须逐行插入并用真实 Enter 换行。
 * 含 #话题# 的行用真实键入，触发编辑器的话题识别，让话题成为可点击的蓝字话题。
 */
async function typeMultilineContent(page, content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line) {
      if (/#[^#\s][^#]*#/.test(line)) {
        await page.keyboard.type(line, { delay: 30 })
        await sleep(400)
        // 关闭话题联想弹层，避免随后的 Enter 误选联想项
        await page.keyboard.press('Escape').catch(() => {})
        await sleep(150)
      } else {
        await page.keyboard.insertText(line)
      }
    }
    if (i < lines.length - 1) {
      await page.keyboard.press('Enter')
      await sleep(80)
    }
  }
}

async function fillContent(page, content) {
  // 正文编辑器优先；显式排除标题类节点
  const editors = [
    page.locator('.bili-dyn-publishing__editor [contenteditable="true"]').first(),
    page.locator('.bili-dyn-publishing .bili-rich-textarea__inner[contenteditable="true"]').first(),
    page.locator('.bili-dyn-publishing [contenteditable="true"]').first()
  ]

  const plain = (s) => String(s || '').replace(/\s+/g, '')
  const meaningfulLines = String(content || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const lastLine = meaningfulLines[meaningfulLines.length - 1] || ''

  for (const box of editors) {
    try {
      if (!(await box.count()) || !(await box.isVisible().catch(() => false))) continue

      const meta = await box.evaluate((node) => ({
        cls: String(node.className || ''),
        placeholder: String(node.getAttribute('placeholder') || node.getAttribute('data-placeholder') || ''),
        aria: String(node.getAttribute('aria-label') || ''),
        role: String(node.getAttribute('role') || ''),
        parentCls: String(node.parentElement?.className || '')
      }))
      if (looksLikeTitleEditor(meta) || looksLikeTitleEditor({ cls: meta.parentCls, placeholder: '', aria: '', role: '' })) {
        console.warn('[publish] 跳过标题编辑器', meta.cls || meta.placeholder)
        continue
      }

      await box.click({ timeout: 4000 })
      await sleep(300)
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Backspace')
      await typeMultilineContent(page, content)
      await sleep(400)
      const val = await box.innerText().catch(() => '')
      if (!val || !val.trim()) continue

      // 校验最后一行（页脚/话题）确实进入了编辑器，防止多行内容被编辑器截断
      if (lastLine && !plain(val).includes(plain(lastLine))) {
        await saveDebug(page, 'content-truncated')
        console.warn('[publish] 正文疑似被截断：编辑器缺少末行', JSON.stringify(lastLine))
        return false
      }

      await clearTitleFields(page)
      // 再点回正文，避免光标停在标题
      await box.click({ timeout: 2000 }).catch(() => {})
      return true
    } catch (e) {}
  }
  return false
}

async function enableFileChooserIntercept(page) {
  // Windows 有头模式下，若不拦截会弹出系统「打开」对话框
  try {
    const client = await page.context().newCDPSession(page)
    await client.send('Page.setInterceptFileChooserDialog', { enabled: true })
    return client
  } catch (e) {
    console.warn('[publish] CDP filechooser intercept failed', e.message || e)
    return null
  }
}

async function dismissNativeFileDialog(page) {
  try {
    await page.keyboard.press('Escape')
    await sleep(200)
    await page.keyboard.press('Escape')
  } catch (e) {}
}

async function uploadImages(page, tempFiles) {
  if (!tempFiles.length) return true

  // COS 图已下载到本地临时文件；禁止依赖系统选文件框
  await enableFileChooserIntercept(page)

  const picTool = page.locator('.bili-dyn-publishing__tools__item.pic').first()
  const imagePanel = page.locator('.bili-dyn-publishing__image-upload').first()
  const addBtn = page.locator('.bili-pics-uploader__add').first()

  try {
    if (await picTool.count()) {
      const panelVisible = await imagePanel.isVisible().catch(() => false)
      if (!panelVisible) {
        await picTool.click({ timeout: 5000 })
        await sleep(rand(400, 800))
      }
    }
  } catch (e) {
    console.warn('[publish] click pic tool failed', e.message || e)
  }

  try {
    await imagePanel.waitFor({ state: 'visible', timeout: 8000 })
  } catch (e) {
    console.warn('[publish] image upload panel not visible')
  }

  const findFileInputs = () =>
    page.locator(
      '.bili-dyn-publishing input[type="file"], .bili-pics-uploader input[type="file"], .bili-dyn-publishing__image-upload input[type="file"], input[type="file"]'
    )

  const setOnHiddenInput = async (files) => {
    const inputs = findFileInputs()
    const n = await inputs.count().catch(() => 0)
    for (let i = 0; i < n; i++) {
      try {
        await inputs.nth(i).setInputFiles(files)
        return true
      } catch (e) {
        console.warn('[publish] setInputFiles on input', i, e.message || e)
      }
    }
    return false
  }

  /**
   * 点「+」前必须已开启 CDP 拦截；用 filechooser 事件喂入本地临时文件（来自 COS）。
   * 绝不依赖用户手动选文件。
   */
  const setViaInterceptedChooser = async (files) => {
    if (!(await addBtn.count())) return false
    let chooser = null
    try {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 12000 })
      await addBtn.click({ timeout: 5000 })
      chooser = await chooserPromise
      await chooser.setFiles(files)
      return true
    } catch (e) {
      console.warn('[publish] intercepted filechooser failed', e.message || e)
      await dismissNativeFileDialog(page)
      // 点击后页面可能已插入 input，再试直写
      await sleep(400)
      return setOnHiddenInput(files)
    }
  }

  let setOk = await setOnHiddenInput(tempFiles)
  if (!setOk) {
    console.log('[publish] 无现成 file input，走拦截后的上传按钮（COS 临时文件）')
    setOk = await setViaInterceptedChooser(tempFiles)
  }

  if (!setOk && tempFiles.length > 1) {
    let okCount = 0
    for (const f of tempFiles) {
      if (await setOnHiddenInput([f])) okCount++
      else if (await setViaInterceptedChooser([f])) okCount++
      await sleep(rand(600, 1000))
    }
    setOk = okCount > 0
  }

  if (!setOk) {
    await dismissNativeFileDialog(page)
    await saveDebug(page, 'no-image-upload')
    console.warn('[publish] 未能选中配图文件（COS 已下载到本地，但页面未接受）')
    return false
  }

  console.log('[publish] 已选择配图', tempFiles.length, '张（来自 COS），等待上传完成…')
  const ready = await waitImageUploadReady(page, Math.min(tempFiles.length, 1))
  if (!ready) {
    await saveDebug(page, 'image-upload-timeout')
    console.warn('[publish] 配图上传超时（未看到预览）')
    return false
  }
  await sleep(rand(1200, 2200) + Math.max(0, tempFiles.length - 1) * 800)
  console.log('[publish] 配图上传完成')
  return true
}

async function confirmPublishModal(page) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    const confirmBtns = [
      page.getByRole('button', { name: /确认并发送/ }).first(),
      page.locator('button').filter({ hasText: /确认并发送/ }).first(),
      page.getByText('确认并发送', { exact: true }).first()
    ]
    for (const btn of confirmBtns) {
      try {
        if (!(await btn.count())) continue
        if (!(await btn.isVisible().catch(() => false))) continue
        await btn.click({ timeout: 5000 })
        console.log('[publish] 已点击「确认并发送」')
        await sleep(rand(1500, 2500))
        return true
      } catch (e) {}
    }
    const hasModal = await page.getByText('使用规范', { exact: false }).first().isVisible().catch(() => false)
    if (!hasModal) return false
    await sleep(300)
  }
  return false
}

async function clickPublish(page) {
  // B 站当前是 div，不是 button：
  // <div class="bili-dyn-publishing__action launcher"> 发布 </div>
  const candidates = [
    page.locator('div.bili-dyn-publishing__action.launcher').first(),
    page.locator('.bili-dyn-publishing__action').filter({ hasText: /^\s*发布\s*$/ }).first(),
    page.locator('.bili-dyn-publishing').locator('div.bili-dyn-publishing__action').first(),
    page.getByText('发布', { exact: true }).first()
  ]

  for (const btn of candidates) {
    try {
      if (!(await btn.count())) continue
      if (!(await btn.isVisible().catch(() => false))) continue
      await btn.scrollIntoViewIfNeeded().catch(() => {})
      await sleep(200)
      await btn.click({ timeout: 5000 })
      console.log('[publish] clicked publish control')
      return true
    } catch (e) {
      try {
        await btn.click({ timeout: 5000, force: true })
        console.log('[publish] force-clicked publish control')
        return true
      } catch (e2) {}
    }
  }

  // 兜底：在 publishing 面板内找包含「发布」的可点击 div
  const fallback = page.locator('.bili-dyn-publishing div').filter({ hasText: /^\s*发布\s*$/ })
  const n = await fallback.count()
  for (let i = 0; i < n; i++) {
    const el = fallback.nth(i)
    const cls = (await el.getAttribute('class').catch(() => '')) || ''
    if (!/action|launcher|publish/i.test(cls) && i < n - 1) continue
    try {
      await el.click({ timeout: 3000, force: true })
      return true
    } catch (e) {}
  }
  return false
}

/**
 * 使用已登录 storageState 发布图文动态。
 */
export async function publishDynamic({ content, images = [] }) {
  const cfg = getConfig()
  const stateFile = storageStatePath()
  if (!fs.existsSync(stateFile)) {
    const err = new Error('未登录：请先运行 npm run login')
    err.errorType = 'auth'
    throw err
  }

  // B 站对无头模式较敏感，默认有头更稳；可用 BILI_HEADED=false 关闭
  const headed = cfg.headed || String(process.env.BILI_HEADED || 'true').toLowerCase() !== 'false'

  const browser = await chromium.launch({
    headless: !headed,
    args: ['--disable-blink-features=AutomationControlled']
  })
  const context = await browser.newContext({
    storageState: stateFile,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 960 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  const page = await context.newPage()
  await enableFileChooserIntercept(page)
  const tempFiles = []

  try {
    await page.goto('https://t.bilibili.com/', { waitUntil: 'domcontentloaded', timeout: 90000 })
    await sleep(rand(1500, 2500))
    await ensureLoggedIn(page)

    await openPublisher(page)
    await sleep(rand(500, 1000))

    const filled = await fillContent(page, content)
    if (!filled) {
      await saveDebug(page, 'no-editor')
      const err = new Error('找不到动态编辑框，页面结构可能已变更（见 logs/no-editor-*.png）')
      err.errorType = 'other'
      throw err
    }

    const imgs = (images || []).slice(0, 9)
    if (imgs.length) {
      for (let i = 0; i < imgs.length; i++) {
        const local = await downloadToTemp(imgs[i], i)
        if (local) tempFiles.push(local)
      }
      if (!tempFiles.length) {
        // 图全部失效：不发成纯文字（推文没图可能看不懂），抛 media 类错误由网关跳过该事件
        const err = new Error(`全部配图下载失败（${imgs.length} 张，多为 COS 已清理），跳过本条`)
        err.errorType = 'media'
        throw err
      }
      if (tempFiles.length < imgs.length) {
        console.warn(`[publish] ${imgs.length - tempFiles.length} 张配图失效已跳过，用剩余 ${tempFiles.length} 张继续`)
      }
      const uploaded = await uploadImages(page, tempFiles)
      if (!uploaded) {
        await saveDebug(page, 'image-upload-failed')
        const err = new Error('配图上传失败（见 logs/image-upload-*.png），已中止以免发成纯文字')
        err.errorType = 'other'
        throw err
      }
    }

    await sleep(rand(800, 1500))
    const published = await clickPublish(page)
    if (!published) {
      await saveDebug(page, 'no-publish-btn')
      const err = new Error('未找到发布按钮（见 logs/no-publish-btn-*.png）')
      err.errorType = 'other'
      throw err
    }

    await confirmPublishModal(page)
    await sleep(rand(2500, 4500))

    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (/验证码|安全验证|极验/i.test(bodyText)) {
      await saveDebug(page, 'captcha')
      const err = new Error('触发验证码，已暂停')
      err.errorType = 'captcha'
      throw err
    }
    if (/过于频繁|操作太快|请稍后再试/i.test(bodyText)) {
      const err = new Error('发布过于频繁')
      err.errorType = 'rate_limit'
      throw err
    }

    let dynamicId = ''
    const dynLink = page.locator('a[href*="t.bilibili.com/"]').first()
    if (await dynLink.count().catch(() => 0)) {
      const href = await dynLink.getAttribute('href')
      const m = String(href || '').match(/t\.bilibili\.com\/(\d+)/)
      if (m) dynamicId = m[1]
    }
    if (!dynamicId) dynamicId = `ok_${Date.now()}`

    await context.storageState({ path: stateFile })
    console.log('[publish] 发布流程完成', dynamicId)
    return { dynamicId }
  } catch (e) {
    try {
      await saveDebug(page, 'publish-error')
    } catch (e2) {}
    throw e
  } finally {
    for (const f of tempFiles) {
      // 仅清理我们下载到临时目录的文件，不删本地传入路径
      try {
        if (String(f).includes(`${path.sep}bili_pub_`)) fs.unlinkSync(f)
      } catch (e) {}
    }
    await browser.close()
  }
}

export async function ensureAuthDir() {
  const dir = authDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}
