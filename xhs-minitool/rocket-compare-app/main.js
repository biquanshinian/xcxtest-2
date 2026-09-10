(function () {
  var DATA = window.RocketToolData || { filters: [], rockets: [], distances: [5], soundSpeed: 340 };
  var TITLES = {
    home: "火箭对照",
    pick: "选火箭",
    compare: "对照结果",
    sound: "轰鸣晚几秒"
  };
  var SPEED = DATA.soundSpeed || 340;

  var state = {
    view: "home",
    filter: "all",
    pickSlot: "left",
    leftId: "",
    rightId: "",
    distKm: 5
  };
  var toastTimer = 0;
  var radarRaf = 0;
  var soundRaf = 0;
  var soundShownSec = 0;
  var RADAR_AXES = DATA.radarAxes || [
    { key: "lift", label: "运力" },
    { key: "reuse", label: "复用" },
    { key: "size", label: "体量" },
    { key: "mark", label: "辨识" },
    { key: "use", label: "常见" }
  ];
  var COLOR_A = "#E8C07A";
  var COLOR_B = "#3B82F6";

  function $(id) {
    return document.getElementById(id);
  }

  function supportsFlexGap() {
    var flex = document.createElement("div");
    flex.style.position = "absolute";
    flex.style.visibility = "hidden";
    flex.style.display = "flex";
    flex.style.flexDirection = "column";
    flex.style.rowGap = "1px";
    flex.appendChild(document.createElement("div"));
    flex.appendChild(document.createElement("div"));
    document.body.appendChild(flex);
    var supported = flex.scrollHeight === 1;
    flex.parentNode.removeChild(flex);
    return supported;
  }

  function updateAppHeight() {
    var h = window.innerHeight;
    if (window.visualViewport && window.visualViewport.height) {
      h = window.visualViewport.height;
    }
    document.documentElement.style.setProperty("--app-height", h + "px");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function findRocket(id) {
    var i;
    for (i = 0; i < DATA.rockets.length; i++) {
      if (DATA.rockets[i].id === id) return DATA.rockets[i];
    }
    return null;
  }

  function toast(message) {
    var el = $("toast");
    el.textContent = message;
    el.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.hidden = true;
    }, 2200);
  }

  function delaySeconds(km) {
    return (Number(km) * 1000) / SPEED;
  }

  function formatSeconds(seconds) {
    if (seconds < 10) return (Math.round(seconds * 10) / 10).toFixed(1);
    return String(Math.round(seconds));
  }

  function formatDelay(km) {
    return formatSeconds(delaySeconds(km));
  }

  function soundLine(km, secText) {
    return "你先看到火，大约 " + (secText || formatDelay(km)) + " 秒后才听到声";
  }

  function compareNote() {
    var a = findRocket(state.leftId);
    var b = findRocket(state.rightId);
    if (!a || !b) return "";
    return [
      a.name + " vs " + b.name,
      "",
      a.name + "｜" + a.look + "｜" + a.site + "｜LEO " + a.leo + "｜" + a.reuse,
      a.blurb,
      "",
      b.name + "｜" + b.look + "｜" + b.site + "｜LEO " + b.leo + "｜" + b.reuse,
      b.blurb,
      "",
      "来自「火星探索日志」火箭对照，参数为常用约数。"
    ].join("\n");
  }

  function soundNote(secText) {
    var km = state.distKm;
    var delay = secText || formatDelay(km);
    return [
      "距发射点约 " + km + " 公里",
      "轰鸣约晚 " + delay + " 秒",
      "光几乎同时到",
      soundLine(km, delay),
      "按声速 " + SPEED + " 米/秒估算，来自「火星探索日志」。"
    ].join("\n");
  }

  function pickHint() {
    if (state.pickSlot === "left") {
      return state.rightId ? "换左边，右边先留着" : "先选左边";
    }
    return state.leftId && state.rightId ? "换右边，左边先留着" : "再选右边";
  }

  function bothPicked() {
    return !!(findRocket(state.leftId) && findRocket(state.rightId));
  }

  function preferReduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function radarValues(r) {
    var src = r && r.radar ? r.radar : {};
    var out = [];
    var i;
    for (i = 0; i < RADAR_AXES.length; i++) {
      var n = Number(src[RADAR_AXES[i].key]);
      if (isNaN(n)) n = 0;
      if (n < 0) n = 0;
      if (n > 100) n = 100;
      out.push(n);
    }
    return out;
  }

  function formatTons(n) {
    if (n < 1) return (Math.round(n * 10) / 10).toFixed(1);
    if (Math.abs(n - Math.round(n)) > 0.05) return (Math.round(n * 10) / 10).toFixed(1);
    return String(Math.round(n));
  }

  function formatLeo(r, p) {
    var tons = Number(r.tons);
    if (isNaN(tons)) return r.leo;
    var unit = r.leo.indexOf("吨级") >= 0 ? " 吨级" : " 吨";
    return "约 " + formatTons(tons * p) + unit;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function axisPoint(cx, cy, radius, index, count, value01) {
    var ang = -Math.PI / 2 + (Math.PI * 2 * index) / count;
    return {
      x: cx + Math.cos(ang) * radius * value01,
      y: cy + Math.sin(ang) * radius * value01
    };
  }

  function drawRadarOnCtx(ctx, cx, cy, radius, valuesA, valuesB, p, showLabels, labelSize) {
    var count = RADAR_AXES.length;
    var rings = [0.25, 0.5, 0.75, 1];
    var i;
    var j;
    var pt;
    ctx.save();
    ctx.strokeStyle = "rgba(244,241,234,0.12)";
    ctx.lineWidth = 1;
    for (i = 0; i < rings.length; i++) {
      ctx.beginPath();
      for (j = 0; j < count; j++) {
        pt = axisPoint(cx, cy, radius, j, count, rings[i]);
        if (j === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.beginPath();
    for (j = 0; j < count; j++) {
      pt = axisPoint(cx, cy, radius, j, count, 1);
      ctx.moveTo(cx, cy);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();

    function pathPoly(values) {
      ctx.beginPath();
      for (j = 0; j < count; j++) {
        pt = axisPoint(cx, cy, radius, j, count, (values[j] / 100) * p);
        if (j === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
    }
    function drawDots(values, color) {
      ctx.fillStyle = color;
      for (j = 0; j < count; j++) {
        pt = axisPoint(cx, cy, radius, j, count, (values[j] / 100) * p);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    pathPoly(valuesA);
    ctx.fillStyle = "rgba(232,192,122,0.4)";
    ctx.fill();
    pathPoly(valuesB);
    ctx.fillStyle = "rgba(59,130,246,0.34)";
    ctx.fill();
    pathPoly(valuesA);
    ctx.strokeStyle = COLOR_A;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    pathPoly(valuesB);
    ctx.strokeStyle = COLOR_B;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    drawDots(valuesA, COLOR_A);
    drawDots(valuesB, COLOR_B);

    if (showLabels) {
      ctx.fillStyle = "#C9C3B6";
      ctx.font = (labelSize || 12) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (j = 0; j < count; j++) {
        pt = axisPoint(cx, cy, radius + 18, j, count, 1);
        ctx.fillText(RADAR_AXES[j].label, pt.x, pt.y);
      }
    }
    ctx.restore();
  }

  function sizeRadarCanvas(canvas) {
    var wrap = canvas.parentNode;
    var w = wrap.clientWidth || 300;
    var h = 248;
    var dpr = window.devicePixelRatio || 1;
    if (dpr > 2) dpr = 2;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function updateScoreBars(valuesA, valuesB, p) {
    var rows = document.querySelectorAll("#radar-scores .score-row");
    var i;
    for (i = 0; i < rows.length; i++) {
      var leftBar = rows[i].querySelector(".score-bar.is-a i");
      var rightBar = rows[i].querySelector(".score-bar.is-b i");
      var nums = rows[i].querySelectorAll(".score-n");
      if (leftBar) leftBar.style.width = (valuesA[i] * p) + "%";
      if (rightBar) rightBar.style.width = (valuesB[i] * p) + "%";
      if (nums[0]) nums[0].textContent = String(Math.round(valuesA[i] * p));
      if (nums[1]) nums[1].textContent = String(Math.round(valuesB[i] * p));
    }
  }

  function updateLeoCounts(a, b, p) {
    var nodes = document.querySelectorAll("[data-leo]");
    var i;
    for (i = 0; i < nodes.length; i++) {
      var side = nodes[i].getAttribute("data-leo");
      nodes[i].textContent = formatLeo(side === "right" ? b : a, p);
    }
  }

  function drawRadarFrame(a, b, p) {
    var canvas = $("radar-canvas");
    if (!canvas) return;
    var sized = sizeRadarCanvas(canvas);
    if (!sized) return;
    var valuesA = radarValues(a);
    var valuesB = radarValues(b);
    drawRadarOnCtx(sized.ctx, sized.w / 2, sized.h / 2, Math.min(sized.w, sized.h) / 2 - 28, valuesA, valuesB, p, true, 12);
    updateScoreBars(valuesA, valuesB, p);
    updateLeoCounts(a, b, p);
  }

  function stopRadar() {
    if (radarRaf) {
      window.cancelAnimationFrame(radarRaf);
      radarRaf = 0;
    }
  }

  function playRadar(a, b) {
    stopRadar();
    var start = Date.now();
    var dur = preferReduceMotion() ? 0 : 720;
    function tick() {
      var t = dur ? Math.min(1, (Date.now() - start) / dur) : 1;
      drawRadarFrame(a, b, easeOutCubic(t));
      if (t < 1) {
        radarRaf = window.requestAnimationFrame(tick);
      } else {
        radarRaf = 0;
      }
    }
    if (!window.requestAnimationFrame || dur === 0) {
      drawRadarFrame(a, b, 1);
      return;
    }
    drawRadarFrame(a, b, 0);
    radarRaf = window.requestAnimationFrame(tick);
  }

  function buildRadarChrome(a, b) {
    $("radar-legend").innerHTML =
      '<span><i class="dot-a"></i>' + escapeHtml(a.name) + "</span>" +
      '<span><i class="dot-b"></i>' + escapeHtml(b.name) + "</span>";
    var html = [];
    var i;
    for (i = 0; i < RADAR_AXES.length; i++) {
      html.push(
        '<div class="score-row">' +
        '<span class="score-lab">' + escapeHtml(RADAR_AXES[i].label) + "</span>" +
        '<span class="score-bar is-a"><i></i></span><span class="score-n">0</span>' +
        '<span class="score-bar is-b"><i></i></span><span class="score-n">0</span></div>'
      );
    }
    $("radar-scores").innerHTML = html.join("");
  }

  function clipTitle(text) {
    if (text.length > 20) return text.slice(0, 20);
    return text;
  }

  function renderPick() {
    var hint = $("pick-hint");
    hint.textContent = pickHint();
    var filters = $("rocket-filters");
    var list = $("rocket-list");
    var fHtml = [];
    var i;
    for (i = 0; i < DATA.filters.length; i++) {
      var f = DATA.filters[i];
      fHtml.push(
        '<button type="button" class="chip' + (state.filter === f.id ? " is-on" : "") +
        '" data-action="filter-rocket" data-id="' + f.id + '">' + escapeHtml(f.label) + "</button>"
      );
    }
    filters.innerHTML = fHtml.join("");
    var cHtml = [];
    for (i = 0; i < DATA.rockets.length; i++) {
      var r = DATA.rockets[i];
      if (state.filter !== "all" && r.filter !== state.filter) continue;
      var on = r.id === state.leftId || r.id === state.rightId;
      var mark = "";
      if (r.id === state.leftId) mark = "左边 · ";
      else if (r.id === state.rightId) mark = "右边 · ";
      cHtml.push(
        '<button type="button" class="pick-card' + (on ? " is-on" : "") +
        '" data-action="pick-rocket" data-id="' + r.id + '">' +
        '<span class="pick-kicker">' + mark + escapeHtml(r.site) + " · " + escapeHtml(r.reuse) + "</span>" +
        "<h3>" + escapeHtml(r.name) + "</h3>" +
        "<p>" + escapeHtml(r.look) + "｜LEO " + escapeHtml(r.leo) + "</p></button>"
      );
    }
    list.innerHTML = cHtml.join("");
  }

  function renderCompare() {
    var a = findRocket(state.leftId);
    var b = findRocket(state.rightId);
    if (!a || !b) return;
    var grid = $("compare-grid");
    grid.classList.remove("is-live");
    grid.classList.remove("is-prep");
    grid.innerHTML = colHtml("左边", a, "left") + colHtml("右边", b, "right");
    $("compare-note").textContent = compareNote();
    buildRadarChrome(a, b);
    if (!preferReduceMotion()) {
      grid.classList.add("is-prep");
      void grid.offsetWidth;
      grid.classList.add("is-live");
    }
    playRadar(a, b);
  }

  function colHtml(side, r, slot) {
    return (
      '<div class="col"><div class="side">' + side + "</div><h3>" + escapeHtml(r.name) + "</h3>" +
      '<div class="row"><b>外形</b>' + escapeHtml(r.look) + "</div>" +
      '<div class="row"><b>主场</b>' + escapeHtml(r.site) + "</div>" +
      '<div class="row"><b>LEO 运力</b><span data-leo="' + slot + '">' + escapeHtml(r.leo) + "</span></div>" +
      '<div class="row"><b>回收</b>' + escapeHtml(r.reuse) + "</div>" +
      '<div class="row"><b>一句话</b>' + escapeHtml(r.blurb) + "</div></div>"
    );
  }

  function stopSoundCount() {
    if (soundRaf) {
      window.cancelAnimationFrame(soundRaf);
      soundRaf = 0;
    }
  }

  function ensureDelayBox() {
    var box = $("delay-box");
    if (box.getAttribute("data-ready") === "1") return;
    box.innerHTML =
      '<div class="big">轰鸣约晚 <span id="delay-num" class="count-num">0</span> 秒</div>' +
      '<div class="sub">光几乎同时到 · 你先看到火，大约 <span id="delay-num-sub" class="count-num">0</span> 秒后才听到声</div>';
    box.setAttribute("data-ready", "1");
  }

  function paintSoundNumbers(sec) {
    var text = formatSeconds(sec);
    var n = $("delay-num");
    var s = $("delay-num-sub");
    if (n) n.textContent = text;
    if (s) s.textContent = text;
    $("sound-note").textContent = soundNote(text);
  }

  function playSoundCount(toSec) {
    stopSoundCount();
    var fromSec = soundShownSec;
    var start = Date.now();
    var dur = preferReduceMotion() ? 0 : 640;
    function tick() {
      var t = dur ? Math.min(1, (Date.now() - start) / dur) : 1;
      var sec = fromSec + (toSec - fromSec) * easeOutCubic(t);
      soundShownSec = sec;
      paintSoundNumbers(sec);
      if (t < 1) {
        soundRaf = window.requestAnimationFrame(tick);
      } else {
        soundShownSec = toSec;
        paintSoundNumbers(toSec);
        soundRaf = 0;
      }
    }
    if (!window.requestAnimationFrame || dur === 0) {
      soundShownSec = toSec;
      paintSoundNumbers(toSec);
      return;
    }
    soundRaf = window.requestAnimationFrame(tick);
  }

  function renderSound() {
    var box = $("dist-presets");
    var html = [];
    var i;
    for (i = 0; i < DATA.distances.length; i++) {
      var d = DATA.distances[i];
      html.push(
        '<button type="button" class="chip' + (state.distKm === d ? " is-on" : "") +
        '" data-action="preset-dist" data-km="' + d + '">' + d + " km</button>"
      );
    }
    box.innerHTML = html.join("");
    $("dist-input").value = String(state.distKm);
    ensureDelayBox();
    playSoundCount(delaySeconds(state.distKm));
  }

  function pushView(name) {
    if (!window.history || typeof window.history.pushState !== "function") return;
    try {
      window.history.pushState({ view: name }, "");
    } catch (err) {}
  }

  function showView(name, opts) {
    opts = opts || {};
    if (name === "compare" && !bothPicked()) {
      name = "pick";
    }
    var prev = state.view;
    state.view = name;
    var views = document.querySelectorAll(".view");
    var i;
    for (i = 0; i < views.length; i++) {
      views[i].classList.toggle("is-active", views[i].getAttribute("data-view") === name);
    }
    document.title = TITLES[name] || TITLES.home;
    $("result-dock").hidden = name !== "compare" && name !== "sound";
    $("scroller").scrollTop = 0;
    if (name !== "compare") stopRadar();
    if (name !== "sound") stopSoundCount();
    if (name === "pick") renderPick();
    if (name === "compare") renderCompare();
    if (name === "sound") {
      if (prev !== "sound") soundShownSec = 0;
      renderSound();
    }
    if (!opts.fromPop && name !== prev) pushView(name);
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var chars = String(text).split("");
    var line = "";
    var used = 0;
    var i;
    for (i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = chars[i];
        used += 1;
        if (used >= maxLines - 1) {
          var rest = chars.slice(i).join("");
          if (ctx.measureText(rest).width > maxWidth) {
            while (rest.length && ctx.measureText(rest + "…").width > maxWidth) {
              rest = rest.slice(0, -1);
            }
            ctx.fillText(rest + "…", x, y);
          } else {
            ctx.fillText(rest, x, y);
          }
          return y + lineHeight;
        }
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    return y;
  }

  function paintBg(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#141826");
    g.addColorStop(0.55, "#0B0C0E");
    g.addColorStop(1, "#1A1014");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(59,130,246,0.16)";
    ctx.beginPath();
    ctx.arc(560, 120, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,36,66,0.12)";
    ctx.beginPath();
    ctx.arc(120, 860, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#F4F1EA";
    ctx.font = "22px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("火星探索日志 · 火箭对照", 56, 86);
  }

  function makeCompareCard() {
    var a = findRocket(state.leftId);
    var b = findRocket(state.rightId);
    if (!a || !b) return "";
    var canvas = document.createElement("canvas");
    var w = 750;
    var h = 1000;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (!ctx) return "";
    paintBg(ctx, w, h);
    ctx.fillStyle = "#E8C07A";
    ctx.font = "22px sans-serif";
    ctx.fillText("火箭对照", 56, 180);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 44px sans-serif";
    wrapText(ctx, a.name + "  vs  " + b.name, 56, 236, 638, 50, 2);
    drawRadarOnCtx(ctx, 375, 408, 108, radarValues(a), radarValues(b), 1, true, 18);
    drawHalf(ctx, a, 48, 560);
    drawHalf(ctx, b, 48, 762);
    ctx.fillStyle = "#FF2442";
    ctx.fillRect(0, h - 18, w, 18);
    return canvas.toDataURL("image/jpeg", 0.86);
  }

  function drawHalf(ctx, r, x, y) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x, y, 654, 188);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(r.name, x + 20, y + 36);
    ctx.fillStyle = "#CFE0FF";
    ctx.font = "20px sans-serif";
    wrapText(ctx, r.look + " · " + r.site, x + 20, y + 78, 610, 28, 2);
    ctx.fillStyle = "#F4F1EA";
    ctx.font = "20px sans-serif";
    wrapText(ctx, "LEO " + r.leo + " ｜ " + r.reuse + " ｜ " + r.blurb, x + 20, y + 136, 610, 28, 2);
  }

  function makeSoundCard() {
    var canvas = document.createElement("canvas");
    var w = 750;
    var h = 1000;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (!ctx) return "";
    paintBg(ctx, w, h);
    ctx.fillStyle = "#E8C07A";
    ctx.font = "22px sans-serif";
    ctx.fillText("轰鸣晚几秒", 56, 180);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 40px sans-serif";
    wrapText(ctx, "距发射点约 " + state.distKm + " 公里", 56, 260, 638, 50, 2);
    ctx.fillStyle = "#CFE0FF";
    ctx.font = "bold 48px sans-serif";
    ctx.fillText("轰鸣约晚 " + formatDelay(state.distKm) + " 秒", 56, 400);
    ctx.fillStyle = "#F4F1EA";
    ctx.font = "26px sans-serif";
    wrapText(ctx, "光几乎同时到。按声速 " + SPEED + " 米/秒估算。", 56, 480, 638, 38, 2);
    wrapText(ctx, soundLine(state.distKm), 56, 580, 638, 38, 3);
    ctx.fillStyle = "#FF2442";
    ctx.fillRect(0, h - 18, w, 18);
    return canvas.toDataURL("image/jpeg", 0.86);
  }

  function currentCard() {
    if (state.view === "compare") return makeCompareCard();
    if (state.view === "sound") return makeSoundCard();
    return "";
  }

  function currentNote() {
    if (state.view === "compare") return compareNote();
    if (state.view === "sound") return soundNote();
    return "";
  }

  function currentTitle() {
    if (state.view === "compare") {
      var a = findRocket(state.leftId);
      var b = findRocket(state.rightId);
      if (a && b) return clipTitle(a.name + "对照" + b.name);
      return "火箭对照";
    }
    return clipTitle(state.distKm + "公里轰鸣晚几秒");
  }

  function getBridge() {
    return window.xhs && window.xhs.miniTool ? window.xhs.miniTool : null;
  }

  function callBridge(name, options) {
    var api = getBridge();
    if (!api || typeof api[name] !== "function") {
      return Promise.reject(new Error("bridge-unavailable"));
    }
    return api[name](options);
  }

  function saveCard() {
    var dataUrl = currentCard();
    if (!dataUrl) {
      toast("当前环境无法生成卡片");
      return;
    }
    callBridge("writeTempFile", { data: dataUrl }).then(function (res) {
      var filePath = res && res.filePath ? res.filePath : dataUrl;
      return callBridge("saveImageToPhotosAlbum", { filePath: filePath });
    }).then(function () {
      toast("卡片已保存到相册");
    }).catch(function (err) {
      if (err && err.message === "bridge-unavailable") {
        toast("请在小红书内打开后再保存到相册");
        return;
      }
      callBridge("saveImageToPhotosAlbum", { filePath: dataUrl }).then(function () {
        toast("卡片已保存到相册");
      }).catch(function () {
        toast("保存失败，请重试或改用发笔记");
      });
    });
  }

  function postNote() {
    var dataUrl = currentCard();
    var content = currentNote();
    if (content.length > 1000) content = content.slice(0, 997) + "...";
    callBridge("postNote", {
      title: currentTitle(),
      content: content,
      pageType: "photo_publish",
      mediaInfo: {
        image_resources: [{ url: dataUrl }]
      }
    }).then(function () {
      toast("已打开发笔记");
    }).catch(function (err) {
      if (err && err.message === "bridge-unavailable") {
        toast("请在小红书内打开后发笔记，正文可长按复制");
        return;
      }
      toast("发笔记失败，可先长按复制正文");
    });
  }

  function searchNotes() {
    var keyword = "火箭对照";
    if (state.view === "compare") {
      var a = findRocket(state.leftId);
      var b = findRocket(state.rightId);
      if (a && b) keyword = a.name + " " + b.name + " 对比";
    } else if (state.view === "sound") {
      keyword = "轰鸣晚几秒";
    }
    callBridge("openRedPage", {
      type: "search",
      params: { keyword: keyword }
    }).catch(function (err) {
      if (err && err.message === "bridge-unavailable") {
        toast("请在小红书内搜索：" + keyword);
        return;
      }
      toast("暂时无法跳转搜索");
    });
  }

  function setDistance(km) {
    var n = Number(km);
    if (isNaN(n)) n = 5;
    if (n < 0.2) n = 0.2;
    if (n > 50) n = 50;
    state.distKm = Math.round(n * 10) / 10;
    renderSound();
  }

  function onAction(action, el) {
    if (action === "open-compare") {
      state.pickSlot = "left";
      state.filter = "all";
      state.leftId = "";
      state.rightId = "";
      showView("pick");
      return;
    }
    if (action === "open-sound") {
      showView("sound");
      return;
    }
    if (action === "filter-rocket") {
      state.filter = el.getAttribute("data-id");
      renderPick();
      return;
    }
    if (action === "pick-rocket") {
      var id = el.getAttribute("data-id");
      var otherId = state.pickSlot === "left" ? state.rightId : state.leftId;
      if (id === otherId) {
        toast(state.pickSlot === "left" ? "左边请选另一型" : "右边请选另一型");
        return;
      }
      if (state.pickSlot === "left") {
        state.leftId = id;
      } else {
        state.rightId = id;
      }
      if (bothPicked()) {
        showView("compare");
        return;
      }
      state.pickSlot = "right";
      renderPick();
      return;
    }
    if (action === "swap-left") {
      state.pickSlot = "left";
      showView("pick");
      return;
    }
    if (action === "swap-right") {
      state.pickSlot = "right";
      showView("pick");
      return;
    }
    if (action === "preset-dist") {
      setDistance(el.getAttribute("data-km"));
      return;
    }
    if (action === "save-card") {
      saveCard();
      return;
    }
    if (action === "post-note") {
      postNote();
      return;
    }
    if (action === "search-notes") {
      searchNotes();
      return;
    }
  }

  function bind() {
    document.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("[data-action]") : null;
      if (!el) return;
      onAction(el.getAttribute("data-action"), el);
    });
    window.addEventListener("popstate", function (e) {
      var view = e.state && e.state.view ? e.state.view : "home";
      showView(view, { fromPop: true });
    });
    $("dist-input").addEventListener("change", function (e) {
      setDistance(e.target.value);
    });
    window.addEventListener("resize", function () {
      updateAppHeight();
      if (state.view === "compare") {
        var a = findRocket(state.leftId);
        var b = findRocket(state.rightId);
        if (a && b) drawRadarFrame(a, b, 1);
      }
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateAppHeight);
    }
  }

  function boot() {
    if (supportsFlexGap()) {
      document.documentElement.classList.add("supports-flex-gap");
    }
    updateAppHeight();
    if (window.history && typeof window.history.replaceState === "function") {
      try {
        window.history.replaceState({ view: "home" }, "");
      } catch (err) {}
    }
    bind();
    showView("home");
  }

  boot();
})();
