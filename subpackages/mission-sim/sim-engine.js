/**
 * 星舰任务指挥室：确定性模拟引擎（纯 JS，无云调用、无外部资源）
 *
 * 设计：
 * - seed 驱动（mulberry32），同 seed + 同决策 = 同一场任务，可复盘可分享
 * - 玩家不开火箭，只做飞行总监决策：席位 GO/NO-GO 轮询 + 三个决策门
 * - 飞行剖面用公开节点硬编码关键帧插值（Max-Q ~T+62s、MECO ~T+150s、
 *   助推器回收 ~T+7:24、船回收 ~T+66min），不做真实动力学
 * - 时间压缩分阶段（决策门自动暂停），一局约 5-6 分钟真实时间
 */

/* ========== 确定性随机 ========== */

function mulberry32(seed) {
  var a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    var t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ========== 飞行剖面关键帧（tMission 秒 → 高度 km / 速度 km/h） ========== */

var BOOSTER_PROFILE = [
  // [t, altKm, speedKmh]
  [0, 0, 0],
  [30, 3, 600],
  [62, 12, 1600],     // Max-Q
  [120, 42, 4200],
  [150, 65, 5600],    // MECO / 热分离
  [190, 90, 4400],    // 反推点火
  [260, 60, 2800],
  [360, 18, 1200],
  [420, 2.5, 350],    // 着陆点火前
  [444, 0.1, 12]      // 筷子捕获
]

var SHIP_PROFILE = [
  [150, 65, 5600],
  [320, 130, 15000],
  [520, 150, 26400],  // SECO ~T+8:40（对齐真实时间线）
  [2845, 145, 26800], // 滑行至再入界面 ~T+47:25
  [3240, 75, 18000],  // 等离子黑障段
  [3830, 12, 1100],   // 亚音速腹部姿态
  [3881, 1.2, 90],    // 翻转与着陆点火 ~T+1:04:41
  [3921, 0.1, 10]     // 溅落/捕获 ~T+1:05:21（对齐最近任务时间线末节点）
]

/* 标量关键帧曲线（[t, v] 线性插值，两端夹紧）：燃料余量 / 姿态角用 */
function sampleCurve(curve, t) {
  if (t <= curve[0][0]) return curve[0][1]
  var last = curve[curve.length - 1]
  if (t >= last[0]) return last[1]
  for (var i = 1; i < curve.length; i++) {
    if (t <= curve[i][0]) {
      var p0 = curve[i - 1]
      var p1 = curve[i]
      return p0[1] + (p1[1] - p0[1]) * ((t - p0[0]) / (p1[0] - p0[0]))
    }
  }
  return last[1]
}

/* 双级燃料余量 %（点火消耗 → 滑行持平 → 着陆点火再消耗） */
var BOOSTER_FUEL = [[0, 100], [150, 18], [190, 18], [230, 10], [420, 10], [444, 4]]
var SHIP_FUEL = [[0, 100], [150, 100], [520, 14], [3881, 14], [3921, 5]]

/* 姿态角（度）：0=竖直机头朝上，90=水平，170=反推倒飞 */
var BOOSTER_ORI = [[0, 0], [150, 45], [175, 170], [230, 170], [330, 0], [444, 0]]
var SHIP_ORI = [[0, 0], [150, 45], [520, 85], [2845, 88], [3600, 92], [3881, 95], [3901, 0]]

function sampleProfile(profile, t) {
  if (t <= profile[0][0]) return { alt: profile[0][1], speed: profile[0][2] }
  var last = profile[profile.length - 1]
  if (t >= last[0]) return { alt: last[1], speed: last[2] }
  for (var i = 1; i < profile.length; i++) {
    if (t <= profile[i][0]) {
      var p0 = profile[i - 1]
      var p1 = profile[i]
      var k = (t - p0[0]) / (p1[0] - p0[0])
      return { alt: p0[1] + (p1[1] - p0[1]) * k, speed: p0[2] + (p1[2] - p0[2]) * k }
    }
  }
  return { alt: last[1], speed: last[2] }
}

/* ========== 席位与阶段 ========== */

var STATIONS = [
  { id: 'prop', name: '推进' },
  { id: 'struct', name: '结构' },
  { id: 'wx', name: '气象' },
  { id: 'tower', name: '回收塔' },
  { id: 'range', name: '航区' }
]

// 阶段: fueling → terminal → hold(T-40) → ascent → boosterReturn → catchGate →
//       boosterCatch → shipCoast → shipEntry → done
var PHASE_LABEL = {
  fueling: '推进剂加注',
  terminal: '终端倒计时',
  hold: 'T-40 保持',
  ascent: '上升段',
  boosterReturn: '助推器返回',
  catchGate: '回收决策',
  boosterCatch: '筷子捕获',
  shipCoast: '轨道滑行',
  shipEntry: '再入与回收',
  done: '任务结束'
}

/**
 * 默认飞行时间线（对齐最近星舰任务剖面：一级受控溅落 + 载荷部署 + 二级受控溅落）。
 * 从任务详情页进入时会被该任务的 LL2 时间线整体替换，本表仅作独立入口兜底。
 * gate: 关联的决策门 id
 */
var TIMELINE_DEF = [
  { id: 'fuel', label: '推进剂加注', tLabel: 'T-30:00', desc: '甲烷/液氧快速加注，白霜线爬升', gate: 'g1_fuel' },
  { id: 'terminal', label: '终端倒计时', tLabel: 'T-01:00', desc: '自动序列接管，水幕系统预压' },
  { id: 'hold', label: 'T-40 保持', tLabel: 'T-00:40', desc: '飞行总监最终提交窗口', gate: 'g2_commit' },
  { id: 'liftoff', label: '点火升空', tLabel: 'T+00:00', desc: '33 台猛禽全推力，喷淋开启，离塔' },
  { id: 'maxq', label: '最大动压 Max-Q', tLabel: 'T+01:02', desc: '气动载荷峰值' },
  { id: 'meco', label: 'MECO / 热分离', tLabel: 'T+02:30', desc: '飞船点火，级间热分离' },
  { id: 'boostback', label: '反推点火', tLabel: 'T+03:10', desc: '助推器减速调整落点' },
  { id: 'catchgate', label: '回收决策', tLabel: 'T+06:40', desc: '着陆点火 GO / NO-GO', gate: 'g3_catch' },
  { id: 'catch', label: '助推器溅落', tLabel: 'T+07:24', desc: '着陆点火，受控溅落于近海' },
  { id: 'seco', label: 'SECO / 轨道滑行', tLabel: 'T+08:40', desc: '飞船关机滑行，时间压缩' },
  { id: 'payload', label: '载荷部署', tLabel: 'T+18:40', desc: '模拟载荷依次弹出，验证部署机构' },
  { id: 'entry', label: '再入界面', tLabel: 'T+47:25', desc: '等离子鞘形成，通信黑障' },
  { id: 'shipcatch', label: '飞船溅落', tLabel: 'T+1:05:21', desc: '腹部再入、翻转点火，受控溅落' }
]

/**
 * 从飞行时间线自动推断任务剖面（全自动，后续任务改剖面无需改代码）：
 * - 一级结局：时间线含 booster/助推 + catch/捕获 → 塔臂捕获，否则受控溅落
 * - 二级结局：时间线含 ship/飞船 + catch/捕获 → 塔臂捕获，否则受控溅落
 * - 载荷部署：含 payload/deploy/载荷/部署 节点 → 取其时间
 */
function inferMissionProfile(customTl) {
  // 默认剖面 = 最近星舰任务：双溅落 + 载荷部署，二级收尾 T+1:05:21
  if (!customTl) return { boosterEnd: 'splash', shipEnd: 'splash', payloadT: 1120, shipEndT: 3921 }
  var bCatch = false
  var sCatch = false
  var payloadT = null
  for (var i = 0; i < customTl.length; i++) {
    var s = (customTl[i].label + ' ' + customTl[i].desc).toLowerCase()
    var isCatch = /catch|mechazilla|捕获/.test(s)
    var isBooster = /booster|super ?heavy|b\d{2}\b|助推|超重|一级/.test(s)
    var isShip = /ship|starship|s\d{2}\b|飞船|二级/.test(s)
    if (isCatch && isBooster) bCatch = true
    else if (isCatch && isShip) sCatch = true
    if (payloadT == null && /payload|deploy|starlink|载荷|部署/.test(s)) payloadT = customTl[i].t
  }
  // 二级收尾对齐时间线末节点（任务钟走到最后一个节点才结算，不遗漏）
  var lastT = customTl[customTl.length - 1].t
  var shipEndT = (isFinite(lastT) && lastT >= 3500 && lastT < 7200) ? lastT : 3921
  return {
    boosterEnd: bCatch ? 'catch' : 'splash',
    shipEnd: sCatch ? 'catch' : 'splash',
    payloadT: payloadT,
    shipEndT: shipEndT
  }
}

function fmtT(t) {
  var sign = t < 0 ? 'T-' : 'T+'
  var s = Math.abs(Math.round(t))
  var h = Math.floor(s / 3600)
  var m = Math.floor((s % 3600) / 60)
  var sec = s % 60
  function pad(n) { return (n < 10 ? '0' : '') + n }
  return h > 0 ? (sign + h + ':' + pad(m) + ':' + pad(sec)) : (sign + pad(m) + ':' + pad(sec))
}

/* ========== 任务实例 ========== */

/**
 * 外部任务时间线（LL2 飞行时间线）归一化：{ t 秒, label, desc, tLabel }
 * 全量保留调用方节点，不做筛除（仅剔除无效时间），按 t 升序
 */
function normalizeCustomTimeline(list) {
  if (!Array.isArray(list) || !list.length) return null
  var out = []
  for (var i = 0; i < list.length; i++) {
    var r = list[i] || {}
    var t = Number(r.t)
    if (!isFinite(t)) continue
    out.push({
      id: 'll2_' + i,
      t: t,
      label: String(r.label || '').trim() || ('节点 ' + (i + 1)),
      tLabel: String(r.tLabel || '').trim() || fmtT(t),
      desc: String(r.desc || '').trim()
    })
  }
  if (!out.length) return null
  out.sort(function (a, b) { return a.t - b.t })
  return out
}

function createMission(options) {
  var seed = (options && options.seed) || 12345
  var rng = mulberry32(seed)
  var customTl = normalizeCustomTimeline(options && options.timeline)
  var profile = inferMissionProfile(customTl)
  // 自动演示：决策门自动 GO、跳过随机异常/中止，供剖面循环预览
  var autoDemo = !!(options && options.autoDemo)

  // 异常表（seed 决定本局注入哪些，一次性生成保证确定性）
  var anomalies = {
    loxTemp: rng() < 0.5,            // 加注期液氧温度偏高（PROP 琥珀）
    windGust: rng() < 0.55,          // 回收窗口风切变（WX 琥珀/红）
    windSevere: false,               // windGust 升级为红（由下面骰决定）
    engineOut: 0,                    // 上升段发动机失效数
    gridFin: rng() < 0.3             // 格栅舵作动器降级（TOWER 琥珀）
  }
  anomalies.windSevere = anomalies.windGust && rng() < 0.35
  var engineRoll = rng()
  anomalies.engineOut = engineRoll < 0.35 ? 0 : engineRoll < 0.8 ? 1 : 3
  // 结果判定用的独立骰（与决策组合后仍确定）
  var catchLuck = rng()
  var shipLuck = rng()
  if (autoDemo) {
    anomalies.loxTemp = false
    anomalies.windGust = false
    anomalies.windSevere = false
    anomalies.engineOut = 0
    anomalies.gridFin = false
    // catchLuck 取 0：GO 时 catchLuck < risk 为假 → 回收成功
    // shipLuck 须 > shipRisk（默认 0.08）：取 1 保证演示闭环成功，避免 0 > 0.08 恒败
    catchLuck = 0
    shipLuck = 1
  }

  var state = {
    seed: seed,
    phase: 'fueling',
    t: -1800,               // 任务钟（秒）
    warp: 0,                // 阶段时间压缩倍率（引擎自动，0=暂停等决策）
    rate: 1,                // 用户倍率（叠乘在 warp 上，1/2/4）
    propLoad: 0,            // 加注进度 0-100
    waterFarm: 100,         // 水幕水量 %
    holdRealMs: 0,          // T-40 保持累计真实时长
    stations: {},           // id → { status: 'go'|'amber'|'nogo', note }
    gate: null,             // 当前决策门 { id, title, desc, options: [{key,label,tone}] }
    log: [],                // { t, text } 时间线（复盘用）
    rev: 0,                 // 离散状态版本号（页面 diff 用）
    outcome: null,          // 结算 { result, title, lines, verdict }
    aborted: false,
    boosterResult: '',      // 'catch'|'splash'|'lost'
    decisions: []           // 复盘：{ t, gate, choice }
  }

  STATIONS.forEach(function (s) {
    state.stations[s.id] = { status: 'go', note: '正常' }
  })

  function bump() { state.rev++ }

  function pushLog(text) {
    state.log.push({ t: fmtT(state.t), text: text })
    if (state.log.length > 60) state.log.shift()
    bump()
  }

  function setStation(id, status, note) {
    var st = state.stations[id]
    if (st.status === status && st.note === note) return
    st.status = status
    st.note = note
    bump()
  }

  function openGate(id, title, desc, options) {
    state.gate = { id: id, title: title, desc: desc, options: options }
    state.warp = 0
    bump()
  }

  function closeGate() {
    state.gate = null
    bump()
  }

  function amberCount() {
    var n = 0
    STATIONS.forEach(function (s) {
      if (state.stations[s.id].status === 'amber') n++
      if (state.stations[s.id].status === 'nogo') n += 2
    })
    return n
  }

  /* ---- 初始事件 ---- */
  pushLog('任务时钟启动，开始推进剂加注序列')
  if (anomalies.loxTemp) {
    // 加注中段触发
    state._loxTempAt = -1200 - Math.floor(rng() * 300)
  }

  /* ---- 决策处理 ---- */

  function decide(gateId, choice) {
    if (!state.gate || state.gate.id !== gateId) return
    state.decisions.push({ t: fmtT(state.t), gate: gateId, choice: choice })

    if (gateId === 'g1_fuel') {
      closeGate()
      if (choice === 'nogo') return finishScrub('加注前中止', '你在加注提交门选择了 NO-GO。任务推迟，箭体安全。')
      pushLog('加注提交 GO，继续倒计时')
      state.warp = 30
    } else if (gateId === 'g2_commit') {
      closeGate()
      if (choice === 'nogo') return finishScrub('终端中止', '你在 T-40 最终提交门选择了中止。推进剂开始回抽，箭体安全。')
      pushLog('最终提交 GO，释放保持，倒计时恢复')
      state.phase = 'terminal'
      state.warp = 1
    } else if (gateId === 'g3_catch') {
      closeGate()
      state.phase = 'boosterCatch'
      state.warp = 2
      if (choice === 'nogo') {
        state.boosterResult = 'splash'
        pushLog(profile.boosterEnd === 'catch' ? '回收 NO-GO：助推器转向近海受控溅落' : '回收 NO-GO：放弃着陆点火，助推器将硬入水')
      } else {
        // 风险结算：琥珀越多，回收失败概率越高（确定性：catchLuck 固定）
        var risk = 0
        if (state.stations.wx.status === 'amber') risk += 0.25
        if (state.stations.wx.status === 'nogo') risk += 0.6
        if (state.stations.tower.status === 'amber') risk += 0.2
        if (anomalies.engineOut >= 3) risk += 0.2
        state.boosterResult = catchLuck < risk ? 'lost' : 'catch'
        pushLog(profile.boosterEnd === 'catch' ? '回收 GO：助推器向塔臂进场' : '回收 GO：助推器执行着陆点火，进入溅落走廊')
      }
    }
  }

  function finishScrub(title, text) {
    state._abortIdx = timelineIndexLive()
    state.aborted = true
    state.phase = 'done'
    state.warp = 0
    pushLog(text)
    var wasted = state.propLoad > 60
    state.outcome = {
      result: 'scrub',
      title: title,
      verdict: amberCount() >= 2
        ? '面对多块琥珀板选择保守是教科书式的判断。发射可以再来，箭体只有一枚。'
        : (wasted
          ? '本次中止时告警并不严重，偏保守。中止永远安全，但每次回抽推进剂都有成本。'
          : '干脆利落的早期中止，损失最小。'),
      lines: buildDebriefLines()
    }
    bump()
  }

  function buildDebriefLines() {
    return state.log.slice(-14)
  }

  /* ---- 结算 ---- */

  function finishMission() {
    state.phase = 'done'
    state.warp = 0
    var booster = state.boosterResult
    var shipRisk = anomalies.engineOut >= 3 ? 0.3 : 0.08
    var shipOk = shipLuck > shipRisk
    var title, result, verdict

    var bCatchMode = profile.boosterEnd === 'catch'
    var shipEndText = profile.shipEnd === 'catch' ? '飞船落入塔臂' : '飞船受控溅落于回收海域'
    if (booster === 'catch' && shipOk) {
      result = 'success'
      title = bCatchMode && profile.shipEnd === 'catch' ? '双捕获达成' : '任务完整闭环'
      verdict = bCatchMode && profile.shipEnd === 'catch'
        ? '助推器与飞船先后回到塔臂。所有决策与风险匹配，这就是这份工作的满分答卷。'
        : '一二级全部按剖面受控完成，全部试验目标达成。所有决策与风险匹配，满分答卷。'
      pushLog(shipEndText + '，任务完整闭环')
    } else if (booster === 'lost' && shipOk) {
      result = 'partial'
      title = bCatchMode ? '飞船回收 / 助推器损失' : '飞船闭环 / 助推器硬入水'
      verdict = bCatchMode
        ? '你在琥珀板下仍提交了捕获，助推器没能进入包络。回看 G3 决策门：当时的风况值得一个 NO-GO。'
        : '你在琥珀板下仍提交了着陆点火，点火异常导致硬入水。回看 G3 决策门：当时的状态值得一个 NO-GO。'
      pushLog(shipEndText + '；助推器回收失败')
    } else if (booster === 'splash' && shipOk) {
      result = 'partial'
      title = bCatchMode ? '飞船回收 / 助推器受控溅落' : '飞船闭环 / 助推器保守放弃'
      verdict = bCatchMode
        ? '保守但安全的选择。塔和箭都还在，代价只是一枚不再复用的助推器。'
        : '保守但安全的选择。数据全部回传，代价只是少验证一次着陆点火。'
      pushLog(shipEndText)
    } else {
      result = 'fail'
      title = '飞船再入失利'
      verdict = anomalies.engineOut >= 3
        ? '上升段损失 3 台发动机后强行继续，再入热负荷超限。回看 T-40 后的那些琥珀板。'
        : '再入阶段出现异常，任务未能完整闭环。同 seed 重飞，试试不同的决策组合。'
      pushLog('飞船再入过程中失联')
    }
    state.outcome = { result: result, title: title, verdict: verdict, lines: buildDebriefLines() }
    bump()
  }

  /* ---- 主推进 ---- */

  var milestones = {} // 只触发一次的旗标

  function once(key, fn) {
    if (milestones[key]) return
    milestones[key] = true
    fn()
  }

  function step(realDtMs) {
    if (state.phase === 'done') return snapshot()
    if (state.gate) {
      if (autoDemo) {
        // 演示模式：决策门瞬间自动 GO，本 tick 继续推进时钟
        decide(state.gate.id, 'go')
        if (state.phase === 'done') return snapshot()
      } else {
        // 决策门开着：时钟暂停；T-40 保持期有温漂压力
        if (state.gate.id === 'g2_commit') {
          state.holdRealMs += realDtMs
          if (state.holdRealMs > 25000) {
            once('holdDrift', function () {
              setStation('prop', 'amber', '推进剂温漂，密度下降')
              pushLog('保持时间过长：推进剂温度开始漂移')
            })
          }
          if (state.holdRealMs > 55000) {
            once('holdAbort', function () {
              closeGate()
              finishScrub('自动中止', '保持超时，推进剂温度超出提交限制，序列自动中止。')
            })
          }
        }
        return snapshot()
      }
    }
    var dt = (realDtMs / 1000) * state.warp * state.rate

    state.t += dt

    /* 加注段 */
    if (state.phase === 'fueling') {
      state.propLoad = Math.min(100, ((state.t + 1800) / 1740) * 100)
      if (state.t >= -600) {
        once('engineChill', function () { pushLog('发动机预冷开始，白霜线沿箭体爬升') })
      }
      if (state.t >= -180) {
        once('loadComplete', function () { pushLog('推进剂加注接近完成，箭体转内部电源') })
      }
      if (anomalies.loxTemp && state._loxTempAt && state.t >= state._loxTempAt) {
        once('loxTemp', function () {
          setStation('prop', 'amber', '液氧温度偏高 0.8K')
          pushLog('推进席报告：液氧温度偏高，正在评估')
        })
      }
      // 温度告警会在加注后期自愈（教学局给玩家看"琥珀恢复绿"的过程）
      if (milestones.loxTemp && state.t >= -400) {
        once('loxTempClear', function () {
          setStation('prop', 'go', '温度回到包络内')
          pushLog('推进席：液氧温度回到包络，PROP 转绿')
        })
      }
      if (state.t >= -60) {
        state.t = -60
        state.phase = 'terminal'
        state.warp = 1
        pushLog('进入终端倒计时，自动序列接管')
      }
    }

    /* 终端倒计时（含 T-40 自动保持） */
    if (state.phase === 'terminal') {
      if (state.t >= -40 && !milestones.holdGate) {
        once('holdGate', function () {
          state.t = -40
          state.phase = 'hold'
          pushLog('T-40 自动保持：等待飞行总监最终提交')
          if (anomalies.windGust) {
            setStation('wx', 'amber', '高空风接近限制')
          }
          openGate('g2_commit', '最终提交', '这是最后的 GO/NO-GO。保持时间越久，推进剂温漂风险越大。',
            [{ key: 'go', label: 'GO — 释放保持', tone: 'go' }, { key: 'nogo', label: 'NO-GO — 中止', tone: 'nogo' }])
        })
      }
      if (state.t >= 0) {
        once('liftoff', function () {
          state.phase = 'ascent'
          state.warp = 3
          pushLog('点火确认，33 台发动机推力正常，离塔')
        })
      }
    }

    /* 上升段 */
    if (state.phase === 'ascent') {
      if (state.t >= 62) once('maxq', function () { pushLog('通过最大动压 Max-Q') })
      if (anomalies.engineOut > 0 && state.t >= 95) {
        once('engineOut', function () {
          var n = anomalies.engineOut
          setStation('struct', 'amber', n + ' 台发动机失效')
          pushLog('遥测：' + n + ' 台猛禽发动机提前关机' + (n >= 3 ? '，性能余量吃紧' : '，剩余推力可补偿'))
        })
      }
      if (state.t >= 150) {
        once('meco', function () {
          state.phase = 'boosterReturn'
          state.warp = 6
          pushLog('MECO / 热分离：飞船点火远去，助推器开始返回')
        })
      }
    }

    /* 助推器返回 */
    if (state.phase === 'boosterReturn') {
      if (state.t >= 190) {
        once('boostback', function () { pushLog('助推器反推点火，调头返回发射场') })
      }
      if (anomalies.gridFin && state.t >= 260) {
        once('gridFin', function () {
          setStation('tower', 'amber', '格栅舵作动器 3 号降级')
          pushLog('回收塔席：格栅舵作动器降级，进场精度受影响')
        })
      }
      if (anomalies.windSevere && state.t >= 330) {
        once('windSevere', function () {
          setStation('wx', 'nogo', '塔区阵风超限')
          pushLog('气象席：塔区阵风升级，超出捕获限制')
        })
      }
      if (state.t >= 400) {
        once('catchGate', function () {
          state.t = 400
          state.phase = 'catchGate'
          pushLog('回收窗口临近：请做出回收决策')
          if (profile.boosterEnd === 'catch') {
            openGate('g3_catch', '筷子捕获提交', '权衡气象与塔况：GO 进塔臂，NO-GO 转近海受控溅落（安全但损失箭体）。',
              [{ key: 'go', label: 'GO — 塔臂捕获', tone: 'go' }, { key: 'nogo', label: 'NO-GO — 近海溅落', tone: 'nogo' }])
          } else {
            openGate('g3_catch', '着陆点火提交', '权衡气象与箭体状态：GO 执行着陆点火受控溅落，NO-GO 放弃点火硬入水（保数据回传，损失箭体）。',
              [{ key: 'go', label: 'GO — 着陆点火', tone: 'go' }, { key: 'nogo', label: 'NO-GO — 放弃点火', tone: 'nogo' }])
          }
        })
      }
    }

    /* 回收演出 → 飞船段 */
    if (state.phase === 'boosterCatch') {
      if (state.t >= 444) {
        once('boosterDone', function () {
          if (state.boosterResult === 'catch') {
            pushLog(profile.boosterEnd === 'catch' ? '着陆点火，筷子臂合拢——助推器捕获成功' : '着陆点火成功，助推器受控溅落于近海回收区')
          } else if (state.boosterResult === 'splash') {
            pushLog(profile.boosterEnd === 'catch' ? '助推器近海受控溅落，数据完整' : '助推器硬入水，全程遥测数据已回传')
          } else {
            pushLog(profile.boosterEnd === 'catch' ? '进场偏差超出包络，助推器在塔外损失' : '着陆点火异常，助推器硬入水解体')
          }
          state.phase = 'shipCoast'
          state.warp = 120
          pushLog('切换跟踪飞船：SECO 后进入滑行段（时间压缩 120x）')
        })
      }
    }

    /* 飞船滑行/再入 */
    if (state.phase === 'shipCoast') {
      if (state.t >= 520) {
        once('seco', function () { pushLog('SECO：飞船主发动机关机，进入滑行弹道') })
      }
      if (profile.payloadT != null && state.t >= profile.payloadT) {
        once('payloadDeploy', function () { pushLog('载荷部署：舱门开启，模拟载荷依次弹出') })
      }
      if (state.t >= 2845) {
        once('entry', function () {
          state.phase = 'shipEntry'
          state.warp = 24
          pushLog('再入界面：等离子鞘形成，进入通信黑障')
        })
      }
    }
    if (state.phase === 'shipEntry') {
      if (state.t >= 3240) once('blackoutExit', function () { pushLog('穿出黑障，遥测恢复，腹部姿态下降') })
      if (state.t >= profile.shipEndT - 40) once('flip', function () { pushLog(profile.shipEnd === 'catch' ? '翻转机动，着陆点火，向塔臂进场' : '翻转机动，着陆点火，进入溅落走廊') })
      if (state.t >= profile.shipEndT) {
        once('finish', function () { finishMission() })
      }
    }

    return snapshot()
  }

  /* ---- 飞行时间线状态 ---- */

  function timelineIndexLive() {
    var p = state.phase
    var t = state.t
    if (p === 'fueling') return 0
    if (p === 'terminal') return t < -40 ? 1 : 3 // hold 释放后聚焦「点火升空」
    if (p === 'hold') return 2
    if (p === 'ascent') return t < 62 ? 3 : 4
    if (p === 'boosterReturn') return t < 190 ? 5 : 6
    if (p === 'catchGate') return 7
    if (p === 'boosterCatch') return 8
    if (p === 'shipCoast') return t < 1120 ? 9 : 10
    if (p === 'shipEntry') return t < profile.shipEndT - 40 ? 11 : 12
    return 0
  }

  /**
   * 真实任务时间线模式：节点状态完全由任务钟 state.t 驱动（对齐 LL2，全节点无遗漏）；
   * 决策门内联挂在当前 active 节点上
   */
  function buildCustomTimeline() {
    var n = customTl.length
    var doneAll = state.phase === 'done' && !state.aborted
    var idx = n
    for (var i = 0; i < n; i++) {
      if (state.t < customTl[i].t) { idx = i; break }
    }
    var abortIdx = state.phase === 'done' && state.aborted ? Math.min(idx, n - 1) : -1
    var gateIdx = state.gate ? Math.min(idx, n - 1) : -1
    return customTl.map(function (def, i) {
      var status
      if (doneAll) status = 'done'
      else if (abortIdx >= 0) status = i < abortIdx ? 'done' : (i === abortIdx ? 'abort' : 'skip')
      else if (i < idx) status = 'done'
      else if (i === idx) status = 'active'
      else status = 'pending'
      return {
        id: def.id,
        label: def.label,
        tLabel: def.tLabel,
        desc: def.desc,
        status: status,
        tone: '',
        hasGate: i === gateIdx
      }
    })
  }

  function buildTimeline() {
    if (customTl) return buildCustomTimeline()
    var n = TIMELINE_DEF.length
    var idx
    var abortIdx = -1
    if (state.phase === 'done') {
      if (state.aborted) {
        idx = -1
        abortIdx = state._abortIdx == null ? 0 : state._abortIdx
      } else {
        idx = n
      }
    } else {
      idx = timelineIndexLive()
    }
    return TIMELINE_DEF.map(function (def, i) {
      var status
      if (abortIdx >= 0) {
        status = i < abortIdx ? 'done' : (i === abortIdx ? 'abort' : 'skip')
      } else if (i < idx) {
        status = 'done'
      } else if (i === idx) {
        status = 'active'
      } else {
        status = 'pending'
      }
      var label = def.label
      var desc = def.desc
      var tone = ''
      if (def.id === 'catch' && state.boosterResult) {
        if (state.boosterResult === 'splash') {
          if (profile.boosterEnd === 'catch') { label = '近海受控溅落'; desc = '保守决策：助推器受控溅落，箭体不复用'; tone = 'warn' }
          else { label = '放弃点火硬入水'; desc = '保守决策：不点火直接入水，保数据回传'; tone = 'warn' }
        } else if (state.boosterResult === 'lost') {
          if (profile.boosterEnd === 'catch') { label = '助推器损失'; desc = '进场偏差超出包络，塔外损失'; tone = 'bad' }
          else { label = '助推器硬入水'; desc = '着陆点火异常，硬入水解体'; tone = 'bad' }
        }
      }
      if (def.id === 'shipcatch' && state.outcome && state.outcome.result === 'fail') {
        label = '再入失利'
        desc = '飞船在再入过程中失联'
        tone = 'bad'
      }
      return {
        id: def.id,
        label: label,
        tLabel: def.tLabel,
        desc: desc,
        status: status,
        tone: tone,
        hasGate: !!(state.gate && def.gate === state.gate.id)
      }
    })
  }

  /* ---- 快照 ---- */

  function snapshot() {
    var tele
    if (state.t < 0) {
      tele = { alt: 0, speed: 0 }
    } else if (state.phase === 'shipCoast' || state.phase === 'shipEntry' || (state.phase === 'done' && state.t > 500)) {
      tele = sampleProfile(SHIP_PROFILE, state.t)
    } else {
      tele = sampleProfile(BOOSTER_PROFILE, state.t)
    }
    // 水幕：T-15 沟槽 → T+30 后回落
    var water = 100
    if (state.t > -15 && state.t < 60) water = Math.max(35, 100 - ((state.t + 15) / 75) * 65)
    else if (state.t >= 60) water = 35

    var timeline = buildTimeline()
    var tlKey = timeline.map(function (n) { return n.status + (n.tone || '') + (n.hasGate ? 'G' : '') }).join('|')

    var phaseLabel = PHASE_LABEL[state.phase] || state.phase
    if (state.phase === 'boosterCatch' && profile.boosterEnd !== 'catch') phaseLabel = '溅落回收'

    /* 发动机状态（页面发动机状态板用）：
       b: off/ignite/full/boostback/landing13/landing3；bOut: 失效台数；s: off/full/landing */
    var engines = { b: 'off', bOut: 0, s: 'off' }
    if (state.phase !== 'done') {
      var et = state.t
      if (et >= -3 && et < 0) engines.b = 'ignite'
      else if (et >= 0 && et < 150) engines.b = 'full'
      else if (et >= 190 && et < 230) engines.b = 'boostback'
      else if (et >= 420 && et <= 444) engines.b = et < 436 ? 'landing13' : 'landing3'
      if (et >= 150 && et < 520) engines.s = 'full'
      else if (et >= profile.shipEndT - 40 && et <= profile.shipEndT) engines.s = 'landing'
      // 失效标记只在助推器任务段内展示（分离回收完成后集群整体熄灭）
      if (milestones.engineOut && et < 450) engines.bOut = anomalies.engineOut
    }

    /* 双级遥测（遥测面板用）：速度/高度/燃料余量/姿态角（0=竖直 90=水平 170=倒飞） */
    var st = state.t
    var bTele = st < 0 ? { alt: 0, speed: 0 } : sampleProfile(BOOSTER_PROFILE, Math.min(st, 444))
    var sTele = st < 0 ? { alt: 0, speed: 0 } : (st < 150 ? bTele : sampleProfile(SHIP_PROFILE, st))
    if (st > 460) bTele = { alt: 0, speed: 0 }
    if (st > profile.shipEndT + 10) sTele = { alt: 0, speed: 0 }
    var fuelingFill = Math.round(state.propLoad)
    var stages = {
      b: {
        alt: Math.round(bTele.alt * 10) / 10,
        speed: Math.round(bTele.speed),
        fuel: st < 0 ? fuelingFill : Math.round(sampleCurve(BOOSTER_FUEL, st)),
        ori: st < 0 ? 0 : Math.round(sampleCurve(BOOSTER_ORI, Math.min(st, 444))),
        active: st <= 460
      },
      s: {
        alt: Math.round(sTele.alt * 10) / 10,
        speed: Math.round(sTele.speed),
        fuel: st < 0 ? fuelingFill : Math.round(sampleCurve(SHIP_FUEL, st)),
        ori: st < 0 ? 0 : Math.round(sampleCurve(SHIP_ORI, Math.min(st, 3921))),
        active: st <= profile.shipEndT + 10
      }
    }

    return {
      rev: state.rev,
      phase: state.phase,
      phaseLabel: phaseLabel,
      profile: profile,
      engines: engines,
      stages: stages,
      timeline: timeline,
      tlKey: tlKey,
      tText: fmtT(state.t),
      t: state.t,
      warp: state.warp,
      rate: state.rate,
      propLoad: Math.round(state.propLoad),
      water: Math.round(water),
      altKm: tele.alt,
      speedKmh: tele.speed,
      stations: STATIONS.map(function (s) {
        return { id: s.id, name: s.name, status: state.stations[s.id].status, note: state.stations[s.id].note }
      }),
      gate: state.gate,
      log: state.log,
      outcome: state.outcome,
      seed: state.seed
    }
  }

  /* ---- 开局第一道门 ---- */
  openGate('g1_fuel', '加注提交', '各席位已完成上电自检。提交后开始快速加注，中止成本将逐步升高。',
    [{ key: 'go', label: 'GO — 开始加注', tone: 'go' }, { key: 'nogo', label: 'NO-GO — 推迟', tone: 'nogo' }])
  if (autoDemo) decide('g1_fuel', 'go')

  /** 用户倍率（1/2/4）：叠乘在阶段压缩上，不影响事件顺序与结局判定 */
  function setRate(r) {
    var v = Number(r)
    if (v !== 1 && v !== 2 && v !== 4) v = 1
    if (state.rate === v) return
    state.rate = v
    bump()
  }

  return {
    step: step,
    decide: decide,
    snapshot: snapshot,
    setRate: setRate
  }
}

module.exports = { createMission: createMission }
