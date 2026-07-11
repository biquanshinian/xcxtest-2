import { chromium } from 'playwright'
import { getConfig, storageStatePath } from './config.js'
import { ensureAuthDir } from './publish.js'

async function main() {
  getConfig()
  await ensureAuthDir()
  const stateFile = storageStatePath()

  console.log('将打开浏览器，请扫码登录 B 站。登录成功后回到终端按 Enter 保存 Cookie。')
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('https://passport.bilibili.com/login', { waitUntil: 'domcontentloaded' })

  await new Promise((resolve) => {
    process.stdin.resume()
    process.stdin.once('data', resolve)
  })

  await context.storageState({ path: stateFile })
  await browser.close()
  console.log('已保存登录态到', stateFile)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
