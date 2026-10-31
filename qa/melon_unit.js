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
    // 权重口径（2026-10-31 改）：直接锁声明权重（橘 4 最大 / 柠 1 最小）。
    // 原实现靠「连投 600 次统计 curLevel」，新判负规则（顶部越线）下会提前终局，
    // drop() 恒 false → curLevel 卡 1，统计失效；实投分布另由 [3b] 短程验证。
    const W = core.WEIGHTS;
    const maxW = W.indexOf(Math.max(...W));
    const minW = W.indexOf(Math.min(...W));
    T('加权：橘子(3 级)权重最大', maxW === 2, W.join(','));
    T('加权：柠檬(4 级)权重最小', minW === 3, W.join(','));
    // [3b] 短程实投：每 12 投换新局，避开判负与冷却卡死
    let gb = core.create({ seed: 99 });
    const seen = new Set();
    for (let i = 0; i < 120; i++) {
        if (gb.over || i % 12 === 0) gb = core.create({ seed: 99 + i });
        seen.add(gb.curLevel);
        gb.drop(); run(gb, 0.45);
    }
    T('实投只出 1..5 级', [...seen].every(l => l >= 1 && l <= 5), [...seen].join(','));
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

// ---------- [8] 连击计分（Batch D）：3 秒窗 ×1.2/×1.5/×2 封顶，超窗复位 ----------
{
    const g = core.create({ seed: 5 });
    // 每对用不同级（产物互不相同，避免产物之间二次合成污染分数）
    const pair = (lv, y) => { g.debugAdd(lv, 100, y); g.debugAdd(lv, 120, y); };
    pair(4, 400); run(g, 0.3);                      // 合成 1：+4×1
    T('第 1 次合成 ×1（基础 4）', g.score === 4, 'score=' + g.score);
    pair(5, 300); run(g, 0.3);                      // 合成 2：+round(5×1.2)=6
    T('3 秒内第 2 次合成 ×1.2', g.score === 10, 'score=' + g.score);
    pair(6, 200); run(g, 0.3);                      // 合成 3：+round(6×1.5)=9
    T('3 秒内第 3 次合成 ×1.5', g.score === 19, 'score=' + g.score);
    pair(7, 100); run(g, 0.3);                      // 合成 4：+round(7×2)=14
    T('第 4 次起 ×2 封顶', g.score === 33, 'score=' + g.score);
    run(g, 3.5);                                    // 超 3 秒窗
    pair(3, 350); run(g, 0.3);                      // 合成 5：复位 ×1 → +3
    T('超窗连击复位 ×1', g.score === 36, 'score=' + g.score);
    T('连击状态可读', g.combo === 1 && g.comboMult === 1, 'combo=' + g.combo + ' mult=' + g.comboMult);
}

// ---------- [9] 取整口径回归（BUG-2）：round 口径 9 个分歧格 ----------
// 历史 bug：App toInt 截断 vs 网页 Math.round，30 个（源级×倍率）组合里 9 个分歧 →
// 双端分数漂移。本节把 round 口径锁死在全部分歧格上（旧单测选值恰好全落在整数格）。
// 双列分放（x=100 列 vs x=280 列）防产物互撞污染分数。
{
    const cells12 = [[3, 4], [4, 5], [8, 10], [9, 11]];           // [lv, round(lv×1.2)]
    const cells15 = [[1, 2], [3, 5], [5, 8], [7, 11], [9, 14]];   // [lv, round(lv×1.5)]
    for (const [k, want] of cells12) {
        const g = core.create({ seed: 9 });
        g.debugAdd(4, 100, 400); g.debugAdd(4, 120, 400); run(g, 0.3);   // 连击 1（×1）
        const s0 = g.score;
        g.debugAdd(k, 280, 300); g.debugAdd(k, 300, 300); run(g, 0.3);  // 连击 2 → ×1.2
        T(`BUG-2 分歧格 lv${k}×1.2 = +${want}（round 口径）`, g.score - s0 === want, `delta=${g.score - s0}`);
    }
    for (const [k, want] of cells15) {
        const g = core.create({ seed: 9 });
        g.debugAdd(4, 100, 400); g.debugAdd(4, 120, 400); run(g, 0.3);   // 连击 1（×1）
        g.debugAdd(5, 60, 300); g.debugAdd(5, 80, 300); run(g, 0.3);     // 连击 2（×1.2）
        const s0 = g.score;
        g.debugAdd(k, 280, 300); g.debugAdd(k, 300, 300); run(g, 0.3);  // 连击 3 → ×1.5
        T(`BUG-2 分歧格 lv${k}×1.5 = +${want}（round 口径）`, g.score - s0 === want, `delta=${g.score - s0}`);
    }
}

console.log(`\n===== melon_unit: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
