# 公众号采集浏览器扩展

Chrome / Edge：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本目录。

## 配置

1. 云函数 `adminGateway` 环境变量增加 `OA_COLLECTOR_TOKEN`（随机长串）。
2. 扩展弹窗填写：
   - Admin API Base：与后台一致，例如 `https://cloud1-xxx.ap-shanghai.app.tcloudbase.com/admin`
   - Token：与上面环境变量相同

## 使用

### 采集最新 5 篇（对标账号）

1. 微信打开对标公众号（如「SpaceX时光机」）→ 右上角 → **查看历史消息**。
2. 将历史消息页在 Chrome 中打开（或复制链接到 Chrome）。
3. 点扩展 → **采集最新 5 篇**（会拉取列表并抓正文，约 10–30 秒）。
4. 后台「公众号内容 → 对标资产库 → 对标账号」点 **文章**，可对每篇 **洗稿** 进草稿箱。

### 采集单篇

打开 `mp.weixin.qq.com` 文章页 → **采集当前文章**。

数据进入「采集入库 / 爆文库」，并自动关联或创建对标账号。
