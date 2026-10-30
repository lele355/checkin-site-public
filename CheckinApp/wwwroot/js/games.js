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
    var deployActive = gameKey === 'armychess' && state.status === 'setup'
      && state.mySide > 0 && !(state.state && state.state.deployDone && state.state.deployDone[state.mySide - 1]);
    if (deployActive && !deployPieces) deployPieces = window.ArmyChessBoard.genDeploy(state.mySide);
    if (!deployActive) { deployPieces = null; deploySel = null; }
    lastGeom = renderer.render(svg, state.state || {}, {
      showCoord: state.showCoord,
      lastMark: state.lastMark,
      mySide: state.mySide,
      myTurn: state.myTurn,
      tapConfirm: state.tapConfirm,
      sel: sel,
      deployPieces: deployActive ? deployPieces : null,
      movable: (state.state && state.state.movable) || [],
    });
    window.__gmLastGeom = lastGeom;   // UI 冒烟/调试用几何（与点击换算同源）
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
      // 飞行棋：骰点 + 掷/选机状态（状态事实）
      if (gameKey === 'ludo' && state.state) {
        if (state.state.lastRoll) txt += ' · 骰子 ' + state.state.lastRoll;
        if (state.myTurn && state.status === 'playing') {
          txt += state.state.needRoll ? ' · 掷骰子' : ' · 选一架飞机';
        }
      }
      // 翻棋：阵营状态 + 执色 + 二选一（状态事实）
      if (gameKey === 'armychess' && state.state && state.state.mode === 'fanqi' && state.status === 'playing') {
        txt += state.state.settled ? ' · 翻子或走子' : ' · 阵营未定';
        if (state.state.myColor) txt += ' · 你执' + (state.state.myColor === 1 ? '红' : '蓝');
      }
      statusTextEl.textContent = txt;
    }
    // 布阵按钮条：仅布阵期且自己未部署时出现
    var bar = document.getElementById('gmSetupBar');
    if (bar) bar.hidden = !deployActive;
    // 飞行棋掷骰按钮条：轮到我且这一手还没掷
    var ludoBar = document.getElementById('gmLudoBar');
    if (ludoBar) {
      var needRoll = !!(state.myTurn && state.status === 'playing'
        && state.state && state.state.needRoll);
      ludoBar.hidden = !needRoll;
    }
  }

  // 最近一次 render 返回的几何（pad/cw/ch/cols/rows/mode）—— 点击换算与渲染同源
  var lastGeom = null;
  // 两段式走子：当前选中的起点 (gx,gy)。象棋/斗兽棋/军旗用。
  var sel = null;
  // 军旗明棋布阵：本地排布（客户端生成，确认后提交 deploy）
  var deployPieces = null;
  var deploySel = null;

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

  // 执方视角：翻棋 = 执色（myColor），其余 = 座位（mySide）
  function myColorOf() {
    if (gameKey === 'armychess' && state.state && state.state.mode === 'fanqi') return state.state.myColor || 0;
    return state.mySide;
  }

  // (gx,gy) 上是否我的子（两段式选起点用）
  function ownPieceAt(gx, gy) {
    var ps = state.state && state.state.pieces;
    if (!ps) return false;
    var mine = myColorOf();
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].x === gx && ps[i].y === gy && ps[i].side === mine) return true;
    }
    return false;
  }

  // 点击：算到 SVG viewBox 坐标 → 飞行棋点机 / 网格坐标 → 布阵/两段式/单点分发
  svg.addEventListener('click', function (e) {
    var rect = svg.getBoundingClientRect();
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var vw = vb && vb.width ? vb.width : 640;
    var vh = vb && vb.height ? vb.height : 640;
    var x = (e.clientX - rect.left) / rect.width * vw;
    var y = (e.clientY - rect.top) / rect.height * vh;

    // 飞行棋：点 ✈ 走子（movable 内才发 {p}），不走网格换算
    if (gameKey === 'ludo') {
      if (!state.myTurn || state.status !== 'playing') return;
      var lst = (state.state && state.state.movable) || [];
      if (!lst.length) return;
      var pi = window.LudoBoard.pieceAt(x, y);
      if (pi >= 0 && lst.indexOf(pi) >= 0) sendMove({ p: pi });
      return;
    }

    var g = window.GameBoards.hit(lastGeom, x, y);
    if (!g) return;

    // 军旗明棋布阵：点两格互换（约束不合法的交换不动）
    if (gameKey === 'armychess' && state.status === 'setup' && deployPieces) {
      var mine = deployPieces.some(function (q) { return q.x === g.x && q.y === g.y; });
      if (!mine) return;
      if (!deploySel) { deploySel = { x: g.x, y: g.y }; sel = deploySel; render(); return; }
      if (deploySel.x === g.x && deploySel.y === g.y) { deploySel = null; sel = null; render(); return; }
      var swapped = window.ArmyChessBoard.trySwap(state.mySide, deployPieces, deploySel.x, deploySel.y, g.x, g.y);
      if (swapped) deployPieces = swapped;
      deploySel = null; sel = null;
      render();
      return;
    }

    if (!state.myTurn || state.status !== 'playing') return;

    // 翻棋：点暗子 = 翻开 {x,y}；点己方已翻子 = 两段式走子（暗子不可动不可被攻击）
    if (gameKey === 'armychess' && state.state && state.state.mode === 'fanqi') {
      var psF = state.state.pieces || [], pq = null;
      for (var iF = 0; iF < psF.length; iF++) if (psF[iF].x === g.x && psF[iF].y === g.y) { pq = psF[iF]; break; }
      if (pq && pq.hidden) {
        sel = null;
        sendMove({ x: g.x, y: g.y });
        return;
      }
      if (!state.state.settled) return;   // 阵营未定：只能翻子
      if (ownPieceAt(g.x, g.y)) { sel = { x: g.x, y: g.y }; render(); return; }
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

  // 军旗布阵：随机 / 确认（Play.cshtml 按钮条调）
  window.__gmDeployRandom = function () {
    if (deployPieces) { deployPieces = window.ArmyChessBoard.genDeploy(state.mySide); deploySel = null; sel = null; render(); }
  };
  window.__gmDeployPieces = function () { return deployPieces; };
  window.__gmDeployConfirm = function () {
    if (!deployPieces) return;
    fetch('/api/v1/games/armychess/rooms/' + state.id + '/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: JSON.stringify({ pieces: deployPieces }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.data) { deployPieces = null; deploySel = null; sel = null; apply(j.data); }
    }, function () { });
  };

  // 飞行棋：掷骰（Play.cshtml 按钮条调）
  window.__gmLudoRoll = function () {
    fetch('/api/v1/games/' + gameKey + '/rooms/' + state.id + '/roll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.data) apply(j.data);
    }, function () { });
  };

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
