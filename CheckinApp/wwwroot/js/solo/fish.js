// solo/fish.js — 大鱼吃小鱼（单机）。
// 规则依据：checkin-work/docs/research/2026-10-30-audit-solo-games.md §2.1（F1-F10）
//   + Batch D：F11 关卡制（随分数/时间提速加密度，图形提示不加文字）/ F12 天敌危害
//   （水母、鲨鱼碰触扣命 + 无敌帧，HUD 图形标示危险鱼）/ F13 音效（吃鱼/受伤/冲刺/结束，
//   WebAudio 合成音）/ P3-3 教程 7 档命名与引擎同规。
// 与 App FishGame.kt 同规则（改一处必须同步另一处）。纯前端算分，结束时 POST /games/fish/score。
(function () {
  'use strict';

  var host = document.querySelector('.gm-solo');
  if (!host) return;
  var canvas = document.getElementById('soloCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var gameKey = host.dataset.gameKey || 'fish';
  var maxScore = parseInt(host.dataset.maxScore || '1000000', 10);

  var W = canvas.width, H = canvas.height;
  var MAX_LEVEL = 6;                                    // 7 体型档：0..6
  var VALUES = [50, 150, 400, 900, 1800, 3600, 7200];   // 普通鱼按体型档计分（P3-3：7 档命名）
  var LEVEL_WEIGHTS = [3, 3, 2, 2, 1, 1, 1];           // 小鱼多大鱼少
  var STAGE_MAX = 6;                                    // 关卡上限（F11）
  var STAGE_SCORE_STEP = 1000;                          // 每 1000 分 +1 关（F11）
  var STAGE_TIME_STEP = 120;                            // 每 120 秒 +1 关（F11）

  var level, growth, lives, px, py, tx, ty, dir, score, best;
  var over, invuln, chain, chainTimer, dashCd, time;
  var stage, stageFlash;
  var fishes, pearls, bubbles, seaweed;
  var lastTs = 0;

  // ---- 音效（F13）：WebAudio 合成音，吃鱼 / 受伤 / 冲刺 / 结束四类 ----
  var sfx = (function () {
    var ac = null;
    var enabled = true;   // 音效开关（DisplaySettings.Sound，初始化时拉取）
    function ensure() {
      try {
        if (!ac) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ac = new AC();
        }
        if (ac.state === 'suspended') ac.resume();
      } catch (e) { ac = null; }
      return ac;
    }
    function tone(wave, f0, f1, dur, vol, delay) {
      if (!ac) return;
      var t0 = ac.currentTime + (delay || 0);
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) osc.frequency.linearRampToValueAtTime(f1, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain); gain.connect(ac.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    }
    function play(name) {
      if (!enabled) return;
      if (!ensure()) return;
      try {
        if (name === 'eat') tone('sine', 520, 820, 0.09, 0.18, 0);
        else if (name === 'hurt') tone('square', 200, 90, 0.22, 0.16, 0);
        else if (name === 'dash') tone('triangle', 320, 960, 0.11, 0.14, 0);
        else if (name === 'end') {
          tone('sine', 660, 660, 0.14, 0.18, 0);
          tone('sine', 440, 440, 0.14, 0.18, 0.15);
          tone('sine', 294, 294, 0.30, 0.18, 0.30);
        }
      } catch (e) {}
    }
    return {
      ensure: ensure,
      play: play,
      setEnabled: function (on) { enabled = !!on; },
    };
  })();

  // 音效开关（设置面板「音效」项，只对有音效的游戏显示）
  fetch('/api/v1/games/settings', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.ok && j.data) sfx.setEnabled(j.data.sound !== false);
    })
    .catch(function () {});

  function radius(lvl) { return 10 + lvl * 5; }
  function growthNeed(l) { return 4 + l * 2; }          // 成长条阈值（F1）
  function fishValue(l) { return VALUES[Math.min(l, 6)]; }

  // 关卡（F11）：随分数与时间推进，封顶 STAGE_MAX
  function stageOf(sc, tm) {
    return 1 + Math.min(STAGE_MAX - 1, Math.floor(sc / STAGE_SCORE_STEP) + Math.floor(tm / STAGE_TIME_STEP));
  }

  function rollLevel() {
    var total = 0, i;
    for (i = 0; i < LEVEL_WEIGHTS.length; i++) total += LEVEL_WEIGHTS[i];
    var r = Math.random() * total;
    for (i = 0; i < LEVEL_WEIGHTS.length; i++) { r -= LEVEL_WEIGHTS[i]; if (r < 0) return i; }
    return 0;
  }

  function spawnFish(side) {
    var lv = rollLevel();
    var kind;
    if (lv >= 3 && Math.random() < 0.5) {
      // 天敌（F12）：水母 / 鲨 —— 恒危险、不可吃；0~2 档永远是普通鱼（新手期只按体型判定）
      kind = Math.random() < 0.5 ? 3 : 4;
    } else {
      kind = Math.floor(Math.random() * 3);             // 普通鱼三种轮廓（F5）
    }
    var fromLeft = side === undefined ? Math.random() < 0.5 : side === 0;
    var f = {
      x: fromLeft ? -radius(lv) - 10 : W + radius(lv) + 10,
      y: 60 + Math.random() * (H - 160),
      baseY: 0, phase: Math.random() * Math.PI * 2,
      level: lv,
      dir: fromLeft ? 1 : -1,
      speed: 0.7 + lv * 0.12 + Math.random() * 0.3,
      kind: kind,                                       // 0 椭圆 / 1 梭鱼 / 2 鳐 / 3 水母[天敌] / 4 鲨[天敌]
    };
    f.baseY = f.y;
    // 出生点避让玩家（F3：不贴脸刷）
    if (Math.abs(f.x - px) < 130 && Math.abs(f.y - py) < 90) f.y = f.y < py ? 50 : H - 90;
    fishes.push(f);
  }

  function spawnSchool() {
    var n = 2 + Math.floor(Math.random() * 2);
    var side = Math.random() < 0.5 ? 0 : 1;
    for (var i = 0; i < n; i++) spawnFish(side);
  }

  function spawnPearl() {
    pearls.push({ x: 30 + Math.random() * (W - 60), y: 60 + Math.random() * (H - 140), r: 5, t: Math.random() * Math.PI * 2 });
  }

  function reset() {
    level = 0; growth = 0; lives = 3;
    px = W / 2; py = H / 2; tx = px; ty = py; dir = 1;
    score = 0; over = false; invuln = 0;
    chain = 0; chainTimer = 0; dashCd = 0;
    time = 0; stage = 1; stageFlash = 0;
    fishes = []; pearls = []; bubbles = [];
    for (var i = 0; i < 4; i++) spawnSchool();
    for (var p = 0; p < 3; p++) spawnPearl();
    for (var b = 0; b < 12; b++) bubbles.push({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 3, s: 0.3 + Math.random() * 0.7 });
    seaweed = [];
    for (var s = 0; s < 6; s++) seaweed.push({ x: 30 + s * (W - 60) / 5, h: 40 + Math.random() * 45, phase: Math.random() * Math.PI * 2 });
    updateHud();
  }

  function updateHud() {
    if (score > best) best = score;
    var el = document.getElementById('soloScore');
    if (el) el.textContent = String(score);
    var bestEl = document.getElementById('soloBest');
    if (bestEl) bestEl.textContent = '最高 ' + best;
  }

  function endGame() {
    over = true;
    sfx.play('end');
    var finalScore = Math.min(score, maxScore);
    updateHud();
    draw();
    submitScore(finalScore);
    loadLeaderboard();
    var modal = document.getElementById('soloEndModal');
    if (modal) {
      var es = document.getElementById('soloEndScore');
      if (es) es.textContent = String(score);
      var eb = document.getElementById('soloEndBest');
      if (eb) eb.textContent = String(best);
      modal.hidden = false;
    }
  }

  function submitScore(finalScore) {
    if (finalScore <= 0) return;
    fetch('/api/v1/games/' + gameKey + '/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: finalScore }),
    }).catch(function () {});
  }

  function loadLeaderboard() {
    fetch('/api/v1/games/' + gameKey + '/leaderboard')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok || !j.data) return;
        var panel = document.getElementById('soloLeaderboardPanel');
        if (!panel) return;
        var html = '<h3>排行榜</h3><ol>';
        (j.data.items || []).forEach(function (it) {
          html += '<li><b>' + it.name + '</b> · ' + it.bestScore + '</li>';
        });
        html += '</ol>';
        if (j.data.mine) {
          html += '<p class="hint">我的最高分 ' + j.data.mine.bestScore + ' · 第 ' + j.data.mine.rank + ' 名</p>';
        }
        panel.innerHTML = html;
        panel.hidden = false;
      })
      .catch(function () {});
  }

  function comboMult() { return chain >= 6 ? 2 : chain >= 3 ? 1.5 : 1; }

  function step(dt) {
    if (over) return;
    time += dt;
    // F11 关卡推进：随分数与时间提速加密度；升关用图形冲击波提示（不加文字）
    var ns = stageOf(score, time);
    if (ns > stage) { stage = ns; stageFlash = 1.2; }
    if (stageFlash > 0) stageFlash -= dt;
    var speedMult = 1 + 0.12 * (stage - 1);

    // 光标平滑跟随（F4：插值逼近，不再瞬移）+ 按速度转身
    var nx = px + (tx - px) * Math.min(1, dt * 8);
    var ny = py + (ty - py) * Math.min(1, dt * 8);
    if (Math.abs(nx - px) > 0.3) dir = nx > px ? 1 : -1;
    px = nx; py = ny;

    if (invuln > 0) invuln -= dt;
    if (dashCd > 0) dashCd -= dt;
    if (chainTimer > 0) { chainTimer -= dt; if (chainTimer <= 0) chain = 0; }

    // 鱼群：穿屏游动（F3），缓慢摆尾；出屏补鱼放循环外（与 App 同构，防迭代中改表）
    var respawns = [];
    for (var i = 0; i < fishes.length; i++) {
      var f = fishes[i];
      f.x += f.dir * f.speed * speedMult * 60 * dt;
      f.phase += dt * 1.5;
      f.y = f.baseY + Math.sin(f.phase) * 12;
      if ((f.dir > 0 && f.x > W + 80) || (f.dir < 0 && f.x < -80)) {
        fishes.splice(i, 1); i--;
        respawns.push(f.dir > 0 ? 1 : 0);
      }
    }
    for (var rs = 0; rs < respawns.length; rs++) spawnFish(respawns[rs]);
    // 鱼群密度与刷新随关卡提升（F11）
    if (fishes.length < 10 + 2 * (stage - 1) && Math.random() < dt * (0.6 + 0.15 * (stage - 1))) spawnSchool();
    if (pearls.length < 4 && Math.random() < dt * 0.15) spawnPearl();

    // 气泡上升（F6）
    for (var b = 0; b < bubbles.length; b++) {
      var bb = bubbles[b];
      bb.y -= bb.s * 40 * dt;
      if (bb.y < -6) { bb.y = H + 6; bb.x = Math.random() * W; }
    }

    // 吃珍珠（F10 先行）
    var pr = radius(level);
    for (var k = pearls.length - 1; k >= 0; k--) {
      var po = pearls[k];
      po.t += dt * 3;
      if (Math.hypot(po.x - px, po.y - py) < pr + po.r + 2) {
        pearls.splice(k, 1);
        score += 10;
        sfx.play('eat');
        updateHud();
      }
    }

    // 吃鱼 / 被吃（F8：普通鱼同级可吃；F12：天敌恒危险；F2：三条命 + 无敌帧）
    var eaten = 0;
    for (var m = fishes.length - 1; m >= 0; m--) {
      var fi = fishes[m];
      var rr = radius(fi.level) + pr - 4;
      if (Math.hypot(fi.x - px, fi.y - py) >= rr) continue;
      if (fi.kind < 3 && fi.level <= level) {
        chain++; chainTimer = 3;
        score += Math.round(fishValue(fi.level) * comboMult());
        growth += 1 + fi.level;
        if (level < MAX_LEVEL && growth >= growthNeed(level)) { growth = 0; level++; }
        fishes.splice(m, 1);
        eaten++;
        sfx.play('eat');
        updateHud();
      } else if (invuln <= 0) {
        lives--;
        sfx.play('hurt');
        if (lives <= 0) { endGame(); return; }
        invuln = 2;
        chain = 0;
        px = W / 2; py = H / 2; tx = px; ty = py;
      }
    }
    for (var e2 = 0; e2 < eaten; e2++) spawnFish();
  }

  // ---- 绘制 ----
  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#81D4FA');
    g.addColorStop(0.55, '#29B6F6');
    g.addColorStop(1, '#01579B');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 光柱（F6）
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (var i = 0; i < 3; i++) {
      var x0 = W * (0.2 + i * 0.3);
      ctx.beginPath();
      ctx.moveTo(x0 - 18, 0); ctx.lineTo(x0 + 18, 0);
      ctx.lineTo(x0 + 60, H); ctx.lineTo(x0 - 60, H);
      ctx.closePath(); ctx.fill();
    }

    // 海草（F6）
    var t = performance.now() / 1000;
    for (var s = 0; s < seaweed.length; s++) {
      var w = seaweed[s];
      var sway = Math.sin(t * 1.2 + w.phase) * 10;
      ctx.strokeStyle = 'rgba(27,94,32,0.75)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(w.x, H);
      ctx.quadraticCurveTo(w.x + sway, H - w.h * 0.6, w.x + sway * 1.6, H - w.h);
      ctx.stroke();
    }
    // 沙底
    ctx.fillStyle = '#C8B078';
    ctx.fillRect(0, H - 14, W, 14);

    // 气泡
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    for (var b = 0; b < bubbles.length; b++) {
      ctx.beginPath(); ctx.arc(bubbles[b].x, bubbles[b].y, bubbles[b].r, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // 多鱼种轮廓（F5）：0 椭圆身 / 1 尖嘴梭鱼 / 2 鳐形 / 3 水母 / 4 鲨形；spiky=天敌尖刺标记（F12）
  function drawFish(x, y, lv, facing, color, kind, alpha, spiky, scale) {
    var sc = scale || 1;
    var r = radius(lv) * sc;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;

    if (kind === 3) { // 水母：伞盖 + 触手
      ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0);
      ctx.quadraticCurveTo(r * 0.7, r * 0.55, 0, r * 0.5);
      ctx.quadraticCurveTo(-r * 0.7, r * 0.55, -r, 0);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2 * sc;
      for (var i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.3, r * 0.45);
        ctx.quadraticCurveTo(i * r * 0.4, r * 0.9, i * r * 0.25, r * 1.3);
        ctx.stroke();
      }
    } else if (kind === 2) { // 鳐：菱形身 + 长尾
      ctx.beginPath();
      ctx.moveTo(r * 1.1, 0);
      ctx.quadraticCurveTo(0, -r * 0.95, -r * 1.05, 0);
      ctx.quadraticCurveTo(0, r * 0.95, r * 1.1, 0);
      ctx.fillStyle = color; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(-r * 1.8, r * 0.12); ctx.lineWidth = 3 * sc; ctx.strokeStyle = color; ctx.stroke();
    } else {
      // 鱼身：椭圆 + 尾
      ctx.beginPath();
      ctx.ellipse(0, 0, r * (kind === 1 ? 1.25 : 1.05), r * (kind === 4 ? 0.72 : 0.82), 0, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      if (kind === 4) { // 鲨：背鳍
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, -r * 0.68); ctx.lineTo(r * 0.35, -r * 1.35); ctx.lineTo(r * 0.55, -r * 0.6);
        ctx.closePath(); ctx.fillStyle = color; ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(-r * 0.95, 0);
      ctx.lineTo(-r * 1.65, -r * 0.5);
      ctx.lineTo(-r * 1.65, r * 0.5);
      ctx.closePath(); ctx.fillStyle = color; ctx.fill();
      if (kind === 1) { // 梭鱼尖嘴
        ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(r * 1.45, -r * 0.12); ctx.lineTo(r * 1.45, r * 0.12);
        ctx.closePath(); ctx.fillStyle = color; ctx.fill();
      }
    }
    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(r * 0.38, -r * 0.22, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(r * 0.43, -r * 0.22, r * 0.09, 0, Math.PI * 2); ctx.fill();

    // 天敌尖刺标记（F12）：图形标示，红鱼 + 刺
    if (spiky) {
      ctx.fillStyle = color;
      for (var sp = -2; sp <= 2; sp++) {
        var a = -Math.PI / 2 + sp * 0.5;
        var bx = Math.cos(a) * r * 1.05, by = Math.sin(a) * r * 1.05;
        var tX = Math.cos(a) * r * 1.35, tY = Math.sin(a) * r * 1.35;
        ctx.beginPath();
        ctx.moveTo(bx - r * 0.12, by);
        ctx.lineTo(tX, tY);
        ctx.lineTo(bx + r * 0.12, by);
        ctx.closePath(); ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // 心形生命图钉（F9 图形，不加文字）
  function drawHeart(cx, cy, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.75);
    ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.25, cx - s * 0.55, cy - s * 1.05, cx, cy - s * 0.35);
    ctx.bezierCurveTo(cx + s * 0.55, cy - s * 1.05, cx + s * 1.4, cy - s * 0.25, cx, cy + s * 0.75);
    ctx.closePath(); ctx.fill();
  }

  function drawHud() {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    // 关卡格（F11 图形提示）：顶部一排菱形，升关时点亮 + 光圈
    for (var i = 0; i < STAGE_MAX; i++) {
      var cx = W / 2 - (STAGE_MAX - 1) * 7 + i * 14, cy = 5;
      var hs = (stageFlash > 0 && i < stage) ? 5.2 : 4;
      ctx.fillStyle = i < stage ? '#FFD54F' : 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - hs); ctx.lineTo(cx + hs, cy); ctx.lineTo(cx, cy + hs); ctx.lineTo(cx - hs, cy);
      ctx.closePath(); ctx.fill();
      if (stageFlash > 0 && i === stage - 1) {
        ctx.strokeStyle = 'rgba(255,213,79,' + (0.6 * stageFlash / 1.2).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, hs + 3 + 4 * (1.2 - stageFlash), 0, Math.PI * 2); ctx.stroke();
      }
    }

    // 生命（F9 图形心形）
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(8, 8, 176, 26);
    for (var h = 0; h < 3; h++) {
      drawHeart(22 + h * 20, 21, 7, h < lives ? '#E53935' : 'rgba(229,57,53,0.25)');
    }

    // 成长条（F9）
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(84, 16, 92, 10);
    ctx.fillStyle = '#FFD54F';
    ctx.fillRect(84, 16, 92 * Math.min(1, growth / growthNeed(level)), 10);
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    ctx.fillText('体型 ' + (level + 1) + '/7', 86, 30);

    // 图例（F12 图形标示）：绿小鱼=可吃 / 红刺鱼=危险（不加文字）
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(W - 168, 8, 160, 26);
    drawFish(W - 138, 21, 0, 1, '#C8E6C9', 0, 1, false, 0.6);
    drawFish(W - 38, 21, 0, 1, '#EF5350', 4, 1, true, 0.6);

    // 连击（F7）
    if (chain >= 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(W / 2 - 36, 42, 72, 22);
      ctx.fillStyle = '#FFEE58';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('连击 ×' + comboMult(), W / 2, 53);
      ctx.textAlign = 'left';
    }
  }

  function draw() {
    drawBackground();

    // 珍珠（F10）
    for (var k = 0; k < pearls.length; k++) {
      var po = pearls[k];
      var glow = 3 + Math.sin(po.t) * 1.2;
      ctx.fillStyle = '#F8BBD0';
      ctx.beginPath(); ctx.arc(po.x, po.y, po.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(po.x - 1.2, po.y - 1.2, glow * 0.45, 0, Math.PI * 2); ctx.fill();
    }

    // 其它鱼：普通鱼（可吃蓝绿 / 更大红）+ 天敌（恒红带刺，F12）
    for (var j = 0; j < fishes.length; j++) {
      var f = fishes[j];
      var enemy = f.kind >= 3;
      var danger = enemy || f.level > level;
      var color = danger ? '#EF5350' : '#4FC3F7';
      drawFish(f.x, f.y, f.level, f.dir, color, f.kind, 1, enemy);
    }

    // 玩家鱼（无敌闪烁，F2）
    if (!(invuln > 0 && Math.floor(performance.now() / 120) % 2 === 0)) {
      drawFish(px, py, level, dir, '#FFB300', 4);
    }

    // 升关冲击波（F11 图形提示）
    if (stageFlash > 0) {
      var a = stageFlash / 1.2;
      var ring = radius(level) + 20 + (1.2 - stageFlash) * 60;
      ctx.strokeStyle = 'rgba(255,213,79,' + (0.6 * a).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, ring, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, ring * 0.7, 0, Math.PI * 2); ctx.stroke();
    }

    drawHud();

    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function frame(ts) {
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;
    if (!over) step(dt);
    draw();
    if (over) return;
    requestAnimationFrame(frame);
  }

  // ---- 交互：平滑跟随 + 点击冲刺（F4）----
  function toPos(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }
  canvas.addEventListener('mousemove', function (e) {
    sfx.ensure();
    if (over) return;
    var p = toPos(e); tx = p.x; ty = p.y;
  });
  canvas.addEventListener('click', function (e) {
    sfx.ensure();
    if (over) return;
    // 冲刺：朝目标方向瞬时加推（冷却 1.2s）
    if (dashCd <= 0) {
      var p = toPos(e);
      var dx = p.x - px, dy = p.y - py, d = Math.hypot(dx, dy) || 1;
      tx = px + dx / d * 130; ty = py + dy / d * 130;
      dashCd = 1.2;
      sfx.play('dash');
    }
  });
  canvas.addEventListener('touchmove', function (e) {
    sfx.ensure();
    if (over) return;
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var t = e.touches[0];
    tx = (t.clientX - rect.left) * (canvas.width / rect.width);
    ty = (t.clientY - rect.top) * (canvas.height / rect.height);
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) {
    sfx.ensure();
    if (over) return;
    e.preventDefault();
    if (dashCd <= 0) {
      var dx = tx - px, dy = ty - py, d = Math.hypot(dx, dy) || 1;
      tx = px + dx / d * 130; ty = py + dy / d * 130;
      dashCd = 1.2;
      sfx.play('dash');
    }
  }, { passive: false });

  function restart() {
    var panel = document.getElementById('soloLeaderboardPanel');
    if (panel) panel.hidden = true;
    var modal = document.getElementById('soloEndModal');
    if (modal) modal.hidden = true;
    reset();
    lastTs = 0;
    requestAnimationFrame(frame);
  }
  var restartBtn = document.getElementById('soloRestart');
  if (restartBtn) restartBtn.addEventListener('click', restart);
  var endRestartBtn = document.getElementById('soloEndRestart');
  if (endRestartBtn) endRestartBtn.addEventListener('click', restart);
  var lbBtn = document.getElementById('soloLeaderboard');
  if (lbBtn) lbBtn.addEventListener('click', loadLeaderboard);

  reset();
  requestAnimationFrame(frame);
})();
