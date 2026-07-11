// 初始化 tweet_accounts 集合的脚本
// 在微信开发者工具的云开发控制台中运行，或通过云函数执行一次

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const INITIAL_ACCOUNTS = [
  { screenName: 'SpaceX', label: 'SpaceX', author: 'SpaceX自动追踪', cosFolder: 'SpaceX推文图片' },
  { screenName: 'Starlink', label: 'Starlink', author: 'Starlink自动追踪', cosFolder: 'Starlink推文图片' },
  { screenName: 'NASASpaceflight', label: 'NSF', author: 'NSF自动追踪', cosFolder: 'NSF推文图片' },
  { screenName: 'StarshipGazer', label: 'StarshipGazer', author: 'StarshipGazer自动追踪', cosFolder: 'StarshipGazer推文图片' },
  { screenName: 'NASA', label: 'NASA', author: 'NASA自动追踪', cosFolder: 'NASA推文图片' },
  { screenName: 'elonmusk', label: 'Elon Musk', author: 'Elon Musk自动追踪', cosFolder: 'ElonMusk推文图片' }
]

exports.main = async () => {
  const col = db.collection('tweet_accounts')
  const now = Date.now()
  const results = []

  for (const account of INITIAL_ACCOUNTS) {
    // 检查是否已存在
    const existing = await col.where({ screenName: account.screenName }).limit(1).get()
    if (existing.data && existing.data.length > 0) {
      results.push({ screenName: account.screenName, status: 'skipped', reason: 'already exists' })
      continue
    }

    const doc = {
      ...account,
      avatarUrl: '',
      enabled: true,
      createdAt: now,
      updatedAt: now
    }
    const res = await col.add({ data: doc })
    results.push({ screenName: account.screenName, status: 'created', _id: res._id })
  }

  return { success: true, results }
}
