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
  if (window.__QA_HOOKS__ !== false) window.__melonGame = game;   // 测试钩子（P3-2：显式 false=Release 隐藏，缺省可见护工具链）
  var best = 0;
  var particles = [];   // 合成爆裂小点
  var flashes = [];     // 合成闪光环（Batch D 特效）

  // ---- 音效（M13）：WebAudio 合成音，合成/爆瓜/结束三类；音效开关走 DisplaySettings.Sound ----
  var sfx = (function () {
    var ac = null;
    var enabled = true;
    function ensure() {
      if (!ac) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        try { ac = new Ctx(); } catch (e) { return false; }
      }
      if (ac.state === 'suspended') { try { ac.resume(); } catch (e) { } }
      return true;
    }
    function tone(f0, f1, dur, vol, type) {
      if (!ac) return;
      var t0 = ac.currentTime;
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.linearRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function play(name) {
      if (!enabled || !ensure()) return;
      if (name === 'merge') tone(420, 720, 0.1, 0.3, 'sine');
      else if (name === 'explode') { tone(220, 640, 0.16, 0.34, 'triangle'); tone(640, 180, 0.2, 0.26, 'sine'); }
      else if (name === 'end') { tone(660, 660, 0.14, 0.3, 'sine'); setTimeout(function () { tone(440, 440, 0.14, 0.3, 'sine'); }, 150); setTimeout(function () { tone(294, 294, 0.3, 0.3, 'sine'); }, 300); }
    }
    return {
      ensure: ensure,
      play: play,
      setEnabled: function (on) { enabled = !!on; },
    };
  })();
  // 音效开关（设置面板「音效」项；melon 属有音效游戏，M13 落地）
  fetch('/api/v1/games/settings', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.ok && j.data) sfx.setEnabled(j.data.sound !== false); })
    .catch(function () { });
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

  // ---- 果面（图标统一制式：级色圆子 + 白色果剪影，icons-ready 同源，双端同规）----
  var FRUIT_ICON = ['', 'grape', 'cherry', 'orange', 'lemon', 'kiwi', 'tomato', 'peach', 'pineapple', 'coconut', 'half-watermelon', 'watermelon'];
  var FRUIT_BASE = ['', '#9C27B0', '#E53935', '#FB8C00', '#F9A825', '#7CB342', '#EF5350', '#F48FB1', '#F9A825', '#8D6E63', '#43A047', '#2E7D32'];
  var iconImgs = {};
  function iconImg(name) {
    if (!iconImgs[name]) {
      var im = new Image();
      im.src = '/pieces/melon/' + name + '.svg';
      iconImgs[name] = im;
    }
    return iconImgs[name];
  }

  function drawFruit(x, y, level, angle, alpha, scale) {
    var r = game.radii[level - 1] * (scale || 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;

    // 级色圆子（碰撞形状可读性）
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = FRUIT_BASE[level] || '#9E9E9E'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.stroke();

    // 白色果剪影（icons-ready 同源素材）
    var im = iconImg(FRUIT_ICON[level] || 'grape');
    if (im.complete && im.naturalWidth) {
      var s2 = r * 1.5;
      try { ctx.filter = 'brightness(0) invert(1)'; } catch (e) { }
      ctx.drawImage(im, -s2 / 2, -s2 / 2, s2, s2);
      try { ctx.filter = 'none'; } catch (e) { }
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

    // 已落水果（合成新果 0.2s 弹跳缩放，Batch D 特效）
    for (var i = 0; i < game.bodies.length; i++) {
      var b = game.bodies[i];
      var age = game.time - b.born;
      var sc = age < 0.2 && age >= 0 ? 0.6 + 0.4 * (age / 0.2) : 1;
      drawFruit(b.x, b.y, b.level, 0, 1, sc);
    }

    // 合成闪光环（Batch D：扩散圆环）
    for (var f = flashes.length - 1; f >= 0; f--) {
      var fl = flashes[f];
      fl.r += 3.2; fl.life -= 1;
      if (fl.life <= 0) { flashes.splice(f, 1); continue; }
      ctx.globalAlpha = Math.min(1, fl.life / 14) * 0.8;
      ctx.strokeStyle = fl.color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
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

    // 连击 HUD（Batch D：3 秒窗连续合成递增）
    if (game.combo >= 2 && !game.over) {
      ctx.fillStyle = '#FF6F00';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('连击 ×' + game.comboMult, 12, 26);
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
      flashes.push({ x: evs[i].x, y: evs[i].y, r: 12, life: 14, color: evs[i].type === 'explode' ? '#FFD54F' : '#FFFFFF' });
      sfx.play(evs[i].type === 'explode' ? 'explode' : 'merge');   // M13 音效
    }
    if (game.score > best) best = game.score;
    updateHud();
    draw();
    if (game.over) {
      sfx.play('end');   // M13 终局音（停表前播一次）
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
    if (window.__QA_HOOKS__ !== false) window.__melonGame = game;
    particles = [];
    flashes = [];
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
