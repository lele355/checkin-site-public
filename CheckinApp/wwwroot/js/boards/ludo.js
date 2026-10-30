// boards/ludo.js — 飞行棋：环形跑道 + 起飞点 + 终点跑道 + 骰子（2~4 人四色）。
(function () {
  'use strict';

  var GB = window.GameBoards;
  if (!GB) return;

  var TRACK = 52, HOME = 6;

  // side → 颜色 / 起点 / 进终点前位置 / 机库角落
  var SIDES = {
    1: { color: '#ef5350', dark: '#c62828', start: 0, homeEntry: 50, corner: [60, 580] }, // 红
    2: { color: '#ffee58', dark: '#f9a825', start: 26, homeEntry: 24, corner: [580, 60] }, // 黄
    3: { color: '#42a5f5', dark: '#1565c0', start: 13, homeEntry: 11, corner: [580, 580] }, // 蓝
    4: { color: '#66bb6a', dark: '#2e7d32', start: 39, homeEntry: 37, corner: [60, 60] }, // 绿
  };

  function trackXY(i, cx, cy, r) {
    var angle = (i / TRACK) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  function homeXY(side, h, cx, cy, trackR) {
    var info = SIDES[side] || SIDES[1];
    var startAngle = (info.homeEntry / TRACK) * Math.PI * 2 - Math.PI / 2;
    var angle = startAngle + (h + 1) / (HOME + 2) * Math.PI * 0.4;
    var r = trackR - 40 - h * 28;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  // 本局在用的 side 集合（从 pieces 推断；缺省 1,2）
  function usedSides(state) {
    var set = {};
    if (state && state.pieces) {
      state.pieces.forEach(function (p) { if (SIDES[p.side]) set[p.side] = true; });
    }
    var arr = Object.keys(set).map(Number).sort();
    return arr.length ? arr : [1, 2];
  }

  function render(svg, state, opts) {
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 640 640');

    var cx = 320, cy = 320, trackR = 230, slotR = 18;
    var sides = usedSides(state);

    svg.appendChild(GB.el('rect', { x: 0, y: 0, width: 640, height: 640, fill: '#e8f5e9', rx: 12 }));

    // 环形跑道格子
    for (var i = 0; i < TRACK; i++) {
      var pos = trackXY(i, cx, cy, trackR);
      var startSide = 0;
      sides.forEach(function (sd) { if (SIDES[sd].start === i) startSide = sd; });
      var fill = startSide ? SIDES[startSide].color : '#c8e6c9';
      svg.appendChild(GB.el('circle', {
        cx: pos.x, cy: pos.y, r: slotR, fill: fill, opacity: startSide ? '0.75' : '1',
        stroke: '#66bb6a', 'stroke-width': '1.5',
      }));
    }

    // 中央区域
    svg.appendChild(GB.el('circle', { cx: cx, cy: cy, r: 80, fill: '#a5d6a7', stroke: '#66bb6a', 'stroke-width': '2' }));

    // 终点跑道（每个在用 side 一条）
    sides.forEach(function (side) {
      var info = SIDES[side];
      for (var h = 0; h < HOME; h++) {
        var hp = homeXY(side, h, cx, cy, trackR);
        svg.appendChild(GB.el('circle', {
          cx: hp.x, cy: hp.y, r: slotR * 0.8, fill: info.color, opacity: '0.55',
          stroke: info.dark, 'stroke-width': '1',
        }));
      }
    });

    // 棋子（在跑道上 / 终点跑道）
    if (state.pieces) {
      state.pieces.forEach(function (p) {
        var info = SIDES[p.side];
        if (!info || p.pos < 0) return;
        var pos;
        if (p.pos < TRACK) {
          pos = trackXY(p.pos, cx, cy, trackR);
        } else {
          pos = homeXY(p.side, p.pos - TRACK, cx, cy, trackR);
        }
        svg.appendChild(GB.el('circle', {
          cx: pos.x, cy: pos.y, r: 13, fill: info.color, stroke: info.dark, 'stroke-width': '2',
        }));
      });
    }

    // 在家棋子（角落机库）
    if (state.pieces) {
      sides.forEach(function (side) {
        var info = SIDES[side];
        var homeCount = state.pieces.filter(function (p) { return p.side === side && p.pos < 0; }).length;
        for (var k = 0; k < homeCount; k++) {
          svg.appendChild(GB.el('circle', {
            cx: info.corner[0] + (k % 2) * 28, cy: info.corner[1] + Math.floor(k / 2) * 28, r: 12,
            fill: info.color, stroke: info.dark, 'stroke-width': '2',
          }));
        }
      });
    }

    // 骰子
    if (state.lastRoll) {
      svg.appendChild(GB.el('rect', {
        x: cx - 25, y: cy - 25, width: 50, height: 50,
        fill: '#fff', stroke: '#333', 'stroke-width': '2', rx: 8,
      }));
      var dt = GB.el('text', {
        x: cx, y: cy + 10, 'text-anchor': 'middle', 'font-size': '32', fill: '#333', 'font-weight': 'bold',
      });
      dt.textContent = String(state.lastRoll);
      svg.appendChild(dt);
    }
  }

  window.LudoBoard = {
    render: render,
    // 飞行棋走子走掷骰/选机操作，不用棋盘点击换算
    onTap: function () { },
  };
})();
