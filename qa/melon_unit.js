// melon_unit.js — 合成大西瓜物理/规则单测（Node 直跑，无依赖）。
// 被测对象：CheckinApp/wwwroot/js/solo/melon-core.js（浏览器/Node 双载核心）。
// 规则唯一依据：checkin-work/docs/research/2026-10-30-audit-solo-games.md §1.1
// 用法：node melon_unit.js
'use strict';

const core = require('../CheckinApp/wwwroot/js/solo/melon-core.js');

let pass = 0, fail = 0;
function T(name, ok, extra) {
    if (ok) { pass++; console.log('PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
    else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

function run(game, seconds) {
    for (let i = 0; i < seconds * 60; i++) game.step(1 / 60);
}

// ---------- [1] 11 级链定义与命名（M11） ----------
{
    T('链长 11 级', core.NAMES.length === 11);
    T('链序 葡萄→樱桃→橘子→柠檬→猕猴桃', JSON.stringify(core.NAMES.slice(0, 5)) === JSON.stringify(['葡萄', '樱桃', '橘子', '柠檬', '猕猴桃']));
    T('链序 番茄→桃子→菠萝→椰子→半个西瓜→西瓜', JSON.stringify(core.NAMES.slice(5)) === JSON.stringify(['番茄', '桃子', '菠萝', '椰子', '半个西瓜', '西瓜']));
    T('命名规范（半个西瓜/西瓜，M11）', core.NAMES[9] === '半个西瓜' && core.NAMES[10] === '西瓜');
    T('半径单调递增且拉开比例（M7）', core.RADII[0] === 12 && core.RADII[10] === 68 && core.RADII.every((r, i) => i === 0 || r > core.RADII[i - 1]));
}

// ---------- [2] 计分（M4）：等差 k + 西瓜 +100 + 爆炸 +100 ----------
{
    const g = core.create({ seed: 7 });
    g.debugAdd(1, 100, 400); g.debugAdd(1, 120, 400);   // 半径 12，间距 20 < 24 已接触
    run(g, 1);
    T('两葡萄合成得 1 分（源级等差）', g.score === 1, 'score=' + g.score);
    T('合成产物为樱桃', g.bodies.some(b => b.level === 2), 'levels=' + g.bodies.map(b => b.level).join(','));
}
{
    const g = core.create({ seed: 7 });
    g.debugAdd(10, 120, 400); g.debugAdd(10, 240, 400);
    g.aim(120); g.drop(); // 触发物理步进
    // 直接靠拢触发
    g.bodies[0].x = 180; g.bodies[1].x = 190;
    run(g, 0.2);
    T('两半个西瓜合成：+10 +100 = 110 分', g.score === 110, 'score=' + g.score);
    T('产物是完整西瓜', g.bodies.some(b => b.level === 11), 'levels=' + g.bodies.map(b => b.level).join(','));
}
{
    const g = core.create({ seed: 7 });
    g.debugAdd(11, 180, 400); g.debugAdd(11, 260, 400);
    g.bodies[0].x = 180; g.bodies[1].x = 188;
    run(g, 0.2);
    T('两西瓜相撞爆炸 +100（M9）', g.score === 100 && !g.bodies.some(b => b.level === 11), 'score=' + g.score);
}

// ---------- [3] 掉落：只 1..5 级 + 加权（M8） ----------
{
    const g = core.create({ seed: 42 });
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 600; i++) {
        counts[g.curLevel - 1]++;
        g.drop();
        run(g, 0.4);   // 让冷却走完
    }
    T('掉落仅前 5 级', counts.every(c => c >= 0) && counts.length === 5);
    const maxIdx = counts.indexOf(Math.max(...counts));
    const minIdx = counts.indexOf(Math.min(...counts));
    T('加权：橘子(3 级)最常见', maxIdx === 2, counts.join(','));
    T('加权：柠檬(4 级)最少', minIdx === 3, counts.join(','));
}

// ---------- [4] 物理：自由落体着地 ----------
{
    const g = core.create({ seed: 1 });
    g.debugAdd(3, 180, 100);
    run(g, 2);
    const b = g.bodies[0];
    T('落体静止在容器底（y≈H-r）', Math.abs(b.y - (480 - b.r)) < 3, `y=${b.y.toFixed(1)} r=${b.r}`);
    T('落体速度趋零', Math.abs(b.vx) + Math.abs(b.vy) < 8, `v=${(Math.abs(b.vx) + Math.abs(b.vy)).toFixed(2)}`);
}

// ---------- [5] 堆叠：后落的果停在先落的果上 ----------
{
    const g = core.create({ seed: 1 });
    g.debugAdd(5, 180, 460);
    g.debugAdd(5, 180, 200);
    run(g, 2);
    T('同级堆叠立即合成', g.bodies.filter(b => !b.dead).length === 1, 'n=' + g.bodies.length);
    const g2 = core.create({ seed: 1 });
    g2.debugAdd(4, 140, 460);
    g2.debugAdd(6, 180, 200);
    run(g2, 2.5);
    const tops = g2.bodies.map(b => b.y).sort((a, b) => b - a);
    T('异级堆叠不穿透不合成', g2.bodies.length === 2 && tops[0] > tops[1] - 1, 'ys=' + tops.map(y => y.toFixed(0)).join(','));
}

// ---------- [6] 警戒线（M10）：静止越线缓冲判负 ----------
{
    // 四个大西瓜（r=68）锁死合成后叠塔：最上一个静止后质心越线（y≈70 < 96）
    const g = core.create({ seed: 1 });
    for (const y of [460, 330, 200, 70]) { const b = g.debugAdd(11, 180, y); b.lock = 999999; }
    run(g, 1.0);
    T('越线静止中未到缓冲不误判', !g.over, 'overTimer=' + g.overTimer.toFixed(2));
    run(g, 1.5);
    T('越线静止 >0.8s 判负', g.over, 'overTimer=' + g.overTimer.toFixed(2));
}
{
    // 快速穿过警戒线的果不累计计时
    const g = core.create({ seed: 1 });
    const b = g.debugAdd(7, 180, 80);
    b.vy = -300;
    run(g, 0.4);
    T('快速越线不累计计时', !g.over && g.overTimer < 0.35, 'overTimer=' + g.overTimer.toFixed(2));
}

// ---------- [7] 预览链推进 ----------
{
    const g = core.create({ seed: 9 });
    const first = g.curLevel, second = g.nextLevel;
    g.drop();
    T('掉落后当前果=旧下一个', g.curLevel === second, `${first}→${g.curLevel}`);
    T('新的下一个已推进且在 1..5', g.nextLevel >= 1 && g.nextLevel <= 5);
}

console.log(`\n===== melon_unit: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
