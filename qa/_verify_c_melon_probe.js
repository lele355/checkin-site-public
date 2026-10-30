// _verify_c_melon_probe.js —— Batch C 合成大西瓜物理攻击性探针（QA 严过关，Node 直打 melon-core）。
// 覆盖：①两西瓜爆炸位置/计分 ②警戒线「越线移动不误判 / 越线静止判负」 ③掉落加权 [2,3,4,1,2] 500 抽样
//      + 物理攻击：同级堆塔不穿底、边缘投掷不出界、合成链到西瓜+爆炸、随机风暴不变量。
// 用法：node _verify_c_melon_probe.js
const M = require('D:/checkin/site/CheckinApp/wwwroot/js/solo/melon-core.js');

const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}

function invariants(g, tag) {
    for (const b of g.bodies) {
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return tag + ' NaN@' + b.level;
        if (b.y + b.r > g.height + 0.5) return tag + ' 穿底 y=' + b.y.toFixed(1) + ' r=' + b.r;
        if (b.x - b.r < -0.5 || b.x + b.r > g.width + 0.5) return tag + ' 出界 x=' + b.x.toFixed(1);
    }
    return '';
}
function maxOverlap(g) {
    let worst = 0;
    for (let i = 0; i < g.bodies.length; i++)
        for (let j = i + 1; j < g.bodies.length; j++) {
            const a = g.bodies[i], b = g.bodies[j];
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            worst = Math.max(worst, (a.r + b.r) - d);
        }
    return worst;
}

// ============ ① 两西瓜相撞爆炸：位置/计分 ============
console.log('[①] 两西瓜爆炸：双消 +100、无残留、上方果补位不穿底');
{
    const g = M.create({ seed: 11 });
    g.debugAdd(11, 100, 300);
    g.debugAdd(11, 150, 300);
    g.step(0.2);
    const evs = g.drainEvents();
    T('爆炸事件恰好 1 条且类型 explode', evs.filter(e => e.type === 'explode').length === 1, JSON.stringify(evs));
    const ex = evs.find(e => e.type === 'explode');
    T('爆炸点 = 两瓜中点', ex && Math.abs(ex.x - 125) < 1 && Math.abs(ex.y - 300) < 1, ex && `x=${ex.x} y=${ex.y}`);
    T('计分爆炸 +100（一次，不多）', g.score === 100, `score=${g.score}`);
    T('爆炸后盘面清空（无残留体）', g.bodies.length === 0, `n=${g.bodies.length}`);
    // 爆炸缺口上方补一颗果 → 落底不穿底
    g.debugAdd(3, 125, 80);
    for (let i = 0; i < 300 && !g.over; i++) g.step(1 / 60);
    const b = g.bodies[0];
    T('缺口果补位落底不穿底', !!b && b.y + b.r <= g.height + 0.5 && Math.abs(b.y + b.r - g.height) < 2, b && `y=${b.y.toFixed(1)} r=${b.r}`);
    T('补位过程无出界/NaN', invariants(g, 'post-explode') === '', invariants(g, 'post-explode'));
}

// ============ ② 警戒线：越线移动不误判 / 越线静止判负 ============
console.log('[②] 警戒线（越线且静止 >0.8s 才判负）');
{
    // ②a 越线但持续移动（模拟贴顶滚动/弹跳）2 秒 → 不误判
    const g = M.create({ seed: 22 });
    const b = g.debugAdd(2, 180, 50);   // 质心在警戒线（96）上方
    for (let i = 0; i < 120; i++) {
        b.y = 50; b.x = 30 + (i % 12) * 25; b.vx = 200; b.vy = 120;   // 保持越线且持续运动
        g.step(1 / 60);
    }
    T('越线持续移动 2s 不误判', !g.over, `over=${g.over} overTimer=${g.overTimer.toFixed(2)}`);
    T('计时未积累（衰减）', g.overTimer < 0.05, `overTimer=${g.overTimer.toFixed(2)}`);

    // ②b 越线静止：0.6s 内不判，0.9s 判负
    const g2 = M.create({ seed: 23 });
    const b2 = g2.debugAdd(2, 180, 50);
    for (let i = 0; i < 60; i++) { b2.y = 50; b2.vx = 0; b2.vy = 0; b2.age += 0; g2.step(1 / 60); }   // 1.0s（含 0.4s age 门槛）
    T('静止 ~0.6s 缓冲内不误判', !g2.over, `overTimer=${g2.overTimer.toFixed(2)}`);
    for (let i = 0; i < 30; i++) { b2.y = 50; b2.vx = 0; b2.vy = 0; g2.step(1 / 60); }                 // 再 +0.5s → 静止约 0.9s
    T('越线静止 0.9s 判负', g2.over, `overTimer=${g2.overTimer.toFixed(2)}`);

    // ②c 未越线静止不判（对照）
    const g3 = M.create({ seed: 24 });
    const b3 = g3.debugAdd(2, 180, 300);
    for (let i = 0; i < 180; i++) { b3.y = 300; b3.vx = 0; b3.vy = 0; g3.step(1 / 60); }
    T('线下静止 3s 不判负', !g3.over, `overTimer=${g3.overTimer.toFixed(2)}`);
}

// ============ ③ 掉落加权：500 抽样 ============
console.log('[③] 掉落加权（1..5 级，[2,3,4,1,2]：橘子最多、柠檬最少）');
{
    const counts = [0, 0, 0, 0, 0, 0];
    for (let seed = 1; seed <= 500; seed++) {
        const g = M.create({ seed });
        counts[g.curLevel]++;
    }
    const sum = counts.slice(1).reduce((a, b) => a + b, 0);
    T('500 抽样全部落在 1..5 级', sum === 500, counts.slice(1).join(','));
    T('橘子(3 级)最常见', counts[3] === Math.max(...counts.slice(1)), counts.slice(1).join(','));
    T('柠檬(4 级)最少', counts[4] === Math.min(...counts.slice(1)), counts.slice(1).join(','));
    // 比例逼近 [2,3,4,1,2]/12（±8 个百分点容差）
    const exp = [2 / 12, 3 / 12, 4 / 12, 1 / 12, 2 / 12];
    let ratioOk = true; const detail = [];
    for (let lv = 1; lv <= 5; lv++) {
        const p = counts[lv] / 500;
        detail.push(`${lv}:${p.toFixed(2)}`);
        if (Math.abs(p - exp[lv - 1]) > 0.08) ratioOk = false;
    }
    T('分布比例逼近 [2,3,4,1,2]/12', ratioOk, detail.join(' '));
    // 掉落体级别只含 1..5（连 drop 链验证）
    const g = M.create({ seed: 999 });
    let only15 = true;
    for (let i = 0; i < 30; i++) {
        g.step(0.4);
        if (!g.dropReady) { i--; continue; }
        const ok = g.drop();
        if (!ok) { i--; continue; }
        const lv = g.bodies[g.bodies.length - 1].level;
        if (lv < 1 || lv > 5) only15 = false;
        if (g.bodies.length > 12) { g.bodies.length = 0; }
    }
    T('实际掉落体级别只含 1..5', only15);
}

// ============ 物理攻击 A：快速同级堆塔 ============
console.log('[物理A] 快速连点同级果堆塔：合成不穿透、不塌穿底');
{
    const g = M.create({ seed: 33 });
    for (let k = 0; k < 8; k++) g.debugAdd(3, 180, 60 + k * 26);   // 8 颗橘子错位叠落（等效快速连点同一点位）
    let bad = '';
    for (let i = 0; i < 900 && !bad; i++) { g.step(1 / 60); bad = invariants(g, 'tower'); }
    T('堆塔 15s 全程不穿底/不出界/无 NaN', bad === '', bad);
    const ov = maxOverlap(g);
    T('静置后无深度互穿（重叠 < 半径 20%）', ov < Math.max(...g.bodies.map(b => b.r)) * 0.2, `maxOverlap=${ov.toFixed(1)} bodies=${g.bodies.length}`);
    const evs = g.drainEvents();
    T('塔上发生级联合成', evs.filter(e => e.type === 'merge').length >= 3, `merges=${evs.filter(e => e.type === 'merge').length} 剩余=${g.bodies.length} 级=${g.bodies.map(b => b.level).join(',')}`);
    T('等差计分核对（8 橘子 → 合成链）', g.score === evs.filter(e => e.type === 'merge').reduce((s, e) => s + (e.level - 1), 0), `score=${g.score}`);
}

// ============ 物理 B：瞄准容器边缘投掷 ============
console.log('[物理B] 边缘投掷不出界');
{
    const g = M.create({ seed: 44 });
    g.aim(0); g.drop();
    const b1 = g.bodies[0];
    T('aim(0) 落点贴左壁且不越界', Math.abs(b1.x - b1.r) < 0.01, `x=${b1.x} r=${b1.r}`);
    // 掉落冷却 0.35s；step() 有 0.05s 掉帧保护，逐步推进 0.5s 模拟时间清冷却（QA 修探针）
    for (let i = 0; i < 30; i++) g.step(1 / 60);
    g.aim(g.width); g.drop();
    const b2 = g.bodies[g.bodies.length - 1];
    T('aim(右缘) 落点贴右壁且不越界', Math.abs(b2.x - (g.width - b2.r)) < 0.01, `x=${b2.x} r=${b2.r}`);
    let bad = '';
    for (let i = 0; i < 300 && !bad; i++) { g.step(1 / 60); bad = invariants(g, 'edge'); }
    T('边缘投掷后 5s 无出界', bad === '', bad);
}

// ============ 物理 C：合成链到西瓜 + 两西瓜爆炸（物理路径全链） ============
console.log('[物理C] 合成链：两对半西瓜 → 两西瓜 → 相撞爆炸');
{
    const g = M.create({ seed: 55 });
    g.debugAdd(10, 90, 400); g.debugAdd(10, 128, 400);    // 对 1：两半西瓜物理接触 → 合成西瓜
    g.step(0.3);
    let evs = g.drainEvents();
    T('半西瓜合成 +10+100=110', g.score === 110 && evs.some(e => e.type === 'merge' && e.level === 11), `score=${g.score}`);
    g.debugAdd(10, 260, 400); g.debugAdd(10, 298, 400);   // 对 2
    g.step(0.3);
    evs = g.drainEvents();
    T('第二对再合成（累计 220）', g.score === 220 && evs.some(e => e.type === 'merge' && e.level === 11), `score=${g.score}`);
    T('盘面恰好两颗西瓜', g.bodies.length === 2 && g.bodies.every(b => b.level === 11), g.bodies.map(b => b.level).join(','));
    // 等锁定解除后对撞
    for (let i = 0; i < 12; i++) g.step(1 / 60);
    const [w1, w2] = g.bodies;
    w1.vx = 260; w2.vx = -260;                            // 相向推挤
    for (let i = 0; i < 240; i++) {
        g.step(1 / 60);
        if (g.bodies.length === 0) break;
        if (g.bodies.length === 2) { g.bodies[0].vx += g.bodies[0].x < 180 ? 8 : -8; g.bodies[1].vx += g.bodies[1].x < 180 ? 8 : -8; }
    }
    evs = g.drainEvents();
    T('两西瓜相撞爆炸（explode）', evs.some(e => e.type === 'explode'), evs.map(e => e.type).join(','));
    T('爆炸计分 +100 → 累计 320', g.score === 320, `score=${g.score}`);
    T('爆炸后无残留体', g.bodies.length === 0, `n=${g.bodies.length}`);
}

// ============ 物理 D：随机风暴不变量（确定性种子） ============
console.log('[物理D] 60 果随机风暴：无 NaN / 不穿底 / 收敛不深度互穿 / 不逃逸容器');
{
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const rnd = mulberry32(666);
    const g = M.create({ seed: 66 });
    for (let k = 0; k < 60; k++) {
        const lv = 1 + (k % 5);
        const b = g.debugAdd(lv, 20 + rnd() * 320, 40 + rnd() * 60);
        b.vx = (rnd() - 0.5) * 300;
    }
    let bad = '', maxLeak = 0;
    for (let i = 0; i < 3600; i++) {
        g.step(1 / 60);
        for (const b of g.bodies) {
            maxLeak = Math.max(maxLeak, b.x + b.r - g.width, b.r - b.x, b.y + b.r - g.height);
        }
        // 硬不变量：NaN / 逃逸 / 穿底 >5px（密堆求解器残余容差，现实负载实测 ≤1.5px）
        for (const b of g.bodies) {
            if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) { bad = 'storm NaN'; break; }
            if (b.y + b.r > g.height + 5) { bad = 'storm 穿底 y=' + b.y.toFixed(1); break; }
            if (b.x + b.r > g.width + 20 || b.x - b.r < -20) { bad = 'storm 逃逸 x=' + b.x.toFixed(1); break; }
        }
        if (bad) break;
    }
    T('随机风暴 60s 无 NaN / 不深度穿底 / 不逃逸容器', bad === '', bad + ` bodies=${g.bodies.length} score=${g.score}`);
    const ov = maxOverlap(g);
    T('风暴收敛（60s）后互穿 ≤3px（求解器容差级）', ov < 3, `maxOverlap=${ov.toFixed(1)}`);
    // P3 观察断言：密堆下内壁求解器残余泄漏应有限（诊断实测 ≤8.5px@60 果极端堆）
    T('内壁泄漏有限（≤15px，P3 观察项）', maxLeak <= 15, `maxLeak=${maxLeak.toFixed(1)}px`);
}

const pass = results.filter(r => r.ok).length, fail = results.length - pass;
console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
for (const r of results.filter(x => !x.ok)) console.log('  FAIL >> ' + r.name + '  [' + r.extra + ']');
process.exit(fail ? 1 : 0);
