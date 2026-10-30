// solo/melon.js — 合成大西瓜（单机）壳：画布渲染 + 输入 + 记分上报。
// 玩法物理与规则全部在 melon-core.js（可单测）；本文件只做表现层。
// 结束时 POST /games/melon/score 上报最高分（与其它单机一致）。
(function () {
  'use strict';

  var host = document.querySelector('.gm-solo');
  if (!host) return;
  var canvas = document.getElementById('soloCanvas');
  if (!canvas || !window.MelonCore) return;
  var ctx = canvas.getContext('2d');
  var gameKey = host.dataset.gameKey || 'melon';
  var maxScore = parseInt(host.dataset.maxScore || '1000000', 10);

  var game = window.MelonCore.create({ width: canvas.width, height: canvas.height });
  window.__melonGame = game;   // UI 冒烟/调试钩子（与 __gmLastGeom 同模式）
  var best = 0;
  var particles = [];   // 合成爆裂小点
  var lastTs = 0;
  var reported = false;

  function updateHud() {
    var el = document.getElementById('soloScore');
    if (el) el.textContent = String(game.score);
    var bestEl = document.getElementById('soloBest');
    if (bestEl) bestEl.textContent = '最高 ' + best;
  }

  function submitScore(finalScore) {
    if (finalScore <= 0 || reported) return;
    reported = true;
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

  // ---- 果面（M6：按级画特征，不再是纯色圆+白字）----
  function drawFruit(x, y, level, angle, alpha) {
    var r = game.radii[level - 1];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;

    function circle(fill) {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.stroke();
    }
    function dots(color, n, spread, size) {
      ctx.fillStyle = color;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 + level;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * spread, Math.sin(a) * r * spread, r * size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    switch (level) {
      case 1: // 葡萄：紫圆 + 颗粒点
        circle('#9C27B0'); dots('rgba(255,255,255,0.35)', 7, 0.55, 0.16);
        break;
      case 2: // 樱桃：红圆 + 核点 + 梗
        circle('#E53935');
        ctx.strokeStyle = '#4E342E'; ctx.lineWidth = Math.max(1.5, r * 0.12);
        ctx.beginPath(); ctx.moveTo(0, -r * 0.6); ctx.quadraticCurveTo(r * 0.4, -r * 1.15, r * 0.75, -r * 1.0); ctx.stroke();
        dots('rgba(120,0,0,0.5)', 1, 0, 0.3);
        break;
      case 3: // 橘子：橙圆 + 皮孔
        circle('#FB8C00'); dots('rgba(255,240,200,0.5)', 8, 0.6, 0.1);
        break;
      case 4: // 柠檬：黄椭圆感
        circle('#F9A825');
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.08, r * 0.86, 0, 0, Math.PI * 2); ctx.fillStyle = '#FDD835'; ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.fillStyle = '#FEE581'; ctx.fill();
        break;
      case 5: // 猕猴桃：绿切面 + 籽粒环
        circle('#7CB342');
        ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fillStyle = '#AED581'; ctx.fill();
        dots('rgba(30,60,20,0.7)', 10, 0.75, 0.08);
        break;
      case 6: // 番茄：红圆 + 绿蒂
        circle('#EF5350');
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath();
        for (var i = 0; i < 5; i++) {
          var a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          ctx.lineTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5 - r * 0.75);
          ctx.lineTo(Math.cos(a + 0.6) * r * 0.22, Math.sin(a + 0.6) * r * 0.22 - r * 0.75);
        }
        ctx.closePath(); ctx.fill();
        break;
      case 7: // 桃子：粉圆 + 缝线
        circle('#F48FB1');
        ctx.strokeStyle = 'rgba(196,80,110,0.8)'; ctx.lineWidth = r * 0.08;
        ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.quadraticCurveTo(r * 0.25, 0, 0, r * 0.9); ctx.stroke();
        break;
      case 8: // 菠萝：黄圆 + 网纹 + 顶冠
        circle('#F9A825');
        ctx.strokeStyle = 'rgba(180,110,20,0.55)'; ctx.lineWidth = r * 0.07;
        for (var g = -2; g <= 2; g++) {
          ctx.beginPath(); ctx.moveTo(-r, g * r * 0.4); ctx.lineTo(r, g * r * 0.4 + r * 0.4); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-r, g * r * 0.4 + r * 0.4); ctx.lineTo(r, g * r * 0.4); ctx.stroke();
        }
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.85); ctx.lineTo(0, -r * 1.35); ctx.lineTo(r * 0.45, -r * 0.85); ctx.closePath(); ctx.fill();
        break;
      case 9: // 椰子：棕壳 + 白肉心
        circle('#8D6E63');
        ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fillStyle = '#EFEBE9'; ctx.fill();
        dots('rgba(60,40,25,0.8)', 3, 0.18, 0.12);
        break;
      case 10: // 半个西瓜：下绿皮上红瓤黑籽
        circle('#43A047');
        ctx.beginPath(); ctx.arc(0, r * 0.25, r * 0.95, Math.PI, 0); ctx.closePath(); ctx.fillStyle = '#EF5350'; ctx.fill();
        dots('rgba(20,20,20,0.85)', 5, 0.45, 0.09);
        break;
      default: // 西瓜：绿条纹
        circle('#2E7D32');
        ctx.strokeStyle = '#81C784'; ctx.lineWidth = r * 0.14;
        for (var s = -2; s <= 2; s++) {
          ctx.beginPath();
          ctx.moveTo(s * r * 0.38, -r * 0.98);
          ctx.quadraticCurveTo(s * r * 0.62, 0, s * r * 0.38, r * 0.98);
          ctx.stroke();
        }
        break;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function draw() {
    var W = canvas.width, H = canvas.height;
    // 背景：浅木纹容器感
    ctx.clearRect(0, 0, W, H);
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#FFF8E1');
    bg.addColorStop(1, '#FFECB3');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // 容器内壁
    ctx.strokeStyle = '#BCAAA4'; ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    // 警戒线（越线计时中闪红，M10）
    var danger = game.overTimer > 0;
    ctx.strokeStyle = danger ? '#D32F2F' : 'rgba(211,47,47,0.55)';
    ctx.lineWidth = danger ? 3 : 2;
    ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(6, game.warnY); ctx.lineTo(W - 6, game.warnY); ctx.stroke();
    ctx.setLineDash([]);

    // 已落水果
    for (var i = 0; i < game.bodies.length; i++) {
      var b = game.bodies[i];
      drawFruit(b.x, b.y, b.level, b.angle);
    }

    // 落点预览（半透明当前果 + 虚线导引，M3/M5）
    if (!game.over) {
      var cr = game.radii[game.curLevel - 1];
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(game.aimX, game.dropY + cr); ctx.lineTo(game.aimX, H - 8); ctx.stroke();
      ctx.setLineDash([]);
      drawFruit(game.aimX, game.dropY, game.curLevel, 0, 0.85);

      // 下一个预览（右上角小图 + 「下一个」）
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('下一个', W - 14, 22);
      drawFruit(W - 26 - game.radii[game.nextLevel - 1], 22, game.nextLevel, 0, 0.9);
    }

    // 合成爆裂粒子
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.25; pt.life -= 1;
      if (pt.life <= 0) { particles.splice(p, 1); continue; }
      ctx.globalAlpha = Math.min(1, pt.life / 12);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 结束弹窗（M12：分数 + 最高分 + 重开按钮）
    if (game.over) {
      var modal = document.getElementById('soloEndModal');
      if (modal && modal.hidden) {
        var es = document.getElementById('soloEndScore');
        if (es) es.textContent = String(game.score);
        var eb = document.getElementById('soloEndBest');
        if (eb) eb.textContent = String(best);
        modal.hidden = false;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    }
  }

  function burst(x, y, level) {
    var color = ['#9C27B0', '#E53935', '#FB8C00', '#FDD835', '#7CB342', '#EF5350', '#F48FB1', '#F9A825', '#8D6E63', '#43A047', '#2E7D32'][Math.min(10, level - 1)];
    for (var i = 0; i < 10; i++) {
      var a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 2 + Math.random() * 3, life: 12 + Math.random() * 10, color: color });
    }
  }

  function frame(ts) {
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;
    game.step(dt);
    var evs = game.drainEvents();
    for (var i = 0; i < evs.length; i++) {
      burst(evs[i].x, evs[i].y, evs[i].level);
    }
    if (game.score > best) best = game.score;
    updateHud();
    draw();
    if (game.over) {
      submitScore(Math.min(game.score, maxScore));
      return; // 停表；重开后恢复
    }
    requestAnimationFrame(frame);
  }

  function toX(e) {
    var rect = canvas.getBoundingClientRect();
    return (e.clientX - rect.left) * (canvas.width / rect.width);
  }
  canvas.addEventListener('mousemove', function (e) {
    if (game.over) return;
    game.aim(toX(e));
  });
  canvas.addEventListener('click', function (e) {
    if (game.over) return;
    game.aim(toX(e)); game.drop();
  });
  canvas.addEventListener('touchmove', function (e) {
    if (game.over) return;
    e.preventDefault();
    game.aim(toX(e.touches[0]));
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) {
    if (game.over) return;
    e.preventDefault(); game.drop();
  }, { passive: false });

  function restart() {
    var panel = document.getElementById('soloLeaderboardPanel');
    if (panel) panel.hidden = true;
    var modal = document.getElementById('soloEndModal');
    if (modal) modal.hidden = true;
    game = window.MelonCore.create({ width: canvas.width, height: canvas.height });
    window.__melonGame = game;
    particles = [];
    reported = false;
    lastTs = 0;
    updateHud();
    requestAnimationFrame(frame);
  }
  var restartBtn = document.getElementById('soloRestart');
  if (restartBtn) restartBtn.addEventListener('click', restart);
  var endRestartBtn = document.getElementById('soloEndRestart');
  if (endRestartBtn) endRestartBtn.addEventListener('click', restart);
  var lbBtn = document.getElementById('soloLeaderboard');
  if (lbBtn) lbBtn.addEventListener('click', loadLeaderboard);

  updateHud();
  requestAnimationFrame(frame);
})();
