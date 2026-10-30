// games.js — 通用对局轮询 + 落子。配合 boards.js + boards/{key}.js 使用。
// 1.2s 短轮询 + revision 乐观锁，渲染交给 boards 模块。
// pageshow 刷 bfcache（修复 2）。
(function () {
  'use strict';

  var stateEl = document.getElementById('gmState');
  var boardHost = document.getElementById('gmBoardHost');
  if (!stateEl || !boardHost) return;
  if (boardHost.dataset.bound === '1') return;
  boardHost.dataset.bound = '1';

  var state;
  try { state = JSON.parse(stateEl.textContent); } catch (e) { return; }

  var statusTextEl = document.getElementById('gmStatusText');
  var clockEl = document.getElementById('gmClock');
  var timer = null;
  var clockTimer = null;

  // 选择棋盘渲染器（按 gameKey 精确分发，不回落到 GomokuBoard）
  var gameKey = state.gameKey || 'gomoku';
  var RENDERERS = {
    gomoku: window.GomokuBoard,
    reversi: window.ReversiBoard,
    jungle: window.JungleBoard,
    xiangqi: window.XiangqiBoard,
    ludo: window.LudoBoard,
    armychess: window.ArmyChessBoard,
  };
  var renderer = RENDERERS[gameKey];
  if (!renderer) { console.error('未知游戏类型: ' + gameKey); return; }

  // 创建 SVG
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 640 640');
  svg.setAttribute('class', 'gm-board');
  svg.style.width = '100%';
  svg.style.height = 'auto';
  boardHost.appendChild(svg);

  function render() {
    if (!renderer.render) return;
    lastGeom = renderer.render(svg, state.state || {}, {
      showCoord: state.showCoord,
      lastMark: state.lastMark,
      mySide: state.mySide,
      myTurn: state.myTurn,
      tapConfirm: state.tapConfirm,
      sel: sel,
    });
    if (statusTextEl) {
      var txt = statusText(state);
      // 黑白棋：全程比分 + 无子可下提示（状态事实，非解释）
      if (gameKey === 'reversi' && state.state) {
        var evs = state.state.events || [];
        var last = evs.length ? evs[evs.length - 1] : null;
        if (last && last.t === 'pass') {
          txt = (last.s === state.mySide ? '你无子可下，跳过' : '对方无子可下，跳过') + ' · ' + txt;
        }
        txt += ' · 黑 ' + (state.state.black || 0) + ' 白 ' + (state.state.white || 0);
      }
      statusTextEl.textContent = txt;
    }
  }

  // 最近一次 render 返回的几何（pad/cw/ch/cols/rows/mode）—— 点击换算与渲染同源
  var lastGeom = null;
  // 两段式走子：当前选中的起点 (gx,gy)。象棋/斗兽棋/军旗用。
  var sel = null;

  function statusText(s) {
    if (s.status === 'waiting') return '等人进来';
    if (s.status === 'finished') {
      var w = s.winner === 3 ? '和棋' : s.winner === 0 ? '已结束' : (s.winner === s.mySide ? '你赢了' : '你输了');
      return w;
    }
    if (s.mySide === 0) return '你在旁观这一局';
    return s.myTurn ? '轮到你' : '等对手落子';
  }

  // 点击模式：两段式（象棋/斗兽棋/军旗）/ 单点落子（五子棋/黑白棋）/ 不响应棋盘点击（飞行棋走按钮）
  function boardClickMode() {
    if (gameKey === 'xiangqi' || gameKey === 'jungle' || gameKey === 'armychess') return 'two';
    if (gameKey === 'gomoku' || gameKey === 'reversi') return 'point';
    return 'none';
  }

  // (gx,gy) 上是否我的子（两段式选起点用）
  function ownPieceAt(gx, gy) {
    var ps = state.state && state.state.pieces;
    if (!ps) return false;
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].x === gx && ps[i].y === gy && ps[i].side === state.mySide) return true;
    }
    return false;
  }

  // 点击：算到 SVG viewBox 坐标 → 网格坐标 → 两段式/单点分发
  svg.addEventListener('click', function (e) {
    if (!state.myTurn || state.status !== 'playing') return;
    var rect = svg.getBoundingClientRect();
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var vw = vb && vb.width ? vb.width : 640;
    var vh = vb && vb.height ? vb.height : 640;
    var x = (e.clientX - rect.left) / rect.width * vw;
    var y = (e.clientY - rect.top) / rect.height * vh;
    var g = window.GameBoards.hit(lastGeom, x, y);
    if (!g) return;

    var mode = boardClickMode();
    if (mode === 'none') return;

    if (mode === 'two') {
      // 点己方另一子 = 改选起点（必须在 sendMove 之前判，否则改选分支不可达）
      if (ownPieceAt(g.x, g.y)) {
        sel = { x: g.x, y: g.y };
        render();
        return;
      }
      // 已有起点且点的是别处 → 提交 {fx,fy,tx,ty}
      if (sel && !(sel.x === g.x && sel.y === g.y)) {
        sendMove({ fx: sel.x, fy: sel.y, tx: g.x, ty: g.y });
        sel = null;
        render();
        return;
      }
      sel = null;
      render();
      return;
    }

    // 单点落子（五子棋/黑白棋）
    sendMove({ x: g.x, y: g.y });
  });

  function sendMove(move) {
    fetch('/api/v1/games/' + gameKey + '/rooms/' + state.id + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: JSON.stringify(move),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.data) apply(j.data);
    }, function () { });
  }

  function apply(data) {
    if (data.revision === state.revision) return;
    state.revision = data.revision;
    if (!data.myTurn) sel = null;   // 轮到对方时清掉两段式选中
    state.status = data.status;
    state.turn = data.turn;
    state.winner = data.winner;
    state.resultReason = data.resultReason;
    state.myTurn = data.myTurn;
    state.mySide = data.mySide;
    state.state = data.state;
    state.moveRemainMs = data.moveRemainMs;
    state.myRemainMs = data.myRemainMs;
    state.oppRemainMs = data.oppRemainMs;
    render();
  }

  function poll() {
    fetch('/api/v1/games/' + gameKey + '/rooms/' + state.id, {
      headers: { 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.data) apply(j.data);
    }, function () { });
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  function tick() {
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

  // bfcache 返回时刷一次（修复 2）
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    if (!document.body.contains(svg)) return;
    poll();
  });
})();
