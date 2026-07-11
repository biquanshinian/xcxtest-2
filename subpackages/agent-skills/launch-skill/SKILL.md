# launch-tracker：全球航天发射查询

本 SKILL 提供全球火箭发射的查询能力：即将发射、近期已完成发射、单次发射详情、年度全球发射统计、发射商信息。数据来自 Launch Library 2（The Space Devs），经小程序云端缓存加工，时间均已换算为北京时间。

## 意图分流

- 用户问「最近/今天/本周/某发射商有什么发射」「什么时候发射」→ getUpcomingLaunches
- 用户问「最近发射了什么」「上次发射成功了吗」「某发射商最近战绩」→ getRecentLaunches
- 用户想了解某一次具体任务（时间、火箭、地点、任务内容）→ getLaunchDetail
- 用户问「今年/某年全球发了多少次火箭」「哪个国家/公司发射最多」→ getGlobalLaunchStats
- 用户问「XX 是什么公司/机构」「XX 发射过多少次」→ getAgencyInfo
- 用户表达模糊（如「有什么好看的发射」）→ 先调 getUpcomingLaunches 展示列表卡片，引导用户挑选

## 业务流程

1. 列表类查询（getUpcomingLaunches / getRecentLaunches）返回后，展示发射列表卡片，用一句话概括，等待用户挑选，不要主动逐条调用 getLaunchDetail。
2. 用户点击卡片中的任务或说出想看的任务 → 用对应 launchId 调用 getLaunchDetail → 介绍任务并提示可进入小程序查看完整详情。
3. 统计类查询（getGlobalLaunchStats）返回后，展示统计卡片并概括；若用户追问排行细节，直接引用返回的 topAgencies / topCountries / topRockets 回答，不要重复调用接口。
4. 发射商查询（getAgencyInfo）若返回 alternates，说明有多个近似匹配，可向用户确认后再次调用。

## 接口依赖

| 接口 | 前置条件 |
| --- | --- |
| getUpcomingLaunches | 无 |
| getRecentLaunches | 无 |
| getLaunchDetail | launchId 必须来自 getUpcomingLaunches 或 getRecentLaunches 的返回 |
| getGlobalLaunchStats | 无 |
| getAgencyInfo | 无 |

## 跨接口约束

1. launchId、agencyId 一律取自上游接口返回的原值，禁止从用户自然语言推断或编造。
2. 接口返回失败或空结果时，如实告知用户并按 content 中的指引处理，禁止以相同参数立即重试，禁止编造发射任务、发射时间或统计数字。
3. 所有时间字段 netBeijing 已是北京时间，直接展示，不要再做时区换算。
4. 发射时间可能推迟，回答即将发射的时间时建议附一句「发射时间可能调整，以实际为准」。
5. 同一含义字段跨接口同名：launchId、agencyKeyword、statusZh、netBeijing。
