// boards/armychess.js — 军棋棋盘：5×12 格子 + 行营/大本营 + 暗子渲染。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  var W = 5, H = 12;
  var CAMPS = [[1,2],[3,2],[2,3],[1,4],[3,4],[1,7],[3,7],[2,8],[1,9],[3,9]];
  var DENS = [[1,0],[3,0],[1,11],[3,11]];

  // rank token → 显示名
  var RANK_NAMES = {
    rank_commander: '司令', rank_army: '军长', rank_division: '师长',
    rank_brigade: '旅长', rank_regiment: '团长', rank_battalion: '营长',
    rank_company: '连长', rank_platoon: '排长', rank_engineer: '工兵',
    rank_mine: '地雷', rank_flag: '军旗', rank_bomb: '炸',
  };

  function isCamp(x, y) { return CAMPS.some(function (p) { return p[0] === x && p[1] === y; }); }
  function isDen(x, y) { return DENS.some(function (p) { return p[0] === x && p[1] === y; }); }

  function render(svg, state, opts) {
    svg.innerHTML = '';
    var totalH = 640 * H / W;
    svg.setAttribute('viewBox', '0 0 640 ' + totalH);

    var pad = 20;
    var cw = (640 - pad * 2) / W;
    var ch = (totalH - pad * 2) / H;

    function px(x) { return pad + x * cw + cw / 2; }
    function py(y) { return pad + y * ch + ch / 2; }

    // 背景
    svg.appendChild(GB.el('rect', { x: 0, y: 0, width: 640, height: totalH, fill: '#c8b896', rx: 8 }));

    // 特殊格
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var cx = pad + x * cw, cy = pad + y * ch;
        if (isCamp(x, y)) {
          svg.appendChild(GB.el('rect', { x: cx, y: cy, width: cw, height: ch, fill: '#a5d6a7', opacity: '0.6' }));
          svg.appendChild(GB.el('text', {
            x: px(x), y: py(y) + 4, 'text-anchor': 'middle',
            'font-size': '12', fill: '#2e7d32', 'font-weight': 'bold',
          })).textContent = '营';
        } else if (isDen(x, y)) {
          svg.appendChild(GB.el('rect', { x: cx, y: cy, width: cw, height: ch, fill: '#ef9a9a', opacity: '0.6' }));
          svg.appendChild(GB.el('text', {
            x: px(x), y: py(y) + 4, 'text-anchor': 'middle',
            'font-size': '12', fill: '#b71c1c', 'font-weight': 'bold',
          })).textContent = '旗';
        }
      }
    }

    // 棋盘中线
    var midY = pad + 6 * ch;
    svg.appendChild(GB.el('line', { x1: pad, y1: midY, x2: 640 - pad, y2: midY, stroke: '#5d4037', 'stroke-width': '2' }));

    // 格线
    var grid = GB.el('g', { stroke: '#8d6e63', 'stroke-width': '1' });
    for (var i = 0; i <= W; i++) grid.appendChild(GB.el('line', { x1: pad + i * cw, y1: pad, x2: pad + i * cw, y2: pad + H * ch }));
    for (var j = 0; j <= H; j++) grid.appendChild(GB.el('line', { x1: pad, y1: pad + j * ch, x2: pad + W * cw, y2: pad + j * ch }));
    svg.appendChild(grid);

    // 棋子
    if (state.pieces) {
      state.pieces.forEach(function (p) {
        var isSide1 = p.side === 1;
        var g = GB.el('g', {});
        g.appendChild(GB.el('circle', {
          cx: px(p.x), cy: py(p.y), r: Math.min(cw, ch) * 0.4,
          fill: isSide1 ? '#d32f2f' : '#1565c0',
          stroke: isSide1 ? '#b71c1c' : '#0d47a1', 'stroke-width': '2',
        }));
        if (p.hidden) {
          // 暗子：只显示 '?'，不携带任何身份信息
          var t = GB.el('text', {
            x: px(p.x), y: py(p.y) + 5, 'text-anchor': 'middle',
            'font-size': '16', fill: '#fff', 'font-weight': 'bold',
          });
          t.textContent = '?';
          g.appendChild(t);
        } else {
          // 明子：显示 rank 名
          var name = RANK_NAMES[p.rank] || '?';
          var t2 = GB.el('text', {
            x: px(p.x), y: py(p.y) + 5, 'text-anchor': 'middle',
            'font-size': '13', fill: '#fff', 'font-weight': 'bold',
          });
          t2.textContent = name;
          g.appendChild(t2);
        }
        svg.appendChild(g);
      });
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

  window.ArmyChessBoard = {
    render: render,
    onTap: function (svg, geom, st, x, y, cb) {
      var g = GB.hit(geom, x, y);
      if (g) cb(g.x, g.y);
    },
  };
})();
