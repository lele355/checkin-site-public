// boards.js — 棋盘渲染抽象：3 种几何（grid/point/track）+ 共享原语。
// 每款游戏的 boards/{key}.js 产出配置对象交给原语渲染。
// 固定色不跟主题（红线 18）。
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** 创建 SVG 元素 */
  function el(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /** grid 几何：棋子放格内，返回 {px, cell, pad} */
  function gridGeom(size, pad, showCoord) {
    var p = showCoord ? (pad || 40) : (pad || 20);
    var step = (640 - p * 2) / size;
    return {
      pad: p,
      step: step,
      cell: step,
      px: function (i) { return p + i * step + step / 2; },
      cellPx: function (i) { return p + i * step; },
    };
  }

  /** 选中标记 */
  function drawSelect(g, geom, x, y, color) {
    var c = el('circle', {
      cx: geom.px(x), cy: geom.px(y), r: geom.cell * 0.48,
      fill: 'none', stroke: color || '#1a73e8', 'stroke-width': '3',
      'stroke-dasharray': '6,3', opacity: '0.8',
    });
    g.appendChild(c);
    return c;
  }

  /** 最后一手标记 */
  function drawLastMark(g, geom, x, y, dark) {
    var c = el('circle', {
      cx: geom.px(x), cy: geom.px(y), r: geom.cell * 0.12,
      fill: dark ? '#fff' : '#333', opacity: '0.7',
    });
    g.appendChild(c);
    return c;
  }

  /** 坐标文字 */
  function drawCoords(g, geom, cols, rows) {
    for (var i = 0; i < cols; i++) {
      var t = el('text', {
        x: geom.px(i), y: 24, 'text-anchor': 'middle',
        'font-size': '14', fill: '#888',
      });
      t.textContent = String.fromCharCode(65 + i);
      g.appendChild(t);
    }
    for (var j = 0; j < rows; j++) {
      var t2 = el('text', {
        x: 18, y: geom.px(j), 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': '14', fill: '#888',
      });
      t2.textContent = String(j + 1);
      g.appendChild(t2);
    }
  }

  /** 命中：把 viewBox 坐标 (x,y) 换算成网格坐标；越界返回 null。
   *  geom = { pad, cw, ch, cols, rows, mode }，mode: 'cell'（格子盘，floor）| 'point'（交叉点盘，round）。
   *  各板 render() 返回自己的 geom —— 换算与渲染同源，禁止各写一份 pad/step。 */
  function hit(geom, x, y) {
    if (!geom || !geom.cw) return null;
    var gx, gy;
    if (geom.mode === 'point') {
      gx = Math.round((x - geom.pad) / geom.cw);
      gy = Math.round((y - geom.pad) / geom.ch);
    } else {
      gx = Math.floor((x - geom.pad) / geom.cw);
      gy = Math.floor((y - geom.pad) / geom.ch);
    }
    if (gx < 0 || gx >= geom.cols || gy < 0 || gy >= geom.rows) return null;
    return { x: gx, y: gy };
  }

  // 暴露到 window
  window.GameBoards = {
    el: el,
    gridGeom: gridGeom,
    hit: hit,
    drawSelect: drawSelect,
    drawLastMark: drawLastMark,
    drawCoords: drawCoords,
    SVG_NS: SVG_NS,
  };
})();
