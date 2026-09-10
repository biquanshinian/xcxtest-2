(function () {
  var DATA = window.WatchGuideData || { filters: [], sites: [], rockets: {}, intents: [], quiz: [], basePack: [] };
  var STORAGE_KEY = "xhs-watch-guide-v1";
  var TITLES = {
    home: "火箭观礼助手",
    site: "选发射场",
    rocket: "选火箭",
    intent: "选目的",
    result: "观礼攻略",
    quiz: "航天速答"
  };

  var state = {
    view: "home",
    siteFilter: "cn",
    siteId: "",
    rocketId: "",
    intentId: "",
    launchAt: "",
    checks: {},
    quizIndex: 0,
    quizScore: 0,
    quizPicked: -1,
    quizDone: false
  };
  var toastTimer = 0;
  var countTimer = 0;

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

  function findSite(id) {
    var i;
    for (i = 0; i < DATA.sites.length; i++) {
      if (DATA.sites[i].id === id) return DATA.sites[i];
    }
    return null;
  }

  function findIntent(id) {
    var i;
    for (i = 0; i < DATA.intents.length; i++) {
      if (DATA.intents[i].id === id) return DATA.intents[i];
    }
    return null;
  }

  function loadStore() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved.siteId) state.siteId = saved.siteId;
      if (saved.rocketId) state.rocketId = saved.rocketId;
      if (saved.intentId) state.intentId = saved.intentId;
      if (saved.launchAt) state.launchAt = saved.launchAt;
      if (saved.checks) state.checks = saved.checks;
    } catch (err) {}
  }

  function saveStore() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        siteId: state.siteId,
        rocketId: state.rocketId,
        intentId: state.intentId,
        launchAt: state.launchAt,
        checks: state.checks
      }));
    } catch (err) {}
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

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatRemain(ms) {
    if (ms <= 0) return "已到预计点火时间";
    var total = Math.floor(ms / 1000);
    var d = Math.floor(total / 86400);
    var h = Math.floor((total % 86400) / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var parts = [];
    if (d) parts.push(d + "天");
    parts.push(pad2(h) + ":" + pad2(m) + ":" + pad2(s));
    return "T-" + parts.join(" ");
  }

  function parseLocalDateTime(value) {
    if (!value) return null;
    var bits = value.split("T");
    if (bits.length !== 2) return null;
    var d = bits[0].split("-");
    var t = bits[1].split(":");
    if (d.length !== 3 || t.length < 2) return null;
    return new Date(
      Number(d[0]),
      Number(d[1]) - 1,
      Number(d[2]),
      Number(t[0]),
      Number(t[1]),
      t[2] ? Number(t[2]) : 0
    );
  }

  function packItems() {
    var items = DATA.basePack.slice();
    var site = findSite(state.siteId);
    var intent = findIntent(state.intentId);
    if (site) {
      if (site.filter === "cn" || site.filter === "sea") items.push("雨具或防风外套（按当天天气加减）");
      if (site.id === "jiuquan" || site.id === "jiuquan-com") items.push("防沙口罩 / 镜头罩");
      if (site.id === "haiyang" || site.id === "vandenberg") items.push("望远镜（看船或远距离轨迹）");
      if (site.id === "xichang" || site.id === "overnight") items.push("夜间照明，不要朝发射方向乱照");
    }
    if (intent) {
      var i;
      for (i = 0; i < intent.extras.length; i++) items.push(intent.extras[i]);
    }
    return items;
  }

  function buildNote() {
    var site = findSite(state.siteId);
    var rocket = DATA.rockets[state.rocketId];
    var intent = findIntent(state.intentId);
    if (!site || !rocket || !intent) return "";
    var lines = [
      site.short + " · " + rocket.name + "观礼攻略",
      "",
      "场站：" + site.name + "（" + site.region + "）",
      "火箭：" + rocket.name + "｜" + rocket.look,
      "目的：" + intent.name,
      "",
      "怎么看：" + site.spots,
      "安全：" + site.safety,
      "声光：" + site.sound,
      "拍照：" + site.photo,
      "型号提醒：" + rocket.note,
      "",
      "装备：" + packItems().join(" / "),
      "",
      "来自「火星探索日志」火箭观礼助手"
    ];
    return lines.join("\n");
  }

  function noteTitle() {
    var site = findSite(state.siteId);
    var rocket = DATA.rockets[state.rocketId];
    var title = (site ? site.short : "发射") + "观礼攻略";
    if (site && rocket) {
      var compact = site.short + rocket.name + "攻略";
      if (compact.length <= 20) title = compact;
    }
    if (title.length > 20) title = title.slice(0, 20);
    return title;
  }

  var STEP_VIEWS = ["site", "rocket", "intent", "result"];

  function renderStepper(el, current) {
    var steps = ["场站", "火箭", "目的", "攻略"];
    var html = [];
    var i;
    for (i = 0; i < steps.length; i++) {
      if (i < current) {
        html.push(
          '<button type="button" class="step is-link" data-action="goto-view" data-view="' +
          STEP_VIEWS[i] + '">' + (i + 1) + " " + steps[i] + "</button>"
        );
      } else {
        html.push('<span class="' + (i === current ? "on" : "") + '">' + (i + 1) + " " + steps[i] + "</span>");
      }
    }
    el.innerHTML = html.join("");
  }

  function renderSites() {
    renderStepper($("stepper-site"), 0);
    var filters = $("site-filters");
    var list = $("site-list");
    if (!filters || !list) return;
    var fHtml = [];
    var i;
    for (i = 0; i < DATA.filters.length; i++) {
      var f = DATA.filters[i];
      fHtml.push(
        '<button type="button" class="chip' + (state.siteFilter === f.id ? " is-on" : "") +
        '" data-action="filter-site" data-id="' + f.id + '">' + escapeHtml(f.label) + "</button>"
      );
    }
    filters.innerHTML = fHtml.join("");
    var cHtml = [];
    for (i = 0; i < DATA.sites.length; i++) {
      var s = DATA.sites[i];
      if (s.filter !== state.siteFilter) continue;
      cHtml.push(
        '<button type="button" class="pick-card" data-action="pick-site" data-id="' + s.id + '">' +
        '<span class="pick-kicker">' + escapeHtml(s.tag) + " · " + escapeHtml(s.region) + "</span>" +
        "<h3>" + escapeHtml(s.name) + "</h3>" +
        "<p>" + escapeHtml(s.climate) + "</p></button>"
      );
    }
    list.innerHTML = cHtml.join("");
  }

  function renderRockets() {
    var site = findSite(state.siteId);
    renderStepper($("stepper-rocket"), 1);
    var list = $("rocket-list");
    if (!site) {
      list.innerHTML = "";
      return;
    }
    var html = [];
    var i;
    for (i = 0; i < site.rockets.length; i++) {
      var r = DATA.rockets[site.rockets[i]];
      if (!r) continue;
      html.push(
        '<button type="button" class="pick-card" data-action="pick-rocket" data-id="' + r.id + '">' +
        '<span class="pick-kicker">' + escapeHtml(r.look) + "</span>" +
        "<h3>" + escapeHtml(r.name) + "</h3>" +
        "<p>" + escapeHtml(r.note) + "</p></button>"
      );
    }
    list.innerHTML = html.join("");
  }

  function renderIntents() {
    renderStepper($("stepper-intent"), 2);
    var list = $("intent-list");
    var html = [];
    var i;
    for (i = 0; i < DATA.intents.length; i++) {
      var it = DATA.intents[i];
      html.push(
        '<button type="button" class="pick-card" data-action="pick-intent" data-id="' + it.id + '">' +
        "<h3>" + escapeHtml(it.name) + "</h3>" +
        "<p>" + escapeHtml(it.desc) + "</p></button>"
      );
    }
    list.innerHTML = html.join("");
  }

  function renderChecks() {
    var items = packItems();
    var html = [];
    var i;
    for (i = 0; i < items.length; i++) {
      var key = items[i];
      var on = !!state.checks[key];
      html.push(
        '<li><button type="button" class="check-item' + (on ? " is-on" : "") +
        '" data-action="toggle-check" data-key="' + escapeHtml(key) + '">' +
        '<span class="check-box"></span><span class="check-label">' + escapeHtml(key) +
        "</span></button></li>"
      );
    }
    $("check-list").innerHTML = html.join("");
  }

  function renderCountdown() {
    var box = $("countdown");
    var date = parseLocalDateTime(state.launchAt);
    if (!date || isNaN(date.getTime())) {
      box.textContent = "填写时间后开始倒数";
      return;
    }
    box.textContent = formatRemain(date.getTime() - Date.now());
  }

  function renderResult() {
    var site = findSite(state.siteId);
    var rocket = DATA.rockets[state.rocketId];
    var intent = findIntent(state.intentId);
    if (!site || !rocket || !intent) return;
    $("result-hero").innerHTML =
      '<div class="kicker">' + escapeHtml(site.tag) + " · " + escapeHtml(intent.name) + "</div>" +
      "<h2>" + escapeHtml(site.short) + "｜" + escapeHtml(rocket.name) + "</h2>" +
      '<div class="meta">' + escapeHtml(site.region) + " · " + escapeHtml(rocket.look) + "</div>";
    $("guide-panel").innerHTML =
      "<h3>观礼要点</h3>" +
      '<div class="guide-block"><strong>怎么看</strong><p>' + escapeHtml(site.spots) + "</p></div>" +
      '<div class="guide-block"><strong>安全</strong><p>' + escapeHtml(site.safety) + "</p></div>" +
      '<div class="guide-block"><strong>声光</strong><p>' + escapeHtml(site.sound) + "</p></div>" +
      '<div class="guide-block"><strong>拍照</strong><p>' + escapeHtml(site.photo) + "</p></div>" +
      '<div class="guide-block"><strong>型号</strong><p>' + escapeHtml(rocket.note) + "</p></div>";
    $("launch-at").value = state.launchAt;
    $("note-text").textContent = buildNote();
    renderChecks();
    renderCountdown();
  }

  function renderQuiz() {
    var card = $("quiz-card");
    var progress = $("quiz-progress");
    if (state.quizDone) {
      progress.textContent = "速答完成";
      card.innerHTML =
        "<h2>你答对 " + state.quizScore + " / " + DATA.quiz.length + " 题</h2>" +
        '<p class="quiz-why">场站和火箭对得上，观礼笔记才不会穿帮。可以回去生成攻略，或再答一次。</p>' +
        '<button type="button" class="btn-primary" data-action="start">去生成攻略</button>' +
        '<button type="button" class="btn-ghost" data-action="retry-quiz">再答一次</button>';
      return;
    }
    var item = DATA.quiz[state.quizIndex];
    progress.textContent = "第 " + (state.quizIndex + 1) + " / " + DATA.quiz.length + " 题";
    var html = ["<h2>" + escapeHtml(item.q) + "</h2>"];
    var i;
    for (i = 0; i < item.options.length; i++) {
      var cls = "quiz-option";
      if (state.quizPicked >= 0) {
        if (i === item.answer) cls += " is-right";
        else if (i === state.quizPicked) cls += " is-wrong";
      }
      html.push(
        '<button type="button" class="' + cls + '" data-action="quiz-pick" data-index="' + i + '">' +
        escapeHtml(item.options[i]) + "</button>"
      );
    }
    if (state.quizPicked >= 0) {
      html.push('<p class="quiz-why">' + escapeHtml(item.why) + "</p>");
      html.push('<button type="button" class="btn-primary" data-action="quiz-next">' +
        (state.quizIndex === DATA.quiz.length - 1 ? "看成绩" : "下一题") + "</button>");
    }
    card.innerHTML = html.join("");
  }

  function pushView(name) {
    if (!window.history || typeof window.history.pushState !== "function") return;
    try {
      window.history.pushState({ view: name }, "");
    } catch (err) {}
  }

  function showView(name, opts) {
    opts = opts || {};
    var prev = state.view;
    state.view = name;
    var views = document.querySelectorAll(".view");
    var i;
    for (i = 0; i < views.length; i++) {
      views[i].classList.toggle("is-active", views[i].getAttribute("data-view") === name);
    }
    document.title = TITLES[name] || TITLES.home;
    $("result-dock").hidden = name !== "result";
    $("scroller").scrollTop = 0;
    if (name === "site") renderSites();
    if (name === "rocket") renderRockets();
    if (name === "intent") renderIntents();
    if (name === "result") renderResult();
    if (name === "quiz") renderQuiz();
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

  function drawStar(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    var i;
    for (i = 0; i < 4; i++) {
      ctx.rotate((Math.PI / 2) * i);
      ctx.beginPath();
      ctx.ellipse(size * 0.42, 0, size * 0.38, size * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function makeCard() {
    var site = findSite(state.siteId);
    var rocket = DATA.rockets[state.rocketId];
    var intent = findIntent(state.intentId);
    var canvas = document.createElement("canvas");
    var w = 750;
    var h = 1000;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (!ctx) return "";

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

    drawStar(ctx, 82, 86, 28, "#F4F1EA");
    ctx.fillStyle = "#F4F1EA";
    ctx.font = "22px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("火星探索日志 · 火箭观礼", 118, 86);

    ctx.fillStyle = "#E8C07A";
    ctx.font = "22px sans-serif";
    ctx.fillText((site.tag || "") + "  /  " + (intent ? intent.name : ""), 56, 180);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 54px sans-serif";
    var y = wrapText(ctx, site.short + "｜" + rocket.name, 56, 250, 638, 64, 3);

    ctx.fillStyle = "#9AA0A8";
    ctx.font = "24px sans-serif";
    y = wrapText(ctx, site.region + " · " + rocket.look, 56, y + 8, 638, 36, 2);

    var date = parseLocalDateTime(state.launchAt);
    ctx.fillStyle = "#CFE0FF";
    ctx.font = "bold 36px sans-serif";
    var countText = date && !isNaN(date.getTime())
      ? formatRemain(date.getTime() - Date.now())
      : "本地攻略卡 · 不联网";
    ctx.fillText(countText, 56, y + 36);

    var tips = [site.spots, site.safety, rocket.note];
    var i;
    var boxY = 560;
    for (i = 0; i < tips.length; i++) {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(48, boxY, 654, 96);
      ctx.fillStyle = "#F4F1EA";
      ctx.font = "24px sans-serif";
      wrapText(ctx, tips[i], 68, boxY + 38, 614, 32, 2);
      boxY += 112;
    }

    ctx.fillStyle = "#FF2442";
    ctx.fillRect(0, h - 18, w, 18);
    return canvas.toDataURL("image/jpeg", 0.86);
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
    var dataUrl = makeCard();
    if (!dataUrl) {
      toast("当前环境无法生成卡片");
      return;
    }
    callBridge("writeTempFile", { data: dataUrl }).then(function (res) {
      var filePath = res && res.filePath ? res.filePath : dataUrl;
      return callBridge("saveImageToPhotosAlbum", { filePath: filePath });
    }).then(function () {
      toast("观礼卡已保存到相册");
    }).catch(function (err) {
      if (err && err.message === "bridge-unavailable") {
        toast("请在小红书内打开后再保存到相册");
        return;
      }
      callBridge("saveImageToPhotosAlbum", { filePath: dataUrl }).then(function () {
        toast("观礼卡已保存到相册");
      }).catch(function () {
        toast("保存失败，请重试或改用发笔记");
      });
    });
  }

  function postNote() {
    var dataUrl = makeCard();
    var content = buildNote();
    if (content.length > 1000) content = content.slice(0, 997) + "...";
    callBridge("postNote", {
      title: noteTitle(),
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
    var site = findSite(state.siteId);
    var rocket = DATA.rockets[state.rocketId];
    var keyword = (site ? site.short : "火箭") + " " + (rocket ? rocket.name : "观礼");
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

  function onAction(action, el) {
    if (action === "start") {
      showView("site");
      return;
    }
    if (action === "open-quiz") {
      state.quizIndex = 0;
      state.quizScore = 0;
      state.quizPicked = -1;
      state.quizDone = false;
      showView("quiz");
      return;
    }
    if (action === "retry-quiz") {
      state.quizIndex = 0;
      state.quizScore = 0;
      state.quizPicked = -1;
      state.quizDone = false;
      renderQuiz();
      return;
    }
    if (action === "goto-view") {
      showView(el.getAttribute("data-view"));
      return;
    }
    if (action === "filter-site") {
      state.siteFilter = el.getAttribute("data-id");
      renderSites();
      return;
    }
    if (action === "pick-site") {
      state.siteId = el.getAttribute("data-id");
      state.rocketId = "";
      saveStore();
      showView("rocket");
      return;
    }
    if (action === "pick-rocket") {
      state.rocketId = el.getAttribute("data-id");
      saveStore();
      showView("intent");
      return;
    }
    if (action === "pick-intent") {
      state.intentId = el.getAttribute("data-id");
      saveStore();
      showView("result");
      return;
    }
    if (action === "toggle-check") {
      var key = el.getAttribute("data-key");
      state.checks[key] = !state.checks[key];
      saveStore();
      renderChecks();
      return;
    }
    if (action === "reset-checks") {
      state.checks = {};
      saveStore();
      renderChecks();
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
    if (action === "quiz-pick") {
      if (state.quizPicked >= 0) return;
      var idx = Number(el.getAttribute("data-index"));
      state.quizPicked = idx;
      if (idx === DATA.quiz[state.quizIndex].answer) state.quizScore += 1;
      renderQuiz();
      return;
    }
    if (action === "quiz-next") {
      if (state.quizIndex >= DATA.quiz.length - 1) {
        state.quizDone = true;
      } else {
        state.quizIndex += 1;
        state.quizPicked = -1;
      }
      renderQuiz();
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
    $("launch-at").addEventListener("change", function (e) {
      state.launchAt = e.target.value;
      saveStore();
      renderCountdown();
      $("note-text").textContent = buildNote();
    });
    window.addEventListener("resize", updateAppHeight);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateAppHeight);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && countTimer) {
        window.clearInterval(countTimer);
        countTimer = 0;
      } else if (!document.hidden && !countTimer) {
        countTimer = window.setInterval(renderCountdown, 1000);
      }
    });
  }

  function boot() {
    if (supportsFlexGap()) {
      document.documentElement.classList.add("supports-flex-gap");
    }
    updateAppHeight();
    loadStore();
    if (window.history && typeof window.history.replaceState === "function") {
      try {
        window.history.replaceState({ view: "home" }, "");
      } catch (err) {}
    }
    bind();
    showView("home");
    countTimer = window.setInterval(renderCountdown, 1000);
  }

  boot();
})();
