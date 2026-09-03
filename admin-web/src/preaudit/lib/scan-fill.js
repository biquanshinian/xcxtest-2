export function emptyValue(v) {
  return v == null || v === ''
}

export function requiredScanFields(item) {
  const opt = Object.create(null)
  ;((item && item.optionalFields) || []).forEach((f) => {
    if (f) opt[f] = true
  })
  return ((item && item.fields) || []).filter((f) => f && f !== 'people' && !opt[f])
}

export function missingRequiredScanFields(item, current) {
  const cur = current || {}
  return requiredScanFields(item).filter((f) => {
    if (f === 'endDate') return emptyValue(cur.endDate)
    if (f === 'amount') return emptyValue(cur.amount) && cur.amount !== 0
    return emptyValue(cur[f])
  })
}

export function shouldFinishScan(item, current, filledNow) {
  if (missingRequiredScanFields(item, current).length) return false
  if (requiredScanFields(item).length) return true
  return !!(filledNow && filledNow.length)
}

export function cameraErrorText(err) {
  const name = (err && err.name) || ''
  const msg = String((err && err.message) || '')
  if (name === 'NotAllowedError' || /Permission|denied/i.test(msg)) {
    return '没有摄像头权限。请在浏览器或微信里允许使用摄像头，或改用拍照识别（图仍不保存）'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '没找到后置摄像头，可改用拍照识别'
  }
  if (name === 'NotReadableError') {
    return '摄像头正被占用，关掉其它扫码页再试，或改用拍照识别'
  }
  if (/secure|https/i.test(msg) || name === 'SecurityError') {
    return '当前页面不能开摄像头，请用手机浏览器打开后再扫，或改用拍照识别'
  }
  return msg || '打不开摄像头，可改用拍照识别（图仍不保存）'
}

export function stabilizeParsed(parsed, fields, memo, manual) {
  const src = parsed || {}
  const next = { date: '', startDate: '', endDate: '', amount: null }
  const want = fields || []
  function take(key, value) {
    if (value == null || value === '') return
    if (manual) {
      next[key] = value
      return
    }
    const prev = memo[key]
    if (prev && String(prev.value) === String(value)) {
      prev.n += 1
      if (prev.n >= 2) next[key] = value
    } else {
      memo[key] = { value: value, n: 1 }
    }
  }
  if (want.includes('date')) take('date', src.date)
  if (want.includes('startDate')) take('startDate', src.startDate || '')
  if (want.includes('endDate')) take('endDate', src.endDate || '')
  if (want.includes('amount')) take('amount', src.amount)
  if (want.includes('contractor')) take('contractor', src.contractor || '')
  return next
}

export function hasParsedValue(parsed) {
  if (!parsed) return false
  return !!(parsed.date || parsed.startDate || parsed.endDate || parsed.contractor || (parsed.amount != null && parsed.amount !== ''))
}

export const A4_RATIO = 210 / 297
export const SCAN_ORIENTATIONS = [0, 180, 90, 270]

export function orientationForAttempt(n) {
  const i = Math.max(1, Number(n) || 1) - 1
  return SCAN_ORIENTATIONS[i % SCAN_ORIENTATIONS.length]
}

export function orientationsForScan(manual, attempt) {
  if (manual) return SCAN_ORIENTATIONS.slice()
  return [orientationForAttempt(attempt)]
}

export function mapElementRectToVideo(vw, vh, viewW, viewH, rect) {
  const scale = Math.max(viewW / vw, viewH / vh)
  const ox = (viewW - vw * scale) / 2
  const oy = (viewH - vh * scale) / 2
  let sx = (rect.x - ox) / scale
  let sy = (rect.y - oy) / scale
  let sw = rect.w / scale
  let sh = rect.h / scale
  if (sx < 0) {
    sw += sx
    sx = 0
  }
  if (sy < 0) {
    sh += sy
    sy = 0
  }
  if (sx + sw > vw) sw = vw - sx
  if (sy + sh > vh) sh = vh - sy
  return {
    sx: Math.max(0, Math.round(sx)),
    sy: Math.max(0, Math.round(sy)),
    sw: Math.max(1, Math.round(sw)),
    sh: Math.max(1, Math.round(sh))
  }
}

export function a4CropInVideo(vw, vh, landscape) {
  const ratio = landscape ? 297 / 210 : A4_RATIO
  let sw
  let sh
  if (vw / vh > ratio) {
    sh = vh * 0.86
    sw = sh * ratio
  } else {
    sw = vw * 0.86
    sh = sw / ratio
  }
  return {
    sx: Math.round((vw - sw) / 2),
    sy: Math.round((vh - sh) / 2),
    sw: Math.max(1, Math.round(sw)),
    sh: Math.max(1, Math.round(sh))
  }
}

export function captureVideoFrame(video, frameEl, landscape) {
  const el = video
  const vw = el && el.videoWidth
  const vh = el && el.videoHeight
  if (!vw || !vh) throw new Error('摄像头还没就绪')
  let crop = a4CropInVideo(vw, vh, landscape)
  if (frameEl && typeof frameEl.getBoundingClientRect === 'function' && el.getBoundingClientRect) {
    const vRect = el.getBoundingClientRect()
    const fRect = frameEl.getBoundingClientRect()
    if (vRect.width && vRect.height && fRect.width && fRect.height) {
      crop = mapElementRectToVideo(vw, vh, vRect.width, vRect.height, {
        x: fRect.left - vRect.left,
        y: fRect.top - vRect.top,
        w: fRect.width,
        h: fRect.height
      })
    }
  }
  const maxEdge = 1280
  let dw = crop.sw
  let dh = crop.sh
  if (Math.max(dw, dh) > maxEdge) {
    const scale = maxEdge / Math.max(dw, dh)
    dw = Math.round(dw * scale)
    dh = Math.round(dh * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = dw
  canvas.height = dh
  const ctx = canvas.getContext('2d')
  ctx.drawImage(el, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, dw, dh)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0
      canvas.height = 0
      if (!blob) reject(new Error('取帧失败'))
      else resolve(blob)
    }, 'image/jpeg', 0.72)
  })
}

export async function openRearCamera() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const err = new Error('这台设备不能开摄像头')
    err.name = 'NotFoundError'
    throw err
  }
  const tries = [
    { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { audio: false, video: { facingMode: 'environment' } },
    { audio: false, video: true }
  ]
  let last = null
  for (let i = 0; i < tries.length; i++) {
    try {
      return await navigator.mediaDevices.getUserMedia(tries[i])
    } catch (err) {
      last = err
    }
  }
  throw last || new Error('打不开摄像头')
}

export function stopStream(stream) {
  if (!stream) return
  const tracks = stream.getTracks ? stream.getTracks() : []
  tracks.forEach((track) => {
    try { track.stop() } catch (e) { /* ignore */ }
  })
}

export const SCAN_SUCCESS_VIBRATE = [30, 40, 55]
const SCAN_NOTIFY_GAP_MS = 700

let scanAudioCtx = null
let lastScanNotifyAt = 0

function audioCtor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext || window.webkitAudioContext || null
}

function getScanAudioCtx() {
  const Ctor = audioCtor()
  if (!Ctor) return null
  if (!scanAudioCtx || scanAudioCtx.state === 'closed') scanAudioCtx = new Ctor()
  return scanAudioCtx
}

function playTone(ctx, freq, start, dur, peak) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  osc.connect(gain)
  gain.connect(ctx.destination)
  const t0 = ctx.currentTime + start
  const t1 = t0 + dur
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t1)
  osc.start(t0)
  osc.stop(t1 + 0.02)
}

function playScanBeep(ctx) {
  // 接近微信扫一扫成功：两声短促高音「滴滴」
  playTone(ctx, 1760, 0, 0.07, 0.24)
  playTone(ctx, 2349, 0.09, 0.1, 0.2)
}

function weixinBridge() {
  if (typeof window === 'undefined') return null
  return window.WeixinJSBridge || null
}

let weixinUnlockBound = false

function bindWeixinUnlock() {
  if (weixinUnlockBound || typeof document === 'undefined') return
  weixinUnlockBound = true
  document.addEventListener('WeixinJSBridgeReady', function () {
    unlockScanFeedback()
  })
}

function warmAudio(ctx) {
  const src = ctx.createBufferSource()
  src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050)
  src.connect(ctx.destination)
  src.start(0)
}

export function vibrateScanSuccess() {
  try {
    const bridge = weixinBridge()
    if (bridge && typeof bridge.invoke === 'function') {
      bridge.invoke('vibrateShort', { type: 'medium' }, function () {})
      return true
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(SCAN_SUCCESS_VIBRATE)
      return true
    }
  } catch (e) { /* ignore */ }
  return false
}

export function unlockScanFeedback() {
  if (typeof window === 'undefined') return false
  bindWeixinUnlock()
  try {
    const ctx = getScanAudioCtx()
    if (!ctx) return true
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume()
    warmAudio(ctx)
  } catch (e) { /* ignore */ }
  return true
}

export function resetScanFeedback() {
  lastScanNotifyAt = 0
}

export function notifyScanSuccess() {
  if (typeof window === 'undefined') return false
  const now = Date.now()
  if (now - lastScanNotifyAt < SCAN_NOTIFY_GAP_MS) return false
  lastScanNotifyAt = now
  try {
    const ctx = getScanAudioCtx()
    if (ctx) {
      if (ctx.state === 'suspended' && ctx.resume) {
        ctx.resume().then(function () { playScanBeep(ctx) }).catch(function () {})
      } else {
        playScanBeep(ctx)
      }
    }
  } catch (e) { /* ignore */ }
  vibrateScanSuccess()
  return true
}
