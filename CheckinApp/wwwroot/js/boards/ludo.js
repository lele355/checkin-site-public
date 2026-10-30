// boards/ludo.js —— 飞行棋十字盘（中国飞行棋，§9.2 坐标表 = 渲染唯一事实源）。
// 15×15 网格 (col,row) 0-indexed；主环 52 格 color(i)=i%4；四角 6×6 机场；
// 每色 6 格终点航道汇入中央 3×3 终点区；虚线捷径入口→落点（+12）；
// ✈ 飞机棋子（F8）；movable 高亮由服务端快照直供（免两端各算一套）。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  var GRID = 15, CELL = 640 / GRID;

  // ---- §9.2 主环 52 格坐标表（顺时针） ----
  var RING = [
    [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
    [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
    [7, 0], [8, 0],
    [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
    [14, 7], [14, 8],
    [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
    [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
    [7, 14], [6, 14],
    [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    [0, 7], [0, 6],
  ];

  // 每色 6 格终点航道（h=0..5 → pos 52..57），中心 (7,7) = pos 58
  var RUNWAY = {
    1: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    2: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    3: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
    4: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  };
  var CENTER = [7, 7];

  // 四角 6×6 机场（区域左上角格）：红左上 / 黄右上 / 蓝右下 / 绿左下
  var AIRPORT = { 1: [0, 0], 2: [9, 0], 3: [9, 9], 4: [0, 9] };

  // 起点（0/13/26/39）与虚线捷径入口→落点（start+16 → start+28，+12）
  var START = { 1: 0, 2: 13, 3: 26, 4: 39 };
  var SHORTCUT = { 1: [16, 28], 2: [29, 41], 3: [42, 2], 4: [3, 15] };

  // color(i)=i%4：0 红 1 黄 2 蓝 3 绿；side k 的色号 = k−1（固定色不跟主题）
  var CELL_FILL = ['#ffcdd2', '#fff9c4', '#bbdefb', '#c8e6c9'];   // 主环浅色
  var RUN_FILL = ['#ef9a9a', '#fff59d', '#90caf9', '#a5d6a7'];   // 航道中色
  var FULL = ['#ef5350', '#ffee58', '#42a5f5', '#66bb6a'];       // 起点/机身
  var DARK = ['#c62828', '#f9a825', '#1565c0', '#2e7d32'];       // 描边/字

  function colorIdx(i) { return ((i % 4) + 4) % 4; }
  function sideIdx(side) { return ((side - 1) % 4 + 4) % 4; }
  function cx(col) { return (col + 0.5) * CELL; }
  function cy(row) { return (row + 0.5) * CELL; }

  // 上次 render 的飞机屏幕坐标（点击命中用）：[{p, side, x, y}]
  var planeXY = [];
  var mySide = 0;

  function planeCell(pos, side) {
    if (pos < 0) return null;
    if (pos < 52) return RING[pos];
    if (pos <= 57) return RUNWAY[side][pos - 52];
    return CENTER;   // 58 中心
  }

  /** 机场停机位（每机固定 2×2 格位，按机号 p 稳定分布） */
  function airportSlot(side, p) {
    var a = AIRPORT[side];
    return [a[0] + (p % 2 === 0 ? 1.5 : 4.5), a[1] + (p < 2 ? 1.5 : 4.5)];
  }

  function render(svg, state, opts) {
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 640 640');
    planeXY = [];
    opts = opts || {};
    var movable = opts.movable || state.movable || [];
    var myTurn = !!opts.myTurn;
    mySide = opts.mySide || 0;   // 高亮/命中只认己方机（movable 是本方机号集）

    svg.appendChild(GB.el('rect', { x: 0, y: 0, width: 640, height: 640, fill: '#e8f5e9', rx: 12 }));

    // ---- 四角机场 ----
    [1, 2, 3, 4].forEach(function (side) {
      var a = AIRPORT[side];
      var ci = sideIdx(side);
      svg.appendChild(GB.el('rect', {
        x: a[0] * CELL, y: a[1] * CELL, width: 6 * CELL, height: 6 * CELL,
        fill: FULL[ci], opacity: '0.16', rx: 14,
      }));
      svg.appendChild(GB.el('rect', {
        x: a[0] * CELL, y: a[1] * CELL, width: 6 * CELL, height: 6 * CELL,
        fill: 'none', stroke: DARK[ci], 'stroke-width': '2', rx: 14, opacity: '0.55',
      }));
      // 4 个停机位
      for (var p = 0; p < 4; p++) {
        var s = airportSlot(side, p);
        svg.appendChild(GB.el('circle', {
          cx: cx(s[0]), cy: cy(s[1]), r: CELL * 0.36,
          fill: '#ffffff', opacity: '0.5', stroke: DARK[ci], 'stroke-width': '1.2',
        }));
      }
    });

    // ---- 主环 52 格 ----
    for (var i = 0; i < 52; i++) {
      var g = RING[i];
      var ci2 = colorIdx(i);
      var isStart = i === START[1] || i === START[2] || i === START[3] || i === START[4];
      svg.appendChild(GB.el('rect', {
        x: g[0] * CELL + 2, y: g[1] * CELL + 2, width: CELL - 4, height: CELL - 4,
        fill: isStart ? FULL[ci2] : CELL_FILL[ci2],
        stroke: isStart ? DARK[ci2] : '#90a4ae', 'stroke-width': isStart ? '2.5' : '1.2', rx: 7,
      }));
    }

    // ---- 终点航道（每色 6 格） ----
    [1, 2, 3, 4].forEach(function (side) {
      var ci3 = sideIdx(side);
      for (var h = 0; h < 6; h++) {
        var r = RUNWAY[side][h];
        svg.appendChild(GB.el('rect', {
          x: r[0] * CELL + 2, y: r[1] * CELL + 2, width: CELL - 4, height: CELL - 4,
          fill: RUN_FILL[ci3], stroke: DARK[ci3], 'stroke-width': '1.2', rx: 7,
        }));
      }
    });

    // ---- 中央 3×3 终点区：四色箭头汇入中心 ----
    var zx = 6 * CELL, zy = 6 * CELL, zs = 3 * CELL;
    svg.appendChild(GB.el('rect', { x: zx, y: zy, width: zs, height: zs, fill: '#dcedc8', stroke: '#90a4ae', 'stroke-width': '1.5', rx: 10 }));
    var mx = cx(CENTER[0]), my = cy(CENTER[1]), q = zs / 2 - 4;
    // 左红 / 上黄 / 右蓝 / 下绿（与各自航道入口方向一致）
    svg.appendChild(GB.el('polygon', { points: (mx - q) + ',' + my + ' ' + mx + ',' + (my - q * 0.62) + ' ' + mx + ',' + (my + q * 0.62), fill: FULL[0], opacity: '0.85' }));
    svg.appendChild(GB.el('polygon', { points: mx + ',' + (my - q) + ' ' + (mx - q * 0.62) + ',' + my + ' ' + (mx + q * 0.62) + ',' + my, fill: FULL[1], opacity: '0.85' }));
    svg.appendChild(GB.el('polygon', { points: (mx + q) + ',' + my + ' ' + mx + ',' + (my - q * 0.62) + ' ' + mx + ',' + (my + q * 0.62), fill: FULL[2], opacity: '0.85' }));
    svg.appendChild(GB.el('polygon', { points: mx + ',' + (my + q) + ' ' + (mx - q * 0.62) + ',' + my + ' ' + (mx + q * 0.62) + ',' + my, fill: FULL[3], opacity: '0.85' }));

    // ---- 虚线捷径（每色入口 → 落点，+12） ----
    [1, 2, 3, 4].forEach(function (side) {
      var sc = SHORTCUT[side];
      var a2 = RING[sc[0]], b2 = RING[sc[1]];
      var ci4 = sideIdx(side);
      svg.appendChild(GB.el('line', {
        x1: cx(a2[0]), y1: cy(a2[1]), x2: cx(b2[0]), y2: cy(b2[1]),
        stroke: DARK[ci4], 'stroke-width': '3.5', 'stroke-dasharray': '10 8',
        opacity: '0.6', 'stroke-linecap': 'round',
      }));
      svg.appendChild(GB.el('circle', { cx: cx(a2[0]), cy: cy(a2[1]), r: 5, fill: DARK[ci4], opacity: '0.8' }));
    });

    // ---- 最近骰点（中央浮牌，位于终点区下层） ----
    if (state.lastRoll) {
      svg.appendChild(GB.el('rect', {
        x: mx - CELL * 0.62, y: my - CELL * 0.62, width: CELL * 1.24, height: CELL * 1.24,
        fill: '#ffffff', stroke: '#37474f', 'stroke-width': '2', rx: 10, opacity: '0.92',
      }));
      var dt = GB.el('text', {
        x: mx, y: my + CELL * 0.28, 'text-anchor': 'middle',
        'font-size': String(CELL * 0.72), fill: '#37474f', 'font-weight': 'bold',
      });
      dt.textContent = String(state.lastRoll);
      svg.appendChild(dt);
    }

    // ---- ✈ 飞机（同格错开半格；movable 高亮） ----
    var stacked = {};
    (state.pieces || []).forEach(function (p) {
      if (p.side < 1 || p.side > 4) return;
      var ci5 = sideIdx(p.side);
      var sx, sy;
      if (p.pos < 0) {
        var slot = airportSlot(p.side, p.p);
        sx = cx(slot[0]); sy = cy(slot[1]);
      } else {
        var cell = planeCell(p.pos, p.side);
        if (!cell) return;
        var key = cell[0] + ',' + cell[1];
        var k = stacked[key] || 0;
        stacked[key] = k + 1;
        sx = cx(cell[0]) + ((k % 2) - 0.5) * CELL * 0.34;
        sy = cy(cell[1]) + ((Math.floor(k / 2) % 2) - 0.5) * CELL * 0.34;
      }
      var isMovable = myTurn && p.side === mySide && movable.indexOf(p.p) >= 0;
      if (isMovable) {
        svg.appendChild(GB.el('circle', {
          cx: sx, cy: sy, r: CELL * 0.46, fill: 'none',
          stroke: '#f57c00', 'stroke-width': '3.5',
        }));
      }
      svg.appendChild(GB.el('circle', {
        cx: sx, cy: sy, r: CELL * 0.32, fill: FULL[ci5], stroke: DARK[ci5], 'stroke-width': '2',
      }));
      var gt = GB.el('text', {
        x: sx, y: sy + CELL * 0.13, 'text-anchor': 'middle',
        'font-size': String(CELL * 0.42), fill: '#ffffff', 'font-weight': 'bold',
      });
      gt.textContent = '✈';
      svg.appendChild(gt);
      planeXY.push({ p: p.p, side: p.side, x: sx, y: sy });
    });

    return { pad: 0, cw: CELL, ch: CELL, cols: GRID, rows: GRID, mode: 'cell' };
  }

  /** 点击命中：返回最近的己方飞机机号（阈值内），否则 -1 */
  function pieceAt(x, y) {
    var best = -1, bestD = CELL * 0.62;
    for (var i = 0; i < planeXY.length; i++) {
      if (planeXY[i].side !== mySide) continue;
      var d = Math.abs(planeXY[i].x - x) + Math.abs(planeXY[i].y - y);
      if (d < bestD) { bestD = d; best = planeXY[i].p; }
    }
    return best;
  }

  window.LudoBoard = {
    render: render,
    pieceAt: pieceAt,
    // 飞行棋走子 = 点飞机（games.js ludo 分支用 pieceAt），不走网格换算
    onTap: function () { },
  };
})();
