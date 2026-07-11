/**
 * 小程序配置
 *
 * 【MARS 预览 - 微信云中转】
 * 将 cloud/MARS-preview.html 上传至 微信云开发 → 静态网站，
 * 在「文件管理」中拿到该文件的完整访问地址，填到 MARSCloudPreviewUrl。
 *
 * 地址格式：
 * - 默认测试域名：https://xxx-xxx.tcloudbaseapp.com/MARS-preview.html
 *   使用测试域名时会有腾讯云「页面访问提示」，点「确定访问」即可；正式环境建议绑定自定义域名。
 * - 自定义域名：https://你的已备案域名/MARS-preview.html（需在静态网站中先绑定并解析）。
 *
 * 重要：务必使用 静态网站 → 文件管理 中的访问地址，不要用 云存储 的「获取临时链接」。
 * 带 ?sign= 与 t= 的链接多为临时/一次性，易导致点「确定访问」后无法加载，应使用不含这些参数的地址。
 *
 * 业务域名：微信公众平台 → 开发管理 → 开发设置 → 业务域名 中
 * 添加上述根域名，并上传校验文件到静态网站根目录。详见 cloud/README.md「调试时常见问题」。
 */
module.exports = {
  // 微信云开发环境 ID
  cloudEnv: 'cloud1-9gdqgdt5bfaa20fb',
  /**
   * 视频号直播（channel-live / wx.getChannelsLiveInfo）
   * 要求：小程序与视频号须同主体；基础库 ≥ 2.29.0 方可使用 channel-live 组件
   */
  channelsLive: {
    finderUserName: 'sphRhrA54c8qKcU',
    /** 仅开发调试：主体不一致时手动兜底（正式环境请保持 enabled: false 并完成同主体认证） */
    manualFallback: {
      enabled: false,
      feedId: '',
      nonceId: '',
      status: 0,
      description: ''
    },
    /**
     * 自己视频号未开播时的引导（方案二：扫码进第三方视频号主页）
     * 正式以云端 adminGateway /channels-live-fallback-guide 为准。
     * 注意：此处不要写死旧二维码 URL，否则云端拉取失败/未完成时会一直显示历史旧图。
     */
    fallbackGuide: {
      enabled: false,
      title: '推荐观看',
      nickname: '',
      qrUrl: '',
      tip: '扫码前往视频号主页，可预约或观看直播'
    }
  },
  storeAppid: 'wx8d072f770b6f91ee',
  /** 流量主 · 激励式视频广告位（门控「看广告解锁 10 分钟」） */
  rewardedVideoAdUnitId: 'adunit-70ea9524f0415a31',
  // MARS 预览页完整 URL（部署后必填，不要带 ?sign=、t= 等临时链接参数）
  MARSCloudPreviewUrl: 'https://cloud1-9gdqgdt5bfaa20fb-1397421562.tcloudbaseapp.com/MARS-preview.html',
  // 用户网页预览 URL（包含星舰监控中心区域）
  userWebPreviewUrl: 'https://cloud1-9gdqgdt5bfaa20fb-1397421562.tcloudbaseapp.com/#/share/figma',
  // 星舰监控中心云中转页面 URL（部署后必填，用于解决第三方嵌入内容问题）
  // 部署步骤：
  // 1. 将 cloud/monitor-preview.html 上传到微信云开发静态网站
  // 2. 获取访问地址，填入下方
  // 3. 在微信公众平台配置业务域名
  monitorCloudPreviewUrl: '', // 例如：'https://cloud1-9gdqgdt5bfaa20fb-1397421562.tcloudbaseapp.com/monitor-preview.html'
  // 图片CDN配置
  imageCDN: {
    // CDN基础URL（微信云存储CDN域名；用于首页轮播、开屏动画等仍在云存储的路径）
    baseUrl: 'https://636c-cloud1-9gdqgdt5bfaa20fb-1397421562.tcb.qcloud.la/',
    // 火箭配置图若放在独立 COS（与 media_assets.url 同源），填写 COS/CDN 根地址；留空则自动用下方 inspirationCOS.cdnBaseUrl 或 baseUrl
    rocketCosBaseUrl: '',
    // 媒体映射集合名（默认为 media_assets）
    mediaCollection: 'media_assets',
    // 是否启用CDN（开发环境可设为false使用本地图片）
    enabled: true,
    // 图片映射调试开关：true 时输出详细诊断日志，建议仅开发排查时开启
    debug: false
  },
  // 独立 COS 桶配置（推文媒体、图标等通用媒体，替代 CloudBase 云存储以节省流量配额；键名为历史遗留）
  inspirationCOS: {
    bucket: 'mars-1397421562',
    region: 'ap-guangzhou',
    baseUrl: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/',
    /**
     * CDN 加速域名（配置后 utils/cos-url.js 自动将 COS 直链替换为此域名）
     *
     * 作用：① 降低 COS 外网流量费  ② 开启 HTTP/2（微信「网络性能」检测项）
     *
     * COS 默认桶域名 *.cos.*.myqcloud.com 通常仅 HTTP/1.1，profiler 会报「未开启 HTTP/2」。
     * 客户端无法单靠代码开启 HTTP/2，必须走 CDN 自定义域名并在控制台打开 HTTP/2。
     *
     * 腾讯云控制台步骤（运维手动）：
     * 1. CDN 控制台 → 域名管理 → 添加域名（如 cdn.marsx.com.cn 或 media.marsx.com.cn）
     * 2. 源站类型选「COS 源」，源站填 mars-1397421562.cos.ap-guangzhou.myqcloud.com
     * 3. HTTPS 配置：上传/绑定 SSL 证书并开启 HTTPS
     * 4. 高级配置 → 开启 HTTP/2
     * 5. 域名 CNAME 解析到 CDN 分配的加速域名
     * 6. 微信公众平台 → 开发设置 → downloadFile / request 合法域名：添加上述 CDN 域名
     * 7. 将下方 cdnBaseUrl 填为 'https://你的CDN域名/'（末尾保留斜杠）
     *
     * 留空则继续使用 baseUrl（COS 源站直连，无 HTTP/2）
     */
    cdnBaseUrl: ''
  },
  // Cloudflare Worker 代理地址（用于直播流获取等）
  // 部署后填入你的 Worker 地址，如 'https://spacex-proxy.你的账号.workers.dev'
  workerProxyUrl: 'https://api.marsx.com.cn',
  // 上拉加载交互统一配置（事件页 & 首页）
  loadMoreInteraction: {
    lowerThreshold: 120,
    triggerZone: 280
  },
  /** 首页「即将发射」任务卡片：火箭配置图倒计时（默认仅前 N 张显示） */
  missionCardCountdown: {
    visibleCount: 2
  },

  /**
   * Artemis II 星历简报 — 参见 subpackages/monitor-pages/utils/artemis-arow.js
   *
   * 请求链路：小程序 → Worker(/artemis-horizons) → JPL Horizons
   * 前置条件：
   *   1. cloudflare-worker/spacex-proxy.js 已部署（含 /artemis-horizons 路由）
   *   2. 微信公众平台 request 合法域名已添加 workerProxyUrl 的域名
   *
   * horizonsProxyUrl 可选：填完整代理地址则优先使用，否则自动拼 workerProxyUrl + '/artemis-horizons'
   */
  /**
   * request / downloadFile / uploadFile 合法域名清单（须在公众平台配置，代码无法代配）
   * 600002 = 域名未列入白名单。新增外链前请同步更新后台与本文档。
   *
   * request 合法域名：
   * - api.marsx.com.cn（workerProxyUrl，LL2/直播/B站/NASA 代理等）
   * - ll.thespacedevs.com、lldev.thespacedevs.com（Launch Library，开发/生产）
   * - mars-1397421562.cos.ap-guangzhou.myqcloud.com（COS 媒体）
   * - 636c-cloud1-9gdqgdt5bfaa20fb-1397421562.tcb.qcloud.la（云存储 CDN）
   * - cloud1-9gdqgdt5bfaa20fb-1397421562.tcloudbaseapp.com（静态网站/H5）
   * - api.open-meteo.com（Starbase 实况天气，可选）
   * - ssd-api.jpl.nasa.gov、eonet.gsfc.nasa.gov（NASA 子包，可选）
   * - rovers.nebulum.one（火星车照片，可选）
   * - admin.marsx.com.cn（管理后台 H5 预览，可选）
   *
   * downloadFile 合法域名：与 COS/CDN 及云存储域名一致；配置 inspirationCOS.cdnBaseUrl 后须同步添加 CDN 域名
   * - api.marsx.com.cn（飞船图鉴等经 Worker 代理的 LL2 图片本地缓存落盘依赖；未配置时自动降级为纯远程加载）
   * uploadFile 合法域名：COS 桶域名
   * 业务域名（web-view）：tcloudbaseapp.com、admin.marsx.com.cn 等
   */
  requestLegalDomains: [
    'api.marsx.com.cn',
    'll.thespacedevs.com',
    'lldev.thespacedevs.com',
    'mars-1397421562.cos.ap-guangzhou.myqcloud.com',
    '636c-cloud1-9gdqgdt5bfaa20fb-1397421562.tcb.qcloud.la',
    'cloud1-9gdqgdt5bfaa20fb-1397421562.tcloudbaseapp.com',
    'api.open-meteo.com',
    'ssd-api.jpl.nasa.gov',
    'eonet.gsfc.nasa.gov',
    'rovers.nebulum.one',
    'admin.marsx.com.cn'
  ],

  artemisArow: {
    enabled: true,
    /** 完整代理地址（不含 query），留空则用 workerProxyUrl + '/artemis-horizons' */
    horizonsProxyUrl: '',
    /** 轮询间隔（毫秒） */
    pollIntervalMs: 15000,
    /** 任务名称 */
    missionName: 'Artemis II',
    /** 发射时刻 UTC，用于计算 MET */
    launchUtcIso: '2026-04-01T22:35:12.000Z',
    /** 任务结束时刻 UTC（溅落/返回），留空表示任务进行中 */
    missionEndUtcIso: '2026-04-11T00:07:00.000Z',
    /** 任务总时长文字（任务结束后展示用，留空则自动计算） */
    missionDurationText: '约10天1小时32分钟',
    /** 时段外隐藏整个区块 */
    visibleAfterIso: '',
    visibleUntilIso: ''
  }
}
