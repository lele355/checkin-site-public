// boards/gomoku.js — 五子棋棋盘：交叉点棋、黑白圆子、最后一手标记。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  function render(svg, state, opts) {
    var size = (state && state.size) || 15;
    var geom = GB.gridGeom(size, opts.showCoord ? 40 : 20, opts.showCoord);
    svg.innerHTML = '';

    // 背景
    svg.appendChild(GB.el('rect', {
      x: 0, y: 0, width: 640, height: 640, fill: '#dcb35c', rx: 10,
    }));

    // 格线
    var grid = GB.el('g', { stroke: '#333', 'stroke-width': '1.2' });
    for (var i = 0; i < size; i++) {
      grid.appendChild(GB.el('line', {
        x1: geom.px(0), y1: geom.px(i), x2: geom.px(size - 1), y2: geom.px(i),
      }));
      grid.appendChild(GB.el('line', {
        x1: geom.px(i), y1: geom.px(0), x2: geom.px(i), y2: geom.px(size - 1),
      }));
    }
    svg.appendChild(grid);

    // 星位
    var stars = GB.el('g', { fill: '#333' });
    starPoints(size).forEach(function (s) {
      stars.appendChild(GB.el('circle', {
        cx: geom.px(s[0]), cy: geom.px(s[1]), r: geom.cell * 0.09,
      }));
    });
    svg.appendChild(stars);

    // 坐标
    if (opts.showCoord) {
      var cg = GB.el('g', {});
      GB.drawCoords(cg, geom, size, size);
      svg.appendChild(cg);
    }

    // 落子确认预览（任务二尾巴）：半透明石子标记将落点，与 App 预览圈同规
    if (opts.pointPreview) {
      var pp = opts.pointPreview.split(',');
      var pv = { x: +pp[0], y: +pp[1] };
      if (!(state && (state.moves || []).some(function (m) { return m.x === pv.x && m.y === pv.y; }))) {
        var sp = geom.cell * 0.9;
        svg.appendChild(GB.el('image', {
          href: '/pieces/reversi-gomoku/' + (state.mySide === 1 ? 'black-stone' : 'white-stone') + '.svg',
          x: geom.px(pv.x) - sp / 2, y: geom.px(pv.y) - sp / 2, width: sp, height: sp,
          opacity: '0.45', 'pointer-events': 'none',
        }));
      }
    }

    // 棋子：渐变圆子整枚图标（icons-ready 同源，双端同规）
    var stonesG = GB.el('g', {});
    var moves = (state && state.moves) || [];
    moves.forEach(function (m) {
      // 新着回弹（任务二尾巴）：0.35→1 缓出缩放
      var isLast = opts.placeAt === (m.x + ',' + m.y) && opts.placeProgress < 1;
      var pr = isLast ? (1 - Math.pow(1 - (opts.placeProgress || 0), 2)) : 1;
      var s = geom.cell * 0.9 * (isLast ? 0.35 + 0.65 * pr : 1);
      stonesG.appendChild(GB.el('image', {
        href: '/pieces/reversi-gomoku/' + (m.s === 1 ? 'black-stone' : 'white-stone') + '.svg',
        x: geom.px(m.x) - s / 2, y: geom.px(m.y) - s / 2, width: s, height: s,
        'pointer-events': 'none',
      }));
    });

    // 最后一手标记
    if (opts.lastMark && state.lastMove) {
      GB.drawLastMark(stonesG, geom, state.lastMove.x, state.lastMove.y, state.lastMove.s === 1);
    }
    svg.appendChild(stonesG);

    // 返回几何描述给点击换算用（pad/step 与渲染同源）
    return { pad: geom.pad, cw: geom.step, ch: geom.step, cols: size, rows: size, mode: 'cell' };
  }

  function starPoints(size) {
    var n = size;
    var pts = [[3, 3], [n - 4, 3], [3, n - 4], [n - 4, n - 4], [Math.floor(n / 2), Math.floor(n / 2)]];
    return pts;
  }

  function onTap(svg, geom, state, x, y, callback) {
    var g = GB.hit(geom, x, y);
    if (g) callback(g.x, g.y);
  }

  window.GomokuBoard = {
    render: render,
    onTap: onTap,
  };
})();
