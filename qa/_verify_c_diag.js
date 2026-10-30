// _verify_c_diag.js —— 风暴出界/互穿诊断：量化墙外凸幅度与互穿收敛趋势（定性用）
const M = require('D:/checkin/site/CheckinApp/wwwroot/js/solo/melon-core.js');

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

for (const seed of [1, 2, 3]) {
    const rnd = mulberry32(seed * 777);
    const g = M.create({ seed });
    for (let k = 0; k < 60; k++) {
        const lv = 1 + (k % 5);
        const b = g.debugAdd(lv, 20 + rnd() * 320, 40 + rnd() * 60);
        b.vx = (rnd() - 0.5) * 300;
    }
    let maxOut = 0, outSteps = 0, totalSteps = 0;
    const overlapAt = [];
    for (let i = 0; i < 3600; i++) {
        g.step(1 / 60);
        totalSteps++;
        let out = 0;
        for (const b of g.bodies) {
            if (b.x + b.r > g.width + 0.5) out = Math.max(out, b.x + b.r - g.width);
            if (b.x - b.r < -0.5) out = Math.max(out, b.r - b.x);
            if (b.y + b.r > g.height + 0.5) out = Math.max(out, b.y + b.r - g.height);
        }
        if (out > 0) outSteps++;
        maxOut = Math.max(maxOut, out);
        if (i % 600 === 599) {
            let worst = 0;
            for (let p = 0; p < g.bodies.length; p++)
                for (let q = p + 1; q < g.bodies.length; q++) {
                    const a = g.bodies[p], b = g.bodies[q];
                    worst = Math.max(worst, a.r + b.r - Math.hypot(b.x - a.x, b.y - a.y));
                }
            overlapAt.push(worst.toFixed(1));
        }
    }
    console.log(`seed=${seed} bodies=${g.bodies.length} maxWallOut=${maxOut.toFixed(1)}px outSteps=${outSteps}/${totalSteps} overlapTrend@6s间隔=${overlapAt.join(' → ')}`);
}
