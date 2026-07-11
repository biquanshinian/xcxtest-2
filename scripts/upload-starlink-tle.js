/**
 * 本地脚本：拉取 Starlink TLE 数据并通过微信云开发 HTTP API 写入数据库
 * 
 * 使用方法：
 * 1. 在微信开发者工具中打开「云开发控制台」→「数据库」→ 确保 starlink_tle 集合已创建
 * 2. 在微信开发者工具的控制台中直接粘贴运行以下代码（调试器 Console 面板）
 * 
 * 或者在小程序页面的 JS 中临时加一个按钮调用此函数
 */

// ===== 方法 1：在微信开发者工具控制台中运行 =====
// 打开小程序项目 → 调试器 → Console → 粘贴以下代码

async function uploadStarlinkTLE() {
  console.log('开始拉取 TLE 数据...')
  
  try {
    // 从 Worker 精简版端点拉取（~100KB）
    const res = await new Promise((resolve, reject) => {
      wx.request({
        url: 'https://spacex-proxy.huyuzetongxue.workers.dev/starlink-tle-mini',
        method: 'GET',
        timeout: 60000,
        success: resolve,
        fail: reject
      })
    })

    if (res.statusCode !== 200 || !res.data) {
      console.error('拉取失败:', res.statusCode)
      return
    }

    const json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
    console.log(`拉取成功: ${json.total} 颗卫星, 采样 ${json.sampled} 颗`)

    // 写入云数据库
    const db = wx.cloud.database()
    const collection = db.collection('starlink_tle')
    const { total } = await collection.count()

    const record = {
      format: 'tle',
      data: json.tle,
      totalCount: json.total,
      sampledCount: json.sampled,
      source: 'manual-upload',
      updatedAt: new Date(),
      updatedAtMs: Date.now()
    }

    if (total > 0) {
      const { data } = await collection.limit(1).get()
      await collection.doc(data[0]._id).update({ data: record })
      console.log('✅ 更新成功!')
    } else {
      await collection.add({ data: record })
      console.log('✅ 写入成功!')
    }
  } catch (err) {
    console.error('失败:', err)
  }
}

// 执行
uploadStarlinkTLE()
