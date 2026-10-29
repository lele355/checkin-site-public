// games.js — 五子棋棋盘：短轮询 + 点击落子。
//
// 为什么是轮询：回合制棋类对延迟不敏感，1.2 秒一次完全够用；
// 而 WebSocket 要为 Cookie / Bearer 两套认证各写一条长连接，收益不抵复杂度。
//
// 这个脚本会在两种时机执行：正常加载、以及 pjax 换主区后被 site.js 重放。
// 所以入口先判断「棋盘元素是否已绑定」，避免同一次访问挂两个定时器。
//
// 盘面大小、留白、落子确认、计时都是从 `#gmState` 里读的 —— 页面渲染用的是同一份快照，
// 不做第二次计算，改规则时只改服务端一处。
(function () {
  'use strict';

  var svg = document.getElementById('gmBoard');
  if (!svg || svg.dataset.bound === '1') return;
  svg.dataset.bound = '1';

  var stateEl = document.getElementById('gmState');
  var stonesG = document.getElementById('gmStones');
  var statusEl = document.getElementById('gmStatus');
  // 文案与计时条是两个独立节点：写文案只能写到 #gmStatusText，不能碰 #gmStatus，
  // 否则会把作为兄弟节点的计时条一起清掉（2.5.1 就是这么丢的）。
  var statusTextEl = document.getElementById('gmStatusText') || statusEl;
  var clockEl = document.getElementById('gmClock');
  var ghost = document.getElementById('gmGhost');
  if (!stateEl || !stonesG || !statusEl) return;

  var state;
  try { state = JSON.parse(stateEl.textContent); } catch (e) { return; }

  var SIZE = state.size || 15;
  var PAD = typeof state.pad === 'number' ? state.pad : 20;
  var STEP = (640 - PAD * 2) / (SIZE - 1);
  var bus = false;
  var timer = null;
  var clockTimer = null;
  var ghostAt = null;          // 二次确认时的预览格
  var clockAt = 0;             // 本地计时起点（毫秒时间戳）
  var clockBase = null;        // 拿到快照那一刻的剩余量
  var forcedPoll = false;      // 计时归零后是否已经催过一次轮询

  function px(i) { return PAD + i * STEP; }
  function dot(side) { return side === 1 ? 'b' : 'w'; }
  function rStone() { return (STEP * 0.42).toFixed(2); }
  function rMark() { return (STEP * 0.16).toFixed(2); }

  function occupied(x, y) {
    var ms = state.moves || [];
    for (var i = 0; i < ms.length; i++) if (ms[i].x === x && ms[i].y === y) return true;
    return false;
  }

  function render() {
    var html = '';
    var moves = state.moves || [];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      html += '<circle cx="' + px(m.x) + '" cy="' + px(m.y) + '" r="' + rStone() + '" class="gm-stone ' + dot(m.s) + '"/>';
    }
    if (state.lastMove && state.lastMark !== false) {
      html += '<circle cx="' + px(state.lastMove.x) + '" cy="' + px(state.lastMove.y) +
        '" r="' + rMark() + '" class="gm-last ' + dot(state.lastMove.s) + '"/>';
    }
    stonesG.innerHTML = html;
    hideGhost();
    statusText();
    resetClock();
  }

  function statusText() {
    var txt;
    if (state.status === 'waiting') {
      txt = '等人进来 —— 把房间码 ' + (state.code || '') + ' 发给朋友';
    } else if (state.status === 'finished') {
      var who = state.winner === 3 ? '和棋' : (state.winner === state.mySide ? '你赢了' : '你输了');
      txt = who + ' · 共 ' + (state.moves || []).length + ' 手';
      var r = state.resultReason;
      if (r === 'resign') txt += '（认输）';
      else if (r === 'draw') txt += '（棋盘下满）';
      else if (r === 'overline') txt += '（黑方长连判负）';
      else if (r === 'timeout') txt += '（超时）';
    } else if (!state.mySide) {
      txt = '你在旁观这一局';
    } else if (state.myTurn) {
      txt = '轮到你落子';
    } else {
      txt = '等对手落子';
    }
    if (state.status === 'playing' && state.opponentOnline === false) txt += ' · 对手好像离开了';
    statusTextEl.textContent = txt;
    statusEl.dataset.myturn = state.myTurn ? '1' : '0';
  }

  // ---------------- 计时条 ----------------
  function fmt(ms) {
    var s = Math.ceil(Math.max(0, ms) / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m > 0 ? m + ':' + (s < 10 ? '0' + s : s) : s + 's';
  }

  function resetClock() {
    clockAt = Date.now();
    clockBase = {
      move: typeof state.moveRemainMs === 'number' ? state.moveRemainMs : null,
      my: typeof state.myRemainMs === 'number' ? state.myRemainMs : null,
      opp: typeof state.oppRemainMs === 'number' ? state.oppRemainMs : null
    };
    forcedPoll = false;
    drawClock();
  }

  // 服务端只给「该走棋的一方」计时（没轮到你就不扣），所以这里也不能三方一起倒数，
  // 否则对手/自己的数字会先掉下去再被下一次轮询拉回来，看着像在乱跳。
  function left(v, running) {
    if (v === null) return null;
    return running ? Math.max(0, v - (Date.now() - clockAt)) : v;
  }

  function drawClock() {
    if (!clockEl || !clockBase) return;
    var playing = state.status === 'playing';
    var move = left(clockBase.move, playing);
    var my = left(clockBase.my, playing && state.myTurn);
    var opp = left(clockBase.opp, playing && !state.myTurn);
    if (move === null && my === null) { clockEl.hidden = true; return; }

    clockEl.hidden = false;
    var parts = [];
    if (move !== null && state.status === 'playing') parts.push('本步 ' + fmt(move));
    if (my !== null) parts.push('我 ' + fmt(my));
    if (opp !== null) parts.push('对手 ' + fmt(opp));
    clockEl.textContent = parts.join(' · ');
    clockEl.classList.toggle('low', (move !== null && move < 10000) || (my !== null && my < 60000));

    // 归零了立刻催一次轮询，让服务端判超时（不然要等下一拍）
    var zero = (move === 0) || (my === 0);
    if (zero && !forcedPoll && state.status === 'playing') {
      forcedPoll = true;
      poll();
    }
  }

  // ---------------- 二次确认的预览圈 ----------------
  // 注意：<circle> 是 SVGElement，没有 hidden 这个 IDL 属性（那是 HTMLElement 才有的），
  // 写 ghost.hidden = false 只会挂一个无效的 JS 属性，attribute 不会被移除，
  // 结果就是预览圈永远不显示。SVG 元素一律走 setAttribute / removeAttribute。
  function showGhost(x, y) {
    if (!ghost) return;
    ghost.setAttribute('cx', px(x));
    ghost.setAttribute('cy', px(y));
    ghost.setAttribute('r', rStone());
    ghost.setAttribute('class', 'gm-ghost ' + dot(state.mySide));
    ghost.removeAttribute('hidden');
    ghostAt = { x: x, y: y };
  }

  function hideGhost() {
    if (ghost) ghost.setAttribute('hidden', '');
    ghostAt = null;
  }

  /** 拿到一份新快照：重绘；状态换了就整页刷新一次（按钮/名字要跟着变） */
  function apply(next) {
    if (!next || next.revision === state.revision) return;
    var prevStatus = state.status;
    var prevMoves = (state.moves || []).length;
    state = next;
    SIZE = state.size || SIZE;
    render();
    // 对手落子后提示一下，别让人以为自己的点击没生效
    if ((next.moves || []).length > prevMoves && next.myTurn && window.toast) {
      window.toast('对手走了一步，轮到你了', 'ok');
    }
    if (next.status !== prevStatus) {
      setTimeout(function () {
        if (!document.body.contains(svg)) return;
        location.reload();
      }, 300);
    }
  }

  function place(x, y) {
    bus = true;
    fetch('/api/v1/games/gomoku/rooms/' + state.id + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: JSON.stringify({ x: x, y: y })
    }).then(function (r) {
      return r.json();
    }).then(function (j) {
      bus = false;
      hideGhost();
      if (j && j.ok) apply(j.data);
      else if (window.toast) window.toast((j && j.error) || '落子失败', 'err');
    }, function () {
      bus = false;
      if (window.toast) window.toast('网络不太好，再点一次', 'err');
    });
  }

  svg.addEventListener('click', function (e) {
    if (bus || state.status !== 'playing' || !state.myTurn) return;

    var rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    var vx = (e.clientX - rect.left) / rect.width * 640;
    var vy = (e.clientY - rect.top) / rect.height * 640;

    var col = Math.round((vx - PAD) / STEP);
    var row = Math.round((vy - PAD) / STEP);
    if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return;
    // 离交叉点太远当没点中（手机上避免误触）
    if (Math.abs(px(col) - vx) > STEP * 0.6 || Math.abs(px(row) - vy) > STEP * 0.6) return;
    if (occupied(col, row)) return;

    // 开了「落子确认」：第一下只预览，点同一处第二下才落
    if (state.tapConfirm) {
      if (!ghostAt || ghostAt.x !== col || ghostAt.y !== row) {
        showGhost(col, row);
        return;
      }
    }
    place(col, row);
  });

  function schedule(ms) {
    timer = setTimeout(tick, ms);
  }

  function poll() {
    fetch('/api/v1/games/gomoku/rooms/' + state.id, {
      headers: { 'X-Requested-With': 'fetch' },
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json();
    }).then(function (j) {
      if (j && j.ok && j.data) apply(j.data);
    }, function () { /* 断网就下一轮再试 */ });
  }

  function tick() {
    // pjax 换页后这个 svg 已经不在文档里了 —— 停掉，别再空转
    if (!document.body.contains(svg)) {
      clearTimeout(timer);
      clearInterval(clockTimer);
      return;
    }
    if (document.hidden) { schedule(1500); return; }

    poll();
    schedule(state.status === 'finished' ? 3000 : 1200);
  }

  render();
  schedule(1200);
  clockTimer = setInterval(function () {
    if (!document.body.contains(svg)) { clearInterval(clockTimer); return; }
    drawClock();
  }, 250);
})();
