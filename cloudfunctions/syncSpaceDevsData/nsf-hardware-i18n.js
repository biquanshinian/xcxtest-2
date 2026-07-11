/**
 * Next Spaceflight 星舰硬件设施中文化：
 * 状态/类型/分类标签映射、65 条载具简介的内置翻译表、测试名称与地点的短语翻译。
 * 网站新增载具时翻译表可能覆盖不到，此时前端显示英文原文。
 */

const STATUS_ZH = {
  Active: '活跃',
  Destroyed: '已损毁',
  Expended: '已消耗',
  Retired: '已退役'
}

const TYPE_ZH = {
  'Test Vehicle': '测试载具',
  'Full Stack': '组合体',
  'Structural Test Article': '结构测试件'
}

const CATEGORY_ZH = {
  fullstack: '组合体',
  booster: '助推器',
  ship: '飞船',
  suborbital: '亚轨道',
  other: '其他'
}

/** 按载具名称索引的简介中文翻译（名称为 NSF 稳定标识） */
const VEHICLE_NOTES_ZH = {
  'Ship 41': 'Ship 41 是 v3 星舰上面级原型机，预计执行星舰第 14 次试飞（Flight 14）。',
  'Booster 20': 'Booster 20 是 v3 超重型助推器原型机，预计执行星舰第 13 次试飞（Flight 13）。',
  'Ship 40': 'Ship 40 是 v3 星舰上面级原型机，预计执行星舰第 13 次试飞（Flight 13）。',
  'Booster 19/Ship 39': 'Booster 19 与 Ship 39 是共同执行星舰第 12 次试飞的助推器与上面级组合。这是星舰 V3 版本的首飞，也是星堡 2 号发射台的首次发射。',
  'Ship 39': 'Ship 39 是星舰上面级原型机，v3 飞船构型的首艘，执行了星舰第 12 次试飞。',
  'Booster 19': 'Booster 19 执行了星舰第 12 次试飞，即星舰组合体 v3 版本的首次发射。在首艘 v3 助推器 Booster 18 于气体系统压力测试中损失后，Booster 19 的研制进度被加快以顶替其任务。Booster 19 在飞行中的返程点火阶段失利。',
  'Booster 18': 'Booster 18 是首艘 v3 构型的超重型助推器，原定执行星舰第 12 次试飞，在气体系统压力测试中损毁。',
  'Booster 15/Ship 38': 'Booster 15 与 Ship 38 是共同执行星舰第 11 次试飞的助推器与上面级组合。这是星舰 V2 版本的最后一次飞行，也是星堡 1 号发射台现有构型下的最后一次发射。',
  'Ship 38': 'Ship 38 是星舰上面级原型机，也是最后一艘 v2 飞船，执行了星舰第 11 次试飞。',
  'Booster 17': 'Booster 17 是最后一艘 v2 超重型助推器原型机，未执行任何飞行任务。',
  'Booster 16/Ship 37': 'Booster 16 与 Ship 37 是共同执行星舰第 10 次试飞的助推器与上面级组合。',
  'Ship 37': 'Ship 37 是执行星舰第 10 次试飞的上面级原型机。飞行中 Ship 37 成为首艘从载荷舱部署星链模拟器的飞船，也是首艘按计划完成再入并在海面软着陆的 v2 飞船。由于 Ship 36 事故后 Masseys 静态点火台仍在修复，Ship 37 还成为首艘在轨道发射台上进行静态点火的星舰上面级原型机。',
  'Booster 16': 'Booster 16 是支持星舰第 10 次试飞的超重型助推器。级间分离后，Booster 16 进行了多项试验，包括在最后的三发动机着陆点火期间测试发动机失效容错能力，随后关机并按计划硬溅落。',
  'Ship 36': 'Ship 36 是星舰上面级原型机，在 Masseys 试验场准备静态点火时爆炸损毁。Ship 36 原定执行星舰第 10 次试飞。',
  'Booster 14/Ship 35': 'Booster 14 与 Ship 35 是执行星舰第 9 次试飞的超重型助推器与星舰组合。',
  'Ship 35': 'Ship 35 是执行星舰第 9 次试飞的上面级原型机，是首艘成功达到二级发动机关机（SECO）的 V2 飞船。',
  'Booster 15/Ship 34': 'Booster 15 与 Ship 34 是执行星舰第 8 次试飞的超重型助推器与星舰组合。',
  'Booster 15': 'Booster 15 是执行星舰第 8 次试飞的超重型助推器，并被发射塔成功接住。Booster 15 随后复飞并在星舰第 11 次试飞中消耗性使用，是该计划中第二枚复飞的助推器。',
  'Ship 34': 'Ship 34 是执行星舰第 8 次试飞的上面级原型机。与 Ship 33 类似，Ship 34 也在发动机关机前不久发生快速非计划解体（RUD），未能进入滑行阶段。',
  'Booster 14/Ship 33': 'Booster 14 与 Ship 33 是执行星舰第 7 次试飞的超重型助推器与星舰组合。Booster 14 被发射塔「筷子」机械臂成功接住，但 Ship 33 在预定发动机关机前不久发生快速非计划解体（RUD），未能完成任务。',
  'Booster 14': 'Booster 14 是执行星舰第 7 次试飞的超重型助推器，被发射塔「筷子」机械臂成功接住。其一台猛禽发动机（314）曾随 Booster 12 发射，并在第 7、9 次试飞中复用。Booster 14 是首枚被复用的超重型助推器，以 33 台发动机中 29 台经飞行验证的状态执行了星舰第 9 次试飞。',
  'Ship 33': 'Ship 33 是首艘新一代星舰上面级原型机，执行了星舰第 7 次试飞。Ship 33 在发动机关机前不久发生快速非计划解体（RUD），未能进入滑行阶段。',
  'Booster 13/Ship 31': 'Booster 13 与 Ship 31 是执行星舰第 6 次试飞的超重型助推器与星舰组合。',
  'Booster 13': 'Booster 13 是执行星舰第 6 次试飞的超重型助推器原型机。',
  'Ship 31': 'Ship 31 是执行星舰第 6 次试飞的上面级原型机，成为第三艘成功经受住大气再入的星舰，也是首艘在白昼着陆的星舰。',
  'Booster 12/Ship 30': 'Booster 12 与 Ship 30 是执行星舰第 5 次试飞的超重型助推器与星舰组合。Booster 12 成为首枚被发射塔「筷子」系统成功捕获的助推器。',
  'Booster 12': 'Booster 12 是执行星舰第 5 次试飞的超重型助推器原型机，成为首枚被发射塔「筷子」系统成功捕获的助推器。',
  'Ship 30': 'Ship 30 是执行星舰第 5 次试飞的上面级原型机，成为第二艘成功经受住大气再入的星舰，也是首艘精确软着陆于预定海面位置的星舰。',
  'Booster 11/Ship 29': 'Booster 11 与 Ship 29 是执行第四次综合试飞的超重型助推器与星舰组合，成为星舰计划中首对成功在海面软着陆的助推器与飞船。',
  'Booster 11': 'Booster 11 是执行星舰第四次综合试飞的超重型助推器原型机，成为首枚成功完成着陆点火并软着陆于墨西哥湾的超重型助推器。',
  'Ship 29': 'Ship 29 是执行星舰第四次综合试飞的上面级原型机，成为首艘成功经受住大气再入并在海面软着陆的星舰。',
  'Booster 10/Ship 28': 'Booster 10 与 Ship 28 是执行星舰第 3 次试飞的超重型助推器与星舰组合。',
  'Booster 10': 'Booster 10 是执行第三次星舰试飞的超重型助推器原型机。',
  'Ship 28': 'Ship 28 是执行第三次星舰试飞的上面级原型机。',
  'Ship 26': 'Ship 26 是用作地面测试件的星舰原型机。',
  'Booster 9/Ship 25': 'Booster 9 与 Ship 25 是执行星舰第二次综合试飞的超重型助推器与星舰组合。',
  'Booster 9': 'Booster 9 是超重型助推器原型机，是首枚为猛禽发动机配备电动推力矢量控制的助推器，也是首枚通过顶部加装热分离环支持热分离的助推器。',
  'Ship 25': 'Ship 25 是带隔热罩的星舰原型机，与 Booster 9 一同执行了星舰第二次综合试飞。其载荷舱被永久封闭。',
  'Booster 7/Ship 24': 'Booster 7 与 Ship 24 是执行星舰首次综合发射的超重型助推器与星舰组合。',
  'Ship 24': 'Ship 24 是首艘配备用于部署星链卫星的载荷舱门的星舰原型机，但该舱门后来被封闭。Ship 24 执行了星舰首次综合发射。',
  'Booster 7.1': 'Booster 7.1 是结构测试件，通过应力测试验证当前超重型设计的极限。',
  'Booster 7': 'Booster 7 是首艘可容纳 33 台猛禽发动机并采用固定气动面的超重型助推器，参与了星舰首次综合发射。',
  'Booster 4/Ship 20': 'Booster 4 与 Ship 20 是首对被组装成完整星舰堆栈的载具。它们原定执行首次轨道发射尝试，但该计划已变更。',
  'Ship 20': 'Ship 20 是首艘安装完整隔热罩的星舰原型机，也是首艘与助推器对接的飞船。原定参与星舰首次轨道发射，现已不再飞行。',
  'Booster 4': 'Booster 4 是首艘装配 29 台猛禽发动机和四个栅格舵的超重型助推器。原定参与星舰首次轨道发射，现已不再飞行。',
  'Booster 3': 'Booster 3 是首艘抵达发射场的超重型原型机，预计只在地面进行验证测试等试验，不进行试飞。',
  'B2.1': 'B2.1 是由飞船推力穹顶与助推器尾裙组合而成的测试件，这个特殊贮箱的用途尚不明确。',
  'BN2.1': 'BN2.1 是一个测试贮箱，通过带推力液压装置的低温耐压测试验证超重型推力段的结构强度。',
  'Starship SN15': '星舰 SN15 是进行了 10 公里高空试飞的星舰原型机，成为首艘在高空试飞后软着陆的原型机。SN15 相比此前原型机有数百项升级，包括改进的推力座和猛禽发动机。试飞后展示超过两年，最终于 2023 年 7 月 26 日被切割。',
  'Starship SN12 Nosecone': '星舰 SN12 的头锥是用于表征当前头锥设计性能极限的测试件。',
  'Starship SN11': '星舰 SN11 是进行了约 10 公里试飞的星舰原型机。着陆点火期间发生异常，导致载具损失。',
  'Starship SN10': '星舰 SN10 是使用三台猛禽发动机进行亚轨道飞行的星舰原型机。SN10 在成功着陆于着陆场几分钟后在爆炸中损毁。',
  'Starship SN9': '星舰 SN9 是为尝试与 SN8 类似的高空试飞而设计的测试载具。12 月 11 日 SN9 在高舱内处理时倾倒，撞墙受损，更换了两片襟翼后运往发射场。SN9 在试飞中经历了硬着陆。',
  'Starship SN8': '星舰 SN8 是为执行 12.5 公里试飞设计的测试载具，成为首艘装配三台猛禽发动机（SN30、SN32、SN39）的星舰。第一次静态点火后 SN39 被 SN36 替换；第三次静态点火后 SN32 因异常被 SN42 替换，最终由 SN30、SN36、SN42 执行试飞。飞行中因集管贮箱压力异常损失，但完成了大量测试目标。',
  'Starship SN7.2': 'SN7.2 是用于测试更薄的 3 毫米不锈钢材料的测试贮箱，为未来星舰原型机做验证。该贮箱进行了两次低温耐压测试。',
  'Starship SN7.1': 'SN7.1 原型机在测试收尾阶段被测试至失效，用于验证新的制造工艺。',
  'Starship SN7': '星舰 SN7 是用于测试新型钢合金（304L）和焊接工艺的小型原型贮箱，曾两次被测试至损毁——第二次达到了创纪录的压力。',
  'Starship SN6': '星舰 SN6 使用猛禽 SN29 成功完成了 150 米跳跃试飞。',
  'Starship SN5': '星舰 SN5 成功飞至 150 米，成为首个飞行的全尺寸贮箱段。飞行使用猛禽 SN27。',
  'Starship SN4': '星舰 SN4 是首个通过低温耐压测试的全尺寸贮箱段，随后完成多次成功静态点火，最终在一次成功静态点火后因快速断连装置故障在爆炸中损毁。第一轮静态点火使用猛禽 SN18，第二轮使用 SN20。',
  'Starship SN3': '星舰 SN3 在低温耐压测试中损毁。测试期间液氧贮箱压力不足，在加注甲烷贮箱的重压下坍塌，事故归因于测试配置失误。',
  'Starship SN2': '星舰 SN2 原计划作为全尺寸星舰贮箱段进行 150 米跳跃。SN1 损失后，SN2 改为小型测试贮箱，以快速验证推力段的设计改进。SN2 成功通过了带模拟发动机推力载荷的低温耐压测试。',
  'Starship SN1': '星舰 SN1 是在低温耐压测试中爆裂的星舰原型机。测试中由液压活塞模拟猛禽发动机推力，其「推力座」未能承受载荷。',
  'Starship Mk1': '星舰 Mk1 是首个全尺寸星舰原型机。曾为其制造整流罩，但未在发射场测试中使用。载具在低温耐压测试中因贮箱爆裂损失。',
  'Starhopper': '星虫（Starhopper）是缩小尺寸的星舰原型机，作为探路者帮助 SpaceX 积累不锈钢结构经验，完成了 SpaceX 甲烷猛禽发动机的前两次飞行测试。'
}

/** 测试名称短语翻译（按最长短语优先匹配，保留 #N 序号） */
const TEST_NAME_PHRASES = [
  ['Single-Engine Static Fire', '单发动机静态点火'],
  ['Single Engine Static Fire', '单发动机静态点火'],
  ['33-Engine Static Fire', '33 发动机静态点火'],
  ['31-Engine Static Fire', '31 发动机静态点火'],
  ['10-Engine Static Fire', '10 发动机静态点火'],
  ['6-Engine Static Fire', '六发动机静态点火'],
  ['Static Fire', '静态点火'],
  ['Cryogenic Proof Test', '低温耐压测试'],
  ['Cryogenic Proof', '低温耐压测试'],
  ['Cryogenic Loading Test', '低温加注测试'],
  ['Spin Prime Test', '旋转预冷测试'],
  ['Spin Prime', '旋转预冷测试'],
  ['Wet Dress Rehearsal', '湿彩排'],
  ['Preburner Test', '预燃室测试'],
  ['Preburner', '预燃室测试'],
  ['Partial Propellant Load Test', '部分推进剂加注测试'],
  ['Propellant Loading Test', '推进剂加注测试'],
  ['Propellant Load Test', '推进剂加注测试'],
  ['Propellent Loading Test', '推进剂加注测试'],
  ['Partial Tanking Test', '部分加注测试'],
  ['Tanking Test', '加注测试'],
  ['Igniter Test', '点火器测试'],
  ['Pressurize to Failure', '加压至失效测试'],
  ['Gas System Pressure Testing', '气体系统压力测试'],
  ['LOX Header Proof Test', '液氧集管贮箱耐压测试'],
  ['Proof Testing', '耐压验证测试'],
  ['Proof Test', '耐压验证测试'],
  ['Unknown Test', '未知测试'],
  ['10-Kilometer Test Flight', '10 公里试飞'],
  ['10km Test Flight', '10 公里试飞'],
  ['12.5km Test Flight', '12.5 公里试飞'],
  ['150 Meter Hop', '150 米跳跃试飞'],
  ['150-Meter Hop', '150 米跳跃试飞'],
  ['18 Meter Hop', '18 米跳跃试飞'],
  ['Starship Flight Test 2', '星舰第 2 次综合试飞'],
  ['Starship Test Flight', '星舰试飞'],
  ['Starship Flight', '星舰试飞 Flight']
]

/** 测试/发射地点翻译 */
const LOCATION_ZH = {
  'Pad 1, Starbase, Texas, USA': '星堡 1 号发射台（德州）',
  'Pad 2, Starbase, Texas, USA': '星堡 2 号发射台（德州）',
  'Suborbital Pad A, Starbase, Texas, USA': '星堡亚轨道 A 台（德州）',
  'Suborbital Pad B, Starbase, Texas, USA': '星堡亚轨道 B 台（德州）',
  'Cryostation, Massey Outpost, Texas, USA': 'Massey 试验场低温测试站（德州）',
  'Static Fire Stand, Massey Outpost, Texas, USA': 'Massey 试验场静态点火台（德州）',
  'Test Tank Pad, Starbase, Texas, USA': '星堡测试贮箱台（德州）',
  'Launch Site Cryostation, Starbase, Texas, USA': '星堡发射场低温测试站（德州）'
}

function translateVehicleNotes(name, notesEn) {
  const zh = VEHICLE_NOTES_ZH[String(name || '').trim()]
  return zh || String(notesEn || '')
}

function translateTestName(nameEn) {
  const raw = String(nameEn || '').trim()
  if (!raw) return ''
  // 特例：Starship Flight N（发射）
  const flightMatch = raw.match(/^Starship Flight (?:Test )?(\d+)$/)
  if (flightMatch) return `星舰第 ${flightMatch[1]} 次试飞`
  const numMatch = raw.match(/\s*#(\d+)$/)
  const base = numMatch ? raw.slice(0, raw.length - numMatch[0].length) : raw
  for (const [en, zh] of TEST_NAME_PHRASES) {
    if (base === en) return numMatch ? `${zh} #${numMatch[1]}` : zh
  }
  return raw
}

function translateLocation(locEn) {
  const raw = String(locEn || '').trim()
  return LOCATION_ZH[raw] || raw
}

module.exports = {
  STATUS_ZH,
  TYPE_ZH,
  CATEGORY_ZH,
  VEHICLE_NOTES_ZH,
  translateVehicleNotes,
  translateTestName,
  translateLocation
}
