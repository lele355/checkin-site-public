// boards/xiangqi.js — 象棋棋盘：9×10 交叉点 + 楚河汉界 + 7 种棋子。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  var W = 9, H = 10;
  // 红=帅仕相马车炮兵 / 黑=将士象马车炮卒（下标 = 服务端 PieceType）
  var RED_NAMES = ['', '帅', '仕', '相', '马', '车', '炮', '兵'];
  var BLACK_NAMES = ['', '将', '士', '象', '马', '车', '炮', '卒'];
  // 木纹圆饼字子图标（icons-ready 同源）：type 1..7 → 色套件名
  var XQ_ICON = {
    1: ['', 'red-shuai', 'red-shi', 'red-xiang', 'red-ma', 'red-che', 'red-pao', 'red-bing'],
    2: ['', 'black-jiang', 'black-shi', 'black-xiang', 'black-ma', 'black-che', 'black-pao', 'black-zu'],
  };

  function render(svg, state, opts) {
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 640 720');

    var pad = 50;
    var cw = (640 - pad * 2) / (W - 1);
    var ch = (720 - pad * 2) / (H - 1);

    function px(x) { return pad + x * cw; }
    function py(y) { return pad + y * ch; }

    // 背景
    svg.appendChild(GB.el('rect', { x: 0, y: 0, width: 640, height: 720, fill: '#f0d9a8', rx: 8 }));

    // 格线（交叉点连线，不是格子！）
    var grid = GB.el('g', { stroke: '#5d4037', 'stroke-width': '1.2' });
    for (var i = 0; i < W; i++) {
      grid.appendChild(GB.el('line', { x1: px(i), y1: py(0), x2: px(i), y2: py(H - 1) }));
    }
    // 横线：上下两半各 5 条（中间断开 = 楚河汉界）
    for (var j = 0; j < 5; j++) {
      grid.appendChild(GB.el('line', { x1: px(0), y1: py(j), x2: px(W - 1), y2: py(j) }));
      grid.appendChild(GB.el('line', { x1: px(0), y1: py(j + 5), x2: px(W - 1), y2: py(j + 5) }));
    }
    // 两侧边线（连到河界）
    grid.appendChild(GB.el('line', { x1: px(0), y1: py(0), x2: px(0), y2: py(4) }));
    grid.appendChild(GB.el('line', { x1: px(0), y1: py(5), x2: px(0), y2: py(9) }));
    grid.appendChild(GB.el('line', { x1: px(8), y1: py(0), x2: px(8), y2: py(4) }));
    grid.appendChild(GB.el('line', { x1: px(8), y1: py(5), x2: px(8), y2: py(9) }));
    svg.appendChild(grid);

    // 九宫斜线
    var palace = GB.el('g', { stroke: '#5d4037', 'stroke-width': '1.2' });
    palace.appendChild(GB.el('line', { x1: px(3), y1: py(0), x2: px(5), y2: py(2) }));
    palace.appendChild(GB.el('line', { x1: px(5), y1: py(0), x2: px(3), y2: py(2) }));
    palace.appendChild(GB.el('line', { x1: px(3), y1: py(7), x2: px(5), y2: py(9) }));
    palace.appendChild(GB.el('line', { x1: px(5), y1: py(7), x2: px(3), y2: py(9) }));
    svg.appendChild(palace);

    // 楚河汉界
    var river = GB.el('g', {});
    var rt1 = GB.el('text', {
      x: 160, y: py(4) + ch / 2 + 8, 'text-anchor': 'middle',
      'font-size': '28', fill: '#8d6e63', 'font-weight': 'bold', opacity: '0.5',
    });
    rt1.textContent = '楚  河';
    river.appendChild(rt1);
    var rt2 = GB.el('text', {
      x: 480, y: py(4) + ch / 2 + 8, 'text-anchor': 'middle',
      'font-size': '28', fill: '#8d6e63', 'font-weight': 'bold', opacity: '0.5',
    });
    rt2.textContent = '汉  界';
    river.appendChild(rt2);
    svg.appendChild(river);

    // 棋子（放在交叉点上）：整枚图标替换旧圆圈+文字（icons-ready 同源）
    if (state.pieces) {
      state.pieces.forEach(function (p) {
        var key = (XQ_ICON[p.side === 1 ? 1 : 2] || XQ_ICON[2])[p.type];
        if (!key) return;
        svg.appendChild(GB.el('image', {
          href: '/pieces/xiangqi/' + key + '.svg',
          x: px(p.x) - 24, y: py(p.y) - 24, width: 48, height: 48,
          'pointer-events': 'none',
        }));
      });
    }

    // 最后一手标记
    if (opts.lastMark && state.lastMove) {
      var lm = state.lastMove;
      svg.appendChild(GB.el('circle', {
        cx: px(lm.tx), cy: py(lm.ty), r: 26,
        fill: 'none', stroke: '#FF5722', 'stroke-width': '3',
        'stroke-dasharray': '6,3',
      }));
    }

    // 将军提示
    if (state.inCheck) {
      var ct = GB.el('text', {
        x: 320, y: 30, 'text-anchor': 'middle',
        'font-size': '22', fill: '#c62828', 'font-weight': 'bold',
      });
      ct.textContent = '将  军！';
      svg.appendChild(ct);
    }

    // 两段式：选中起点高亮
    if (opts.sel) {
      svg.appendChild(GB.el('circle', {
        cx: px(opts.sel.x), cy: py(opts.sel.y), r: 24,
        fill: 'none', stroke: '#1a73e8', 'stroke-width': 4, opacity: .9,
      }));
    }

    // 可走提示（Batch D）：绿点=可走，红环=可吃
    if (opts.sel && opts.hints) {
      var hl = opts.hints[opts.sel.x + ',' + opts.sel.y] || [];
      hl.forEach(function (tp) {
        var occ = state.pieces && state.pieces.some(function (q) { return q.x === tp[0] && q.y === tp[1]; });
        if (occ) {
          svg.appendChild(GB.el('circle', {
            cx: px(tp[0]), cy: py(tp[1]), r: 25,
            fill: 'none', stroke: '#e53935', 'stroke-width': 3, opacity: .85,
          }));
        } else {
          svg.appendChild(GB.el('circle', {
            cx: px(tp[0]), cy: py(tp[1]), r: 7,
            fill: '#2e7d32', opacity: .75,
          }));
        }
      });
    }

    // 吃子鬼影（Batch D）：被吃子淡出
    if (opts.ghost && opts.ghost.piece) {
      var gp = opts.ghost.piece;
      var isRedG = gp.side === 1;
      var nameG = (isRedG ? RED_NAMES : BLACK_NAMES)[gp.type] || '?';
      var gg = GB.el('g', { opacity: String(Math.max(0, opts.ghost.alpha)) });
      gg.appendChild(GB.el('circle', {
        cx: px(gp.x), cy: py(gp.y), r: 22,
        fill: '#f5e6c8', stroke: isRedG ? '#c62828' : '#212121', 'stroke-width': '2.5',
      }));
      var tg = GB.el('text', {
        x: px(gp.x), y: py(gp.y) + 7, 'text-anchor': 'middle',
        'font-size': '18', fill: isRedG ? '#c62828' : '#212121', 'font-weight': 'bold',
      });
      tg.textContent = nameG;
      gg.appendChild(tg);
      svg.appendChild(gg);
    }

    // 交叉点盘：点击取最近交叉点（round）
    return { pad: pad, cw: cw, ch: ch, cols: W, rows: H, mode: 'point' };
  }

  window.XiangqiBoard = {
    render: render,
    onTap: function (svg, geom, state, x, y, cb) {
      var g = GB.hit(geom, x, y);
      if (g) cb(g.x, g.y);
    },
    W: W, H: H,
  };
})();
