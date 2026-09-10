(function () {
  var DATA = window.RocketScaleData || { filters: [], rockets: [], refs: [], busTons: 15 };
  var TITLES = {
    home: "火箭体量尺",
    pick: "选火箭",
    result: "体量尺"
  };
  var BUS_TONS = DATA.busTons || 15;
  var HUMAN = 1.7;
  var FLOOR = 30;
  var PLANE = 40;

  var state = {
    view: "home",
    filter: "all",
    rocketId: ""
  };
  var toastTimer = 0;
  var scaleRaf = 0;
  var shownP = 0;

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

  function preferReduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function clipTitle(text) {
    if (text.length > 20) return text.slice(0, 20);
    return text;
  }

  function formatNum(n, forceInt) {
    if (forceInt || Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function youCount(height) {
    return height / HUMAN;
  }

  function floorLine(height) {
    var diff = height - FLOOR;
    if (Math.abs(diff) < 1) return "和 10 层楼差不多高";
    if (diff > 0) return "比 10 层楼高 " + formatNum(diff, true) + " 米";
    return "比 10 层楼矮 " + formatNum(-diff, true) + " 米";
  }

  function planeLine(height) {
    var diff = height - PLANE;
    if (Math.abs(diff) < 1) return "和一架波音 737 差不多长";
    if (diff > 0) return "比一架波音 737 还高 " + formatNum(diff, true) + " 米";
    return "比一架波音 737 短 " + formatNum(-diff, true) + " 米";
  }

  function busCount(mass) {
    return mass / BUS_TONS;
  }

  function scaleNote(r) {
    if (!r) return "";
    return [
      r.name + "有多高",
      "",
      "高约 " + formatNum(r.height, true) + " 米",
      "约等于 " + formatNum(youCount(r.height), false) + " 个你",
      floorLine(r.height),
      planeLine(r.height),
      "起飞约 " + formatNum(r.mass, true) + " 吨，相当于 " + formatNum(busCount(r.mass), true) + " 辆公交",
      "",
      "外形：" + r.look,
      "主场：" + r.site,
      "来自「火星探索日志」火箭体量尺，参数为常用约数。"
    ].join("\n");
  }

  function scaleMax(r) {
    var maxH = r.height;
    var i;
    for (i = 0; i < DATA.refs.length; i++) {
      if (DATA.refs[i].height > maxH) maxH = DATA.refs[i].height;
    }
    return maxH;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rad = r;
    if (rad > w / 2) rad = w / 2;
    if (rad > h / 2) rad = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function goldFill(ctx, x0, x1) {
    var g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, "#8C6A32");
    g.addColorStop(0.28, "#F0D29A");
    g.addColorStop(0.55, "#E8C07A");
    g.addColorStop(1, "#6F5428");
    return g;
  }

  function drawOgive(ctx, cx, top, w, h) {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, top + h);
    ctx.quadraticCurveTo(cx - w * 0.12, top + h * 0.22, cx, top);
    ctx.quadraticCurveTo(cx + w * 0.12, top + h * 0.22, cx + w / 2, top + h);
    ctx.closePath();
    ctx.fill();
  }

  function drawEngineBell(ctx, cx, bottom, w, h) {
    ctx.fillStyle = "#2A241C";
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.32, bottom - h);
    ctx.lineTo(cx + w * 0.32, bottom - h);
    ctx.lineTo(cx + w * 0.5, bottom);
    ctx.lineTo(cx - w * 0.5, bottom);
    ctx.closePath();
    ctx.fill();
  }

  function drawOneBooster(ctx, x, bottom, w, h, back) {
    var y = bottom - h;
    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    if (back) {
      g.addColorStop(0, "#6A5228");
      g.addColorStop(0.5, "#B8924E");
      g.addColorStop(1, "#5A4420");
    } else {
      g.addColorStop(0, "#8C6A32");
      g.addColorStop(0.4, "#E8C07A");
      g.addColorStop(1, "#6F5428");
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y + w * 0.7);
    ctx.quadraticCurveTo(x + w / 2, y - 1, x + w, y + w * 0.7);
    ctx.lineTo(x + w, bottom - 3);
    ctx.lineTo(x, bottom - 3);
    ctx.closePath();
    ctx.fill();
    drawEngineBell(ctx, x + w / 2, bottom, w * 0.7, Math.max(3, h * 0.035));
  }

  function drawBundleRocket(ctx, left, bottom, w, h, id) {
    var mid = left + w * 0.5;
    var fat = id === "cz5";
    var coreW = fat ? w * 0.3 : w * 0.26;
    var bW = fat ? w * 0.2 : w * 0.155;
    var bH = h * (fat ? 0.7 : 0.58);
    var fairingH = h * (fat ? 0.2 : 0.15);
    var coreTop = bottom - h + fairingH * 0.62;
    var coreL = mid - coreW / 2;
    drawOneBooster(ctx, mid - coreW / 2 - bW + bW * 0.4, bottom, bW, bH * 0.95, true);
    drawOneBooster(ctx, mid + coreW / 2 - bW * 0.4, bottom, bW, bH * 0.95, true);
    ctx.fillStyle = goldFill(ctx, coreL, coreL + coreW);
    roundRectPath(ctx, coreL, coreTop, coreW, bottom - coreTop - 2, 5);
    ctx.fill();
    ctx.fillStyle = goldFill(ctx, mid - coreW * 0.62, mid + coreW * 0.62);
    drawOgive(ctx, mid, bottom - h, coreW * (fat ? 1.28 : 1.12), fairingH + 3);
    ctx.fillStyle = "rgba(11,12,14,0.22)";
    ctx.fillRect(coreL + 1, coreTop + (bottom - coreTop) * 0.38, coreW - 2, 2);
    drawOneBooster(ctx, mid - coreW / 2 - bW * 0.95, bottom, bW, bH, false);
    drawOneBooster(ctx, mid + coreW / 2 - bW * 0.05, bottom, bW, bH, false);
    drawEngineBell(ctx, mid, bottom, coreW * 0.7, Math.max(4, h * 0.04));
  }

  function drawSlimRocket(ctx, left, bottom, w, h, id) {
    var mid = left + w * 0.5;
    var coreW = w * (id === "falcon9" ? 0.42 : 0.38);
    var coreL = mid - coreW / 2;
    var fairingH = h * 0.14;
    ctx.fillStyle = goldFill(ctx, coreL, coreL + coreW);
    roundRectPath(ctx, coreL, bottom - h + fairingH * 0.7, coreW, h - fairingH * 0.7 - 2, 4);
    ctx.fill();
    drawOgive(ctx, mid, bottom - h, coreW * 1.05, fairingH + 2);
    if (id === "falcon9") {
      ctx.fillStyle = "#2A2D34";
      ctx.fillRect(coreL, bottom - h * 0.38, coreW, Math.max(3, h * 0.018));
      ctx.beginPath();
      ctx.moveTo(coreL - 5, bottom);
      ctx.lineTo(coreL, bottom - h * 0.12);
      ctx.lineTo(coreL + 2, bottom - h * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(coreL + coreW + 5, bottom);
      ctx.lineTo(coreL + coreW, bottom - h * 0.12);
      ctx.lineTo(coreL + coreW - 2, bottom - h * 0.1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(mid - 1.2, bottom - h + fairingH + 6, 2.2, h * 0.42);
    drawEngineBell(ctx, mid, bottom, coreW * 0.72, Math.max(3, h * 0.04));
  }

  function drawFatRocket(ctx, left, bottom, w, h, id) {
    var mid = left + w * 0.5;
    var coreW = w * 0.58;
    var coreL = mid - coreW / 2;
    var shipH = id === "starship" ? h * 0.42 : h * 0.18;
    ctx.fillStyle = goldFill(ctx, coreL, coreL + coreW);
    roundRectPath(ctx, coreL, bottom - h + shipH * 0.55, coreW, h - shipH * 0.55 - 2, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(coreL + 2, bottom - h + shipH * 0.6);
    ctx.quadraticCurveTo(mid, bottom - h - 2, coreL + coreW - 2, bottom - h + shipH * 0.6);
    ctx.closePath();
    ctx.fill();
    if (id === "starship") {
      ctx.fillStyle = "rgba(11,12,14,0.22)";
      ctx.fillRect(coreL + 2, bottom - h * 0.42, coreW - 4, 3);
      ctx.fillStyle = "#C9A05A";
      ctx.beginPath();
      ctx.moveTo(coreL - 7, bottom - h * 0.72);
      ctx.lineTo(coreL, bottom - h * 0.78);
      ctx.lineTo(coreL, bottom - h * 0.58);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(coreL + coreW + 7, bottom - h * 0.28);
      ctx.lineTo(coreL + coreW, bottom - h * 0.34);
      ctx.lineTo(coreL + coreW, bottom - h * 0.14);
      ctx.closePath();
      ctx.fill();
    }
    drawEngineBell(ctx, mid - coreW * 0.22, bottom, coreW * 0.28, Math.max(3, h * 0.035));
    drawEngineBell(ctx, mid, bottom, coreW * 0.28, Math.max(3, h * 0.035));
    drawEngineBell(ctx, mid + coreW * 0.22, bottom, coreW * 0.28, Math.max(3, h * 0.035));
  }

  function drawTowerRocket(ctx, left, bottom, w, h) {
    var mid = left + w * 0.5;
    var coreW = w * 0.36;
    var coreL = mid - coreW / 2;
    ctx.fillStyle = "#D4B06A";
    ctx.fillRect(mid - 1.6, bottom - h, 3.2, h * 0.13);
    ctx.beginPath();
    ctx.moveTo(mid, bottom - h - 3);
    ctx.lineTo(mid - 5, bottom - h + h * 0.05);
    ctx.lineTo(mid + 5, bottom - h + h * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mid - 6, bottom - h + h * 0.08);
    ctx.lineTo(mid - 1, bottom - h + h * 0.03);
    ctx.lineTo(mid - 1, bottom - h + h * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mid + 6, bottom - h + h * 0.08);
    ctx.lineTo(mid + 1, bottom - h + h * 0.03);
    ctx.lineTo(mid + 1, bottom - h + h * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = goldFill(ctx, coreL, coreL + coreW);
    roundRectPath(ctx, coreL, bottom - h + h * 0.14, coreW, h * 0.86 - 2, 4);
    ctx.fill();
    drawOgive(ctx, mid, bottom - h + h * 0.1, coreW, h * 0.08);
    drawEngineBell(ctx, mid, bottom, coreW * 0.7, Math.max(3, h * 0.04));
  }

  function drawRocketBody(ctx, left, bottom, w, h, shape, color, id) {
    if (h < 2) return;
    id = id || "";
    var mid = left + w * 0.5;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(mid, bottom + 3, w * 0.38, 3.2, 0, 0, Math.PI * 2);
    else ctx.rect(mid - w * 0.38, bottom + 1, w * 0.76, 4);
    ctx.fill();
    if (shape === "boost") drawBundleRocket(ctx, left, bottom, w, h, id);
    else if (shape === "tower") drawTowerRocket(ctx, left, bottom, w, h);
    else if (shape === "fat") drawFatRocket(ctx, left, bottom, w, h, id);
    else drawSlimRocket(ctx, left, bottom, w, h, id);
  }

  function drawHuman(ctx, cx, bottom, h, color) {
    var hh = Math.max(h, 3);
    ctx.fillStyle = color;
    if (hh < 10) {
      ctx.beginPath();
      ctx.arc(cx, bottom - hh * 0.55, Math.max(2, hh * 0.45), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    var headR = Math.max(3.8, hh * 0.16);
    var headY = bottom - hh + headR + 0.6;
    ctx.beginPath();
    ctx.arc(cx, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - headR * 0.75, headY + headR * 0.55);
    ctx.quadraticCurveTo(cx - hh * 0.24, headY + hh * 0.28, cx - hh * 0.17, bottom);
    ctx.lineTo(cx + hh * 0.17, bottom);
    ctx.quadraticCurveTo(cx + hh * 0.24, headY + hh * 0.28, cx + headR * 0.75, headY + headR * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  function drawBus(ctx, cx, bottom, h, color) {
    var hh = Math.max(h, 16);
    var bw = Math.min(26, Math.max(15, hh * 0.36));
    var x = cx - bw / 2;
    var y = bottom - hh;
    var i;
    ctx.fillStyle = "#C5CAD3";
    roundRectPath(ctx, x, y, bw, hh - 3, 4);
    ctx.fill();
    ctx.fillStyle = "#3B82F6";
    roundRectPath(ctx, x + 2, y + 3, bw - 4, Math.max(8, hh * 0.15), 3);
    ctx.fill();
    ctx.fillStyle = "#F4F1EA";
    ctx.fillRect(x + 3, y + 2, 3.5, 3);
    ctx.fillRect(x + bw - 6.5, y + 2, 3.5, 3);
    ctx.fillStyle = "#1B1E25";
    ctx.fillRect(x + 3, y + hh * 0.2, bw - 6, 4);
    var rows = Math.max(3, Math.round(hh / 22));
    for (i = 0; i < rows; i++) {
      var wy = y + hh * 0.28 + i * ((hh * 0.5) / rows);
      ctx.fillStyle = "#4B5C74";
      roundRectPath(ctx, x + 3, wy, bw * 0.38, Math.max(4, hh * 0.07), 1.2);
      ctx.fill();
      roundRectPath(ctx, x + bw * 0.55, wy, bw * 0.38, Math.max(4, hh * 0.07), 1.2);
      ctx.fill();
    }
    ctx.fillStyle = "#2A2D34";
    ctx.fillRect(x + bw * 0.38, y + hh * 0.42, bw * 0.24, hh * 0.22);
    ctx.fillStyle = "#111318";
    ctx.beginPath();
    ctx.arc(x + 3, bottom - hh * 0.22, Math.max(2.4, bw * 0.16), 0, Math.PI * 2);
    ctx.arc(x + 3, bottom - hh * 0.08, Math.max(2.4, bw * 0.16), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBuilding(ctx, cx, bottom, h, color) {
    var hh = Math.max(h, 12);
    var bw = Math.max(20, Math.min(36, hh * 0.36));
    var x = cx - bw / 2;
    var y = bottom - hh;
    ctx.fillStyle = "#8BA3C7";
    ctx.fillRect(x - 3, y + 3, bw + 6, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 7, bw, hh - 7);
    ctx.fillRect(x + bw * 0.4, y - 2, bw * 0.2, 10);
    ctx.fillStyle = "#1B1E25";
    ctx.fillRect(x + bw * 0.35, bottom - 14, bw * 0.3, 14);
    var cols = 3;
    var rows = Math.max(4, Math.round(hh / 13));
    var i;
    var j;
    var cw = (bw - 8) / cols;
    var rh = (hh - 28) / rows;
    for (i = 0; i < rows; i++) {
      for (j = 0; j < cols; j++) {
        ctx.fillStyle = (i + j) % 5 === 0 ? "rgba(232,192,122,0.3)" : "rgba(11,12,14,0.32)";
        ctx.fillRect(x + 3 + j * cw + 1, y + 12 + i * rh + 1, Math.max(2, cw - 3), Math.max(2, rh - 3));
      }
    }
  }

  function drawPlane(ctx, cx, bottom, h, color) {
    var hh = Math.max(h, 22);
    var fuse = Math.min(26, Math.max(12, hh * 0.095));
    var wing = Math.min(58, Math.max(32, hh * 0.26));
    var y = bottom - hh;
    var noseH = Math.max(14, hh * 0.11);
    var i;
    var wingY = y + hh * 0.4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - wing / 2, wingY + hh * 0.07);
    ctx.lineTo(cx - fuse * 0.2, wingY);
    ctx.lineTo(cx + fuse * 0.2, wingY);
    ctx.lineTo(cx + wing / 2, wingY + hh * 0.07);
    ctx.lineTo(cx + wing * 0.2, wingY + hh * 0.13);
    ctx.lineTo(cx - wing * 0.2, wingY + hh * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - wing / 2 - 1, wingY + 2, 3, hh * 0.06);
    ctx.fillRect(cx + wing / 2 - 2, wingY + 2, 3, hh * 0.06);
    ctx.fillStyle = "#5B6570";
    ctx.beginPath();
    if (ctx.ellipse) {
      ctx.ellipse(cx - wing * 0.28, wingY + hh * 0.12, 5, 7, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + wing * 0.28, wingY + hh * 0.12, 5, 7, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(cx - wing * 0.28, wingY + hh * 0.12, 5, 0, Math.PI * 2);
      ctx.arc(cx + wing * 0.28, wingY + hh * 0.12, 5, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = "#F2F5F8";
    ctx.beginPath();
    ctx.moveTo(cx - fuse * 0.28, y + noseH);
    ctx.quadraticCurveTo(cx, y - 1, cx + fuse * 0.28, y + noseH);
    ctx.closePath();
    ctx.fill();
    roundRectPath(ctx, cx - fuse / 2, y + noseH - 3, fuse, hh - noseH - 6, fuse * 0.4);
    ctx.fill();
    ctx.strokeStyle = "rgba(59,130,246,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#1E3A5F";
    ctx.fillRect(cx - fuse * 0.28, y + 8, fuse * 0.56, 5);
    ctx.fillStyle = "#7EB0E8";
    var winN = Math.max(5, Math.round(hh / 18));
    for (i = 0; i < winN; i++) {
      ctx.fillRect(cx - 2, y + noseH + 10 + i * ((hh * 0.42) / winN), 4, 3);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + 2, bottom - 8);
    ctx.lineTo(cx + fuse * 1.7, bottom - hh * 0.18);
    ctx.lineTo(cx + fuse * 0.35, bottom - 3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - wing * 0.22, bottom - 3);
    ctx.lineTo(cx + wing * 0.22, bottom - 3);
    ctx.lineTo(cx + fuse * 0.7, bottom - hh * 0.09);
    ctx.lineTo(cx - fuse * 0.4, bottom - hh * 0.09);
    ctx.closePath();
    ctx.fill();
  }

  function drawRefIcon(ctx, ref, cx, bottom, h) {
    if (ref.id === "human") drawHuman(ctx, cx, bottom, h, ref.color);
    else if (ref.id === "bus") drawBus(ctx, cx, bottom, h, ref.color);
    else if (ref.id === "floor10") drawBuilding(ctx, cx, bottom, h, ref.color);
    else drawPlane(ctx, cx, bottom, h, ref.color);
  }

  function drawHeightPill(ctx, x, y, text) {
    ctx.font = "bold 11px sans-serif";
    var tw = ctx.measureText(text).width;
    var py = y < 14 ? 14 : y;
    ctx.fillStyle = "rgba(20,22,28,0.9)";
    roundRectPath(ctx, x, py - 10, tw + 14, 20, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(232,192,122,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#E8C07A";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 7, py);
  }

  function drawInset(ctx, w, pad, tiny, leftSide) {
    var boxW = tiny.length > 1 ? 132 : 96;
    var boxH = 94;
    var bx = leftSide ? pad + 36 : w - pad - boxW;
    var by = 10;
    var i;
    ctx.fillStyle = "rgba(16,18,24,0.94)";
    roundRectPath(ctx, bx, by, boxW, boxH, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(232,192,122,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#E8C07A";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("地面放大", bx + 10, by + 8);
    var slot = (boxW - 12) / tiny.length;
    for (i = 0; i < tiny.length; i++) {
      var ref = tiny[i];
      var cx = bx + 6 + slot * i + slot / 2;
      drawRefIcon(ctx, ref, cx, by + boxH - 28, ref.id === "human" ? 36 : 38);
      ctx.fillStyle = "#9AA0A8";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(ref.short, cx, by + boxH - 24);
      ctx.fillText(ref.height + "m", cx, by + boxH - 12);
    }
  }

  function drawRulerOnCtx(ctx, w, h, r, p) {
    var rulerW = 40;
    var pad = 10;
    var ground = h - 50;
    var usable = ground - 20;
    var maxH = scaleMax(r);
    var ppm = (usable / maxH) * p;
    var i;
    var tick;
    var meters;
    var y;
    var sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#1C2436");
    sky.addColorStop(0.55, "#12151C");
    sky.addColorStop(1, "#0C0E12");
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(244,241,234,0.16)";
    var stars = [[0.2, 0.1], [0.74, 0.07], [0.88, 0.18], [0.58, 0.14], [0.32, 0.2]];
    for (i = 0; i < stars.length; i++) {
      ctx.beginPath();
      ctx.arc(w * stars[i][0], 18 + stars[i][1] * 70, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(244,241,234,0.06)";
    ctx.lineWidth = 1;
    for (tick = 0; tick <= 4; tick++) {
      meters = Math.round((maxH * tick) / 4);
      y = ground - meters * ppm;
      ctx.beginPath();
      ctx.moveTo(rulerW, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(244,241,234,0.28)";
    ctx.beginPath();
    ctx.moveTo(rulerW - 6, 16);
    ctx.lineTo(rulerW - 6, ground);
    ctx.stroke();
    ctx.fillStyle = "#9AA0A8";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (tick = 0; tick <= 4; tick++) {
      meters = Math.round((maxH * tick) / 4);
      y = ground - meters * ppm;
      ctx.beginPath();
      ctx.moveTo(rulerW - 11, y);
      ctx.lineTo(rulerW - 3, y);
      ctx.stroke();
      ctx.fillText(meters + "m", rulerW - 14, y);
    }

    ctx.fillStyle = "#16181E";
    ctx.fillRect(0, ground, w, h - ground);
    ctx.fillStyle = "rgba(255,36,66,0.18)";
    ctx.fillRect(pad, ground, w - pad * 2, 4);
    ctx.fillStyle = "#FF2442";
    ctx.fillRect(pad, ground, w - pad * 2, 2);

    var rocketW = r.shape === "boost" ? 78 : r.shape === "fat" ? 62 : 36;
    var rocketLeft = rulerW + 4;
    var rocketH = r.height * ppm;
    drawRocketBody(ctx, rocketLeft, ground, rocketW, rocketH, r.shape || "slim", "#E8C07A", r.id);
    if (p > 0.6 && rocketH > 28) {
      drawHeightPill(ctx, rocketLeft + rocketW + 6, ground - rocketH, formatNum(r.height * p, true) + "m");
    }
    ctx.fillStyle = "#E8C07A";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("火箭", rocketLeft + rocketW / 2, ground + 12);

    var tall = [];
    var tiny = [];
    for (i = 0; i < DATA.refs.length; i++) {
      var refH = DATA.refs[i].height * ppm;
      var alwaysTiny = DATA.refs[i].id === "human" || DATA.refs[i].id === "bus";
      if (alwaysTiny && refH < 40) tiny.push(DATA.refs[i]);
      else tall.push(DATA.refs[i]);
    }
    var insetW = tiny.length && p > 0.35 ? (tiny.length > 1 ? 136 : 100) : 0;
    var clusterLeft = rocketLeft + rocketW + 24;
    var clusterRight = w - pad - 6 - insetW;
    if (clusterRight < clusterLeft + 48) clusterRight = clusterLeft + 48;
    if (tall.length) {
      var n = tall.length;
      var step = n === 1 ? 0 : (clusterRight - clusterLeft) / (n - 1);
      if (step > 90) step = 90;
      var startX = n === 1
        ? clusterLeft + (clusterRight - clusterLeft) / 2
        : clusterLeft + Math.max(0, (clusterRight - clusterLeft - step * (n - 1)) / 2);
      for (i = 0; i < n; i++) {
        var ref = tall[i];
        var cx = startX + step * i;
        drawRefIcon(ctx, ref, cx, ground, ref.height * ppm);
        ctx.fillStyle = "#9AA0A8";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(ref.short, cx, ground + 12);
      }
    }

    if (tiny.length && p > 0.35) {
      drawInset(ctx, w, pad, tiny, rocketH < usable * 0.55);
    }
  }

  function sizeRulerCanvas(canvas) {
    var wrap = canvas.parentNode;
    var w = wrap.clientWidth || 300;
    var h = 456;
    var dpr = window.devicePixelRatio || 1;
    if (dpr > 2) dpr = 2;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function paintStats(r, p) {
    var h = r.height * p;
    var m = r.mass * p;
    $("stat-box").innerHTML =
      '<div class="big">高约 <span class="count-num">' + formatNum(h, true) + "</span> 米</div>" +
      '<div class="line">约等于 <span class="count-num">' + formatNum(youCount(h), false) + "</span> 个你</div>" +
      '<div class="line">' + floorLine(h) + "</div>" +
      '<div class="line">' + planeLine(h) + "</div>" +
      '<div class="line">起飞约 <span class="count-num">' + formatNum(m, true) +
      "</span> 吨，相当于 <span class=\"count-num\">" + formatNum(busCount(m), true) + "</span> 辆公交</div>";
    $("scale-note").textContent = scaleNote({
      name: r.name,
      look: r.look,
      site: r.site,
      height: h,
      mass: m
    });
  }

  function drawRulerFrame(r, p) {
    var canvas = $("ruler-canvas");
    if (!canvas) return;
    var sized = sizeRulerCanvas(canvas);
    if (!sized) return;
    drawRulerOnCtx(sized.ctx, sized.w, sized.h, r, p);
    paintStats(r, p);
  }

  function stopScale() {
    if (scaleRaf) {
      window.cancelAnimationFrame(scaleRaf);
      scaleRaf = 0;
    }
  }

  function playScale(r) {
    stopScale();
    var start = Date.now();
    var dur = preferReduceMotion() ? 0 : 720;
    function tick() {
      var t = dur ? Math.min(1, (Date.now() - start) / dur) : 1;
      shownP = easeOutCubic(t);
      drawRulerFrame(r, shownP);
      if (t < 1) {
        scaleRaf = window.requestAnimationFrame(tick);
      } else {
        shownP = 1;
        drawRulerFrame(r, 1);
        scaleRaf = 0;
      }
    }
    if (!window.requestAnimationFrame || dur === 0) {
      shownP = 1;
      drawRulerFrame(r, 1);
      return;
    }
    drawRulerFrame(r, 0.08);
    scaleRaf = window.requestAnimationFrame(tick);
  }

  function renderPick() {
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
      cHtml.push(
        '<button type="button" class="pick-card' + (r.id === state.rocketId ? " is-on" : "") +
        '" data-action="pick-rocket" data-id="' + r.id + '">' +
        '<span class="pick-kicker">' + escapeHtml(r.site) + " · 约 " + formatNum(r.height, true) + " 米</span>" +
        "<h3>" + escapeHtml(r.name) + "</h3>" +
        "<p>" + escapeHtml(r.look) + "</p></button>"
      );
    }
    list.innerHTML = cHtml.join("");
  }

  function renderResult() {
    var r = findRocket(state.rocketId);
    if (!r) return;
    $("result-name").textContent = r.name;
    playScale(r);
  }

  function pushView(name) {
    if (!window.history || typeof window.history.pushState !== "function") return;
    try {
      window.history.pushState({ view: name }, "");
    } catch (err) {}
  }

  function showView(name, opts) {
    opts = opts || {};
    if (name === "result" && !findRocket(state.rocketId)) name = "pick";
    var prev = state.view;
    if (document.activeElement && document.activeElement.blur) {
      try { document.activeElement.blur(); } catch (err) {}
    }
    state.view = name;
    var views = document.querySelectorAll(".view");
    var i;
    for (i = 0; i < views.length; i++) {
      var on = views[i].getAttribute("data-view") === name;
      views[i].classList.toggle("is-active", on);
      views[i].hidden = !on;
    }
    document.title = TITLES[name] || TITLES.home;
    $("result-dock").hidden = name !== "result";
    if (name !== "result") stopScale();
    if (name === "pick") renderPick();
    if (name === "result") renderResult();
    resetPageScroll();
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        resetPageScroll();
        window.requestAnimationFrame(resetPageScroll);
      });
    }
    window.setTimeout(resetPageScroll, 80);
    if (!opts.fromPop && name !== prev) pushView(name);
  }

  function resetPageScroll() {
    var scroller = $("scroller");
    var result = $("view-result");
    if (scroller) scroller.scrollTop = 0;
    if (state.view === "result" && result && result.scrollIntoView) {
      try { result.scrollIntoView(true); } catch (err) {}
    }
    if (window.scrollTo) {
      try { window.scrollTo(0, 0); } catch (err) {}
    }
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
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

  function makeCard() {
    var r = findRocket(state.rocketId);
    if (!r) return "";
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

    ctx.fillStyle = "#F4F1EA";
    ctx.font = "22px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("火星探索日志 · 火箭体量尺", 56, 86);
    ctx.fillStyle = "#E8C07A";
    ctx.font = "22px sans-serif";
    ctx.fillText("跟人楼飞机比多高", 56, 168);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 44px sans-serif";
    wrapText(ctx, r.name, 56, 230, 638, 52, 2);

    ctx.drawImage(makeOffscreenRuler(r, 654, 400), 48, 268);

    ctx.fillStyle = "#CFE0FF";
    ctx.font = "bold 36px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("高约 " + formatNum(r.height, true) + " 米", 56, 700);
    ctx.fillStyle = "#F4F1EA";
    ctx.font = "24px sans-serif";
    wrapText(ctx, "约等于 " + formatNum(youCount(r.height), false) + " 个你 · " + floorLine(r.height), 56, 748, 638, 34, 2);
    wrapText(ctx, "起飞约 " + formatNum(r.mass, true) + " 吨，相当于 " + formatNum(busCount(r.mass), true) + " 辆公交", 56, 820, 638, 34, 2);

    ctx.fillStyle = "#FF2442";
    ctx.fillRect(0, h - 18, w, 18);
    return canvas.toDataURL("image/jpeg", 0.86);
  }

  function makeOffscreenRuler(r, w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    if (ctx) drawRulerOnCtx(ctx, w, h, r, 1);
    return c;
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
    var r = findRocket(state.rocketId);
    var dataUrl = makeCard();
    var content = scaleNote(r);
    if (content.length > 1000) content = content.slice(0, 997) + "...";
    callBridge("postNote", {
      title: clipTitle(r ? r.name + "有多高" : "火箭体量尺"),
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
    var r = findRocket(state.rocketId);
    var keyword = r ? r.name + " 有多高" : "火箭有多高";
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
      state.filter = "all";
      state.rocketId = "";
      showView("pick");
      return;
    }
    if (action === "filter-rocket") {
      state.filter = el.getAttribute("data-id");
      renderPick();
      return;
    }
    if (action === "pick-rocket") {
      if (el && el.blur) el.blur();
      state.rocketId = el.getAttribute("data-id");
      showView("result");
      return;
    }
    if (action === "swap-rocket") {
      showView("pick");
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
    window.addEventListener("resize", function () {
      updateAppHeight();
      if (state.view === "result") {
        var r = findRocket(state.rocketId);
        if (r) drawRulerFrame(r, shownP || 1);
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
