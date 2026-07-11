import { claimJob, completeJob, failJob } from './api.js'
import { getConfig } from './config.js'
import { publishDynamic, ensureAuthDir } from './publish.js'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function processOnce() {
  const data = await claimJob()
  if (!data?.job) {
    console.log('[agent] 无任务:', data?.reason || 'empty')
    return { didWork: false, stop: false }
  }

  const job = data.job
  console.log('[agent] 领取任务', job.id, job.type, 'images=', (job.images || []).length)

  try {
    const result = await publishDynamic({
      content: job.content || '',
      images: job.images || []
    })
    await completeJob({
      queueId: job.id,
      claimToken: job.claimToken,
      dynamicId: result.dynamicId
    })
    console.log('[agent] 发布成功', result.dynamicId)
    return { didWork: true, stop: false }
  } catch (e) {
    const errorType = e.errorType || 'other'
    console.error('[agent] 发布失败', errorType, e.message)
    const res = await failJob({
      queueId: job.id,
      claimToken: job.claimToken,
      errorType,
      message: e.message || String(e)
    })
    const stop = errorType === 'auth' || errorType === 'captcha' || res?.action === 'disabled'
    return { didWork: true, stop }
  }
}

async function main() {
  const cfg = getConfig()
  console.log('[agent] 正在启动…')
  await ensureAuthDir()
  const once = process.argv.includes('--once')
  console.log('[agent] start', { apiBase: cfg.apiBase, pollMs: cfg.pollMs, once, tokenLen: (cfg.token || '').length })

  if (once) {
    await processOnce()
    return
  }

  while (true) {
    try {
      console.log('[agent] 开始轮询…')
      const { stop } = await processOnce()
      if (stop) {
        console.error('[agent] 因登录/验证码/自停而退出，请处理后重新启动')
        process.exit(2)
      }
    } catch (e) {
      console.error('[agent] 轮询异常', e.message || e)
    }
    console.log(`[agent] 等待 ${cfg.pollMs}ms 后再次轮询`)
    await sleep(cfg.pollMs)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
