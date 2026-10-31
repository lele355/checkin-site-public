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
  // 兽剪影件名（icons-ready 同源）：rank 1..8 → rat..elephant
  var JUNGLE_ICON = ['', 'rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'];

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
    // 视角对调：上方座（side 2）看到的棋盘上下翻转（己方恒在下半区）
    var flip = !!(opts && opts.flip);
    function vy(y) { return flip ? (H - 1 - y) : y; }

    function px(x) { return pad + x * cw + cw / 2; }
    function py(y) { return pad + vy(y) * ch + ch / 2; }

    // 背景
    svg.appendChild(GB.el('rect', { x: 0, y: 0, width: 640, height: totalH, fill: '#f5e6c8', rx: 8 }));

    // 特殊格
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var cx = pad + x * cw, cy = pad + vy(y) * ch;
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

    // 棋子：整枚字面图标直贴（icons-ready 同源，2.8.8 字面制式对齐象棋/军棋 —— 木饼刻字）
    if (state.pieces) {
      state.pieces.forEach(function (p) {
        var side = Math.min(cw, ch) * 0.94;
        svg.appendChild(GB.el('image', {
          href: '/pieces/jungle/' + (p.side === 1 ? 'red-' : 'blue-') + (JUNGLE_ICON[p.rank] || 'rat') + '.svg',
          x: px(p.x) - side / 2, y: py(p.y) - side / 2,
          width: side, height: side, 'pointer-events': 'none',
        }));
      });
    }

    // 最后一手标记
    if (opts.lastMark && state.lastMove) {
      var lm = state.lastMove;
      svg.appendChild(GB.el('rect', {
        x: pad + lm.tx * cw + 2, y: pad + vy(lm.ty) * ch + 2, width: cw - 4, height: ch - 4,
        fill: 'none', stroke: '#FF5722', 'stroke-width': '3', rx: 4,
      }));
    }

    // 两段式：选中起点高亮
    if (opts.sel) {
      svg.appendChild(GB.el('rect', {
        x: pad + opts.sel.x * cw + 2, y: pad + vy(opts.sel.y) * ch + 2,
        width: cw - 4, height: ch - 4,
        fill: 'none', stroke: '#1a73e8', 'stroke-width': 4, rx: 6,
      }));
    }

    // 可走提示（Batch D）：绿点=可走，红环=可吃
    if (opts.sel && opts.hints) {
      var hl = opts.hints[opts.sel.x + ',' + opts.sel.y] || [];
      hl.forEach(function (tp) {
        var occ = state.pieces && state.pieces.some(function (q) { return q.x === tp[0] && q.y === tp[1]; });
        if (occ) {
          svg.appendChild(GB.el('rect', {
            x: pad + tp[0] * cw + 5, y: pad + vy(tp[1]) * ch + 5, width: cw - 10, height: ch - 10,
            fill: 'none', stroke: '#e53935', 'stroke-width': 3, rx: 6, opacity: .85,
          }));
        } else {
          svg.appendChild(GB.el('circle', {
            cx: px(tp[0]), cy: py(tp[1]), r: Math.min(cw, ch) * 0.16,
            fill: '#2e7d32', opacity: .75,
          }));
        }
      });
    }

    // 吃子鬼影（Batch D）：被吃子淡出（整枚图标直贴）
    if (opts.ghost && opts.ghost.piece) {
      var gp = opts.ghost.piece;
      var sideG = Math.min(cw, ch) * 0.94;
      var gg = GB.el('g', { opacity: String(Math.max(0, opts.ghost.alpha)) });
      gg.appendChild(GB.el('image', {
        href: '/pieces/jungle/' + (gp.side === 1 ? 'red-' : 'blue-') + (JUNGLE_ICON[gp.rank] || 'rat') + '.svg',
        x: px(gp.x) - sideG / 2, y: py(gp.y) - sideG / 2,
        width: sideG, height: sideG, 'pointer-events': 'none',
      }));
      svg.appendChild(gg);
    }

    return { pad: pad, cw: cw, ch: ch, cols: W, rows: H, mode: 'cell' };
  }

  function onTap(svg, geom, state, x, y, callback) {
    var g = GB.hit(geom, x, y);
    if (g) callback(g.x, g.y);
  }

  window.JungleBoard = { render: render, onTap: onTap, W: W, H: H };
})();
