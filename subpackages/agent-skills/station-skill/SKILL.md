# station-tracker：空间站动态

本 SKILL 提供在轨空间站的查询能力：站点概览（状态/在轨人数/停靠飞行器）与乘组名单。数据来自 Launch Library 2 云端缓存，覆盖国际空间站 ISS、天宫空间站及未来新增的在轨空间站，对接时间为北京时间。

## 意图分流

- 用户问「现在有几个空间站」「天宫/ISS 停了几艘飞船」「空间站现状」→ getSpaceStations
- 用户问「中国空间站现在有几个人/有谁」「ISS 乘组是谁」→ getStationCrew（指明了站就传 stationKeyword）
- 用户笼统问「空间站怎么样了」→ 先调 getSpaceStations 概览，用户追问乘组再调 getStationCrew

## 业务流程

1. getSpaceStations 返回后概括各站现状，等待用户追问，不要主动再调 getStationCrew。
2. getStationCrew 按 stationKeyword 过滤；用户没指明空间站时不传该参数，返回全部。
3. 宇航员姓名为英文/拼音原文，中国航天员可按拼音还原中文名（如 Wang Haoze → 王浩泽），不确定时保留原文，不要猜测。

## 跨接口约束

1. stationKeyword 只在用户明确指了某个站时才传；接口失败或无匹配时如实告知，禁止编造空间站、乘组或飞行器信息。
2. 对接时间已是北京时间，直接展示。
3. 深度内容（乘组头像、轨道参数、对接舱位图）引导用户进入小程序空间站详情页或监控中心。
