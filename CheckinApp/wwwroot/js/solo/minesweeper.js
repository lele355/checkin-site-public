// solo/minesweeper.js — 扫雷（单机）壳：画布渲染 + 输入 + 记分上报。
// 规则与计分全部在 minesweeper-core.js（可单测）；本文件只做表现层。
// 交互：左键翻开 / 右键插旗 / 手机长按插旗 / 已翻数字格双键展开。
(function () {
  'use strict';

  var host = document.querySelector('.gm-solo');
  if (!host) return;
  var canvas = document.getElementById('soloCanvas');
  if (!canvas || !window.MineCore) return;
  var ctx = canvas.getContext('2d');
  var gameKey = host.dataset.gameKey || 'minesweeper';
  var maxScore = parseInt(host.dataset.maxScore || '9999999', 10);

  var level = 1;
  var game = null;
  var best = 0;
  var reported = false;
  var lastTs = 0;
  var animCells = [];       // 翻开时的涟漪（index, t0）
  var shakeUntil = 0;       // 踩雷震屏
  var flagPops = {};        // 插旗弹跳：index → t0
  var waves = [];           // 冲击波（踩雷/清场）
  var confetti = [];        // 清场彩纸

  // ---- 音效：WebAudio 合成，开关走 DisplaySettings.Sound（与 melon 同规）----
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
    function play(name, arg) {
      if (!enabled || !ensure()) return;
      if (name === 'open') {
        // 连片时音高上行：开得越多越"爽"（arg = 这次翻开几格）
        var n = Math.min(5, Math.max(1, arg || 1));
        for (var i = 0; i < n; i++) {
          (function (k) {
            setTimeout(function () {
              tone(520 + k * 95, 700 + k * 105, 0.055, 0.14 - k * 0.012, 'sine');
            }, k * 45);
          })(i);
        }
      }
      else if (name === 'number') tone(880, 980, 0.045, 0.10, 'sine');   // 数字格：一声轻响
      else if (name === 'flag') tone(760, 900, 0.05, 0.14, 'triangle');
      else if (name === 'unflag') tone(640, 520, 0.05, 0.11, 'triangle');
      else if (name === 'boom') {
        tone(180, 60, 0.35, 0.36, 'sawtooth');
        tone(90, 40, 0.4, 0.28, 'triangle');
        setTimeout(function () { tone(300, 120, 0.18, 0.16, 'square'); }, 60);
      }
      else if (name === 'win') {
        tone(523, 523, 0.12, 0.26, 'sine');
        setTimeout(function () { tone(659, 659, 0.12, 0.26, 'sine'); }, 120);
        setTimeout(function () { tone(784, 784, 0.24, 0.26, 'sine'); }, 240);
        setTimeout(function () { tone(1047, 1047, 0.34, 0.22, 'sine'); }, 380);
      }
    }
    return { ensure: ensure, play: play, setEnabled: function (on) { enabled = !!on; } };
  })();
  fetch('/api/v1/games/settings', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.ok && j.data) sfx.setEnabled(j.data.sound !== false); })
    .catch(function () { });

  // ---- 尺寸与布局 ----
  //
  // 【2026-11-13 手机竖屏适配】原来按固定格子边长（40/32/22）画布，高级盘 30 列 =
  // 660px 宽，在 360px 手机上被 CSS 压成 11px 一格，手指根本点不准。
  // 现在反过来：先量容器宽，再算格子多大；竖屏遇到「宽棋盘」（高级 30 列）自动转置成
  // 16 列 × 30 行 —— 扫雷只关心「哪些格子相邻」，行列互换不影响规则与计分。
  var ROWS = { 1: 9, 2: 16, 3: 16 };
  var COLS = { 1: 9, 2: 16, 3: 30 };

  function isPortrait() { return window.innerHeight >= window.innerWidth; }

  /// 当前难度在现在的屏幕方向下应该画成几行几列
  function fitShape(lv) {
    var rows = ROWS[lv] || 9, cols = COLS[lv] || 9;
    if (isPortrait() && cols > rows) { var t = cols; cols = rows; rows = t; }
    return { rows: rows, cols: cols };
  }

  /// 格子边长：同时受「容器宽度」和「一屏高度」约束，限制在 18~46px
  /// （太小手指点不准，太大像一排按键；高度取视口 70%，让手机竖屏尽量一屏放下）
  function fitCell(cols, rows) {
    var hostW = (host.clientWidth || 360) - 2;
    var byW = Math.floor(hostW / cols);
    var byH = Math.floor((window.innerHeight * 0.70) / rows);
    var cs2 = Math.min(byW, byH);
    return Math.max(18, Math.min(46, cs2));
  }

  function applySize(shape) {
    var cs2 = fitCell(shape.cols, shape.rows);
    canvas.width = shape.cols * cs2;
    canvas.height = shape.rows * cs2;
    return cs2;
  }

  // 当前这一局实际用的格子边长与形状（draw / cellAt 都读它）
  var shape = fitShape(1);
  var cs = 40;
  function cellSize() { return cs; }

  // ---- HUD ----
  function flagLeft() { return game.mines - game.flags; }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function updateHud() {
    var scoreEl = document.getElementById('soloScore');
    if (scoreEl) scoreEl.textContent = '雷 ' + flagLeft();
    var timeEl = document.getElementById('soloTime');
    if (timeEl) timeEl.textContent = fmtTime(game.elapsedSec());
    var bestEl = document.getElementById('soloBest');
    if (bestEl) bestEl.textContent = '最高 ' + best;
  }

  // ---- 记分 ----
  function submitScore(finalScore) {
    if (finalScore <= 0 || reported) return;
    reported = true;
    fetch('/api/v1/games/' + gameKey + '/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: Math.min(finalScore, maxScore) }),
    }).catch(function () { });
  }

  // show=false 只用来把「我的最高分」拉回来填 HUD，不弹面板（开局自动调用那次）
  function loadLeaderboard(show) {
    fetch('/api/v1/games/' + gameKey + '/leaderboard')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok || !j.data) return;
        if (j.data.mine && j.data.mine.bestScore > best) { best = j.data.mine.bestScore; updateHud(); }
        if (!show) return;
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
      .catch(function () { });
  }

  // ---- 绘制 ----
  var NUM_COLOR = ['', '#1a73e8', '#137333', '#d93025', '#5b21b6', '#8b5a00', '#00838f', '#37474f', '#616161'];

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFlag(cx, cy, cs, scale) {
    var s = cs * 0.5 * (scale || 1);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#37474f'; ctx.lineWidth = Math.max(1.6, cs * 0.06);
    ctx.beginPath(); ctx.moveTo(s * 0.12, -s * 0.42); ctx.lineTo(s * 0.12, s * 0.42); ctx.stroke();
    ctx.fillStyle = '#d93025';
    ctx.beginPath();
    ctx.moveTo(s * 0.12, -s * 0.42);
    ctx.lineTo(-s * 0.5, -s * 0.16);
    ctx.lineTo(s * 0.12, s * 0.08);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#37474f'; ctx.lineWidth = Math.max(1.4, cs * 0.05);
    ctx.beginPath(); ctx.moveTo(-s * 0.36, s * 0.42); ctx.lineTo(s * 0.32, s * 0.42); ctx.stroke();
    ctx.restore();
  }

  function drawMine(cx, cy, cs, boom) {
    // 雷画得更「实」：半径从 0.26 加到 0.30、刺更粗，小格子上也不会糊成一点
    var r = cs * 0.27;
    ctx.fillStyle = boom ? '#b3261e' : '#263238';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = boom ? '#7f1d1a' : '#263238';
    ctx.lineWidth = Math.max(1.6, cs * 0.06);
    for (var a = 0; a < 8; a++) {
      var ang = a * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r * 0.9, cy + Math.sin(ang) * r * 0.9);
      ctx.lineTo(cx + Math.cos(ang) * r * 1.48, cy + Math.sin(ang) * r * 1.48);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.34, r * 0.28, 0, Math.PI * 2); ctx.fill();
  }

  function draw() {
    var cs = cellSize();   // 行内命名沿用 cs，与 draw 内其它算式一致
    var W = canvas.width, H = canvas.height;
    var now = performance.now();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 震屏（踩雷 200ms）
    if (now < shakeUntil) {
      var k = (shakeUntil - now) / 200 * 2;
      ctx.translate(Math.sin(now / 22) * k, Math.cos(now / 18) * k);
    }

    // 棋盘缝（画布底色）：比两种格子都深，未翻/已翻之间的分界靠它兜住
    // （2026-11-13 站主反馈「颜色太相近分不清」：原来未翻 #fff→#dfe5ec、已翻 #f7f9fb，
    //  两者都偏白，小格子上几乎融成一片。现在未翻走偏灰蓝，已翻纯白，对比拉开。）
    ctx.fillStyle = '#aeb9c7';
    ctx.fillRect(-8, -8, W + 16, H + 16);

    for (var i = 0; i < game.cells.length; i++) {
      var c = game.cells[i];
      var x = (i % game.cols) * cs;
      var y = Math.floor(i / game.cols) * cs;

      if (c.open) {
        ctx.fillStyle = c.mine ? '#ffd6d6' : '#ffffff';
        ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
        ctx.strokeStyle = 'rgba(38,50,56,.12)'; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);

        if (c.mine) {
          drawMine(x + cs / 2, y + cs / 2, cs, i === game.boom);
        } else if (c.adj > 0) {
          ctx.fillStyle = NUM_COLOR[c.adj] || '#37474f';
          ctx.font = 'bold ' + Math.round(cs * 0.58) + 'px ui-monospace, Menlo, Consolas, monospace';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(c.adj), x + cs / 2, y + cs / 2 + 0.5);
        }
        continue;
      }

      // 未翻开：带蓝灰底色的凸起块（明显暗于已翻格，边线也更实）
      var g = ctx.createLinearGradient(x, y, x + cs, y + cs);
      g.addColorStop(0, '#eaf0f8');
      g.addColorStop(1, '#c3d0e0');
      ctx.fillStyle = g;
      roundRect(x + 1, y + 1, cs - 2, cs - 2, Math.max(2, cs * 0.16));
      ctx.fill();
      ctx.strokeStyle = 'rgba(38,50,56,.32)'; ctx.lineWidth = 1; ctx.stroke();
      // 左上高光：一块立体的方块，和「已翻平底」一眼区分
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath();
      ctx.moveTo(x + 2.5, y + cs - 3);
      ctx.lineTo(x + 2.5, y + 2.5);
      ctx.lineTo(x + cs - 3, y + 2.5);
      ctx.stroke();

      if (c.flag) {
        // 插旗弹跳：220ms 内先放大 35% 再回弹（视觉上「啪」地钉上去）
        var popT = flagPops[i] ? 1 - (now - flagPops[i]) / 220 : 1;
        var popScale = popT < 1 ? 1 + 0.35 * Math.sin(Math.max(0, popT) * Math.PI) : 1;
        drawFlag(x + cs / 2, y + cs / 2, cs, popScale);
      }

      // 结算后亮出没标到的雷
      if (game.over && c.mine && !c.flag) drawMine(x + cs / 2, y + cs / 2, cs, false);
    }

    // 冲击波（踩雷红圈 / 清场白圈）
    for (var wi = waves.length - 1; wi >= 0; wi--) {
      var wv = waves[wi];
      var wp = (now - wv.t0) / wv.dur;
      if (wp >= 1) { waves.splice(wi, 1); continue; }
      // wp 可能微负（同一帧里 t0 稍晚于 now）——半径必须钳到 0，否则 arc 抛异常
      var wradius = Math.max(0, wv.r0 + Math.max(0, wp) * wv.r1);
      ctx.globalAlpha = (1 - wp) * 0.9;
      ctx.strokeStyle = wv.color;
      ctx.lineWidth = 4 * (1 - wp) + 1;
      ctx.beginPath();
      ctx.arc(wv.x, wv.y, wradius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 清场彩纸
    for (var ci = confetti.length - 1; ci >= 0; ci--) {
      var cf = confetti[ci];
      cf.x += cf.vx; cf.y += cf.vy; cf.vy += 0.18; cf.rot += cf.vr; cf.life -= 1;
      if (cf.life <= 0) { confetti.splice(ci, 1); continue; }
      ctx.save();
      ctx.translate(cf.x, cf.y);
      ctx.rotate(cf.rot);
      ctx.globalAlpha = Math.min(1, cf.life / 20);
      ctx.fillStyle = cf.color;
      ctx.fillRect(-cf.w / 2, -cf.h / 2, cf.w, cf.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // 翻开涟漪
    for (var a = animCells.length - 1; a >= 0; a--) {
      var an = animCells[a];
      var p = (now - an.t0) / 260;
      if (p >= 1) { animCells.splice(a, 1); continue; }
      var ax = (an.i % game.cols) * cs, ay = Math.floor(an.i / game.cols) * cs;
      var ar = Math.max(0, cs * 0.35 * (0.4 + Math.max(0, p)));
      ctx.globalAlpha = (1 - p) * 0.6;
      ctx.strokeStyle = '#1a73e8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ax + cs / 2, ay + cs / 2, ar, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 结束弹窗
    if (game.over) {
      var modal = document.getElementById('soloEndModal');
      if (modal && modal.hidden) {
        var es = document.getElementById('soloEndScore');
        var eb = document.getElementById('soloEndBest');
        var finalScore = game.won ? game.score() : 0;
        if (es) es.textContent = String(finalScore);
        if (eb) eb.textContent = String(best);
        var head = modal.querySelector('h3');
        if (head) head.textContent = game.won ? '清场了' : '踩雷了';
        modal.hidden = false;
      }
    }
  }

  // ---- 交互 ----
  function cellAt(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var x = (clientX - rect.left) * (canvas.width / rect.width);
    var y = (clientY - rect.top) * (canvas.height / rect.height);
    var size = cellSize();
    var cx = Math.floor(x / size);
    var cy = Math.floor(y / size);
    if (cx < 0 || cy < 0 || cx >= game.cols || cy >= game.rows) return -1;
    return cy * game.cols + cx;
  }

  /// 清场撒彩纸（局终从画布上方飘落）
  function burstConfetti() {
    var W = canvas.width, H = canvas.height;
    var colors = ['#1a73e8', '#137333', '#d93025', '#f9ab00', '#8e24aa', '#00acc1'];
    for (var k = 0; k < 90; k++) {
      confetti.push({
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.5,
        vx: (Math.random() - 0.5) * 2.2,
        vy: 1.6 + Math.random() * 2.6,
        w: 4 + Math.random() * 4,
        h: 6 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        life: 100 + Math.random() * 70,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  /// 一次操作之后：音效 + 动效（before = 操作前已翻开格数，用来判断「连开了几格」）
  function afterAction(res, i, before) {
    var now = performance.now();
    var openedNow = game.opened - (before || 0);
    var cx = (i % game.cols) * cs + cs / 2;
    var cy = Math.floor(i / game.cols) * cs + cs / 2;

    if (res === 'boom') {
      shakeUntil = now + 200;
      sfx.play('boom');
      // 红色冲击波 + 一圈橙色余波
      waves.push({ x: cx, y: cy, t0: now, dur: 460, r0: cs * 0.35, r1: cs * 9, color: '#ff5252' });
      waves.push({ x: cx, y: cy, t0: now + 90, dur: 560, r0: cs * 0.2, r1: cs * 6, color: '#ffb74d' });
      if (window.navigator && navigator.vibrate) {
        try { navigator.vibrate([80, 40, 130]); } catch (e) { }
      }
    } else if (res === 'open') {
      // 连开一片 → 音高上行；单开一格 → 一声轻响
      if (openedNow > 1) sfx.play('open', openedNow);
      else sfx.play('number');
      animCells.push({ i: i, t0: now });
      if (game.won) {
        sfx.play('win');
        burstConfetti();
        waves.push({
          x: canvas.width / 2, y: canvas.height / 2, t0: now,
          dur: 620, r0: cs * 0.5, r1: Math.max(canvas.width, canvas.height) * 0.8,
          color: '#1a73e8',
        });
        var sc = Math.min(game.score(), maxScore);
        if (sc > best) best = sc;
        submitScore(sc);
      }
    }
    updateHud();
    draw();
  }

  // ---- 插旗/翻开模式（2026-11-13 站主反馈「没有标记功能」）----
  // 触屏没有右键、长按又容易被手指微动取消，所以给一个看得见的开关：
  // 打开后点哪格就插旗，插完自动切回翻开（避免连点误标）；长按仍然可以临时插旗。
  var flagMode = false;
  var msFlagBtn = document.getElementById('msFlagBtn');
  if (msFlagBtn) {
    msFlagBtn.addEventListener('click', function () {
      flagMode = !flagMode;
      msFlagBtn.classList.toggle('on', flagMode);
      sfx.play(flagMode ? 'flag' : 'unflag');
    });
  }

  function doFlag(i) {
    if (!game.toggleFlag(i)) return false;
    flagPops[i] = performance.now();
    sfx.play(game.cells[i].flag ? 'flag' : 'unflag');
    if (flagMode && msFlagBtn) {
      flagMode = false;
      msFlagBtn.classList.remove('on');   // 标一格就自动回翻开
    }
    updateHud(); draw();
    return true;
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('mousedown', function (e) {
    if (game.over) return;
    var i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    if (e.button === 2) { doFlag(i); return; }        // 桌面右键 = 插旗
    if (e.button !== 0) return;
    if (flagMode) { doFlag(i); return; }              // 插旗模式
    var before = game.opened;
    var res = game.cells[i].open ? game.chord(i) : game.reveal(i);
    afterAction(res, i, before);
  });

  // 手机：长按 420ms 插旗；短按翻开（已翻数字格 = 双键展开）
  var pressTimer = null, pressIndex = -1, longFired = false;
  var pressX = 0, pressY = 0;
  canvas.addEventListener('touchstart', function (e) {
    if (game.over) return;
    e.preventDefault();
    var t = e.touches[0];
    pressIndex = cellAt(t.clientX, t.clientY);
    pressX = t.clientX; pressY = t.clientY;
    longFired = false;
    if (pressIndex < 0) return;
    pressTimer = setTimeout(function () {
      longFired = true;
      doFlag(pressIndex);
    }, 420);
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (game.over || longFired || pressIndex < 0) { pressIndex = -1; return; }
    e.preventDefault();
    var i = pressIndex;
    pressIndex = -1;
    if (flagMode) { doFlag(i); return; }
    var before = game.opened;
    var res = game.cells[i].open ? game.chord(i) : game.reveal(i);
    afterAction(res, i, before);
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    // 只有真「滑走」才取消长按（位移 > 12px）；手指微微抖动不算，
    // 否则长按几乎永远触发不了（2026-11-13「没有标记功能」的另一面）
    var mt = e.touches[0];
    if (mt && (Math.abs(mt.clientX - pressX) > 12 || Math.abs(mt.clientY - pressY) > 12)) {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      pressIndex = -1;
    }
    e.preventDefault();
  }, { passive: false });

  // ---- 循环：计时刷新 + 特效推进（局终后还要把冲击波/彩纸播完再停）----
  function frame(ts) {
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;
    if (!game.over || waves.length || confetti.length) {
      updateHud();
      draw();
      requestAnimationFrame(frame);
    }
  }

  // ---- 开局 ----
  function newGame(lv) {
    level = lv || level;
    var lvInfo = window.MineCore.levelOf(level);
    // 行列按当前屏幕方向定（竖屏的高棋盘会转置），格子边长按容器宽度算
    shape = fitShape(level);
    cs = applySize(shape);
    game = window.MineCore.create({
      level: level, rows: shape.rows, cols: shape.cols, mines: lvInfo.mines,
    });
    if (window.__QA_HOOKS__ !== false) window.__msGame = game;   // 测试钩子（Release 隐藏）

    var panel = document.getElementById('soloLeaderboardPanel');
    if (panel) panel.hidden = true;
    var modal = document.getElementById('soloEndModal');
    if (modal) modal.hidden = true;

    reported = false;
    animCells = [];
    flagPops = {};
    waves = [];
    confetti = [];
    shakeUntil = 0;
    lastTs = 0;
    updateHud();
    draw();
    requestAnimationFrame(frame);   // 计时/动画驱动（结束即停）
  }

  // 难度按钮（Solo.cshtml 仅在扫雷时渲染）
  var levelBtns = document.querySelectorAll('[data-ms-level]');
  Array.prototype.forEach.call(levelBtns, function (b) {
    b.addEventListener('click', function () {
      var lv = parseInt(b.getAttribute('data-ms-level'), 10) || 1;
      Array.prototype.forEach.call(levelBtns, function (x) { x.classList.toggle('on', x === b); });
      newGame(lv);
    });
  });

  var restartBtn = document.getElementById('soloRestart');
  if (restartBtn) restartBtn.addEventListener('click', function () { newGame(level); });
  var endRestartBtn = document.getElementById('soloEndRestart');
  if (endRestartBtn) endRestartBtn.addEventListener('click', function () { newGame(level); });
  var lbBtn = document.getElementById('soloLeaderboard');
  if (lbBtn) lbBtn.addEventListener('click', function () { loadLeaderboard(true); });

  // 转屏 / 窗口尺寸变化：方向变了才重开（竖屏高级盘会转置），只变宽就原地重排
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var s = fitShape(level);
      if (s.rows === game.rows && s.cols === game.cols) {
        shape = s;
        cs = applySize(shape);   // 只改像素密度，局面不动
        draw();
      } else {
        newGame(level);
      }
    }, 350);
  });

  newGame(1);
  loadLeaderboard(false);   // 只取最高分，不弹面板
})();
