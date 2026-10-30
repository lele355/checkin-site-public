// solo/melon.js — 合成大西瓜（单机）。
// 水果从顶部掉落，相同水果相邻合并成高一级，堆到顶线游戏结束。
// 纯前端算分，结束时 POST /games/melon/score 上报最高分。
(function () {
  'use strict';

  var host = document.querySelector('.gm-solo');
  if (!host) return;
  var canvas = document.getElementById('soloCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var gameKey = host.dataset.gameKey || 'melon';
  var maxScore = parseInt(host.dataset.maxScore || '1000000', 10);

  // 水果链（11 级）：葡萄 < 樱桃 < 橘子 < 柠檬 < 猕猴桃 < 番茄 < 桃子 < 菠萝 < 椰子 < 半西瓜 < 大西瓜
  var FRUITS = [
    { name: '葡萄', color: '#9C27B0', radius: 16, score: 1 },
    { name: '樱桃', color: '#E53935', radius: 19, score: 2 },
    { name: '橘子', color: '#FB8C00', radius: 22, score: 4 },
    { name: '柠檬', color: '#FDD835', radius: 25, score: 8 },
    { name: '猕猴桃', color: '#7CB342', radius: 28, score: 15 },
    { name: '番茄', color: '#EF5350', radius: 31, score: 30 },
    { name: '桃子', color: '#F48FB1', radius: 34, score: 60 },
    { name: '菠萝', color: '#F9A825', radius: 37, score: 120 },
    { name: '椰子', color: '#8D6E63', radius: 40, score: 240 },
    { name: '半西瓜', color: '#4CAF50', radius: 43, score: 480 },
    { name: '大西瓜', color: '#2E7D32', radius: 46, score: 960 },
  ];

  var COLS = 10;
  var ROWS = 16;
  var cell = 36;
  var pad = 6;
  var topLine = 1; // 堆到第 1 行（顶线）判负

  // 棋盘：grid[row][col] = 水果索引（0..10）或 -1
  var grid = [];
  var score = 0;
  var over = false;
  var curFruit = -1;
  var curCol = 4;

  function reset() {
    grid = [];
    for (var r = 0; r < ROWS; r++) {
      grid.push([]);
      for (var c = 0; c < COLS; c++) grid[r].push(-1);
    }
    score = 0;
    over = false;
    spawn();
    draw();
    updateScore();
  }

  function spawn() {
    // 随机低等级水果（0..4）
    curFruit = Math.floor(Math.random() * 5);
    curCol = 4;
  }

  function drop() {
    if (over) return;
    // 找该列从底往上第一个空格
    var r = ROWS - 1;
    while (r >= 0 && grid[r][curCol] !== -1) r--;
    if (r < 0) { spawn(); draw(); return; }
    grid[r][curCol] = curFruit;
    mergeAt(r, curCol);
    if (isOver()) { endGame(); return; }
    spawn();
    draw();
  }

  function mergeAt(r, c) {
    var t = grid[r][c];
    if (t < 0) return;
    // 与左/右/下/上相同水果合并
    var dirs = [[0, -1], [0, 1], [1, 0], [-1, 0]];
    for (var d = 0; d < dirs.length; d++) {
      var nr = r + dirs[d][0];
      var nc = c + dirs[d][1];
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      if (grid[nr][nc] === t && t < FRUITS.length - 1) {
        // 合并：消除两个，产出高一级
        grid[r][c] = -1;
        grid[nr][nc] = -1;
        score += FRUITS[t + 1].score;
        // 新水果落在两者位置中较靠下的
        var mr = Math.max(r, nr);
        grid[mr][c] = t + 1;
        mergeAt(mr, c);
        updateScore();
        return;
      }
    }
  }

  function isOver() {
    for (var c = 0; c < COLS; c++) {
      if (grid[topLine][c] !== -1) return true;
    }
    return false;
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

  function updateScore() {
    var el = document.getElementById('soloScore');
    if (el) el.textContent = String(score);
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 顶线
    ctx.strokeStyle = '#D32F2F';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, topLine * cell + cell / 2);
    ctx.lineTo(canvas.width, topLine * cell + cell / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var t = grid[r][c];
        if (t < 0) continue;
        drawFruit(c * cell + cell / 2, r * cell + cell / 2, t);
      }
    }
    // 当前下落水果
    if (!over && curFruit >= 0) {
      drawFruit(curCol * cell + cell / 2, topLine * cell, curFruit, 0.7);
    }
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('本局 ' + score + ' 分', canvas.width / 2, canvas.height / 2);
    }
  }

  function drawFruit(x, y, t, alpha) {
    var f = FRUITS[t];
    ctx.globalAlpha = alpha || 1;
    ctx.beginPath();
    ctx.arc(x, y, f.radius - 2, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = (t >= 9 ? '11px' : '10px') + ' sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.name, x, y);
  }

  // 交互：指针移动选列，点击/触屏下落
  function toCol(px) {
    var c = Math.floor(px / cell);
    return Math.max(0, Math.min(COLS - 1, c));
  }

  canvas.addEventListener('mousemove', function (e) {
    if (over) return;
    var rect = canvas.getBoundingClientRect();
    curCol = toCol((e.clientX - rect.left) * (canvas.width / rect.width));
    draw();
  });
  canvas.addEventListener('click', function () { drop(); });
  canvas.addEventListener('touchmove', function (e) {
    if (over) return;
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var touch = e.touches[0];
    curCol = toCol((touch.clientX - rect.left) * (canvas.width / rect.width));
    draw();
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) { e.preventDefault(); drop(); }, { passive: false });

  var restartBtn = document.getElementById('soloRestart');
  if (restartBtn) restartBtn.addEventListener('click', function () {
    document.getElementById('soloLeaderboardPanel').hidden = true;
    reset();
  });
  var lbBtn = document.getElementById('soloLeaderboard');
  if (lbBtn) lbBtn.addEventListener('click', loadLeaderboard);

  reset();
})();
