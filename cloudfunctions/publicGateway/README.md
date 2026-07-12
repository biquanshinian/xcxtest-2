# 部署说明（小程序仓侧）

## publicGateway

1. 在微信云开发控制台上传并部署 `cloudfunctions/publicGateway`
2. 开通 HTTP 访问服务，路径映射为 `/public`（与 adminGateway 的 `/admin` 同级）
3. 确认云函数有权读取集合：
   - `space_devs_cache`, `launch_data`, `spacex_launch_stats`
   - `booster_genealogy`, `starshipStatus`, `starship_event_updates`
   - `media_assets`, `news_articles`, `global_config`, `road_closure_notice`
4. 可调用 `apiProxy`（飞船/发射场列表）

本地自检（部署后）：

```bash
curl -X POST "https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/public" \
  -H "Content-Type: application/json" \
  -d "{\"path\":\"/ping\",\"method\":\"GET\",\"query\":{}}"
```

## Cloudflare Worker

部署 `cloudflare-worker`：

```bash
cd cloudflare-worker
npx wrangler deploy
```

可选绑定 `PUBLIC_GATEWAY_URL`。验证：

```bash
curl "https://api.marsx.com.cn/public/v1/ping"
```
