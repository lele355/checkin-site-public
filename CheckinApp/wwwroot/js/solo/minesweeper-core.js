// solo/minesweeper-core.js — 扫雷规则内核（无 DOM、可单测、App 端同参复刻）。
//
// 分工：本文件只管「格子怎么翻、怎么标、什么时候赢」，画与输入在 minesweeper.js。
// 双载：网页走 <script>（window.MineCore），Node 单测走 module.exports（与 melon-core 同规）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MineCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 三档难度：行列、雷数、计分底分与每秒扣分（与 App MineCore.LEVELS 完全同参）
  var LEVELS = [
    { key: 1, name: '初级', rows: 9, cols: 9, mines: 10, base: 3000, coef: 4 },
    { key: 2, name: '中级', rows: 16, cols: 16, mines: 40, base: 6000, coef: 6 },
    { key: 3, name: '高级', rows: 16, cols: 30, mines: 99, base: 12000, coef: 10 },
  ];

  function levelOf(key) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].key === key) return LEVELS[i];
    return LEVELS[0];
  }

  /// 单局得分：难度底分 − 用时秒数 × 难度系数，保底 100（越快分越高）
  function scoreOf(levelKey, seconds) {
    var lv = levelOf(levelKey);
    var s = Math.round(lv.base - Math.max(0, seconds) * lv.coef);
    return Math.max(100, Math.min(9999999, s));
  }

  /// 建立一局：雷在第一次翻开时才种下（首点必安全）
  function create(opts) {
    opts = opts || {};
    var levelKey = opts.level || 1;
    var lv = levelOf(levelKey);
    var rows = opts.rows || lv.rows;
    var cols = opts.cols || lv.cols;
    var mines = opts.mines || lv.mines;
    var now = opts.now || function () { return Date.now(); };
    var rnd = opts.random || Math.random;

    var cells = [];
    for (var i = 0; i < rows * cols; i++) {
      cells.push({ mine: false, adj: 0, open: false, flag: false });
    }

    var g = {
      level: levelKey,
      rows: rows,
      cols: cols,
      mines: mines,
      cells: cells,
      started: false,
      over: false,
      won: false,
      boom: -1,          // 踩中的那颗雷（渲染用）
      opened: 0,
      flags: 0,
      startAt: 0,
      endAt: 0,
    };

    function idx(x, y) { return y * cols + x; }

    function neighbors(i) {
      var x = i % cols, y = (i - x) / cols, out = [];
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          out.push(idx(nx, ny));
        }
      }
      return out;
    }

    function plant(safeIndex) {
      // 首点及其周围 8 格不下雷（首点必是一片开阔地，不用先赌运气）
      var forbidden = {};
      forbidden[safeIndex] = true;
      var around = neighbors(safeIndex);
      for (var k = 0; k < around.length; k++) forbidden[around[k]] = true;

      var pool = [];
      for (var i = 0; i < cells.length; i++) if (!forbidden[i]) pool.push(i);

      // 池子不够时退回「只排除首点」（极端小盘防死循环）
      if (pool.length < mines) {
        pool = [];
        for (var j = 0; j < cells.length; j++) if (j !== safeIndex) pool.push(j);
      }

      for (var placed = 0; placed < mines && pool.length > 0; placed++) {
        var pick = Math.floor(rnd() * pool.length);
        cells[pool[pick]].mine = true;
        pool[pick] = pool[pool.length - 1];
        pool.pop();
      }

      for (var c = 0; c < cells.length; c++) {
        if (cells[c].mine) continue;
        var n = neighbors(c), cnt = 0;
        for (var q = 0; q < n.length; q++) if (cells[n[q]].mine) cnt++;
        cells[c].adj = cnt;
      }
    }

    function flood(start) {
      var stack = [start];
      while (stack.length) {
        var cur = stack.pop();
        var cell = cells[cur];
        if (cell.open || cell.flag || cell.mine) continue;
        cell.open = true;
        g.opened++;
        if (cell.adj === 0) {
          var n = neighbors(cur);
          for (var i = 0; i < n.length; i++) if (!cells[n[i]].open) stack.push(n[i]);
        }
      }
    }

    function checkWin() {
      if (g.opened === cells.length - mines) {
        g.won = true;
        g.over = true;
        g.endAt = now();
      }
    }

    /// 翻开一格。返回 'boom' | 'open' | 'noop'
    function reveal(i) {
      if (g.over || i < 0 || i >= cells.length) return 'noop';
      var cell = cells[i];
      if (cell.open || cell.flag) return 'noop';

      if (!g.started) {
        plant(i);
        g.started = true;
        g.startAt = now();
      }

      if (cell.mine) {
        cell.open = true;
        g.boom = i;
        g.over = true;
        g.endAt = now();
        return 'boom';
      }

      flood(i);
      checkWin();
      return 'open';
    }

    /// 插旗 / 取消插旗。返回 true = 状态变了
    function toggleFlag(i) {
      if (g.over || i < 0 || i >= cells.length) return false;
      var cell = cells[i];
      if (cell.open) return false;
      cell.flag = !cell.flag;
      g.flags += cell.flag ? 1 : -1;
      return true;
    }

    /// 双键展开（数字格周围旗数够了 → 翻开其余邻格）。返回 'boom' | 'open' | 'noop'
    function chord(i) {
      if (g.over || i < 0 || i >= cells.length) return 'noop';
      var cell = cells[i];
      if (!cell.open || cell.adj === 0) return 'noop';
      var n = neighbors(i), flags = 0, targets = [];
      for (var k = 0; k < n.length; k++) {
        if (cells[n[k]].flag) flags++;
        else if (!cells[n[k]].open) targets.push(n[k]);
      }
      if (flags !== cell.adj || targets.length === 0) return 'noop';

      var boom = -1;
      for (var t = 0; t < targets.length; t++) {
        var r = reveal(targets[t]);
        if (r === 'boom') boom = targets[t];
      }
      return boom >= 0 ? 'boom' : 'open';
    }

    /// 全部雷的位置（结算后翻开显示用）
    function mineIndexes() {
      var out = [];
      for (var i = 0; i < cells.length; i++) if (cells[i].mine) out.push(i);
      return out;
    }

    /// 用时（秒，向下取整）；未开始为 0
    function elapsedSec() {
      if (!g.started) return 0;
      var end = g.endAt || now();
      return Math.max(0, Math.floor((end - g.startAt) / 1000));
    }

    g.reveal = reveal;
    g.toggleFlag = toggleFlag;
    g.chord = chord;
    g.neighbors = neighbors;
    g.mineIndexes = mineIndexes;
    g.elapsedSec = elapsedSec;
    g.score = function () { return scoreOf(g.level, elapsedSec()); };
    return g;
  }

  return { LEVELS: LEVELS, levelOf: levelOf, scoreOf: scoreOf, create: create };
});
