<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span>知识卡管理（{{ total }}条）</span>
        <div style="display:flex;gap:8px">
          <el-input v-model="keyword" placeholder="搜索内容/分类" clearable style="width:200px" @keyup.enter="onSearch" @clear="onSearch" />
          <el-button @click="onSearch">搜索</el-button>
          <el-button type="warning" @click="onBatchImport">从默认导入</el-button>
          <el-button type="primary" @click="openDialog()">新增卡片</el-button>
        </div>
      </div>
    </template>

    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column label="序号" prop="cardId" width="70" />
      <el-table-column label="分类" prop="category" width="120">
        <template #default="{ row }">
          <el-tag size="small">{{ row.category }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="知识内容" prop="fact" min-width="360" show-overflow-tooltip />
      <el-table-column label="来源" prop="source" width="100" />
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '禁用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openDialog(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-if="total > pageSize"
      style="margin-top:16px;justify-content:center"
      layout="prev, pager, next"
      :total="total"
      :page-size="pageSize"
      :current-page="page"
      @current-change="p => { page = p; load() }"
    />

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑知识卡' : '新增知识卡'" width="560px" destroy-on-close>
      <el-form :model="form" label-width="80px">
        <el-form-item label="序号">
          <el-input-number v-model="form.cardId" :min="1" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" filterable allow-create placeholder="选择或输入分类">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.fact" type="textarea" :rows="4" placeholder="知识卡内容" />
        </el-form-item>
        <el-form-item label="来源">
          <el-input v-model="form.source" placeholder="例：NASA、SpaceX" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'

const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 50
const keyword = ref('')

const dialogVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const form = reactive({
  cardId: 1,
  category: '',
  fact: '',
  source: '',
  enabled: true
})

const categories = computed(() => {
  const cats = new Set(list.value.map(c => c.category).filter(Boolean))
  return [...cats].sort()
})

async function load() {
  loading.value = true
  try {
    const res = await api.listKnowledgeCards({ page: page.value, pageSize, keyword: keyword.value })
    list.value = res?.list || []
    total.value = res?.total || 0
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.message || e))
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  load()
}

function openDialog(row) {
  editing.value = row || null
  form.cardId = row?.cardId || (list.value.length ? Math.max(...list.value.map(c => c.cardId || 0)) + 1 : 1)
  form.category = row?.category || ''
  form.fact = row?.fact || ''
  form.source = row?.source || ''
  form.enabled = row?.enabled !== false
  dialogVisible.value = true
}

async function onSave() {
  if (!form.fact) return ElMessage.warning('请填写知识内容')
  saving.value = true
  try {
    if (editing.value) {
      await api.updateKnowledgeCard(editing.value._id, { ...form })
      ElMessage.success('更新成功')
    } else {
      await api.createKnowledgeCard({ ...form })
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    load()
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.message || e))
  } finally {
    saving.value = false
  }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除序号 ${row.cardId} 的知识卡？`, '确认删除', { type: 'warning' })
    await api.deleteKnowledgeCard(row._id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

async function onBatchImport() {
  try {
    await ElMessageBox.confirm(
      '将把小程序内置的60条太空知识卡导入到云数据库。已存在的卡片不会去重，建议仅在首次使用时操作。',
      '批量导入',
      { type: 'warning', confirmButtonText: '确认导入' }
    )
  } catch { return }

  const defaultCards = [
    { id: 1, category: '太阳系', fact: '土星的密度比水还低，如果有一个足够大的浴缸，土星能浮在水面上。', source: 'NASA' },
    { id: 2, category: '宇宙', fact: '可观测宇宙的直径约930亿光年，包含至少2万亿个星系。', source: 'Hubble' },
    { id: 3, category: '火星', fact: '火星上的奥林匹斯山是太阳系最高的山，高度约21.9公里，是珠穆朗玛峰的近3倍。', source: 'NASA' },
    { id: 4, category: 'SpaceX', fact: 'SpaceX的猎鹰9号是人类历史上第一款成功实现一级助推器回收复用的轨道级运载火箭。', source: 'SpaceX' },
    { id: 5, category: '太阳系', fact: '金星的一天（自转周期243地球日）比它的一年（公转周期225地球日）还长。', source: 'NASA' },
    { id: 6, category: '宇宙', fact: '中子星的密度极高，一茶匙的中子星物质重约60亿吨，相当于一座山的重量。', source: 'ESA' },
    { id: 7, category: '月球', fact: '月球正在以每年3.8厘米的速度远离地球。在遥远的未来，月球将不再能完全遮挡太阳。', source: 'NASA' },
    { id: 8, category: 'SpaceX', fact: '星舰（Starship）高度约120米，是人类有史以来最高最强大的运载火箭。', source: 'SpaceX' },
    { id: 9, category: '太阳系', fact: '木星的大红斑是一个已经持续了至少400年的超级风暴，大小足以容纳两个地球。', source: 'NASA' },
    { id: 10, category: '宇宙', fact: '宇宙的年龄约138亿年。光从宇宙诞生至今走过的距离，约等于从地球到太阳距离的8.7万亿倍。', source: 'Planck' },
    { id: 11, category: '火星', fact: '火星的日落是蓝色的。由于火星大气中的尘埃粒子散射光线的方式，夕阳呈现冷蓝色调。', source: 'Curiosity' },
    { id: 12, category: '太阳', fact: '太阳每秒钟将约400万吨物质转化为能量，但即使以这个速率燃烧，太阳还能再燃烧约50亿年。', source: 'NASA' },
    { id: 13, category: '空间站', fact: '国际空间站以每小时27,600公里的速度运行，每90分钟绕地球一圈，宇航员每天能看到16次日出。', source: 'NASA' },
    { id: 14, category: 'SpaceX', fact: 'SpaceX的星链计划已发射超过6,000颗卫星，构成人类历史上最大的卫星星座。', source: 'SpaceX' },
    { id: 15, category: '太阳系', fact: '海王星上的风速可达每小时2,100公里，是太阳系中风速最快的行星。', source: 'Voyager' },
    { id: 16, category: '宇宙', fact: '宇宙中存在一个被称为"牧夫座空洞"的区域，直径约3.3亿光年，几乎完全空无一物。', source: 'Astronomy' },
    { id: 17, category: '月球', fact: '阿波罗宇航员在月球上留下的脚印可以保存数百万年，因为月球没有风和水来侵蚀它们。', source: 'NASA' },
    { id: 18, category: '火星', fact: '好奇号火星车每年火星生日时都会为自己唱一首生日快乐歌。它于2012年着陆，至今仍在工作。', source: 'NASA' },
    { id: 19, category: '太阳系', fact: '冥王星的心形区域（汤博区）大小约与得克萨斯州相当，由氮冰覆盖。', source: 'New Horizons' },
    { id: 20, category: '宇宙', fact: '已知最大的恒星盾牌座UY，半径约是太阳的1,700倍。如果把它放在太阳系中心，其表面会延伸到木星轨道附近。', source: 'ESO' },
    { id: 21, category: 'SpaceX', fact: '猎鹰重型火箭的首飞载荷是一辆特斯拉Roadster跑车，车上播放着大卫·鲍伊的《Space Oddity》。', source: 'SpaceX' },
    { id: 22, category: '太阳系', fact: '天王星的自转轴倾斜了98度，几乎是"躺着"绕太阳公转的，一个极点会连续面对太阳42年。', source: 'NASA' },
    { id: 23, category: '宇宙', fact: '黑洞并不是"洞"，而是密度极大的天体。一个太阳质量的黑洞，其史瓦西半径仅约3公里。', source: 'Physics' },
    { id: 24, category: '火星', fact: '火星大气中95%是二氧化碳，气压仅为地球的0.6%。毅力号正在用MOXIE装置尝试将CO₂转化为氧气。', source: 'NASA' },
    { id: 25, category: '空间站', fact: '中国天宫空间站总重约100吨，由天和核心舱、问天实验舱和梦天实验舱组成。', source: 'CMSA' },
    { id: 26, category: '太阳', fact: '太阳的核心温度约1,500万度，每秒进行约3.8×10²⁶焦耳的核聚变反应。', source: 'NASA' },
    { id: 27, category: '宇宙', fact: '旅行者1号于1977年发射，目前距地球超过240亿公里，是离地球最远的人造物体。', source: 'NASA' },
    { id: 28, category: 'SpaceX', fact: 'SpaceX龙飞船是首个由私人公司开发并将宇航员送入国际空间站的载人航天器。', source: 'SpaceX' },
    { id: 29, category: '太阳系', fact: '木星的卫星木卫二（欧罗巴）冰层下可能存在一个巨大的液态水海洋，水量可能是地球海洋的两倍。', source: 'NASA' },
    { id: 30, category: '月球', fact: '月球表面的温度变化极端：白天可达127°C，夜晚可降至-173°C，温差达300度。', source: 'NASA' },
    { id: 31, category: '宇宙', fact: '如果你能以光速旅行，到达最近的恒星比邻星也需要4.24年。', source: 'ESA' },
    { id: 32, category: '火星', fact: '火星的两颗卫星火卫一和火卫二非常小，可能是被火星引力捕获的小行星。', source: 'NASA' },
    { id: 33, category: '太阳系', fact: '土星环主要由冰粒和岩石碎片组成，虽然宽达28万公里，但最薄处仅约10米。', source: 'Cassini' },
    { id: 34, category: 'SpaceX', fact: '马斯克的终极目标是在火星建立百万人口的自给自足城市，使人类成为多行星物种。', source: 'SpaceX' },
    { id: 35, category: '宇宙', fact: '在太空中，宇航员的身高会增加约5厘米，因为脊椎在微重力下不再受到地球引力的压缩。', source: 'NASA' },
    { id: 36, category: '太阳系', fact: '水星虽然离太阳最近，但金星才是太阳系最热的行星（约465°C），因为其浓厚的CO₂大气产生了极端温室效应。', source: 'NASA' },
    { id: 37, category: '空间站', fact: 'ISS上的水循环系统能回收约90%的液体，包括汗液和尿液，净化后供宇航员饮用。', source: 'NASA' },
    { id: 38, category: '宇宙', fact: '宇宙微波背景辐射的温度约为2.7开尔文（-270.4°C），是大爆炸留下的"余温"。', source: 'COBE' },
    { id: 39, category: '火星', fact: '火星上的尘暴可以覆盖整个星球，持续数月之久。2018年的全球尘暴导致机遇号火星车永久失联。', source: 'NASA' },
    { id: 40, category: 'SpaceX', fact: 'Starlink卫星配备了自主避碰系统，能根据太空碎片追踪数据自动调整轨道。', source: 'SpaceX' },
    { id: 41, category: '太阳系', fact: '小行星带位于火星和木星之间，但所有小行星的总质量还不到月球的4%。', source: 'NASA' },
    { id: 42, category: '宇宙', fact: '暗物质和暗能量合计占宇宙总质能的约95%，我们能看到的普通物质仅占约5%。', source: 'Planck' },
    { id: 43, category: '月球', fact: '月球上有水冰存在的证据。NASA的LCROSS任务在月球南极永久阴影坑中发现了水冰。', source: 'NASA' },
    { id: 44, category: '太阳', fact: '一次大型日冕物质抛射（CME）可以释放10²⁵焦耳的能量，相当于数十亿颗原子弹同时爆炸。', source: 'SOHO' },
    { id: 45, category: '宇宙', fact: '脉冲星是高速旋转的中子星，有些脉冲星每秒可旋转716次，比家用搅拌机的转速还快。', source: 'Astronomy' },
    { id: 46, category: 'Artemis', fact: 'NASA的阿耳忒弥斯计划旨在2020年代将首位女性和首位有色人种宇航员送上月球。', source: 'NASA' },
    { id: 47, category: '太阳系', fact: '土卫六（泰坦）是太阳系中唯一拥有浓厚大气层和表面液态湖泊的卫星，不过湖泊里是液态甲烷。', source: 'Cassini' },
    { id: 48, category: '火星', fact: '火星赤道附近曾存在大量河流和湖泊的痕迹，科学家认为约35亿年前火星可能有过温暖湿润的环境。', source: 'ESA' },
    { id: 49, category: '宇宙', fact: '引力波在2015年被LIGO首次直接探测到，验证了爱因斯坦100年前的预言。', source: 'LIGO' },
    { id: 50, category: 'SpaceX', fact: 'SpaceX的猛禽发动机使用液态甲烷和液氧作为推进剂，部分原因是火星上可以就地生产甲烷燃料。', source: 'SpaceX' },
    { id: 51, category: '太阳系', fact: '木星拥有至少95颗已知卫星，其中木卫三是太阳系最大的卫星，比水星还大。', source: 'NASA' },
    { id: 52, category: '宇宙', fact: 'GPS卫星需要考虑相对论效应修正时钟——由于卫星速度和引力差异，每天会产生约38微秒的误差。', source: 'Physics' },
    { id: 53, category: '中国航天', fact: '长征系列运载火箭已完成500多次发射任务，是中国航天的主力运载工具。', source: 'CASC' },
    { id: 54, category: '中国航天', fact: '嫦娥五号于2020年成功带回约1.7公斤月球样本，是人类时隔44年再次获取月壤。', source: 'CNSA' },
    { id: 55, category: '宇宙', fact: '在真空的太空中，两块相同金属的裸露表面接触后会永久粘合在一起，这叫做"冷焊接"。', source: 'NASA' },
    { id: 56, category: '太阳系', fact: '天王星和海王星内部可能在极端高压下产生"钻石雨"——碳原子被压缩成钻石并像雨一样降落。', source: 'Nature' },
    { id: 57, category: '火星', fact: '火星一天（火星日）约24小时37分钟，与地球的一天非常接近，这是它适合人类殖民的原因之一。', source: 'NASA' },
    { id: 58, category: '宇宙', fact: '地球每天约有100吨来自太空的微小陨石尘埃落入大气层，大部分在高空就被烧毁。', source: 'ESA' },
    { id: 59, category: 'SpaceX', fact: '星舰的超重型助推器（Super Heavy）配备33台猛禽发动机，总推力约7,590吨力。', source: 'SpaceX' },
    { id: 60, category: '太阳系', fact: '海王星的卫星海卫一（Triton）是太阳系中唯一一颗逆行运转的大卫星，可能是被海王星捕获的柯伊伯带天体。', source: 'Voyager' }
  ]

  loading.value = true
  try {
    const res = await api.batchImportKnowledgeCards({ cards: defaultCards })
    ElMessage.success(`成功导入 ${res?.imported || 0} 条知识卡`)
    load()
  } catch (e) {
    ElMessage.error('导入失败: ' + (e.message || e))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
