// boards/jungle.js — 斗兽棋棋盘：7×9 格子 + 特殊格（河/陷阱/兽穴）+ 8 种兽。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  var W = 7, H = 9;
  // 特殊格布局（与服务端 JungleRules.CellType 一致）
  var WATER = [[1,3],[2,3],[4,3],[5,3],[1,4],[2,4],[4,4],[5,4],[1,5],[2,5],[4,5],[5,5]];
  var TRAP = [[2,0],[4,0],[3,1],[2,8],[4,8],[3,7]];
  var DEN = [[3,0],[3,8]];

  // 兽名
  var RANKS = ['','鼠','猫','狗','狼','豹','虎','狮','象'];

  function isWater(x, y) { return WATER.some(function (p) { return p[0] === x && p[1] === y; }); }
  function isTrap(x, y) { return TRAP.some(function (p) { return p[0] === x && p[1] === y; }); }
  function isDen(x, y) { return DEN.some(function (p) { return p[0] === x && p[1] === y; }); }

  function render(svg, state, opts) {
    var geom = GB.gridGeom(W, opts.showCoord ? 30 : 15, opts.showCoord);
    // 高度需要按 H/W 调整（7×9 不是正方形）
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 ' + 640 + ' ' + (640 * H / W));

    var cellW = geom.cell;
    var cellH = geom.cell * W / H * (H / W); // 保持比例
    // 重新计算：以宽 640 为基准，高 = 640 * H / W
    var totalH = 640 * H / W;
    var pad = geom.pad;
    var cw = (640 - pad * 2) / W;
    var ch = (totalH - pad * 2) / H;

    function px(x) { return pad + x * cw + cw / 2; }
    function py(y) { return pad + y * ch + ch / 2; }

    // 背景
    svg.appendChild(GB.el('rect', { x: 0, y: 0, width: 640, height: totalH, fill: '#f5e6c8', rx: 8 }));

    // 特殊格
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var cx = pad + x * cw, cy = pad + y * ch;
        if (isWater(x, y)) {
          svg.appendChild(GB.el('rect', { x: cx, y: cy, width: cw, height: ch, fill: '#7ec8e3', opacity: '0.7' }));
        } else if (isTrap(x, y)) {
          svg.appendChild(GB.el('rect', { x: cx, y: cy, width: cw, height: ch, fill: '#ffcc80', opacity: '0.6' }));
          svg.appendChild(GB.el('text', {
            x: px(x), y: py(y) + 4, 'text-anchor': 'middle',
            'font-size': '11', fill: '#e65100', 'font-weight': 'bold',
          })).textContent = '陷';
        } else if (isDen(x, y)) {
          svg.appendChild(GB.el('rect', { x: cx, y: cy, width: cw, height: ch, fill: '#ef9a9a', opacity: '0.6' }));
          svg.appendChild(GB.el('text', {
            x: px(x), y: py(y) + 4, 'text-anchor': 'middle',
            'font-size': '11', fill: '#b71c1c', 'font-weight': 'bold',
          })).textContent = '穴';
        }
      }
    }

    // 格线
    var grid = GB.el('g', { stroke: '#8d6e63', 'stroke-width': '1' });
    for (var i = 0; i <= W; i++) {
      grid.appendChild(GB.el('line', { x1: pad + i * cw, y1: pad, x2: pad + i * cw, y2: pad + H * ch }));
    }
    for (var j = 0; j <= H; j++) {
      grid.appendChild(GB.el('line', { x1: pad, y1: pad + j * ch, x2: pad + W * cw, y2: pad + j * ch }));
    }
    svg.appendChild(grid);

    // 棋子
    if (state.pieces) {
      state.pieces.forEach(function (p) {
        var isSide1 = p.side === 1;
        var g = GB.el('g', {});
        g.appendChild(GB.el('circle', {
          cx: px(p.x), cy: py(p.y), r: Math.min(cw, ch) * 0.42,
          fill: isSide1 ? '#d32f2f' : '#1565c0',
          stroke: isSide1 ? '#b71c1c' : '#0d47a1', 'stroke-width': '2',
        }));
        var t = GB.el('text', {
          x: px(p.x), y: py(p.y) + 5, 'text-anchor': 'middle',
          'font-size': '14', fill: '#fff', 'font-weight': 'bold',
        });
        t.textContent = RANKS[p.rank] || '?';
        g.appendChild(t);
        svg.appendChild(g);
      });
    }

    // 最后一手标记
    if (opts.lastMark && state.lastMove) {
      var lm = state.lastMove;
      svg.appendChild(GB.el('rect', {
        x: pad + lm.tx * cw + 2, y: pad + lm.ty * ch + 2, width: cw - 4, height: ch - 4,
        fill: 'none', stroke: '#FF5722', 'stroke-width': '3', rx: 4,
      }));
    }

    // 两段式：选中起点高亮
    if (opts.sel) {
      svg.appendChild(GB.el('rect', {
        x: pad + opts.sel.x * cw + 2, y: pad + opts.sel.y * ch + 2,
        width: cw - 4, height: ch - 4,
        fill: 'none', stroke: '#1a73e8', 'stroke-width': 4, rx: 6,
      }));
    }

    return { pad: pad, cw: cw, ch: ch, cols: W, rows: H, mode: 'cell' };
  }

  function onTap(svg, geom, state, x, y, callback) {
    var g = GB.hit(geom, x, y);
    if (g) callback(g.x, g.y);
  }

  window.JungleBoard = { render: render, onTap: onTap, W: W, H: H };
})();
