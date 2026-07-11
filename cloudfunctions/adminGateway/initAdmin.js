 const cloud = require('wx-server-sdk')
const bcrypt = require('bcryptjs')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureCollectionMeta(collectionName) {
  const metaId = '__meta__'
  const ref = db.collection(collectionName).doc(metaId)
  const exists = await ref.get().catch(() => null)
  if (exists?.data) return

  const ts = Date.now()
  await ref.set({
    data: {
      _id: metaId,
      type: 'system_meta',
      note: '初始化占位文档，可保留',
      createdAt: ts,
      updatedAt: ts
    }
  })
}

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe_123456'
  const collectionOnly = String(process.env.INIT_COLLECTION_ONLY || '').toLowerCase() === 'true'

  await ensureCollectionMeta('batch_jobs')

  if (collectionOnly) {
    return
  }

  const exists = await db.collection('admin_users').where({ username }).limit(1).get()
  if ((exists.data || []).length > 0) {
    return
  }

  const now = Date.now()
  await db.collection('admin_users').add({
    data: {
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'super_admin',
      status: 'active',
      lastLoginAt: 0,
      createdAt: now,
      updatedAt: now
    }
  })

  console.log('管理员初始化成功，请立即登录后台修改默认密码')
}

main().catch((err) => {
  console.error('初始化失败:', err)
  process.exit(1)
})
