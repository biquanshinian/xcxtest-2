window.RocketToolData = {
  filters: [
    { id: "all", label: "全部" },
    { id: "wenchang", label: "文昌" },
    { id: "jiuquan", label: "酒泉" },
    { id: "inland", label: "西昌太原" },
    { id: "haiyang", label: "海阳" },
    { id: "overseas", label: "海外" }
  ],
  distances: [1, 3, 5, 8, 12, 20],
  soundSpeed: 340,
  radarAxes: [
    { key: "lift", label: "运力" },
    { key: "reuse", label: "复用" },
    { key: "size", label: "体量" },
    { key: "mark", label: "辨识" },
    { key: "use", label: "常见" }
  ],
  rockets: [
    { id: "cz5", filter: "wenchang", name: "长征五号", look: "粗壮芯级 + 4 助推", site: "文昌", leo: "约 25 吨", tons: 25, reuse: "一次", blurb: "滨海大直径，起飞段完整。", radar: { lift: 86, reuse: 22, size: 92, mark: 88, use: 72 } },
    { id: "cz7", filter: "wenchang", name: "长征七号", look: "中型捆绑，比长五更细", site: "文昌", leo: "约 14 吨", tons: 14, reuse: "一次", blurb: "货运与组合任务常见。", radar: { lift: 58, reuse: 22, size: 70, mark: 66, use: 78 } },
    { id: "cz8", filter: "wenchang", name: "长征八号", look: "两级液体，外形干净", site: "文昌", leo: "约 8 吨", tons: 8, reuse: "一次", blurb: "商业发射节奏较快。", radar: { lift: 42, reuse: 22, size: 56, mark: 52, use: 80 } },
    { id: "cz2f", filter: "jiuquan", name: "长征二号F", look: "顶部逃逸塔明显", site: "酒泉", leo: "约 8 吨", tons: 8, reuse: "一次", blurb: "载人构型，安检最严。", radar: { lift: 42, reuse: 22, size: 62, mark: 96, use: 64 } },
    { id: "zq3", filter: "jiuquan", name: "朱雀三号", look: "可复用粗壮芯级", site: "酒泉", leo: "约 18 吨", tons: 18, reuse: "可回收", blurb: "酒泉商发，回收叙事常见。", radar: { lift: 74, reuse: 94, size: 82, mark: 80, use: 48 } },
    { id: "lijian", filter: "jiuquan", name: "力箭一号", look: "白色多级细长固体", site: "酒泉", leo: "约 1.5 吨", tons: 1.5, reuse: "一次", blurb: "酒泉陆射固体箭。", radar: { lift: 18, reuse: 22, size: 36, mark: 46, use: 56 } },
    { id: "cz3b", filter: "inland", name: "长征三号乙", look: "芯级 + 助推", site: "西昌", leo: "约 11 吨", tons: 11, reuse: "一次", blurb: "北斗与高轨任务常见。", radar: { lift: 50, reuse: 22, size: 66, mark: 60, use: 84 } },
    { id: "cz6a", filter: "inland", name: "长征六号甲", look: "固体助推 + 液体芯级", site: "太原", leo: "约 8 吨", tons: 8, reuse: "一次", blurb: "太阳同步轨道、窗口短。", radar: { lift: 42, reuse: 22, size: 58, mark: 58, use: 70 } },
    { id: "ceres1s", filter: "haiyang", name: "谷神星一号（海射）", look: "细长固体，海上平台", site: "海阳", leo: "约 0.3 吨", tons: 0.3, reuse: "海射", blurb: "看的是船和平台，不是塔架。", radar: { lift: 8, reuse: 42, size: 22, mark: 72, use: 50 } },
    { id: "gravity1", filter: "haiyang", name: "引力一号", look: "多固体捆绑，发射船", site: "海阳", leo: "约 6.5 吨", tons: 6.5, reuse: "海射", blurb: "先找船，再找火。", radar: { lift: 36, reuse: 42, size: 78, mark: 86, use: 44 } },
    { id: "jl3", filter: "haiyang", name: "捷龙三号", look: "海射固体构型", site: "海阳", leo: "约 1.5 吨", tons: 1.5, reuse: "海射", blurb: "海阳母港固体海射。", radar: { lift: 18, reuse: 42, size: 32, mark: 54, use: 48 } },
    { id: "falcon9", filter: "overseas", name: "猎鹰 9 号", look: "白箭黑翼，一级可回收", site: "卡角 / 范登堡", leo: "约 22 吨", tons: 22, reuse: "可回收", blurb: "起飞之外，给回收区留方向。", radar: { lift: 82, reuse: 98, size: 72, mark: 90, use: 96 } },
    { id: "starship", filter: "overseas", name: "Starship 星舰", look: "不锈钢两级，超重 + 星舰", site: "Starbase", leo: "约 100 吨级", tons: 100, reuse: "可回收", blurb: "体量最大，震动和封路范围都大。", radar: { lift: 100, reuse: 96, size: 100, mark: 100, use: 42 } }
  ]
};
