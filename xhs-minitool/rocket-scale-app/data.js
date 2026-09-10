window.RocketScaleData = {
  filters: [
    { id: "all", label: "全部" },
    { id: "wenchang", label: "文昌" },
    { id: "jiuquan", label: "酒泉" },
    { id: "inland", label: "西昌太原" },
    { id: "haiyang", label: "海阳" },
    { id: "overseas", label: "海外" }
  ],
  busTons: 15,
  refs: [
    { id: "human", label: "人", short: "你", height: 1.7, color: "#F4F1EA" },
    { id: "bus", label: "公交", short: "公交", height: 12, color: "#9AA0A8" },
    { id: "floor10", label: "10 层楼", short: "10层", height: 30, color: "#CFE0FF" },
    { id: "b737", label: "波音 737", short: "737", height: 40, color: "#3B82F6" }
  ],
  rockets: [
    { id: "cz5", filter: "wenchang", name: "长征五号", look: "粗壮芯级 + 4 助推", site: "文昌", height: 57, mass: 870, shape: "boost" },
    { id: "cz7", filter: "wenchang", name: "长征七号", look: "中型捆绑，比长五更细", site: "文昌", height: 53, mass: 600, shape: "boost" },
    { id: "cz8", filter: "wenchang", name: "长征八号", look: "两级液体，外形干净", site: "文昌", height: 50, mass: 360, shape: "slim" },
    { id: "cz2f", filter: "jiuquan", name: "长征二号F", look: "顶部逃逸塔明显", site: "酒泉", height: 58, mass: 480, shape: "tower" },
    { id: "zq3", filter: "jiuquan", name: "朱雀三号", look: "可复用粗壮芯级", site: "酒泉", height: 66, mass: 660, shape: "fat" },
    { id: "lijian", filter: "jiuquan", name: "力箭一号", look: "白色多级细长固体", site: "酒泉", height: 30, mass: 135, shape: "slim" },
    { id: "cz3b", filter: "inland", name: "长征三号乙", look: "芯级 + 助推", site: "西昌", height: 56, mass: 460, shape: "boost" },
    { id: "cz6a", filter: "inland", name: "长征六号甲", look: "固体助推 + 液体芯级", site: "太原", height: 50, mass: 530, shape: "boost" },
    { id: "ceres1s", filter: "haiyang", name: "谷神星一号（海射）", look: "细长固体，海上平台", site: "海阳", height: 20, mass: 33, shape: "slim" },
    { id: "gravity1", filter: "haiyang", name: "引力一号", look: "多固体捆绑，发射船", site: "海阳", height: 31, mass: 405, shape: "boost" },
    { id: "jl3", filter: "haiyang", name: "捷龙三号", look: "海射固体构型", site: "海阳", height: 32, mass: 140, shape: "slim" },
    { id: "falcon9", filter: "overseas", name: "猎鹰 9 号", look: "白箭黑翼，一级可回收", site: "卡角 / 范登堡", height: 70, mass: 550, shape: "slim" },
    { id: "starship", filter: "overseas", name: "Starship 星舰", look: "不锈钢两级，超重 + 星舰", site: "Starbase", height: 121, mass: 5000, shape: "fat" }
  ]
};
