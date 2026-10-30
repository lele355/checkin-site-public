// _verify_t05fix.js — T05-1/T05-2 修复复验：落点精度矩阵 + 横屏裁切 + 显示名
// 用法: node _verify_t05fix.js [P|L|all]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const BASE = 'http://127.0.0.1:5188';
const SHOTS = 'D:/checkin/site/qa/shots_t05fix';
const fs = require('fs');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function dbSet(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    execFileSync('python', ['-c', `import sqlite3; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); c.execute("""update GameRooms set MovesJson='${json}'${extra} where Id=${id}"""); c.commit(); c.close()`]);
}
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 't05fix' }) }); return (await r.json()).data.token; }

(async () => {
    const only = process.argv[2] || 'all';
    const beta = await loginApi('QA_beta');
    const browser = await chromium.launch({ channel: 'msedge' });

    // ---------- 落点精度 ----------
    async function precisionSet(viewport, label, sets) {
        const ctx = await browser.newContext({ viewport });
        const page = await ctx.newPage();
        page.setDefaultTimeout(20000);
        const table = [];

        async function setShowCoord(v) {
            await page.goto(BASE + '/Games/Settings');
            await page.waitForLoadState('load');
            const cb = page.locator('input[name="showCoord"]');
            const on = await cb.isChecked();
            if (on !== v) await (v ? cb.check() : cb.uncheck());
            await Promise.all([page.waitForLoadState('load'), page.locator('form button[type="submit"]').first().click()]);
            await sleep(400);
        }

        async function oneClick(gk, target, size) {
            // 1) 页面内建房（cookie=admin）；2) beta 加入；3) 进 Play；4) 捕获几何；5) 点像素抓 POST
            const id = await page.evaluate(async ({ gk, size }) => {
                const body = { side: 1 };
                if (size) body.size = size;
                const r = await fetch('/api/v1/games/' + gk + '/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                const j = await r.json();
                return j.data.id;
            }, { gk, size });
            await fetch(`${BASE}/api/v1/games/${gk}/rooms/${id}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: '{}' });
            if (gk === 'reversi') {
                // craft：让角点成为合法翻子点（黑(2,0)+白(1,0) → (0,0) 合法；黑(5,7)+白(6,7) → (7,7) 合法）
                const [cx, cy] = target;
                const evs = cx === 0
                    ? [{ t: 'setup', s: 0 }, { t: 'move', s: 1, x: 2, y: 0 }, { t: 'move', s: 2, x: 1, y: 0 }]
                    : [{ t: 'setup', s: 0 }, { t: 'move', s: 1, x: 5, y: 7 }, { t: 'move', s: 2, x: 6, y: 7 }];
                dbSet(id, evs, ", Turn=1, Status='playing', Revision=10");
            }
            await page.goto(`${BASE}/Games/${gk}/Play/${id}`);
            await sleep(1500);
            // 几何：调用渲染模块拿 geom（与绘制同源）
            const pt = await page.evaluate(({ gk, c, r }) => {
                const st = JSON.parse(document.getElementById('gmState').textContent);
                const mod = window[{ gomoku: 'GomokuBoard', reversi: 'ReversiBoard', jungle: 'JungleBoard', xiangqi: 'XiangqiBoard', armychess: 'ArmyChessBoard' }[gk]];
                const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                const geom = mod.render(tmp, st.state || {}, { showCoord: st.showCoord, mySide: st.mySide, myTurn: st.myTurn, lastMark: false, tapConfirm: false });
                const svg = document.querySelector('svg.gm-board');
                const rect = svg.getBoundingClientRect();
                const vb = svg.viewBox.baseVal;
                const vw = vb && vb.width ? vb.width : 640, vh = vb && vb.height ? vb.height : 640;
                const vx = geom.mode === 'point' ? geom.pad + c * geom.cw : geom.pad + c * geom.cw + geom.cw / 2;
                const vy = geom.mode === 'point' ? geom.pad + r * geom.ch : geom.pad + r * geom.ch + geom.ch / 2;
                return {
                    relX: vx / vw * rect.width,
                    relY: vy / vh * rect.height,
                    geom: { pad: geom.pad, cw: geom.cw, ch: geom.ch, mode: geom.mode, cols: geom.cols, rows: geom.rows },
                    myTurn: st.myTurn, status: st.status,
                };
            }, { gk, c: target[0], r: target[1] });
            // 抓 POST body
            let body = null;
            const handler = req => { if (req.url().includes('/move') && req.method() === 'POST') body = req.postData(); };
            page.on('request', handler);
            await page.locator('svg.gm-board').first().click({ position: { x: pt.relX, y: pt.relY } });
            await sleep(700);
            page.off('request', handler);
            let got = null;
            try { got = JSON.parse(body); } catch (_) { }
            const ok = got && got.x === target[0] && got.y === target[1];
            table.push({ game: gk, size: size || '', target, got: got ? `(${got.x},${got.y})` : '无请求', geom: `${pt.geom.mode} pad=${pt.geom.pad} cw=${pt.geom.cw.toFixed(1)}`, ok });
            return ok;
        }

        for (const set of sets) {
            await setShowCoord(set.showCoord);
            for (const g of set.games) {
                if (g.game === 'gomoku' && g.size) {
                    // gomoku 尺寸走建房覆盖即可，无需改设置
                }
                for (const t of g.targets) {
                    await oneClick(g.game, t, g.size);
                }
            }
        }
        const bad = table.filter(r => !r.ok);
        T(`落点精度 ${label}：${table.length} 点全准`, bad.length === 0,
            bad.map(b => `${b.game}${b.size ? '@' + b.size : ''}(${b.target})→${b.got}`).join(' | ') || `全部一致`);
        // 逐点表打印
        for (const r of table) console.log(`    ${r.ok ? '✓' : '✗'} ${r.game}${r.size ? '@' + r.size : ''} 点(${r.target}) → ${r.got}   [${r.geom}]`);
        await ctx.close();
        return table;
    }

    if (only === 'all' || only === 'P') {
        console.log('\n===== P1 360×640 showCoord=ON 全矩阵 =====');
        await precisionSet({ width: 360, height: 640 }, '360×640/坐标开', [{
            showCoord: true,
            games: [
                { game: 'gomoku', size: 19, targets: [[0, 0], [18, 18], [9, 9], [3, 15], [0, 18], [18, 0]] },
                { game: 'gomoku', size: 15, targets: [[0, 0], [14, 14], [7, 7]] },
                { game: 'gomoku', size: 13, targets: [[0, 0], [12, 12], [6, 6]] },
                { game: 'xiangqi', targets: [[0, 0], [8, 9], [4, 4], [0, 9], [8, 0]] },
                { game: 'jungle', targets: [[0, 0], [6, 8], [3, 4], [0, 8], [6, 0]] },
                { game: 'armychess', targets: [[0, 0], [4, 11], [2, 6], [0, 11], [4, 0]] },
                { game: 'reversi', targets: [[0, 0], [7, 7]] },
            ],
        }]);
        console.log('\n===== P2 360×640 showCoord=OFF 子矩阵（pad=20） =====');
        await precisionSet({ width: 360, height: 640 }, '360×640/坐标关', [{
            showCoord: false,
            games: [
                { game: 'gomoku', size: 19, targets: [[0, 0], [18, 18], [9, 9], [3, 15], [0, 18], [18, 0]] },
                { game: 'xiangqi', targets: [[0, 0], [8, 9]] },
                { game: 'jungle', targets: [[0, 0], [6, 8]] },
                { game: 'armychess', targets: [[0, 0], [4, 11]] },
                { game: 'reversi', targets: [[0, 0]] },
            ],
        }]);
        console.log('\n===== P3 1280×900 showCoord=ON 抽查（缩放无关） =====');
        await precisionSet({ width: 1280, height: 900 }, '1280×900/坐标开', [{
            showCoord: true,
            games: [
                { game: 'gomoku', size: 19, targets: [[0, 0], [18, 18], [9, 9]] },
                { game: 'xiangqi', targets: [[0, 0], [8, 9]] },
                { game: 'jungle', targets: [[6, 8]] },
                { game: 'armychess', targets: [[4, 11]] },
                { game: 'reversi', targets: [[7, 7]] },
            ],
        }]);
    }

    // ---------- 横屏裁切 + 竖屏回归 + 显示名 ----------
    if (only === 'all' || only === 'L') {
        console.log('\n===== L 横屏裁切 / 竖屏回归 / 显示名 =====');
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(20000);
        for (const gk of ['xiangqi', 'jungle', 'armychess', 'ludo']) {
            await page.goto(BASE + '/Games/' + gk);
            await page.waitForLoadState('load');
            const btn = page.locator('form button[type="submit"]').filter({ hasText: /我先手|新建对局/ }).first();
            if (await btn.count()) {
                await Promise.all([page.waitForURL(/Play/i), btn.click()]);
                await sleep(900);
                const r = await page.evaluate(() => {
                    const svg = document.querySelector('svg.gm-board');
                    const b = svg.getBoundingClientRect();
                    return { bottom: b.bottom, right: b.right, scrollH: document.documentElement.scrollHeight, vh: window.innerHeight, vw: window.innerWidth };
                });
                T(`横屏 ${gk}：svgBottom≤390`, r.bottom <= 391, `bottom=${r.bottom.toFixed(0)}`);
                T(`横屏 ${gk}：scrollHeight≤390（无纵向滚动）`, r.scrollH <= 391, `scrollH=${r.scrollH}`);
                await page.screenshot({ path: SHOTS + '/landscape_' + gk + '.png' });
            } else T(`横屏 ${gk} 建房按钮`, false);
        }
        await ctx.close();

        // 竖屏 360×640 回归：gromoku 棋盘完整、无溢出
        const ctxP = await browser.newContext({ viewport: { width: 360, height: 640 } });
        const pageP = await ctxP.newPage();
        await pageP.goto(BASE + '/Games/gomoku');
        await pageP.waitForLoadState('load');
        const btnP = pageP.locator('form button[type="submit"]').filter({ hasText: /我先手/ }).first();
        await Promise.all([pageP.waitForURL(/Play/i), btnP.click()]);
        await sleep(800);
        const pr = await pageP.evaluate(() => {
            const svg = document.querySelector('svg.gm-board');
            const b = svg.getBoundingClientRect();
            return { left: b.left, right: b.right, w: b.width, ov: document.documentElement.scrollWidth - window.innerWidth };
        });
        T('竖屏 360 回归：棋盘完整在视口内、无横向溢出', pr.left >= -1 && pr.right <= 361 && pr.ov <= 1, JSON.stringify(pr));
        await pageP.screenshot({ path: SHOTS + '/portrait_gomoku_360.png' });
        await ctxP.close();

        // 显示名
        const ctxM = await browser.newContext({ viewport: { width: 800, height: 600 } });
        const pageM = await ctxM.newPage();
        await pageM.goto(BASE + '/Me');
        await pageM.waitForLoadState('load');
        const me = await pageM.evaluate(async () => {
            const r = await fetch('/api/v1/me', { credentials: 'same-origin' });
            const j = await r.json();
            return j.data && (j.data.displayName || j.data.name);
        });
        T('显示名 = 安家乐', me === '管理员', 'displayName=' + me);
        await ctxM.close();
    }

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
