// boards/ludo.js —— 飞行棋盘 v5【推倒重来版 2026-10-31】。
// 按站主参考（metool.online 飞行棋）重建视觉：
//   浅灰底 + 低饱和哑光四色圆角格（格心白点）+ 2×2 白圆盘机场（本色飞机）
//   + 中心白色圆角块（四色三角汇聚）+ 4 条彩色虚线捷径航线（箭头指示飞越方向）。
// 去掉旧版所有补丁元素：字母格 / 加油站 / 环道箭头 / 跳格标记 —— metool 一概没有。
// 坐标拓扑 = 52 环 + 4×6 航道（与 LudoRules.cs 规则事实同源，规则层不动）。
// 与 App LudoBoard.kt 同源同参。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  var GRID = 15, CELL = 640 / GRID;

  // ---- 拓扑：主环 52 格坐标表（顺时针，与 LudoRules.cs 同源） ----
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

  // 四角 6×6 机场（区域左上角格）：1 红左上 / 2 黄右上 / 3 蓝右下 / 4 绿左下
  var AIRPORT = { 1: [0, 0], 2: [9, 0], 3: [9, 9], 4: [0, 9] };

  // 起点 0/13/26/39；捷径入口→落点（start+16 → start+28，+12）
  var START = { 1: 0, 2: 13, 3: 26, 4: 39 };
  var SHORTCUT = { 1: [16, 28], 2: [29, 41], 3: [42, 2], 4: [3, 15] };
  var HOME_ENTRY = { 1: 50, 2: 11, 3: 24, 4: 37 };

  // ---- metool 低饱和哑光配色（参考图采样）：1 红 / 2 黄 / 3 蓝 / 4 绿 ----
  var BG = '#FAFAFA';
  var SEAM = '#E4E4E4';
  var SIDE_FILL = { 1: '#A94841', 2: '#D9CF52', 3: '#3780A0', 4: '#388B5D' };
  var SIDE_DARK = { 1: '#8A3832', 2: '#B5AC3E', 3: '#2B6782', 4: '#2C6E49' };
  var RING_SEQ = [1, 2, 3, 4];   // 环道色序 i%4 → 红/黄/蓝/绿（与规则 ColorOfCell 同口径）

  function sideFill(side) { return SIDE_FILL[side] || '#999'; }
  function cx(col) { return (col + 0.5) * CELL; }
  function cy(row) { return (row + 0.5) * CELL; }

  // 环道第 i 格归属色：四色循环（同色格间隔恰 4 = 跳 +4 的视觉语义）
  function ringSide(i) { return RING_SEQ[((i % 4) + 4) % 4]; }

  // 机形素材（自绘俯视剪影；按归属色取变体）
  var PLANE_SRC = { 1: 'airplane-red', 2: 'airplane-yellow', 3: 'airplane-blue', 4: 'airplane-green' };

  /** 俯视飞机（机头朝 -Y；angle=0 表示机头朝 +X → 旋转补 +90°） */
  function addPlane(parent, px, py, size, angle, side, opts) {
    opts = opts || {};
    var s = size * 2.45;
    var deg = angle * 180 / Math.PI + 90;
    var el = GB.el('image', {
      href: '/pieces/ludo/' + (opts.white ? 'airplane-white' : (PLANE_SRC[side] || 'airplane')) + '.svg',
      x: (px - s / 2).toFixed(1), y: (py - s / 2).toFixed(1),
      width: s.toFixed(1), height: s.toFixed(1),
      transform: 'rotate(' + deg.toFixed(1) + ' ' + px.toFixed(1) + ' ' + py.toFixed(1) + ')',
      'pointer-events': 'none',
    });
    if (opts.opacity) el.setAttribute('opacity', String(opts.opacity));
    parent.appendChild(el);
    return el;
  }

  /** 实心三角箭头（尖端朝 angle） */
  function addArrow(parent, px, py, size, angle, fill, stroke) {
    var ca = Math.cos(angle), sa = Math.sin(angle);
    var pts = [[0.6, 0], [-0.42, 0.44], [-0.42, -0.44]];
    var d = '';
    for (var i = 0; i < 3; i++) {
      var x = pts[i][0], y = pts[i][1];
      d += (i ? 'L' : 'M') + (px + (x * ca - y * sa) * size).toFixed(1) + ',' +
        (py + (x * sa + y * ca) * size).toFixed(1);
    }
    var attrs = { d: d + 'Z', fill: fill };
    if (stroke) { attrs.stroke = stroke; attrs['stroke-width'] = '1'; attrs['stroke-linejoin'] = 'round'; }
    var el = GB.el('path', attrs);
    parent.appendChild(el);
    return el;
  }

  function addText(parent, px, py, txt, size, fill, weight) {
    var el = GB.el('text', {
      x: px, y: py, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': String(size), fill: fill, 'font-weight': weight || '700',
      'font-family': 'inherit', 'pointer-events': 'none',
    });
    el.textContent = txt;
    parent.appendChild(el);
    return el;
  }

  var planeXY = [];
  var mySide = 0;

  function planeCell(pos, side) {
    if (pos < 0) return null;
    if (pos < 52) return RING[pos];
    if (pos <= 57) return RUNWAY[side][pos - 52];
    return CENTER;
  }

  /** 机场停机位：2×2，圆心在块内 1.85 / 4.15 格处（白圆盘中心） */
  function airportSlot(side, p) {
    var a = AIRPORT[side];
    return [a[0] + 1.85 + (p % 2 === 0 ? 0 : 2.3), a[1] + 1.85 + (p < 2 ? 0 : 2.3)];
  }

  function ringAngle(i) {
    var a = RING[i], b = RING[(i + 1) % 52];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  function render(svg, state, opts) {
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 640 640');
    planeXY = [];
    opts = opts || {};
    var movable = opts.movable || state.movable || [];
    var myTurn = !!opts.myTurn;
    mySide = opts.mySide || 0;

    // ---- 底：浅灰白 + 细灰外框（metool 外框观感） ----
    svg.appendChild(GB.el('rect', { x: 3, y: 3, width: 634, height: 634, fill: BG, stroke: SEAM, 'stroke-width': '2' }));

    // ---- 四角机场：2×2 白圆盘（本色环）+ 本色飞机，盘间小圆点装饰 ----
    [1, 2, 3, 4].forEach(function (side) {
      var a = AIRPORT[side];
      var x0 = a[0] * CELL, y0 = a[1] * CELL;
      // 机场底衬：本色淡色圆角块（区隔机场区）
      svg.appendChild(GB.el('rect', {
        x: x0 + CELL * 0.55, y: y0 + CELL * 0.55,
        width: CELL * 4.9, height: CELL * 4.9,
        fill: sideFill(side), opacity: '0.22', rx: 10,
      }));
      // 盘间小点装饰（白点，metool 机场观感）
      [[1.05, 1.05], [4.95, 1.05], [1.05, 4.95], [4.95, 4.95], [3, 3]].forEach(function (q) {
        svg.appendChild(GB.el('circle', {
          cx: (a[0] + q[0]) * CELL, cy: (a[1] + q[1]) * CELL, r: CELL * 0.12, fill: '#ffffff',
        }));
      });
      // 4 个白圆盘停机位 + 本色飞机
      for (var p = 0; p < 4; p++) {
        var s = airportSlot(side, p);
        svg.appendChild(GB.el('circle', {
          cx: cx(s[0]), cy: cy(s[1]), r: CELL * 0.92,
          fill: '#ffffff', stroke: sideFill(side), 'stroke-width': '3',
        }));
        addPlane(svg, cx(s[0]), cy(s[1]), CELL * 0.62, 0, side, {});
      }
    });

    // ---- 主环 52 格：圆角彩色格 + 格心白点（metool 格式；四色循环 = 同色跳语义） ----
    for (var i = 0; i < 52; i++) {
      var g = RING[i];
      var sd = ringSide(i);
      var isStart = i === START[1] || i === START[2] || i === START[3] || i === START[4];
      svg.appendChild(GB.el('rect', {
        x: g[0] * CELL + 1.5, y: g[1] * CELL + 1.5, width: CELL - 3, height: CELL - 3,
        fill: sideFill(sd), rx: 7,
      }));
      if (isStart) {
        // 起飞格：深灰小飞机（机头朝行进方向；白色在黄格上对比不足，side=0 取中性机形）
        addPlane(svg, cx(g[0]), cy(g[1]), CELL * 0.3, ringAngle(i), 0, {});
      } else {
        svg.appendChild(GB.el('circle', {
          cx: cx(g[0]), cy: cy(g[1]), r: CELL * 0.26, fill: '#ffffff',
        }));
      }
    }

    // ---- 终点航道：本色圆角格 + 白点（h=0..5） ----
    [1, 2, 3, 4].forEach(function (side) {
      for (var h = 0; h < 6; h++) {
        var r = RUNWAY[side][h];
        svg.appendChild(GB.el('rect', {
          x: r[0] * CELL + 1.5, y: r[1] * CELL + 1.5, width: CELL - 3, height: CELL - 3,
          fill: sideFill(side), rx: 7,
        }));
        svg.appendChild(GB.el('circle', {
          cx: cx(r[0]), cy: cy(r[1]), r: CELL * 0.26, fill: '#ffffff',
        }));
      }
    });

    // ---- 中心：白色圆角块 + 四色三角汇聚 + 红点 ----
    var mx3 = cx(CENTER[0]), my3 = cy(CENTER[1]);
    var z = 3 * CELL;
    var zx = 6 * CELL, zy = 6 * CELL;
    [
      [2, zx, zy, zx + z, zy],               // 上（黄方航道口）
      [4, zx, zy + z, zx + z, zy + z],       // 下（绿方航道口）
      [1, zx, zy, zx, zy + z],               // 左（红方航道口）
      [3, zx + z, zy, zx + z, zy + z],       // 右（蓝方航道口）
    ].forEach(function (t) {
      svg.appendChild(GB.el('polygon', {
        points: t[1] + ',' + t[2] + ' ' + t[3] + ',' + t[4] + ' ' + mx3 + ',' + my3,
        fill: sideFill(t[0]), opacity: '0.9',
      }));
    });
    // 白色圆角块（metool 中心观感：干净白块）+ 红点
    svg.appendChild(GB.el('rect', {
      x: mx3 - CELL * 0.95, y: my3 - CELL * 0.95, width: CELL * 1.9, height: CELL * 1.9,
      fill: '#ffffff', stroke: SEAM, 'stroke-width': '2', rx: CELL * 0.34,
    }));
    svg.appendChild(GB.el('circle', { cx: mx3, cy: my3, r: CELL * 0.26, fill: SIDE_FILL[1] }));

    // ---- 4 条彩色虚线捷径航线（入口 → 落点，箭头指示飞越方向） ----
    [1, 2, 3, 4].forEach(function (side) {
      var sc = SHORTCUT[side];
      var from = RING[sc[0]], to = RING[sc[1]];
      var x1 = cx(from[0]), y1 = cy(from[1]), x2 = cx(to[0]), y2 = cy(to[1]);
      // 控制点向盘心收拢，弧线沿对角掠过中心块外缘
      var mx2 = (x1 + x2) / 2, my2 = (y1 + y2) / 2;
      var cxm = 320 + (mx2 - 320) * 0.3, cym = 320 + (my2 - 320) * 0.3;
      svg.appendChild(GB.el('path', {
        d: 'M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' Q' + cxm.toFixed(1) + ',' + cym.toFixed(1) +
          ' ' + x2.toFixed(1) + ',' + y2.toFixed(1),
        stroke: sideFill(side), 'stroke-width': '3', 'stroke-dasharray': '8 7',
        'stroke-linecap': 'round', fill: 'none', opacity: '0.85',
      }));
      var a2 = Math.atan2(y2 - cym, x2 - cxm);
      addArrow(svg, x2 - Math.cos(a2) * CELL * 0.42, y2 - Math.sin(a2) * CELL * 0.42, CELL * 0.2, a2, sideFill(side), '#ffffff');
    });

    // ---- 最近骰点：中心白块右上小徽标 ----
    if (state.lastRoll) {
      var dx0 = mx3 + CELL * 1.5, dy0 = my3 - CELL * 1.45;
      svg.appendChild(GB.el('rect', {
        x: dx0 - CELL * 0.36, y: dy0 - CELL * 0.36, width: CELL * 0.72, height: CELL * 0.72,
        fill: '#ffffff', stroke: SEAM, 'stroke-width': '2', rx: CELL * 0.16,
      }));
      addText(svg, dx0, dy0, String(state.lastRoll), CELL * 0.42, '#555555', '800');
    }

    // ---- 飞机棋子（同格错开；可走的我方机加橙色圈） ----
    var stacked = {};
    (state.pieces || []).forEach(function (p) {
      if (p.side < 1 || p.side > 4) return;
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
          cx: sx, cy: sy, r: CELL * 0.52, fill: 'none', stroke: '#f57c00', 'stroke-width': '3.5',
        }));
      }
      var pieceAngle;
      if (p.pos < 0) pieceAngle = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][p.side - 1];
      else if (p.pos < 52) pieceAngle = ringAngle(p.pos);
      else pieceAngle = Math.atan2(cy(CENTER[1]) - sy, cx(CENTER[0]) - sx);
      addPlane(svg, sx, sy, CELL * 0.52, pieceAngle, p.side, {});
      planeXY.push({ p: p.p, side: p.side, x: sx, y: sy });
    });

    return { pad: 0, cw: CELL, ch: CELL, cols: GRID, rows: GRID, mode: 'cell' };
  }

  /** 点击命中：返回最近的己方飞机机号（阈值内），否则 -1 */
  function pieceAt(x, y) {
    var best = -1, bestD = CELL * 0.66;
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
    onTap: function () { },
  };
})();
