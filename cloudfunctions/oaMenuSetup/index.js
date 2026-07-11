/**
 * 一次性脚本：通过接口创建服务号「火星探索日志」自定义菜单
 *
 * 环境变量（与 oaWebhook 共用）：
 * - WECHAT_OA_APPID
 * - WECHAT_OA_SECRET
 * 可选：
 * - WECHAT_MP_APPID  跳转小程序 AppID，默认 wxf98b58309019771b
 *
 * 云函数测试参数示例：
 * - {} 或 {"action":"create"}  创建菜单
 * - {"action":"get"}           查询当前菜单
 * - {"action":"dryRun"}        仅预览将要提交的 JSON，不调用微信
 */
const cloud = require('wx-server-sdk')
const axios = require('axios')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DEFAULT_MP_APPID = 'wxf98b58309019771b'
const MENU_FALLBACK_URL = 'http://mp.weixin.qq.com'

let _oaTokenCache = { token: '', expireAt: 0 }

function getOaCredentials() {
  const appid = String(process.env.WECHAT_OA_APPID || '').trim()
  const secret = String(process.env.WECHAT_OA_SECRET || '').trim()
  if (!appid || !secret) return null
  return { appid, secret }
}

function getMpAppid() {
  return String(process.env.WECHAT_MP_APPID || DEFAULT_MP_APPID).trim()
}

async function getOaAccessToken() {
  const cred = getOaCredentials()
  if (!cred) throw new Error('缺少 WECHAT_OA_APPID / WECHAT_OA_SECRET')
  const nowMs = Date.now()
  if (_oaTokenCache.token && _oaTokenCache.expireAt > nowMs + 60 * 1000) {
    return _oaTokenCache.token
  }
  const url =
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
    encodeURIComponent(cred.appid) +
    '&secret=' +
    encodeURIComponent(cred.secret)
  const res = await axios.get(url)
  if (!res.data || !res.data.access_token) {
    throw new Error('获取服务号 access_token 失败: ' + JSON.stringify(res.data))
  }
  _oaTokenCache = {
    token: res.data.access_token,
    expireAt: nowMs + (res.data.expires_in || 7200) * 1000
  }
  return _oaTokenCache.token
}

function buildMenuPayload(mpAppid) {
  return {
    button: [
      {
        name: '开启提醒',
        type: 'click',
        key: 'MENU_ENABLE_ALERT'
      },
      {
        name: '今日发射',
        type: 'miniprogram',
        url: MENU_FALLBACK_URL,
        appid: mpAppid,
        pagepath: 'pages/index/index'
      },
      {
        name: '发现',
        sub_button: [
          {
            name: '月愿计划',
            type: 'miniprogram',
            url: MENU_FALLBACK_URL,
            appid: mpAppid,
            pagepath: 'pages/collect/collect'
          },
          {
            name: '监控中心',
            type: 'miniprogram',
            url: MENU_FALLBACK_URL,
            appid: mpAppid,
            pagepath: 'pages/monitor/monitor'
          },
          {
            name: '星舰进度',
            type: 'miniprogram',
            url: MENU_FALLBACK_URL,
            appid: mpAppid,
            pagepath: 'pages/progress/progress'
          },
          {
            name: '太空新闻',
            type: 'miniprogram',
            url: MENU_FALLBACK_URL,
            appid: mpAppid,
            pagepath: 'pages/news/news'
          },
          {
            name: '我的提醒',
            type: 'miniprogram',
            url: MENU_FALLBACK_URL,
            appid: mpAppid,
            pagepath: 'pages/profile/profile'
          }
        ]
      }
    ]
  }
}

async function menuGet(accessToken) {
  const url =
    'https://api.weixin.qq.com/cgi-bin/menu/get?access_token=' + encodeURIComponent(accessToken)
  const res = await axios.get(url)
  return res.data
}

async function menuCreate(accessToken, menu) {
  const url =
    'https://api.weixin.qq.com/cgi-bin/menu/create?access_token=' + encodeURIComponent(accessToken)
  const res = await axios.post(url, menu, {
    headers: { 'Content-Type': 'application/json' }
  })
  return res.data
}

exports.main = async (event) => {
  const action = String((event && event.action) || 'create').trim().toLowerCase()
  const cred = getOaCredentials()
  const mpAppid = getMpAppid()
  const menu = buildMenuPayload(mpAppid)

  if (!cred) {
    return {
      ok: false,
      error: '缺少 WECHAT_OA_APPID / WECHAT_OA_SECRET，请在云开发环境变量中配置'
    }
  }

  if (action === 'dryrun' || action === 'preview') {
    return {
      ok: true,
      action: 'dryRun',
      oaAppid: cred.appid,
      mpAppid: mpAppid,
      menu: menu,
      hint: '确认无误后使用 action=create 提交'
    }
  }

  try {
    const token = await getOaAccessToken()

    if (action === 'get') {
      const data = await menuGet(token)
      return { ok: true, action: 'get', oaAppid: cred.appid, mpAppid: mpAppid, result: data }
    }

    if (action !== 'create') {
      return { ok: false, error: '未知 action，支持 create / get / dryRun' }
    }

    const data = await menuCreate(token, menu)
    if (data.errcode && data.errcode !== 0) {
      return {
        ok: false,
        action: 'create',
        oaAppid: cred.appid,
        mpAppid: mpAppid,
        menu: menu,
        result: data,
        hint:
          data.errcode === 40018
            ? '菜单名过长；请缩短按钮名称'
            : data.errcode === 45064
              ? '未绑定小程序或无权跳转，需开放平台关联审核通过后重试'
              : '见微信返回 errcode/errmsg'
      }
    }

    return {
      ok: true,
      action: 'create',
      oaAppid: cred.appid,
      mpAppid: mpAppid,
      menu: menu,
      result: data,
      effectiveNote:
        '菜单一般 1–5 分钟内全网生效；若曾通过接口设置，公众平台后台的可视化菜单已失效，仅能通过本接口或开放平台再次发布。'
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}
