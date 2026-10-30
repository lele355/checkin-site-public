// solo/fish.js — 大鱼吃小鱼（单机）。
// 控制一条鱼游动，吃比自己小的鱼和食物长大，碰到大鱼被吃，本局结束。
// 纯前端算分，结束时 POST /games/fish/score 上报最高分。
(function () {
  'use strict';

  var host = document.querySelector('.gm-solo');
  if (!host) return;
  var canvas = document.getElementById('soloCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var gameKey = host.dataset.gameKey || 'fish';
  var maxScore = parseInt(host.dataset.maxScore || '1000000', 10);

  // 玩家初始体型等级（0 最小）
  var level = 0;
  var eatenCount = 0;
  var px = 180, py = 240;      // 玩家位置
  var score = 0;
  var over = false;
  var foods = [];               // 食物 {x,y,score}
  var fishes = [];              // 其它鱼 {x,y,level,dir}

  function reset() {
    level = 0;
    eatenCount = 0;
    px = 180; py = 240;
    score = 0;
    over = false;
    foods = [];
    fishes = [];
    for (var i = 0; i < 8; i++) spawnFood();
    for (var j = 0; j < 6; j++) spawnFish();
    updateScore();
    loop();
  }

  function spawnFood() {
    foods.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      score: 1,
    });
  }

  function spawnFish() {
    var lvl = Math.floor(Math.random() * 7); // 0..6
    fishes.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      level: lvl,
      dir: Math.random() < 0.5 ? 1 : -1,
    });
  }

  function radius(lvl) { return 10 + lvl * 5; }

  function updateScore() {
    var el = document.getElementById('soloScore');
    if (el) el.textContent = String(score);
  }

  function loop() {
    if (over) return;
    // 食物随时间慢慢增多
    if (foods.length < 12 && Math.random() < 0.02) spawnFood();

    // 其它鱼游动
    for (var i = 0; i < fishes.length; i++) {
      var f = fishes[i];
      f.x += f.dir * (0.4 + f.level * 0.15);
      if (f.x < 0 || f.x > canvas.width) f.dir *= -1;
    }

    // 吃食物
    for (var k = foods.length - 1; k >= 0; k--) {
      var fo = foods[k];
      var d = Math.hypot(fo.x - px, fo.y - py);
      if (d < radius(level) + 4) {
        score += fo.score;
        foods.splice(k, 1);
        updateScore();
      }
    }

    // 吃小鱼 / 被大鱼吃：吃「不大于自己」的鱼；每吃 3 条升一级
    for (var m = fishes.length - 1; m >= 0; m--) {
      var fi = fishes[m];
      var d2 = Math.hypot(fi.x - px, fi.y - py);
      if (d2 < radius(level) + radius(fi.level) - 4) {
        if (fi.level <= level) {
          // 吃掉小鱼：得分 + 成长
          score += (fi.level + 1) * 5;
          eatenCount++;
          if (eatenCount % 3 === 0) level = Math.min(10, level + 1);
          fishes.splice(m, 1);
          spawnFish();
          updateScore();
        } else if (fi.level > level) {
          // 被大鱼吃：本局结束
          endGame();
          return;
        }
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  function endGame() {
    over = true;
    var finalScore = Math.min(score, maxScore);
    draw();
    submitScore(finalScore);
    loadLeaderboard();
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

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 背景水色
    ctx.fillStyle = '#B3E5FC';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 食物
    ctx.fillStyle = '#8BC34A';
    for (var i = 0; i < foods.length; i++) {
      ctx.beginPath();
      ctx.arc(foods[i].x, foods[i].y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 其它鱼
    for (var j = 0; j < fishes.length; j++) {
      var f = fishes[j];
      drawFish(f.x, f.y, f.level, f.dir, f.level > level ? '#E53935' : '#5C6BC0');
    }

    // 玩家鱼
    drawFish(px, py, level, 1, '#FFB300');

    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('本局 ' + score + ' 分', canvas.width / 2, canvas.height / 2);
    }
  }

  function drawFish(x, y, lvl, dir, color) {
    var r = radius(lvl);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.35, -r * 0.25, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(r * 0.4, -r * 0.25, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    // 尾巴
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(-r - r * 0.5, -r * 0.4);
    ctx.lineTo(-r - r * 0.5, r * 0.4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // 交互：指针移动控制鱼，触屏拖动
  function toPos(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }
  canvas.addEventListener('mousemove', function (e) {
    if (over) return;
    var p = toPos(e);
    px = p.x; py = p.y;
  });
  canvas.addEventListener('touchmove', function (e) {
    if (over) return;
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var t = e.touches[0];
    px = (t.clientX - rect.left) * (canvas.width / rect.width);
    py = (t.clientY - rect.top) * (canvas.height / rect.height);
  }, { passive: false });

  var restartBtn = document.getElementById('soloRestart');
  if (restartBtn) restartBtn.addEventListener('click', function () {
    document.getElementById('soloLeaderboardPanel').hidden = true;
    reset();
  });
  var lbBtn = document.getElementById('soloLeaderboard');
  if (lbBtn) lbBtn.addEventListener('click', loadLeaderboard);

  reset();
})();
