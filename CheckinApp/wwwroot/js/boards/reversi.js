// boards/reversi.js — 黑白棋棋盘：8×8 格、黑白圆子、翻子动画。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  /** 渲染黑白棋棋盘到 svg 容器 */
  function render(svg, state, opts) {
    var geom = GB.gridGeom(8, 20, opts.showCoord);
    svg.innerHTML = '';

    // 背景
    var bg = GB.el('rect', { x: 0, y: 0, width: 640, height: 640, fill: '#2e7d32', rx: 10 });
    svg.appendChild(bg);

    // 格线
    var grid = GB.el('g', { stroke: '#1b5e20', 'stroke-width': '1.5' });
    for (var i = 0; i <= 8; i++) {
      var pos = geom.cellPx(i);
      grid.appendChild(GB.el('line', { x1: geom.cellPx(0), y1: pos, x2: geom.cellPx(8), y2: pos }));
      grid.appendChild(GB.el('line', { x1: pos, y1: geom.cellPx(0), x2: pos, y2: geom.cellPx(8) }));
    }
    svg.appendChild(grid);

    // 星位（4 个角的交叉点）
    var stars = GB.el('g', { fill: '#1b5e20' });
    [[2, 2], [2, 6], [6, 2], [6, 6]].forEach(function (s) {
      stars.appendChild(GB.el('circle', {
        cx: geom.cellPx(s[0]), cy: geom.cellPx(s[1]), r: 4,
      }));
    });
    svg.appendChild(stars);

    // 坐标
    if (opts.showCoord) {
      var cg = GB.el('g', {});
      GB.drawCoords(cg, geom, 8, 8);
      svg.appendChild(cg);
    }

    // 棋子
    // 落子确认预览（任务二尾巴）：半透明石子标记将落点
    if (opts.pointPreview) {
      var pp = opts.pointPreview.split(',');
      var pv = { x: +pp[0], y: +pp[1] };
      if (!board[pv.x][pv.y]) {
        var sp = geom.cell * 0.9;
        svg.appendChild(GB.el('image', {
          href: '/pieces/reversi-gomoku/' + (opts.mySide === 1 ? 'black-stone' : 'white-stone') + '.svg',
          x: geom.px(pv.x) - sp / 2, y: geom.px(pv.y) - sp / 2, width: sp, height: sp,
          opacity: '0.45', 'pointer-events': 'none',
        }));
      }
    }
    var stonesG = GB.el('g', { id: 'rvStones' });
    svg.appendChild(stonesG);

    // 从 state.events 重建盘面（或 state 直接给 board）
    var board = buildBoard(state);
    animP = (opts.placeAt && opts.placeProgress != null) ? Math.min(1, opts.placeProgress) : 1;
    for (var x = 0; x < 8; x++) {
      for (var y = 0; y < 8; y++) {
        if (board[x][y] !== 0) {
          var k2 = x + ',' + y;
          var fx = animP >= 1 ? null
            : (k2 === lastPlaced ? 'pop'
              : (lastFlips.some(function (f) { return f[0] === x && f[1] === y; }) ? 'flip' : null));
          drawStone(stonesG, geom, x, y, board[x][y], fx);
        }
      }
    }

    // 最后一手标记
    if (opts.lastMark && state.lastMove) {
      var lm = state.lastMove;
      GB.drawLastMark(stonesG, geom, lm.x, lm.y, board[lm.x][lm.y] === 2);
    }

    // 可落子提示（半透明）
    if (opts.myTurn && opts.mySide) {
      var hints = legalMoves(board, opts.mySide);
      var hintG = GB.el('g', { id: 'rvHints' });
      hints.forEach(function (m) {
        hintG.appendChild(GB.el('circle', {
          cx: geom.px(m[0]), cy: geom.px(m[1]), r: geom.cell * 0.15,
          fill: opts.mySide === 1 ? '#333' : '#fff', opacity: '0.25',
        }));
      });
      svg.appendChild(hintG);
    }

    return { pad: geom.pad, cw: geom.step, ch: geom.step, cols: 8, rows: 8, mode: 'cell' };
  }

  function drawStone(g, geom, x, y, side, fx) {
    // 渐变圆子整枚图标（icons-ready 同源，双端同规）；fx=新着回弹/翻子挤压（任务二尾巴）
    var s = geom.cell * 0.9;
    var w = s;
    if (fx === 'pop') {
      var pr = 1 - Math.pow(1 - (animP || 0), 2);
      s = s * (0.35 + 0.65 * pr); w = s;
    } else if (fx === 'flip') {
      // 翻子：水平挤压过中线（0→1 走半圈余弦），读作翻面
      w = s * Math.max(0.08, Math.abs(Math.cos(Math.PI * (animP || 0))));
    }
    g.appendChild(GB.el('image', {
      href: '/pieces/reversi-gomoku/' + (side === 1 ? 'black-stone' : 'white-stone') + '.svg',
      x: geom.px(x) - w / 2, y: geom.px(y) - s / 2, width: w, height: s,
      'pointer-events': 'none',
    }));
  }

  var animP = 1;          // 任务二尾巴：落子/翻子动画进度（games.js placeProgress 驱动）
  var lastFlips = [];     // 最后一手翻转的格（翻子动画用）
  var lastPlaced = null;  // 最后一手落点

  function buildBoard(state) {
    var board = [];
    for (var i = 0; i < 8; i++) { board.push([0, 0, 0, 0, 0, 0, 0, 0]); }
    // 标准初始布局
    board[3][3] = 2; board[4][4] = 2;
    board[3][4] = 1; board[4][3] = 1;

    if (state && state.events) {
      state.events.forEach(function (e) {
        if (e.t !== 'move' || e.x == null || e.y == null) return;
        if (board[e.x][e.y] !== 0) return;
        board[e.x][e.y] = e.s;
        var fl = getFlips(board, e.x, e.y, e.s, true);
        fl.forEach(function (f) {
          board[f[0]][f[1]] = e.s;
        });
        lastFlips = fl;   // 只留最后一手的翻子集（逐事件覆盖 = 最后事件即最新）
        lastPlaced = e.x + ',' + e.y;
      });
    }
    return board;
  }

  function getFlips(board, x, y, side, before) {
    var flips = [];
    var dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    dirs.forEach(function (d) {
      var line = [];
      var cx = x + d[0], cy = y + d[1];
      while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8 && board[cx][cy] !== 0 && board[cx][cy] !== side) {
        line.push([cx, cy]);
        cx += d[0]; cy += d[1];
      }
      if (line.length > 0 && cx >= 0 && cx < 8 && cy >= 0 && cy < 8 && board[cx][cy] === side) {
        flips = flips.concat(line);
      }
    });
    return flips;
  }

  function legalMoves(board, side) {
    var moves = [];
    for (var x = 0; x < 8; x++) {
      for (var y = 0; y < 8; y++) {
        if (board[x][y] === 0 && getFlips(board, x, y, side).length > 0) {
          moves.push([x, y]);
        }
      }
    }
    return moves;
  }

  /** 点击落子回调：(x,y) 先是 viewBox 原始坐标，这里换算成格坐标再校验 */
  function onTap(svg, geom, state, x, y, callback) {
    var g = GB.hit(geom, x, y);
    if (!g) return;
    if (state.state) {
      var board = buildBoard(state.state);
      if (board[g.x][g.y] !== 0) return;
      if (getFlips(board, g.x, g.y, state.mySide).length === 0) return;
    }
    callback(g.x, g.y);
  }

  window.ReversiBoard = {
    render: render,
    onTap: onTap,
    buildBoard: buildBoard,
    legalMoves: legalMoves,
  };
})();
