// solo/fish.js — 大鱼吃小鱼（单机）升级版。
// 规则依据：checkin-work/docs/research/2026-10-30-audit-solo-games.md §2.1
//   3 条命 + 被吃后短暂无敌（F2）；鱼从两侧穿屏成群游入（F3）；光标平滑跟随 + 转身（F4）；
//   多鱼种轮廓（F5）；海底背景（F6）；按体型档位计分 + 连击倍率（F7）；同级可吃（F8）；
//   生命/成长条/可吃图例（F9）；珍珠加分（F10 先行）。纯前端算分，结束时 POST /games/fish/score。
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
  var MAX_LEVEL = 6;
  var VALUES = [50, 50, 150, 400, 900, 1800, 1800];   // 按体型档位（F7）
  var LEVEL_WEIGHTS = [3, 3, 2, 2, 1, 1, 1];          // 小鱼多大鱼少

  var level, growth, lives, px, py, tx, ty, dir, score, best;
  var over, invuln, chain, chainTimer, dashCd;
  var fishes, pearls, bubbles, seaweed;
  var lastTs = 0;

  function radius(lvl) { return 10 + lvl * 5; }
  function growthNeed(l) { return 4 + l * 2; }          // 成长条阈值（F1）
  function fishValue(l) { return VALUES[Math.min(l, 6)]; }

  function rollLevel() {
    var total = 0, i;
    for (i = 0; i < LEVEL_WEIGHTS.length; i++) total += LEVEL_WEIGHTS[i];
    var r = Math.random() * total;
    for (i = 0; i < LEVEL_WEIGHTS.length; i++) { r -= LEVEL_WEIGHTS[i]; if (r < 0) return i; }
    return 0;
  }

  function spawnFish(side) {
    var lv = rollLevel();
    var fromLeft = side === undefined ? Math.random() < 0.5 : side === 0;
    var f = {
      x: fromLeft ? -radius(lv) - 10 : W + radius(lv) + 10,
      y: 60 + Math.random() * (H - 160),
      baseY: 0, phase: Math.random() * Math.PI * 2,
      level: lv,
      dir: fromLeft ? 1 : -1,
      speed: 0.7 + lv * 0.12 + Math.random() * 0.3,
      kind: lv % 5,                                   // 轮廓种类（F5）
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
    // 光标平滑跟随（F4：插值逼近，不再瞬移）+ 按速度转身
    var nx = px + (tx - px) * Math.min(1, dt * 8);
    var ny = py + (ty - py) * Math.min(1, dt * 8);
    if (Math.abs(nx - px) > 0.3) dir = nx > px ? 1 : -1;
    px = nx; py = ny;

    if (invuln > 0) invuln -= dt;
    if (dashCd > 0) dashCd -= dt;
    if (chainTimer > 0) { chainTimer -= dt; if (chainTimer <= 0) chain = 0; }

    // 鱼群：穿屏游动（F3），缓慢摆尾
    for (var i = 0; i < fishes.length; i++) {
      var f = fishes[i];
      f.x += f.dir * f.speed * 60 * dt;
      f.phase += dt * 1.5;
      f.y = f.baseY + Math.sin(f.phase) * 12;
      if ((f.dir > 0 && f.x > W + 80) || (f.dir < 0 && f.x < -80)) {
        fishes.splice(i, 1); i--;
        spawnFish(f.dir > 0 ? 1 : 0);   // 从另一侧补入
      }
    }
    if (fishes.length < 10 && Math.random() < dt * 0.6) spawnSchool();
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
        updateHud();
      }
    }

    // 吃鱼 / 被吃（F8：同级可吃；F7：档位分 + 连击倍率；F2：三条命 + 无敌帧）
    for (var m = fishes.length - 1; m >= 0; m--) {
      var fi = fishes[m];
      var rr = radius(fi.level) + pr - 4;
      if (Math.hypot(fi.x - px, fi.y - py) >= rr) continue;
      if (fi.level <= level) {
        chain++; chainTimer = 3;
        score += Math.round(fishValue(fi.level) * comboMult());
        growth += 1 + fi.level;
        if (level < MAX_LEVEL && growth >= growthNeed(level)) { growth = 0; level++; }
        fishes.splice(m, 1);
        spawnFish();
        updateHud();
      } else if (invuln <= 0) {
        lives--;
        if (lives <= 0) { endGame(); return; }
        invuln = 2;
        chain = 0;
        px = W / 2; py = H / 2; tx = px; ty = py;
      }
    }
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

  // 多鱼种轮廓（F5）：0 椭圆身 / 1 尖嘴梭鱼 / 2 鳐形 / 3 水母 / 4 鲨形
  function drawFish(x, y, lv, facing, color, kind, alpha) {
    var r = radius(lv);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;

    if (kind === 3) { // 水母：伞盖 + 触手
      ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0);
      ctx.quadraticCurveTo(r * 0.7, r * 0.55, 0, r * 0.5);
      ctx.quadraticCurveTo(-r * 0.7, r * 0.55, -r, 0);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2;
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
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(-r * 1.8, r * 0.12); ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke();
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

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawHud() {
    // 生命（F9）
    ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(8, 8, 200, 26);
    ctx.fillStyle = '#E53935';
    for (var i = 0; i < 3; i++) {
      ctx.globalAlpha = i < lives ? 1 : 0.25;
      ctx.fillText('❤', 14 + i * 20, 21);
    }
    ctx.globalAlpha = 1;

    // 成长条（F9）
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(82, 16, 118, 10);
    ctx.fillStyle = '#FFD54F';
    ctx.fillRect(82, 16, 118 * Math.min(1, growth / growthNeed(level)), 10);
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    ctx.fillText('体型 ' + (level + 1) + '/7', 84, 30);

    // 可吃/危险图例（F9）
    ctx.textAlign = 'right';
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(W - 168, 8, 160, 26);
    ctx.fillStyle = '#C8E6C9';
    ctx.fillText('可吃 ≤' + level + ' 级', W - 92, 21);
    ctx.fillStyle = '#FFCDD2';
    ctx.fillText('危险 >' + level + ' 级', W - 12, 21);

    // 连击（F7）
    if (chain >= 3) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFEE58';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('连击 ×' + comboMult(), W / 2, 22);
    }
    ctx.textAlign = 'left';
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

    // 其它鱼（按体型档位配色，危险红/可吃蓝绿）
    for (var j = 0; j < fishes.length; j++) {
      var f = fishes[j];
      var danger = f.level > level;
      var color = danger ? '#EF5350' : (f.kind === 3 ? '#80DEEA' : '#4FC3F7');
      drawFish(f.x, f.y, f.level, f.dir, color, f.kind);
    }

    // 玩家鱼（无敌闪烁，F2）
    if (!(invuln > 0 && Math.floor(performance.now() / 120) % 2 === 0)) {
      drawFish(px, py, level, dir, '#FFB300', 4);
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
    if (over) return;
    var p = toPos(e); tx = p.x; ty = p.y;
  });
  canvas.addEventListener('click', function (e) {
    if (over) return;
    // 冲刺：朝目标方向瞬时加推（冷却 1.2s）
    if (dashCd <= 0) {
      var p = toPos(e);
      var dx = p.x - px, dy = p.y - py, d = Math.hypot(dx, dy) || 1;
      tx = px + dx / d * 130; ty = py + dy / d * 130;
      dashCd = 1.2;
    }
  });
  canvas.addEventListener('touchmove', function (e) {
    if (over) return;
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var t = e.touches[0];
    tx = (t.clientX - rect.left) * (canvas.width / rect.width);
    ty = (t.clientY - rect.top) * (canvas.height / rect.height);
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) {
    if (over) return;
    e.preventDefault();
    if (dashCd <= 0) {
      var dx = tx - px, dy = ty - py, d = Math.hypot(dx, dy) || 1;
      tx = px + dx / d * 130; ty = py + dy / d * 130;
      dashCd = 1.2;
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
