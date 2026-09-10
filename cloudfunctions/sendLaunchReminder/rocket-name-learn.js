/**
 * AI 译出的火箭型号名 → 持久化学习词典（rocket_name_dict）
 * 供后续同步 / 提醒在本地静态词典未覆盖时复用，避免新型号永远英文。
 */
const cloud = require('wx-server-sdk')

let _db = null
let _mem = null
let _warmPromise = null

function getDb() {
  if (_db) return _db
  try {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
  } catch (e) {}
  _db = cloud.database()
  return _db
}

function normKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[·・.\/_\-\s]+/g, '')
}

async function warmRocketNameDict() {
  if (_mem) return _mem
  if (_warmPromise) return _warmPromise
  _warmPromise = (async () => {
    _mem = Object.create(null)
    try {
      const db = getDb()
      const res = await db.collection('rocket_name_dict').limit(500).get()
      const list = (res && res.data) || []
      for (let i = 0; i < list.length; i++) {
        const row = list[i]
        const key = normKey(row && (row.en || row._id))
        const zh = row && row.zh ? String(row.zh).trim() : ''
        if (key && zh && /[\u4e00-\u9fff]/.test(zh)) _mem[key] = zh
      }
    } catch (e) {
      // 集合不存在时首次写入会自动建；预热失败不阻断同步
    }
    return _mem
  })()
  try {
    return await _warmPromise
  } finally {
    _warmPromise = null
  }
}

function lookupLearnedRocketName(en) {
  if (!_mem) return ''
  const key = normKey(en)
  return key && _mem[key] ? _mem[key] : ''
}

/**
 * 记下 AI/机翻得到的型号中文名（短名、含汉字才入库）
 */
async function rememberRocketName(en, zh) {
  const enStr = String(en || '').trim()
  const zhStr = String(zh || '').trim()
  if (!enStr || !zhStr) return
  if (!/[\u4e00-\u9fff]/.test(zhStr)) return
  if (zhStr === enStr) return
  // 过长描述不当作型号词典
  if (enStr.length > 48 || zhStr.length > 32) return

  const key = normKey(enStr)
  if (!key) return

  const mem = await warmRocketNameDict()
  if (mem[key] === zhStr) return
  mem[key] = zhStr

  try {
    const db = getDb()
    await db.collection('rocket_name_dict').doc(key).set({
      data: {
        en: enStr,
        zh: zhStr,
        updatedAt: Date.now()
      }
    })
  } catch (e) {
    console.warn('[rocket-name-learn] upsert fail', key, e.message || e)
  }
}

module.exports = {
  warmRocketNameDict,
  lookupLearnedRocketName,
  rememberRocketName,
  normKey
}
