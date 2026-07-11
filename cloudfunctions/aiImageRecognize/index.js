// cloudfunctions/aiImageRecognize/index.js
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const USAGE_COLLECTION = 'ai_image_usage'
const DAILY_LIMIT = Number(process.env.AI_IMAGE_DAILY_LIMIT || 30)

let _usageCollectionEnsured = false
async function ensureUsageCollectionOnce() {
  if (_usageCollectionEnsured) return
  _usageCollectionEnsured = true
  try { await db.createCollection(USAGE_COLLECTION) } catch (e) {}
}

function todayStr() {
  const cn = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return cn.toISOString().slice(0, 10)
}

async function checkQuota(openid) {
  const docId = openid + '_' + todayStr()
  try {
    const res = await db.collection(USAGE_COLLECTION).doc(docId).get()
    const count = Number((res.data && res.data.count) || 0)
    if (count >= DAILY_LIMIT) return { ok: false, count }
  } catch (e) {}
  return { ok: true }
}

async function bumpQuota(openid) {
  const today = todayStr()
  const docId = openid + '_' + today
  try {
    await db.collection(USAGE_COLLECTION).doc(docId).update({
      data: { count: _.inc(1), updatedAt: Date.now() }
    })
  } catch (e) {
    try {
      await db.collection(USAGE_COLLECTION).doc(docId).set({
        data: { openid, date: today, count: 1, updatedAt: Date.now() }
      })
    } catch (e2) {}
  }
}

/** 用微信云开发 OCR 从图片中提取文字 */
async function extractOcrText(fileID) {
  var ocrText = ''
  try {
    var fileRes = await cloud.downloadFile({ fileID: fileID })
    var buf = fileRes.fileContent
    if (!buf || buf.length === 0) return ''

    // 尝试通过 cloud.openapi.ocr 识别（通用印刷体）
    var imgBuf = buf
    try {
      var ocrRes = await cloud.openapi.ocr.printedText({
        imgUrl: '',
        img: { contentType: 'image/jpeg', value: imgBuf }
      })
      if (ocrRes && ocrRes.items && ocrRes.items.length > 0) {
        ocrText = ocrRes.items.map(function (it) { return it.text || '' }).filter(Boolean).join(' ')
      }
    } catch (ocrErr) {
      // printedText 不可用时尝试 generalErase (通用文字)
      try {
        var urlRes = await cloud.getTempFileURL({ fileList: [fileID] })
        var fi = urlRes.fileList && urlRes.fileList[0]
        if (fi && fi.tempFileURL) {
          var ocrRes2 = await cloud.openapi.ocr.printedText({
            imgUrl: fi.tempFileURL
          })
          if (ocrRes2 && ocrRes2.items && ocrRes2.items.length > 0) {
            ocrText = ocrRes2.items.map(function (it) { return it.text || '' }).filter(Boolean).join(' ')
          }
        }
      } catch (e2) {}
    }
  } catch (e) {
    console.warn('[aiImageRecognize] OCR failed:', e.message)
  }
  return ocrText
}

/** 用免费的 hy3-preview 模型分析 OCR 文字推断航天器 */
async function analyzeWithFreeModel(ocrText, userPrompt) {
  var systemPrompt = '你是一个航天器识别助手。你的任务是根据图片OCR提取的文字来判断图片是否与航天（火箭、卫星、太空探索、航天机构）相关。\n\n关键规则：\n1. 只有当文字中明确包含航天相关内容（如火箭名称SpaceX/Falcon/Starship/长征/Atlas、航天机构NASA/ESA/CNSA、任务名称Starlink/Crew等）时才判定为航天相关\n2. 如果文字内容是日常物品、食品、电子产品、汽车等非航天内容，必须判定为非航天相关\n3. 如果没有文字或文字模糊无法判断，也应判定为非航天相关\n4. 不要猜测或联想，严格根据证据判断'

  var prompt = userPrompt || '请根据以下信息判断这张图片是否与航天/火箭/卫星/太空相关，如果是则识别具体型号。'
  if (ocrText) {
    prompt += '\n\n图片中识别到的文字内容：\n' + ocrText
  } else {
    prompt += '\n\n（图片中未识别到文字）'
  }
  prompt += '\n\n重要：如果文字内容与航天/火箭/卫星/太空探索完全无关，或者没有识别到任何文字，请直接返回：{"isSpace":false,"message":"这张图片似乎不是航天相关内容"}'
  prompt += '\n如果确实是航天相关，请返回：{"isSpace":true,"rocketName":"火箭/航天器型号","company":"所属公司","description":"详细描述"}'

  if (cloud.extend && cloud.extend.AI && cloud.extend.AI.createModel) {
    var model = cloud.extend.AI.createModel('hunyuan-v3')
    var res = await model.generateText({
      model: 'hy3-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 800
    })
    if (res && res.choices && res.choices[0]) {
      return res.choices[0].message.content || ''
    }
    if (res && res.result && res.result.choices && res.result.choices[0]) {
      return res.result.choices[0].message.content || ''
    }
    if (typeof res === 'string') return res
  }
  return ''
}

exports.main = async function (event) {
  await ensureUsageCollectionOnce()
  const openid = cloud.getWXContext().OPENID || ''
  if (!openid) return { success: false, error: '未授权' }

  var fileID = event.fileID || ''
  var action = event.action || 'recognize'

  // OCR 动作：只提取文字返回给客户端
  if (action === 'ocr' && fileID) {
    var ocrText = await extractOcrText(fileID)
    return { success: true, ocrText: ocrText }
  }

  // 识别动作
  const quota = await checkQuota(openid)
  if (!quota.ok) return { success: false, error: '今日识别次数已达上限', code: 'quota_exceeded' }

  var ocrInput = event.ocrText || ''
  if (!ocrInput && fileID) {
    ocrInput = await extractOcrText(fileID)
  }

  if (!ocrInput) {
    return { success: false, error: '未能从图片中提取到有效信息，请尝试拍摄更清晰的图片' }
  }

  try {
    var content = await analyzeWithFreeModel(ocrInput, event.prompt || '')
    if (!content) return { success: false, error: 'AI分析失败' }

    var parsed = null
    try {
      var jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
    } catch (e) {}

    // 非航天内容不计入配额
    if (parsed && parsed.isSpace === false) {
      return {
        success: true,
        notSpace: true,
        raw: content,
        parsed: { rocketName: '', description: parsed.message || '这张图片似乎不是航天相关内容，请拍摄火箭、卫星等航天器照片试试' }
      }
    }

    await bumpQuota(openid)
    return {
      success: true,
      raw: content,
      parsed: parsed || { rocketName: '识别结果', description: content }
    }
  } catch (err) {
    console.error('[aiImageRecognize] failed:', err)
    return { success: false, error: err.message || '识别失败' }
  }
}
