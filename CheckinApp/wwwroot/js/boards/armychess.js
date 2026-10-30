// boards/armychess.js — 军旗棋盘：5×12 节点 + 铁路粗线/公路细线/山界/行营/大本营 + 长方军牌。
// 拓扑常量与服务端 ArmyChessBoard.cs 三端同源（设计 §9.1）。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  var W = 5, H = 12;
  var CAMPS = [[1,2],[3,2],[2,3],[1,4],[3,4],[1,7],[3,7],[2,8],[1,9],[3,9]];
  var DENS = [[1,0],[3,0],[1,11],[3,11]];
  var RAIL_ROWS = [1,5,6,10], RAIL_COLS = [0,4];
  var GAPS = [[[1,5],[1,6]], [[3,5],[3,6]]];

  // rank token → 显示名
  var RANK_NAMES = {
    rank_commander: '司令', rank_army: '军长', rank_division: '师长',
    rank_brigade: '旅长', rank_regiment: '团长', rank_battalion: '营长',
    rank_company: '连长', rank_platoon: '排长', rank_engineer: '工兵',
    rank_mine: '地雷', rank_flag: '军旗', rank_bomb: '炸弹',
  };

  function isCamp(x, y) { return CAMPS.some(function (p) { return p[0] === x && p[1] === y; }); }
  function isDen(x, y) { return DENS.some(function (p) { return p[0] === x && p[1] === y; }); }
  function sameEdge(a, b, c, d) { return (a === c && b === d) || (a === d && b === c); }
  function isGap(x1, y1, x2, y2) {
    return GAPS.some(function (g) { return sameEdge(g[0][0], g[0][1], g[1][0], g[1][1]) && sameEdge(x1, y1, x2, y2); });
  }
  function isRailEdge(x1, y1, x2, y2) {
    var horiz = y1 === y2 && RAIL_ROWS.indexOf(y1) >= 0 && Math.abs(x1 - x2) === 1;
    var vert = x1 === x2 && RAIL_COLS.indexOf(x1) >= 0 && Math.abs(y1 - y2) === 1;
    var central = sameEdge(x1, y1, x2, y2) && ((x1 === 2 && y1 === 5 && x2 === 2 && y2 === 6) || (x1 === 2 && y1 === 6 && x2 === 2 && y2 === 5));
    return horiz || vert || central;
  }
  function isOrth(x1, y1, x2, y2) { return Math.abs(x1 - x2) + Math.abs(y1 - y2) === 1; }

  // 行营↔对角邻格（公路斜边，§9.1 全表）
  var CAMP_DIAG = (function () {
    var upper = [
      [[1,2],[0,1]], [[1,2],[2,1]], [[1,2],[0,3]], [[1,2],[2,3]],
      [[3,2],[2,1]], [[3,2],[4,1]], [[3,2],[2,3]], [[3,2],[4,3]],
      [[2,3],[1,2]], [[2,3],[3,2]], [[2,3],[1,4]], [[2,3],[3,4]],
      [[1,4],[0,3]], [[1,4],[2,3]], [[1,4],[0,5]], [[1,4],[2,5]],
      [[3,4],[2,3]], [[3,4],[4,3]], [[3,4],[2,5]], [[3,4],[4,5]],
    ];
    var mirror = upper.map(function (e) {
      return [[e[0][0], 11 - e[0][1]], [e[1][0], 11 - e[1][1]]];
    });
    return upper.concat(mirror);
  })();

  function isCampDiag(x1, y1, x2, y2) {
    return CAMP_DIAG.some(function (e) {
      return (sameEdge(e[0][0], e[0][1], x1, y1) && sameEdge(e[1][0], e[1][1], x2, y2)) ||
             (sameEdge(e[0][0], e[0][1], x2, y2) && sameEdge(e[1][0], e[1][1], x1, y1));
    });
  }
  function isRoadEdge(x1, y1, x2, y2) {
    if (isGap(x1, y1, x2, y2)) return false;
    if (isOrth(x1, y1, x2, y2) && !isRailEdge(x1, y1, x2, y2)) return true;
    return isCampDiag(x1, y1, x2, y2);
  }

  function render(svg, state, opts) {
    svg.innerHTML = '';
    var totalH = 640 * H / W;
    svg.setAttribute('viewBox', '0 0 640 ' + totalH);

    var pad = 24;
    var cw = (640 - pad * 2) / W;
    var ch = (totalH - pad * 2) / H;

    function nx(x) { return pad + x * cw; }        // 节点左上
    function ny(y) { return pad + y * ch; }
    function px(x) { return nx(x) + cw / 2; }      // 节点中心
    function py(y) { return ny(y) + ch / 2; }

    // 背景
    svg.appendChild(GB.el('rect', { x: 0, y: 0, width: 640, height: totalH, fill: '#c8b896', rx: 8 }));

    // 公路（细线）
    var road = GB.el('g', { stroke: '#a08a63', 'stroke-width': '2' });
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (x + 1 < W && isRoadEdge(x, y, x + 1, y)) road.appendChild(GB.el('line', { x1: px(x), y1: py(y), x2: px(x + 1), y2: py(y) }));
      if (y + 1 < H && isRoadEdge(x, y, x, y + 1)) road.appendChild(GB.el('line', { x1: px(x), y1: py(y), x2: px(x), y2: py(y + 1) }));
      if (x + 1 < W && y + 1 < H) { /* 斜边只连行营对角，逐边表判断 */ }
    }
    CAMP_DIAG.forEach(function (e) {
      road.appendChild(GB.el('line', { x1: px(e[0][0]), y1: py(e[0][1]), x2: px(e[1][0]), y2: py(e[1][1]) }));
    });
    svg.appendChild(road);

    // 铁路（粗线，双轨观感 = 外粗内细两道）
    var rail = GB.el('g', { stroke: '#4e342e' });
    for (var y2 = 0; y2 < H; y2++) for (var x2 = 0; x2 < W; x2++) {
      if (x2 + 1 < W && isRailEdge(x2, y2, x2 + 1, y2)) {
        rail.appendChild(GB.el('line', { x1: px(x2), y1: py(y2), x2: px(x2 + 1), y2: py(y2), 'stroke-width': '7' }));
        rail.appendChild(GB.el('line', { x1: px(x2), y1: py(y2), x2: px(x2 + 1), y2: py(y2), 'stroke-width': '2', stroke: '#e8ddc8' }));
      }
      if (y2 + 1 < H && isRailEdge(x2, y2, x2, y2 + 1)) {
        rail.appendChild(GB.el('line', { x1: px(x2), y1: py(y2), x2: px(x2), y2: py(y2 + 1), 'stroke-width': '7' }));
        rail.appendChild(GB.el('line', { x1: px(x2), y1: py(y2), x2: px(x2), y2: py(y2 + 1), 'stroke-width': '2', stroke: '#e8ddc8' }));
      }
    }
    svg.appendChild(rail);

    // 山界缺口标注（无任何边）
    GAPS.forEach(function (g) {
      var mx = (px(g[0][0]) + px(g[1][0])) / 2, my = (py(g[0][1]) + py(g[1][1])) / 2;
      var t = GB.el('text', { x: mx, y: my + 6, 'text-anchor': 'middle', 'font-size': '16', fill: '#6d4c41', 'font-weight': 'bold', opacity: '0.7' });
      t.textContent = '山';
      svg.appendChild(t);
    });

    // 行营（双圈）+ 大本营
    for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
      if (isCamp(xx, yy)) {
        svg.appendChild(GB.el('circle', { cx: px(xx), cy: py(yy), r: Math.min(cw, ch) * 0.42, fill: '#c8e6c9', stroke: '#2e7d32', 'stroke-width': '2' }));
        svg.appendChild(GB.el('circle', { cx: px(xx), cy: py(yy), r: Math.min(cw, ch) * 0.32, fill: 'none', stroke: '#2e7d32', 'stroke-width': '1' }));
        var tc = GB.el('text', { x: px(xx), y: py(yy) + 5, 'text-anchor': 'middle', 'font-size': '13', fill: '#1b5e20', 'font-weight': 'bold', 'pointer-events': 'none' });
        tc.textContent = '营';
        svg.appendChild(tc);
      } else if (isDen(xx, yy)) {
        svg.appendChild(GB.el('circle', { cx: px(xx), cy: py(yy), r: Math.min(cw, ch) * 0.42, fill: '#ffcdd2', stroke: '#b71c1c', 'stroke-width': '2' }));
        var td = GB.el('text', { x: px(xx), y: py(yy) + 5, 'text-anchor': 'middle', 'font-size': '12', fill: '#b71c1c', 'font-weight': 'bold', 'pointer-events': 'none' });
        td.textContent = '大本营';
        svg.appendChild(td);
      }
    }

    // 棋子（长方军牌；暗子背面样式）
    var pieces = (state.pieces || []).slice();
    if (opts.deployPieces) pieces = pieces.concat(opts.deployPieces.map(function (p) {
      return { x: p.x, y: p.y, side: opts.mySide, rank: p.rank, hidden: false };
    }));
    pieces.forEach(function (p) {
      var isSide1 = p.side === 1;
      var tagW = cw * 0.78, tagH = ch * 0.46;
      var tx = px(p.x) - tagW / 2, ty = py(p.y) - tagH / 2;
      var g = GB.el('g', {});
      // 翻棋暗子无归属（p.side 缺省）→ 中性灰「军」背；明/暗棋按红蓝分色
      var hasSide = p.side === 1 || p.side === 2;
      g.appendChild(GB.el('rect', {
        x: tx, y: ty, width: tagW, height: tagH, rx: 6,
        fill: hasSide ? (isSide1 ? '#d32f2f' : '#1565c0') : '#616161',
        stroke: hasSide ? (isSide1 ? '#8e0000' : '#0d47a1') : '#37474f', 'stroke-width': '2',
      }));
      var label = p.hidden ? '军' : (RANK_NAMES[p.rank] || '?');
      var t = GB.el('text', {
        x: px(p.x), y: py(p.y) + 7, 'text-anchor': 'middle',
        'font-size': Math.min(17, tagH * 0.5), fill: '#fff', 'font-weight': 'bold',
        'pointer-events': 'none',
      });
      t.textContent = label;
      g.appendChild(t);
      svg.appendChild(g);
    });

    // 最后一手
    if (opts.lastMark !== false && state.lastMove) {
      svg.appendChild(GB.el('rect', {
        x: nx(state.lastMove.tx) + 2, y: ny(state.lastMove.ty) + 2,
        width: cw - 4, height: ch - 4, fill: 'none', stroke: '#ff5722', 'stroke-width': '3', rx: 4,
      }));
    }

    // 两段式：选中起点高亮
    if (opts.sel) {
      svg.appendChild(GB.el('rect', {
        x: nx(opts.sel.x) + 2, y: ny(opts.sel.y) + 2, width: cw - 4, height: ch - 4,
        fill: 'none', stroke: '#1a73e8', 'stroke-width': 4, rx: 6,
      }));
    }

    return { pad: pad, cw: cw, ch: ch, cols: W, rows: H, mode: 'cell' };
  }

  // ==================== 布阵生成器（明棋自摆阵，客户端本地排布） ====================

  var SPEC = [
    ['rank_commander', 1], ['rank_army', 1], ['rank_division', 2], ['rank_brigade', 2],
    ['rank_regiment', 2], ['rank_battalion', 2], ['rank_company', 3], ['rank_platoon', 3],
    ['rank_engineer', 3], ['rank_mine', 3], ['rank_bomb', 2], ['rank_flag', 1],
  ];

  function ownHalfCells(side) {
    var out = [];
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (side === 1 ? y < 6 : y > 5) continue;
      if (isCamp(x, y)) continue;
      out.push([x, y]);
    }
    return out;
  }

  /** 随机生成一套合法布阵（约束与服务端一致） */
  function genDeploy(side) {
    var cells = ownHalfCells(side).slice().sort(function (a, b) {
      return side === 1 ? b[1] - a[1] : a[1] - b[1];   // 从底线往外排，保证雷/旗落后排
    });
    var dens = DENS.filter(function (d) { return side === 1 ? d[1] === 11 : d[1] === 0; });
    var backRows = side === 1 ? [10, 11] : [0, 1];
    var frontRow = side === 1 ? 6 : 5;

    function pick(pred) {
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (pred(c)) { cells.splice(i, 1); return c; }
      }
      return null;
    }
    function inRows(c, rows) { return rows.indexOf(c[1]) >= 0; }

    var out = [];
    out.push({ x: dens[0][0], y: dens[0][1], rank: 'rank_flag' });
    var fi = cells.findIndex(function (c) { return c[0] === dens[0][0] && c[1] === dens[0][1]; });
    if (fi >= 0) cells.splice(fi, 1);   // 旗格从候选移除，否则后续子会重复布到同一格
    for (var i = 0; i < 3; i++) { var m = pick(function (c) { return inRows(c, backRows); }); if (m) out.push({ x: m[0], y: m[1], rank: 'rank_mine' }); }
    for (var j = 0; j < 2; j++) { var b = pick(function (c) { return c[1] !== frontRow; }); if (b) out.push({ x: b[0], y: b[1], rank: 'rank_bomb' }); }
    var rest = [];
    SPEC.forEach(function (s) {
      if (s[0] === 'rank_flag' || s[0] === 'rank_mine' || s[0] === 'rank_bomb') return;
      for (var k = 0; k < s[1]; k++) rest.push(s[0]);
    });
    rest.forEach(function (rank) { var c = pick(function () { return true; }); if (c) out.push({ x: c[0], y: c[1], rank: rank }); });
    return out;
  }

  /** 交换两格棋子；交换后任一格违反约束则拒绝（约束即时反馈=不可换） */
  function trySwap(side, pieces, ax, ay, bx, by) {
    function rankAt(x, y) {
      var p = pieces.filter(function (q) { return q.x === x && q.y === y; })[0];
      return p ? p.rank : null;
    }
    var ra = rankAt(ax, ay), rb = rankAt(bx, by);
    if (!ra || !rb) return null;
    function legal(x, y, rank) {
      if (rank === 'rank_flag') return DENS.some(function (d) { return d[0] === x && d[1] === y && (side === 1 ? d[1] === 11 : d[1] === 0); });
      if (rank === 'rank_mine') return side === 1 ? y >= 10 : y <= 1;
      if (rank === 'rank_bomb') return side === 1 ? y !== 6 : y !== 5;
      return true;
    }
    if (!legal(bx, by, ra) || !legal(ax, ay, rb)) return null;
    return pieces.map(function (q) {
      if (q.x === ax && q.y === ay) return { x: bx, y: by, rank: q.rank };
      if (q.x === bx && q.y === by) return { x: ax, y: ay, rank: q.rank };
      return q;
    });
  }

  window.ArmyChessBoard = { render: render, genDeploy: genDeploy, trySwap: trySwap };
})();
