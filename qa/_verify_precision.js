// _verify_precision.js — 落子精度专项：15路 vs 19路，逐点验证（beta 交替走子换回 admin 回合）
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const results = [];
function T(n, ok, e) { results.push({ n, ok, e }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'prec' }) }); return (await r.json()).data.token; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const beta = await loginApi('QA_beta');
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);

    async function setSize(sz) {
        await page.goto(BASE + '/Games/Gomoku/Settings');
        await page.waitForLoadState('load');
        await page.locator('select[name="size"]').selectOption(String(sz));
        await Promise.all([page.waitForLoadState('load'), page.locator('form button[type="submit"]').first().click()]);
        await page.waitForTimeout(400);
    }
    async function newRoom() {
        await page.goto(BASE + '/Games/gomoku');
        await page.waitForLoadState('load');
        const btn = page.locator('form button[type="submit"]').filter({ hasText: /我先手/ }).first();
        await Promise.all([page.waitForURL(/Play/i), btn.click()]);
        const id = Number(page.url().match(/Play\/(\d+)/)[1]);
        await fetch(`${BASE}/api/v1/games/gomoku/rooms/${id}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: '{}' });
        await page.waitForTimeout(1500);
        return id;
    }
    const snapOf = async (id, tok) => (await (await fetch(`${BASE}/api/v1/games/gomoku/rooms/${id}`, { headers: { Authorization: 'Bearer ' + tok } })).json()).data;

    async function run(label, size, targets, betaCells) {
        await setSize(size);
        const id = await newRoom();
        const st = await snapOf(id, beta);
        const S = (st.state && st.state.size) || size;
        T(`${label} 房间盘面 ${S} 路`, S === size, 'size=' + S);
        const showCoord = st.showCoord !== false;
        const mism = [];
        for (let k = 0; k < targets.length; k++) {
            const [c, r] = targets[k];
            const pt = await page.evaluate(({ c, r, showCoord, S }) => {
                const svg = document.querySelector('svg.gm-board');
                const rect = svg.getBoundingClientRect();
                const pad = showCoord ? 40 : 20;
                const step = (640 - pad * 2) / S;
                const px = pad + c * step + step / 2, py = pad + r * step + step / 2;
                return { x: rect.left + px / 640 * rect.width, y: rect.top + py / 640 * rect.height };
            }, { c, r, showCoord, S });
            await page.mouse.click(pt.x, pt.y);
            await page.waitForTimeout(1400);
            const s1 = await snapOf(id, beta);
            const got = s1.lastMove;
            if (!got || got.x !== c || got.y !== r) mism.push(`(${c},${r})→(${got ? got.x + ',' + got.y : 'null'})`);
            // beta 走一手，换回 admin 回合（beta 落点避开所有 target 与已落子）
            const [bc, br] = betaCells[k];
            await fetch(`${BASE}/api/v1/games/gomoku/rooms/${id}/move`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: bc, y: br }) });
            await page.waitForTimeout(1400);
        }
        T(`${label} 落子精度（${targets.length} 点）`, mism.length === 0, mism.join(' | ') || targets.map(t => '(' + t + ')').join(',') + ' 全部准');
        return id;
    }

    // 15 路（历史默认）：角/中心/边
    await run('15路', 15, [[0, 0], [7, 7], [14, 14], [3, 11]], [[0, 1], [1, 0], [2, 1], [1, 2]]);
    // 19 路（当前设置）：同型点位
    await run('19路', 19, [[0, 0], [9, 9], [18, 18], [3, 15]], [[0, 1], [1, 0], [2, 1], [1, 2]]);
    // 恢复 19（与测试前一致）
    await setSize(19);

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
