// boards/ludo.js —— 飞行棋十字盘（中国飞行棋，§9 坐标表 = 渲染唯一事实源）。
// 15×15 网格 (col,row) 0-indexed；主环 52 格 color(i)=i%4；四角 6×6 机场；
// 每色 6 格终点航道汇入中央 3×3 终点区；虚线捷径入口→落点（+12，绿 3→15 以公式为准）；
// 飞机棋子为路径剪影（禁 ✈ 字符）；movable 高亮由服务端快照直供（免两端各算一套）。
// 视觉规格：2026-10-31-ludo-layout-spec.md §3/§5/§6/§7/§8/§12（与 App LudoBoard.kt 同源）。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  var GRID = 15, CELL = 640 / GRID;

  // ---- §2.2 主环 52 格坐标表（顺时针） ----
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

  // 起点 0/13/26/39；虚线捷径入口→落点（start+16 → start+28，+12）：
  // 红 16→28 / 黄 29→41 / 蓝 42→2 / 绿 3→15（§7.2 表绿「51」系笔误，以公式与 §6.2 为准）
  var START = { 1: 0, 2: 13, 3: 26, 4: 39 };
  var SHORTCUT = { 1: [16, 28], 2: [29, 41], 3: [42, 2], 4: [3, 15] };

  // §6.2 跳 +4 标记 8 处（捷径前跳 = 入口−4；捷径后跳 = 捷径落点）
  var JUMP_MARK = [12, 28, 25, 41, 38, 2, 51, 15];

  // §5.3 HomeEntry（转入跑道的转角格）→ 转弯箭头指向跑道（向中心）
  var HOME_ENTRY = { 1: 50, 2: 11, 3: 24, 4: 37 };

  // color(i)=i%4：0 红 1 黄 2 蓝 3 绿；side k 的色号 = k−1（固定色不跟主题，红线 18）
  var RING_FILL = ['#ef5350', '#ffee58', '#42a5f5', '#66bb6a'];   // 环道中等色（§12-1）
  var FULL = ['#e53935', '#fdd835', '#1e88e5', '#43a047'];       // 跑道/机场/起点全饱和（§12-1）
  var DARK = ['#c62828', '#f9a825', '#1565c0', '#2e7d32'];       // 描边/深色

  function colorIdx(i) { return ((i % 4) + 4) % 4; }
  function sideIdx(side) { return ((side - 1) % 4 + 4) % 4; }
  function cx(col) { return (col + 0.5) * CELL; }
  function cy(row) { return (row + 0.5) * CELL; }

  // 机形素材（icons-ready 同源）：按填充色取色套变体；白=跳标白机，未知色=中性深色
  var PLANE_SRC = (function () {
    var m = {
      '#ffffff': 'airplane-white', '#fff': 'airplane-white',
      '#e53935': 'airplane-red', '#c62828': 'airplane-red',
      '#fdd835': 'airplane-yellow', '#f9a825': 'airplane-yellow',
      '#1e88e5': 'airplane-blue', '#1565c0': 'airplane-blue',
      '#43a047': 'airplane-green', '#2e7d32': 'airplane-green',
    };
    return function (fill) { return m[String(fill || '').toLowerCase()] || 'airplane'; };
  })();

  /** 机形图标（自绘俯视剪影，CC0，站主决策换俯视；stroke 参数保签名兼容，色套变体自带描边光晕）。
   *  素材机头朝 -Y，调用方 angle=0 表示机头朝 +X —— 旋转补 +90° 对齐语义（与旧 PLANE_POLY 同规）。 */
  function addPlane(parent, px, py, size, angle, fill, stroke, sw) {
    var s = size * 2.45;   // 俯视剪影约占图标 81%，换算到与旧 path 同视觉尺寸
    var deg = angle * 180 / Math.PI + 90;
    var el = GB.el('image', {
      href: '/pieces/ludo/' + PLANE_SRC(fill) + '.svg',
      x: (px - s / 2).toFixed(1), y: (py - s / 2).toFixed(1),
      width: s.toFixed(1), height: s.toFixed(1),
      transform: 'rotate(' + deg.toFixed(1) + ' ' + px.toFixed(1) + ' ' + py.toFixed(1) + ')',
      'pointer-events': 'none',
    });
    parent.appendChild(el);
    return el;
  }
  // 实心三角箭头（尖端朝 angle）
  function addArrow(parent, px, py, size, angle, fill, stroke) {
    var ca = Math.cos(angle), sa = Math.sin(angle);
    var pts = [[0.6, 0], [-0.42, 0.44], [-0.42, -0.44]];
    var d = '';
    for (var i = 0; i < 3; i++) {
      var x = pts[i][0], y = pts[i][1];
      var rx = px + (x * ca - y * sa) * size;
      var ry = py + (x * sa + y * ca) * size;
      d += (i ? 'L' : 'M') + rx.toFixed(1) + ',' + ry.toFixed(1);
    }
    var attrs = { d: d + 'Z', fill: fill };
    if (stroke) { attrs.stroke = stroke; attrs['stroke-width'] = '1'; attrs['stroke-linejoin'] = 'round'; }
    var el = GB.el('path', attrs);
    parent.appendChild(el);
    return el;
  }

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

  /** 环道行进角（弧度）：idx → idx+1 的方向 */
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
    mySide = opts.mySide || 0;   // 高亮/命中只认己方机（movable 是本方机号集）

    svg.appendChild(GB.el('rect', { x: 0, y: 0, width: 640, height: 640, fill: '#e8f5e9', rx: 12 }));

    // ---- 四角机场（§3.2 粗彩边框 + 本色底 + 停机位飞机剪影 + 中央大飞机） ----
    [1, 2, 3, 4].forEach(function (side) {
      var a = AIRPORT[side];
      var ci = sideIdx(side);
      // 停机位飞机朝本方起飞口方向（红南 / 黄西 / 蓝北 / 绿东）
      var padAngle = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][ci];
      // 十字轮廓（参考图实测）：块与臂之间留白缺口（向心两侧边内缩）+ 内角 45° 斜切
      var g = 0.15 * CELL;
      var ins = [[0, 0, 1, 1], [1, 0, 0, 1], [1, 1, 0, 0], [0, 1, 1, 0]][side - 1];
      var x0 = a[0] * CELL + ins[0] * g, y0 = a[1] * CELL + ins[1] * g;
      var x1 = (a[0] + 6) * CELL - ins[2] * g, y1 = (a[1] + 6) * CELL - ins[3] * g;
      svg.appendChild(GB.el('rect', {
        x: x0, y: y0, width: x1 - x0, height: y1 - y0,
        fill: FULL[ci], rx: 14,
      }));
      svg.appendChild(GB.el('rect', {
        x: x0, y: y0, width: x1 - x0, height: y1 - y0,
        fill: 'none', stroke: DARK[ci], 'stroke-width': '2', rx: 14,
      }));
      // 内角斜切：底板色三角切掉块内角（避开停机位）
      var ncx = ins[0] ? x0 : x1, ncy = ins[1] ? y0 : y1;
      var dx = ins[0] ? 1 : -1, dy = ins[1] ? 1 : -1, L = 1.25 * CELL;
      svg.appendChild(GB.el('polygon', {
        points: ncx + ',' + ncy + ' ' + (ncx + dx * L) + ',' + ncy + ' ' + ncx + ',' + (ncy + dy * L),
        fill: '#e8f5e9',
      }));
      // 中央大号半透明飞机（§12-5 参考图有）
      var ghost = addPlane(svg, cx(a[0] + 3), cy(a[1] + 3), CELL * 1.15, padAngle, DARK[ci], null, 0);
      ghost.setAttribute('opacity', '0.28');
      // 4 个停机位：白圆 + 本色飞机剪影
      for (var p = 0; p < 4; p++) {
        var s = airportSlot(side, p);
        svg.appendChild(GB.el('circle', {
          cx: cx(s[0]), cy: cy(s[1]), r: CELL * 0.36,
          fill: '#ffffff', stroke: DARK[ci], 'stroke-width': '1.4',
        }));
        addPlane(svg, cx(s[0]), cy(s[1]), CELL * 0.26, padAngle, FULL[ci], DARK[ci], 1);
      }
      // 盘外角落装饰飞机（参考图：机场块外缘角落 2-3 架小飞机，朝外，不挤占停机位）
      // 坐标为网格浮点（边坐标系）：像素 = 格值 × CELL
      var deco = {
        1: [[0.62, 0.62, -3 * Math.PI / 4], [3, 0.52, -Math.PI / 2], [0.52, 3, Math.PI]],
        2: [[14.38, 0.62, -Math.PI / 4], [12, 0.52, -Math.PI / 2], [14.48, 3, 0]],
        3: [[14.38, 14.38, Math.PI / 4], [12, 14.48, Math.PI / 2], [14.48, 12, 0]],
        4: [[0.62, 14.38, 3 * Math.PI / 4], [3, 14.48, Math.PI / 2], [0.52, 12, Math.PI]],
      }[side];
      deco.forEach(function (d) {
        addPlane(svg, d[0] * CELL, d[1] * CELL, CELL * 0.3, d[2], DARK[ci], null, 0).setAttribute('opacity', '0.85');
      });
    });

    // ---- 主环 52 格（中等色 + 白圈，§12-1/§12-2） ----
    for (var i = 0; i < 52; i++) {
      var g = RING[i];
      var ci2 = colorIdx(i);
      var isStart = i === START[1] || i === START[2] || i === START[3] || i === START[4];
      svg.appendChild(GB.el('rect', {
        x: g[0] * CELL + 2, y: g[1] * CELL + 2, width: CELL - 4, height: CELL - 4,
        fill: isStart ? FULL[ci2] : RING_FILL[ci2],
        stroke: isStart ? DARK[ci2] : '#78909c', 'stroke-width': isStart ? '2.5' : '1', rx: 7,
      }));
      svg.appendChild(GB.el('circle', {
        cx: cx(g[0]), cy: cy(g[1]), r: CELL * 0.3, fill: '#ffffff',
      }));
    }

    // ---- 终点航道（每色 6 格，全饱和 + 白圈，§5.2） ----
    // h=5 末端格压在中心三角下层：先不画，三角之后只补白圈（参考图：白圈浮于色块）
    [1, 2, 3, 4].forEach(function (side) {
      var ci3 = sideIdx(side);
      for (var h = 0; h < 5; h++) {
        var r = RUNWAY[side][h];
        svg.appendChild(GB.el('rect', {
          x: r[0] * CELL + 2, y: r[1] * CELL + 2, width: CELL - 4, height: CELL - 4,
          fill: FULL[ci3], stroke: DARK[ci3], 'stroke-width': '1', rx: 7,
        }));
        svg.appendChild(GB.el('circle', {
          cx: cx(r[0]), cy: cy(r[1]), r: CELL * 0.3, fill: '#ffffff',
        }));
      }
    });

    // ---- 跳 +4 标记（§6.2 共 8 处：本色圆圈 + 白飞机剪影，机头朝行进方向） ----
    JUMP_MARK.forEach(function (idx) {
      var g2 = RING[idx];
      var ci4 = colorIdx(idx);
      svg.appendChild(GB.el('circle', {
        cx: cx(g2[0]), cy: cy(g2[1]), r: CELL * 0.32,
        fill: FULL[ci4], stroke: DARK[ci4], 'stroke-width': '2',
      }));
      addPlane(svg, cx(g2[0]), cy(g2[1]), CELL * 0.22, ringAngle(idx), '#ffffff', null, 0);
    });

    // ---- 起飞口标记（§4.3：深色飞机剪影，机头朝行进方向；中性深色素材保对比） ----
    [1, 2, 3, 4].forEach(function (side) {
      var idx = START[side];
      var g3 = RING[idx];
      addPlane(svg, cx(g3[0]), cy(g3[1]), CELL * 0.24, ringAngle(idx), '#4E342E', null, 0);
    });

    // ---- 虚线捷径航线（§7.3 两段折线穿中心区附近，画在中心区下层） ----
    [1, 2, 3, 4].forEach(function (side) {
      var sc = SHORTCUT[side];
      var a2 = RING[sc[0]], b2 = RING[sc[1]];
      var ci5 = sideIdx(side);
      // 白色衬线 + 本色虚线（在彩色格上也可读），线整体画在中心区之下
      var bendX = cx(CENTER[0]) + (cx(a2[0]) - cx(CENTER[0])) * 0.42 + (cx(b2[0]) - cx(CENTER[0])) * 0.42;
      var bendY = cy(CENTER[1]) + (cy(a2[1]) - cy(CENTER[1])) * 0.42 + (cy(b2[1]) - cy(CENTER[1])) * 0.42;
      var lineD = 'M' + cx(a2[0]) + ',' + cy(a2[1]) + 'L' + bendX.toFixed(1) + ',' + bendY.toFixed(1) +
        'L' + cx(b2[0]) + ',' + cy(b2[1]);
      svg.appendChild(GB.el('path', {
        d: lineD, stroke: '#ffffff', 'stroke-width': '6.5', 'stroke-linecap': 'round',
        'stroke-linejoin': 'round', fill: 'none', opacity: '0.55',
      }));
      svg.appendChild(GB.el('path', {
        d: lineD,
        stroke: DARK[ci5], 'stroke-width': '3.5', 'stroke-dasharray': '10 8',
        opacity: '0.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none',
      }));
    });

    // ---- 中央终点区：带 V 缺口的四箭头三角拼风车（参考图实测，画在虚线上层）----
    // 尖端汇聚中心 ★；平边=中心区四边（缩进 0.38 格，四角留白成 V 缺口）；
    // 跑道臂从平边中央穿出（臂两侧肩阶）；跑道末端白圈浮于色块之上。
    var zx = 6 * CELL, zy = 6 * CELL, zs = 3 * CELL;
    var mx = cx(CENTER[0]), my = cy(CENTER[1]);
    var ins = 0.38 * CELL;
    [
      [FULL[0], zx, zy + ins, zx, zy + zs - ins],                 // 左红
      [FULL[1], zx + ins, zy, zx + zs - ins, zy],                 // 上黄
      [FULL[2], zx + zs, zy + ins, zx + zs, zy + zs - ins],       // 右蓝
      [FULL[3], zx + ins, zy + zs, zx + zs - ins, zy + zs],       // 下绿
    ].forEach(function (t) {
      svg.appendChild(GB.el('polygon', {
        points: t[1] + ',' + t[2] + ' ' + t[3] + ',' + t[4] + ' ' + mx + ',' + my,
        fill: t[0],
      }));
    });
    // 跑道末端白圈叠在三角上
    [[6, 7], [7, 6], [8, 7], [7, 8]].forEach(function (c) {
      svg.appendChild(GB.el('circle', { cx: cx(c[0]), cy: cy(c[1]), r: CELL * 0.3, fill: '#ffffff' }));
    });
    // 中心 ★：参考图四尖汇点无星（像素取证：四色直接相接），不绘制标记

    // ---- 虚线入口/落点标记（§7.3）：入口飞机+方向箭头，落点虚线目标圈 ----
    [1, 2, 3, 4].forEach(function (side) {
      var sc2 = SHORTCUT[side];
      var a3 = RING[sc2[0]], b3 = RING[sc2[1]];
      var ci6 = sideIdx(side);
      var fa = Math.atan2(cy(b3[1]) - cy(a3[1]), cx(b3[0]) - cx(a3[0]));   // 飞行方向
      addPlane(svg, cx(a3[0]), cy(a3[1]), CELL * 0.26, fa, FULL[ci6], DARK[ci6], 1.2);
      addArrow(svg, cx(a3[0]) + Math.cos(fa) * CELL * 0.62, cy(a3[1]) + Math.sin(fa) * CELL * 0.62, CELL * 0.18, fa, DARK[ci6], null);
      svg.appendChild(GB.el('circle', {
        cx: cx(b3[0]), cy: cy(b3[1]), r: CELL * 0.42, fill: 'none',
        stroke: DARK[ci6], 'stroke-width': '1.5', 'stroke-dasharray': '4 4', opacity: '0.8',
      }));
    });

    // ---- 环道方向箭头（顺时针 4 处）：彩色实心画在块内角斜切缺口（白缺口+彩箭头，参考图观感） ----
    var dirArrows = [
      [5.55, 5.55, 0, 0], [9.45, 5.55, Math.PI / 2, 1], [9.45, 9.45, Math.PI, 2], [5.55, 9.45, -Math.PI / 2, 3],
    ];
    dirArrows.forEach(function (da) {
      addArrow(svg, da[0] * CELL, da[1] * CELL, CELL * 0.42, da[2], FULL[da[3]], '#ffffff');
    });

    // ---- HomeEntry 转弯箭头（§8.2 指向跑道方向，本色实心） ----
    [1, 2, 3, 4].forEach(function (side) {
      var he = RING[HOME_ENTRY[side]];
      var ci7 = sideIdx(side);
      // 跑道方向 = 朝中心
      var ha = Math.atan2(cy(CENTER[1]) - cy(he[1]), cx(CENTER[0]) - cx(he[0]));
      addArrow(svg, cx(he[0]), cy(he[1]), CELL * 0.42, ha, FULL[ci7], '#ffffff');
    });

    // ---- 最近骰点（中央浮牌，位于终点区上层、棋子下层） ----
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

    // ---- 飞机棋子（路径剪影，同格错开半格；movable 高亮，§12-5 禁 ✈ 字符） ----
    var stacked = {};
    (state.pieces || []).forEach(function (p) {
      if (p.side < 1 || p.side > 4) return;
      var ci8 = sideIdx(p.side);
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
      // 棋子机头朝行进方向：机场=朝起飞口，主环=顺时针，航道/中心=朝中心
      var pieceAngle;
      if (p.pos < 0) pieceAngle = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][ci8];
      else if (p.pos < 52) pieceAngle = ringAngle(p.pos);
      else pieceAngle = Math.atan2(cy(CENTER[1]) - sy, cx(CENTER[0]) - sx);
      addPlane(svg, sx, sy, CELL * 0.34, pieceAngle, FULL[ci8], DARK[ci8], 1.6);
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
