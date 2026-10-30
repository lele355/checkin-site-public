// _verify_c_browser.js —— Batch C 浏览器抽验（QA 严过关，真实点击/故障注入）：
//   M1 melon 真实点击链路「落→撞→合→分」（不走钩子）+ 现实堆形泄漏测量
//   F1 fish 3 命耗尽结束 + 无敌 2s 闪烁期间不掉命（时间签名断言）
//   F2 fish 同级可吃 + 连击 3 连×1.5 / 6 连×2（单帧确定性进食签名 625）
//   F3 fish 冲刺 1.2s 冷却（画布质心追踪：冷却期内点按不转向）
//   T1 melon/fish 教程 API 五节与引擎同规关键词
// 用法：站点 127.0.0.1:5188 已起 → node _verify_c_browser.js
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5188';
const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });

    // ================= M1 melon 真实点击链路 =================
    console.log('[M1] melon 真实点击「落→撞→合→分」+ 现实堆形泄漏');
    {
        const ctx = await browser.newContext({ viewport: { width: 900, height: 950 }, reducedMotion: 'reduce' });
        const page = await ctx.newPage();
        page.setDefaultTimeout(20000);
        await page.goto(BASE + '/Games/melon/Solo');
        await page.waitForLoadState('load');
        await sleep(600);
        const box = await page.locator('#soloCanvas').boundingBox();
        let scored = false, clicks = 0;
        for (let i = 0; i < 16 && !scored; i++) {
            const fx = 0.2 + ((i * 7) % 10) * 0.06;
            await page.mouse.move(box.x + box.width * fx, box.y + 30);
            await page.mouse.click(box.x + box.width * fx, box.y + 30);
            clicks++;
            await sleep(430);
            scored = parseInt(await page.locator('#soloScore').textContent(), 10) > 0;
        }
        T('真实点击链路：落→撞→合→分 >0', scored, `clicks=${clicks} score=${await page.locator('#soloScore').textContent()}`);

        // 再连点 10 次攒出真实堆形，经钩子读 body 测量泄漏（仅测量，不摆位）
        for (let i = 0; i < 10; i++) {
            const fx = 0.15 + ((i * 3) % 8) * 0.09;
            await page.mouse.click(box.x + box.width * fx, box.y + 30);
            await sleep(430);
        }
        await sleep(1200);
        const stat = await page.evaluate(() => {
            const g = window.__melonGame;
            let leak = 0, ov = 0, n = g.bodies.length;
            for (const b of g.bodies) leak = Math.max(leak, b.x + b.r - g.width, b.r - b.x, b.y + b.r - g.height);
            for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
                const a = g.bodies[i], b = g.bodies[j];
                ov = Math.max(ov, a.r + b.r - Math.hypot(b.x - a.x, b.y - a.y));
            }
            return { leak: leak.toFixed(1), ov: ov.toFixed(1), n, over: g.over };
        });
        T('现实堆形（真实点击 20+ 次）泄漏 ≤5px、互穿 ≤3px',
            parseFloat(stat.leak) <= 5 && parseFloat(stat.ov) <= 3, JSON.stringify(stat));
        await ctx.close();
    }

    // ================= F1 fish 3 命 + 无敌时间签名 =================
    console.log('[F1] fish 3 命耗尽结束 + 无敌 2s 不掉命（时间签名）');
    {
        const ctx = await browser.newContext({ viewport: { width: 900, height: 950 }, reducedMotion: 'reduce' });
        await ctx.addInitScript(() => {
            Math.random = () => 0.99;    // 全部刷 6 级大鱼（玩家 0 级必被吃）；珍珠/补刷概率归零
            Math.hypot = () => 0;        // 强制接触：每帧必撞（故障注入）
        });
        const page = await ctx.newPage();
        const t0 = Date.now();
        await page.goto(BASE + '/Games/fish/Solo');
        await page.waitForLoadState('load');
        // 1.5s 时弹窗必须未出现：没有 2s 无敌的话 3 帧内就会死完
        await sleep(1500);
        const early = await page.evaluate(() => !document.getElementById('soloEndModal').hidden);
        T('1.5s 时未结束（无敌帧在挡）', !early, `modal=${early}`);
        let tModal = null;
        for (let i = 0; i < 60 && tModal === null; i++) {
            await sleep(250);
            if (await page.evaluate(() => !document.getElementById('soloEndModal').hidden)) tModal = Date.now() - t0;
        }
        T('3 命耗尽 → 结束弹窗出现', tModal !== null, `t=${tModal}ms`);
        T('首伤→结束 ≥3.8s（两段 2s 无敌间隔实证）', tModal !== null && tModal >= 3800, `t=${tModal}ms`);
        const score = await page.locator('#soloEndScore').textContent();
        T('全程未吃到 6 级鱼（仅珍珠 +30）', score === '30', `score=${score}`);
        await ctx.close();
    }

    // ================= F2 fish 同级可吃 + 连击倍率（单帧确定性签名） =================
    console.log('[F2] fish 同级可吃 + 连击 3 连×1.5 / 6 连×2（签名 625）');
    {
        const ctx = await browser.newContext({ viewport: { width: 900, height: 950 }, reducedMotion: 'reduce' });
        await ctx.addInitScript(() => {
            Math.random = () => 0.1;     // 全部刷 0 级小鱼（同级）；每校 2 条 → 场上恰 8 条；无珍珠补刷
            Math.hypot = (function (orig) {
                return function (a, b) {
                    if (window.__hm === 'pearl') return 16.5;  // <17(珍珠阈) 且 ≥16(鱼阈) → 只吃珍珠
                    if (window.__hm === 'fish') return 15.5;   // 鱼珍珠都撞（珍珠已清空且不补刷）
                    return orig(a, b);
                };
            })(Math.hypot);
        });
        const page = await ctx.newPage();
        await page.goto(BASE + '/Games/fish/Solo');
        await page.waitForLoadState('load');
        // 阶段 A：只吃珍珠 → 基线 30
        await page.evaluate(() => { window.__hm = 'pearl'; });
        await sleep(700);
        await page.evaluate(() => { window.__hm = 'none'; });
        await sleep(120);
        const s0 = parseInt(await page.locator('#soloScore').textContent(), 10);
        T('阶段 A：珍珠 3×10=30 基线', s0 === 30, `s0=${s0}`);
        // 阶段 B：恰好一个游戏步强制进食（帧序注入）
        await page.evaluate(() => new Promise(res => {
            requestAnimationFrame(() => {
                window.__hm = 'fish';
                requestAnimationFrame(() => { window.__hm = 'none'; res(); });
            });
        }));
        await sleep(150);
        const s1 = parseInt(await page.locator('#soloScore').textContent(), 10);
        const delta = s1 - s0;
        // 8 条同级鱼依次进账：50,50,75,75,75,100,100,100 = 625（同级可吃 + 3 连×1.5 + 6 连×2 同时得证）
        T('单步吃 8 条同级鱼（同级可吃）', delta > 0, `delta=${delta}`);
        T('连击倍率签名 625 = 50+50+75×3+100×3', delta === 625, `delta=${delta}（50/50/75/75/75/100/100/100）`);
        await ctx.close();
    }

    // ================= F3 fish 冲刺冷却（画布质心追踪） =================
    console.log('[F3] fish 冲刺 1.2s 冷却（点按转向只在冷却结束后生效）');
    {
        const ctx = await browser.newContext({ viewport: { width: 900, height: 950 }, reducedMotion: 'reduce' });
        await ctx.addInitScript(() => { Math.random = () => 0.1; });   // 小鱼无威胁、不干扰质心
        const page = await ctx.newPage();
        await page.goto(BASE + '/Games/fish/Solo');
        await page.waitForLoadState('load');
        const box = await page.locator('#soloCanvas').boundingBox();
        const centroid = () => page.evaluate(() => {
            const c = document.getElementById('soloCanvas');
            const g = c.getContext('2d');
            const d = g.getImageData(0, 0, c.width, c.height).data;
            let sx = 0, sy = 0, n = 0;
            for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
                const i = (y * c.width + x) * 4;
                if (Math.abs(d[i] - 255) < 24 && Math.abs(d[i + 1] - 179) < 24 && d[i + 2] < 40) { sx += x; sy += y; n++; }
            }
            return n ? { x: sx / n, y: sy / n, n } : null;
        });
        // 停靠右侧
        await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
        await sleep(900);
        const p0 = await centroid();
        T('玩家鱼质心可测（橙色像素）', !!p0 && p0.n > 4, JSON.stringify(p0));
        // 第一次点按：冲向左上（画布坐标 30,60）
        const clickAt = (cx, cy) => page.evaluate(([cx, cy]) => {
            const c = document.getElementById('soloCanvas');
            const r = c.getBoundingClientRect();
            c.dispatchEvent(new MouseEvent('click', { clientX: r.left + cx, clientY: r.top + cy, bubbles: true }));
        }, [cx, cy]);
        await clickAt(30, 60);
        await sleep(400);
        const p1 = await centroid();
        // 冷却期内第二次点按（反方向）：应被忽略
        await clickAt(330, 60);
        await sleep(450);
        const p2 = await centroid();
        // 冷却结束（>1.2s）后第三次点按反方向：应生效
        await sleep(500);
        await clickAt(330, 60);
        await sleep(450);
        const p3 = await centroid();
        T('冲刺生效：首次点按后向左上位移', !!p0 && !!p1 && p1.x < p0.x - 12, `p0x=${p0 && p0.x.toFixed(0)} p1x=${p1 && p1.x.toFixed(0)}`);
        T('冷却期内点按被忽略（不反向）', !!p1 && !!p2 && p2.x <= p1.x + 10, `p1x=${p1 && p1.x.toFixed(0)} p2x=${p2 && p2.x.toFixed(0)}`);
        T('冷却结束后点按生效（向右折返）', !!p2 && !!p3 && p3.x > p2.x + 12, `p2x=${p2 && p2.x.toFixed(0)} p3x=${p3 && p3.x.toFixed(0)}`);
        await ctx.close();
    }

    // ================= T1 教程 API 与引擎同规 =================
    console.log('[T1] melon/fish 教程 API（双端同源 GameTutorials）');
    {
        const login = await (await fetch(BASE + '/api/v1/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'QA_alpha', password: 'QaGames2026!', device: 'c-final' }),
        })).json();
        const tok = login.data.token;
        for (const [gk, keys] of [
            ['melon', ['11 级', '约 1 秒', 'k 分', '+100', '下一个']],
            ['fish', ['3 条命', '2 秒无敌', '1.2 秒冷却', '同级可吃', '3 连击 ×1.5、6 连击 ×2', '50', '1800', '+10']],
        ]) {
            const r = await (await fetch(`${BASE}/api/v1/games/${gk}/tutorial`, { headers: { Authorization: 'Bearer ' + tok } })).json();
            const secs = (r.data && (r.data.sections || r.data)) || [];
            const all = JSON.stringify(secs);
            T(`${gk} 教程五节`, r.ok && Array.isArray(secs) && secs.length === 5, `n=${Array.isArray(secs) ? secs.length : 'NA'}`);
            const missing = keys.filter(k => !all.includes(k));
            T(`${gk} 教程含引擎同规关键词`, missing.length === 0, missing.join('/') || 'ok');
        }
    }

    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL >> ' + r.name + '  [' + r.extra + ']');
    await browser.close();
    process.exit(fail ? 1 : 0);
})();
