// solo/melon-core.js — 合成大西瓜核心：圆形刚体物理 + 合成规则（浏览器 / Node 双端可载）。
// 不碰 DOM；渲染与输入由 melon.js 壳负责。规则唯一依据：
//   checkin-work/docs/research/2026-10-30-audit-solo-games.md §1.1（11 级链 / 等差计分 / 警戒线缓冲 / 加权掉落）。
// 物理模型：半隐式欧拉积分 + 冲量法解碰撞（位置修正 ×8 松弛迭代），圆刚体带滚动角速度（仅视觉）。
(function (root) {
  'use strict';

  // ---- 常量（双端实现共用这套参数，改这里就要同步 MelonGame.kt）----
  var W = 360, H = 480;
  var RADII = [12, 15, 18, 22, 26, 31, 36, 42, 49, 58, 68];          // 11 级半径：葡萄 12 → 西瓜 68（M7）
  var NAMES = ['葡萄', '樱桃', '橘子', '柠檬', '猕猴桃', '番茄', '桃子', '菠萝', '椰子', '半个西瓜', '西瓜'];
  var GRAVITY = 1600;        // px/s²
  var RESTITUTION = 0.22;    // 弹性
  var FRICTION = 0.10;       // 切向摩擦
  var ITER = 8;              // 每步松弛迭代（堆叠稳定性）
  var DROP_Y = 46;           // 悬停/释放高度
  var WARN_Y = 96;           // 警戒线（质心越线且静止计时）
  var OVER_GRACE = 0.8;      // 越线停留缓冲秒数（M10）
  var MERGE_LOCK = 8;        // 新果冻结步数（防连锁抖动）
  var DROP_COOLDOWN = 0.35;  // 两次掉落间隔
  var WEIGHTS = [2, 3, 4, 1, 2];  // 掉落加权（1..5 级）：橘子最常见、柠檬最少（M8）

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weightedRoll(rng) {
    var total = 0, i;
    for (i = 0; i < WEIGHTS.length; i++) total += WEIGHTS[i];
    var r = rng() * total;
    for (i = 0; i < WEIGHTS.length; i++) { r -= WEIGHTS[i]; if (r < 0) return i + 1; }
    return 5;
  }

  /**
   * 创建一局。opts: { width, height, seed }
   * 返回 game：step(dt) / aim(x) / drop() / score / over / bodies / curLevel / nextLevel / events
   */
  function create(opts) {
    opts = opts || {};
    var w = opts.width || W;
    var h = opts.height || H;
    var rng = mulberry32(opts.seed || (Date.now() & 0xffffffff));

    var bodies = [];      // {x,y,vx,vy,r,level,angle,av,lock,age,born,dead}
    var score = 0;
    var over = false;
    var overTimer = 0;
    var cool = 0;
    var simT = 0;         // 物理时钟（秒）
    var combo = 0;        // 连击（Batch D）：3 秒窗内连续合成递增
    var lastMergeAt = -999;
    var aimX = w / 2;
    var curLevel = weightedRoll(rng);
    var nextLevel = weightedRoll(rng);
    var events = [];      // {type:'merge'|'explode', x, y, level}

    function massOf(b) { return b.r * b.r; }

    function addBody(level, x, y, vx, vy, lock) {
      var b = {
        x: x, y: y, vx: vx || 0, vy: vy || 0,
        r: RADII[level - 1], level: level,
        angle: 0, av: 0, lock: lock || 0, age: 0, born: simT, dead: false,
      };
      bodies.push(b);
      return b;
    }

    // 两个同级相撞 → 合成高一级（等差计分：源级 k 得 k 分；合出西瓜再 +100）
    // 两个西瓜相撞 → 爆炸双双消除 +100（M9）
    function tryMerge(a, b) {
      if (a.dead || b.dead || a.level !== b.level || a.lock > 0 || b.lock > 0) return;
      if (a.level >= 11) {
        a.dead = b.dead = true;
        score += 100;
        events.push({ type: 'explode', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, level: 11 });
        return;
      }
      var lv = a.level;                 // 源水果级别 = 得分（M4）
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var mvx = (a.vx + b.vx) / 2 * 0.9, mvy = (a.vy + b.vy) / 2 * 0.9;
      a.dead = b.dead = true;
      // 连击加成（Batch D）：3 秒窗内连续合成递增 ×1.2 / ×1.5 / ×2 封顶，只加成基础分
      if (simT - lastMergeAt <= 3) combo++; else combo = 1;
      lastMergeAt = simT;
      var mult = combo >= 4 ? 2 : combo === 3 ? 1.5 : combo === 2 ? 1.2 : 1;
      score += Math.round(lv * mult);
      var nl = lv + 1;
      if (nl === 11) score += 100;      // 合出完整西瓜额外 +100（平加，不吃连击）
      addBody(nl, mx, my, mvx, mvy, MERGE_LOCK);
      events.push({ type: 'merge', x: mx, y: my, level: nl, combo: combo });
    }

    function pairResolve(a, b) {
      var dx = b.x - a.x, dy = b.y - a.y;
      var dist2 = dx * dx + dy * dy;
      var rs = a.r + b.r;
      if (dist2 >= rs * rs || dist2 === 0) return;
      var dist = Math.sqrt(dist2);
      var nx = dx / dist, ny = dy / dist;
      var overlap = rs - dist;

      // 同级接触且未锁定即合成（空中/滚动/静止均可，审计 §1.1）；
      // 不合成的接触（含同级锁定中）仍要走位置分离，否则会互穿沉底。
      if (a.level === b.level && a.lock <= 0 && b.lock <= 0) { tryMerge(a, b); return; }

      // 位置修正（按质量分摊）
      var ma = massOf(a), mb = massOf(b), tm = ma + mb;
      a.x -= nx * overlap * (mb / tm); a.y -= ny * overlap * (mb / tm);
      b.x += nx * overlap * (ma / tm); b.y += ny * overlap * (ma / tm);

      // 法向冲量（弹性）
      var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      var vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        var j = -(1 + RESTITUTION) * vn / (1 / ma + 1 / mb);
        a.vx -= j * nx / ma; a.vy -= j * ny / ma;
        b.vx += j * nx / mb; b.vy += j * ny / mb;
      }
      // 切向摩擦 + 滚动角速度
      var tx = -ny, ty = nx;
      var vt = rvx * tx + rvy * ty;
      var jt = -vt * FRICTION / (1 / ma + 1 / mb);
      a.vx -= jt * tx / ma; a.vy -= jt * ty / ma;
      b.vx += jt * tx / mb; b.vy += jt * ty / mb;
      a.av = Math.max(-6, Math.min(6, a.av + vt / a.r * 0.02));
      b.av = Math.max(-6, Math.min(6, b.av + vt / b.r * 0.02));
    }

    function wallResolve(b) {
      if (b.x - b.r < 0) { b.x = b.r; if (b.vx < 0) b.vx = -b.vx * RESTITUTION; b.av += b.vy * 0.002; }
      if (b.x + b.r > w) { b.x = w - b.r; if (b.vx > 0) b.vx = -b.vx * RESTITUTION; b.av -= b.vy * 0.002; }
      if (b.y + b.r > h) {
        b.y = h - b.r;
        if (b.vy > 0) b.vy = -b.vy * RESTITUTION;
        b.vx *= 0.985;                 // 地面摩擦
        b.av *= 0.985;
      }
    }

    function step(dt) {
      if (over) return;
      if (dt > 0.05) dt = 0.05;        // 掉帧保护
      var sub = 1 / 60, steps = Math.max(1, Math.round(dt / sub));
      for (var s = 0; s < steps; s++) {
        var i, j, b;
        simT += sub;
        for (i = 0; i < bodies.length; i++) {
          b = bodies[i];
          if (b.dead) continue;
          b.vy += GRAVITY * sub;
          b.x += b.vx * sub; b.y += b.vy * sub;
          b.angle += b.av * sub;
          // 角速度阻尼 + 限幅（2026-10-31 修「水果不停快速旋转」：接触每帧累加 av 且空中无阻尼 → 无限自旋）
          b.av *= 0.99;
          if (Math.abs(b.av) < 0.1) b.av = 0;
          if (b.angle > 6.283185) b.angle -= 6.283185; else if (b.angle < -6.283185) b.angle += 6.283185;
          b.age += sub;
          if (b.lock > 0) b.lock--;
        }
        for (var it = 0; it < ITER; it++) {
          for (i = 0; i < bodies.length; i++) {
            if (bodies[i].dead) continue;
            wallResolve(bodies[i]);
          }
          for (i = 0; i < bodies.length; i++) {
            if (bodies[i].dead) continue;
            for (j = i + 1; j < bodies.length; j++) {
              if (bodies[j].dead) continue;
              pairResolve(bodies[i], bodies[j]);
            }
          }
        }
        for (i = 0; i < bodies.length; i++) {
          b = bodies[i];
          b.vx *= 0.999; b.vy *= 0.999;
          if (b.dead) { bodies.splice(i, 1); i--; }
        }
        if (cool > 0) cool -= sub;

        // 警戒线：**顶部边缘**越线且静止 > 缓冲 → 判负
        // （2026-10-31 修：原用质心 b.y，堆高时顶部越线但质心仍在线下 → 永远不判负，线像摆设；
        //   速度门限放宽 30→60 以容忍堆叠抖动，另给 age>1.5s 的兜底——落体高速穿线由 age/speed 双门挡住）
        var resting = false;
        for (i = 0; i < bodies.length; i++) {
          b = bodies[i];
          if (b.age > 0.4 && (b.y - b.r) < WARN_Y && (Math.abs(b.vx) + Math.abs(b.vy) < 60 || b.age > 1.5)) { resting = true; break; }
        }
        overTimer = resting ? overTimer + sub : Math.max(0, overTimer - sub * 2);
        if (overTimer >= OVER_GRACE) over = true;
      }
    }

    function aim(x) {
      var r = RADII[curLevel - 1];
      aimX = Math.max(r, Math.min(w - r, x));
    }

    function drop() {
      if (over || cool > 0) return false;
      var r = RADII[curLevel - 1];
      addBody(curLevel, Math.max(r, Math.min(w - r, aimX)), DROP_Y, 0, 0, 0);
      curLevel = nextLevel;
      nextLevel = weightedRoll(rng);
      cool = DROP_COOLDOWN;
      return true;
    }

    /** 测试钩子：直接布子（规则断言/UI 冒烟用） */
    function debugAdd(level, x, y) { return addBody(level, x, y, 0, 0, 0); }

    return {
      width: w, height: h,
      warnY: WARN_Y, dropY: DROP_Y, radii: RADII, names: NAMES,
      step: step, aim: aim, drop: drop, debugAdd: debugAdd,
      drainEvents: function () { var e = events; events = []; return e; },
      get score() { return score; },
      get over() { return over; },
      get bodies() { return bodies; },
      get curLevel() { return curLevel; },
      get nextLevel() { return nextLevel; },
      get aimX() { return aimX; },
      get overTimer() { return overTimer; },
      get dropReady() { return cool <= 0 && !over; },
      get time() { return simT; },
      get combo() { return combo; },
      get comboMult() { return combo >= 4 ? 2 : combo === 3 ? 1.5 : combo === 2 ? 1.2 : 1; },
    };
  }

  var api = { create: create, RADII: RADII, NAMES: NAMES, WEIGHTS: WEIGHTS, WARN_Y: WARN_Y, DROP_Y: DROP_Y };
  root.MelonCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
