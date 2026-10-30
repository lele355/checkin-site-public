// _verify_b_ui.js — 批次 B 第 3 部分：军旗明棋布阵全链 UI 冒烟 + 拓扑渲染
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const fs = require('fs');
const SHOTS = 'D:/checkin/site/qa/shots_batchB';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'bui' }) }); return (await r.json()).data.token; }

(async () => {
    const beta = await loginApi('QA_beta');
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);

    // admin 建明棋房 + beta 加入
    await page.goto(BASE + '/Games/armychess');
    await page.waitForLoadState('load');
    const id = await page.evaluate(async () => {
        const r = await fetch('/api/v1/games/armychess/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1, mode: 'open' }) });
        const j = await r.json(); return j.ok ? j.data.id : null;
    });
    await fetch(`${BASE}/api/v1/games/armychess/rooms/${id}/join`, {}, { }).catch(() => { });
    await fetch(`${BASE}/api/v1/games/armychess/rooms/${id}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: '{}' });
    await page.goto(BASE + '/Games/armychess/Play/' + id);
    await sleep(1500);

    // 1 布阵按钮条出现
    const bar = await page.evaluate(() => {
        const el = document.getElementById('gmSetupBar');
        return { exists: !!el, visible: el ? !el.hidden : false, btns: el ? Array.from(el.querySelectorAll('button')).map(b => b.textContent.trim()) : [] };
    });
    T('布阵按钮条出现（随机布阵/确认布阵）', bar.exists && bar.visible && bar.btns.length >= 2, JSON.stringify(bar));

    // 2 违反约束的交换不动、无请求
    let reqCount = 0;
    let geom = null;
    const reqHandler = req => { if (req.url().includes('/deploy')) reqCount++; };
    page.on('request', reqHandler);
    // 找军旗所在格与一个前线格，点两格尝试交换
    const flagCell = await page.evaluate(() => {
        const dp = window.__gmDeployPieces();
        const f = dp.find(p => p.rank === 'rank_flag');
        return f ? { x: f.x, y: f.y } : null;
    });
    const frontCell = await page.evaluate(() => {
        const dp = window.__gmDeployPieces();
        const f = dp.find(p => p.y === 6);   // 前线排的子（与旗交换 → 违反旗在大本营约束）
        return f ? { x: f.x, y: f.y } : null;
    });
    T('布阵初始状态可取（军旗/前线子存在）', !!flagCell && !!frontCell, JSON.stringify({ flagCell, frontCell }));
    const before = await page.evaluate(() => JSON.stringify(window.__gmDeployPieces()));
    if (flagCell && frontCell) {
        geom = await page.evaluate(gk => {
            const st = JSON.parse(document.getElementById('gmState').textContent);
            const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            return window.ArmyChessBoard.render(tmp, st.state || {}, { showCoord: false, mySide: st.mySide, myTurn: false });
        }, 'armychess');
        const pt = await page.evaluate(({ geom, c, r }) => {
            const svg = document.querySelector('svg.gm-board');
            const rect = svg.getBoundingClientRect();
            const vb = svg.viewBox.baseVal;
            const vx = geom.pad + c * geom.cw + geom.cw / 2, vy = geom.pad + r * geom.ch + geom.ch / 2;
            return { relX: vx / vb.width * rect.width, relY: vy / vb.height * rect.height };
        }, { geom, c: flagCell.x, r: flagCell.y });
        await page.locator('svg.gm-board').first().click({ position: { x: pt.relX, y: pt.relY } });
        await sleep(300);
        const pt2 = await page.evaluate(({ geom, c, r }) => {
            const svg = document.querySelector('svg.gm-board');
            const rect = svg.getBoundingClientRect();
            const vb = svg.viewBox.baseVal;
            const vx = geom.pad + c * geom.cw + geom.cw / 2, vy = geom.pad + r * geom.ch + geom.ch / 2;
            return { relX: vx / vb.width * rect.width, relY: vy / vb.height * rect.height };
        }, { geom, c: frontCell.x, r: frontCell.y });
        await page.locator('svg.gm-board').first().click({ position: { x: pt2.relX, y: pt2.relY } });
        await sleep(500);
    }
    const after = await page.evaluate(() => JSON.stringify(window.__gmDeployPieces()));
    T('违反约束的交换不动（布局不变）且无 deploy 请求', reqCount === 0 && after === before, `req=${reqCount} changed=${after !== before}`);
    page.off('request', reqHandler);

    // 3 合法交换（两枚非旗子互换 → 布局变化）
    const swapPair = await page.evaluate(() => {
        const dp = window.__gmDeployPieces();
        const a = dp.find(p => p.rank === 'rank_engineer');
        const b = dp.find(p => p.rank === 'rank_company' && !(p.x === a.x && p.y === a.y));
        return a && b ? { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } } : null;
    });
    if (swapPair) {
        const beforeSwap = await page.evaluate(() => JSON.stringify(window.__gmDeployPieces()));
        for (const cell of [swapPair.a, swapPair.b]) {
            const pt = await page.evaluate(({ geom, c, r }) => {
                const svg = document.querySelector('svg.gm-board');
                const rect = svg.getBoundingClientRect();
                const vb = svg.viewBox.baseVal;
                const vx = geom.pad + c * geom.cw + geom.cw / 2, vy = geom.pad + r * geom.ch + geom.ch / 2;
                return { relX: vx / vb.width * rect.width, relY: vy / vb.height * rect.height };
            }, { geom, c: cell.x, r: cell.y });
            await page.locator('svg.gm-board').first().click({ position: { x: pt.relX, y: pt.relY } });
            await sleep(250);
        }
        const afterSwap = await page.evaluate(() => JSON.stringify(window.__gmDeployPieces()));
        T('合法交换生效（布局变化）', afterSwap !== beforeSwap, '');
    }

    // 4 确认布阵 → playing
    await page.locator('#gmSetupBar button', { hasText: '确认布阵' }).click();
    await sleep(1200);
    await fetch(`${BASE}/api/v1/games/armychess/rooms/${id}/deploy`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: JSON.stringify({ random: true }) });
    await sleep(800);
    const st = await page.evaluate(async id2 => { const r = await fetch('/api/v1/games/armychess/rooms/' + id2, { credentials: 'same-origin' }); return (await r.json()).data; }, id);
    T('admin 确认布阵 + beta 随机布 → playing', st.status === 'playing', `status=${st.status} done=${JSON.stringify(st.state.deployDone)}`);

    // 5 两步走子 POST {fx,fy,tx,ty} 服务端接受
    let mvBody = null, mvOk = null;
    const mvReq = req => { if (req.url().includes('/move')) mvBody = req.postData(); };
    const mvResp = async resp => { if (resp.url().includes('/move')) { try { mvOk = (await resp.json()).ok; } catch (_) { } } };
    page.on('request', mvReq); page.on('response', mvResp);
    // 点己方子（找一枚可动的：state.pieces 里 side=1 且有相邻空位）
    const plan = await page.evaluate(async ({ id, gk }) => {
        const st = await (async () => { const r = await fetch('/api/v1/games/' + gk + '/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data; })();
        const occ = new Set((st.state.pieces || []).map(p => p.x + ',' + p.y));
        const mine = (st.state.pieces || []).filter(p => p.side === st.mySide);
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (const p of mine) for (const [dx, dy] of dirs) {
            const nx = p.x + dx, ny = p.y + dy;
            if (nx < 0 || nx > 4 || ny < 0 || ny > 11) continue;
            if (!occ.has(nx + ',' + ny)) return { fx: p.x, fy: p.y, tx: nx, ty: ny };
        }
        return null;
    }, { id, gk: 'armychess' });
    if (plan) {
        const liveState = (await (await fetch(`${BASE}/api/v1/games/armychess/rooms/${id}`, { headers: { Authorization: 'Bearer ' + beta } })).json()).data;
        const geom = await page.evaluate(({ gk, state }) => {
            const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            return window.ArmyChessBoard.render(tmp, state || {}, { showCoord: false, mySide: 1, myTurn: true });
        }, { gk: 'armychess', state: liveState.state });
        for (const cell of [[plan.fx, plan.fy], [plan.tx, plan.ty]]) {
            const pt = await page.evaluate(({ geom, c, r }) => {
                const svg = document.querySelector('svg.gm-board');
                const rect = svg.getBoundingClientRect();
                const vb = svg.viewBox.baseVal;
                const vx = geom.pad + c * geom.cw + geom.cw / 2, vy = geom.pad + r * geom.ch + geom.ch / 2;
                return { relX: vx / vb.width * rect.width, relY: vy / vb.height * rect.height };
            }, { geom, c: cell[0], r: cell[1] });
            await page.locator('svg.gm-board').first().click({ position: { x: pt.relX, y: pt.relY } });
            await sleep(400);
        }
        await sleep(600);
        let body = null; try { body = JSON.parse(mvBody); } catch (_) { }
        const playText = await page.evaluate(() => (document.querySelector('svg.gm-board').textContent || ''));
        T('己方军衔名可见（司令/师长等）', /司令|军长|师长|旅长|团长|营长|连长|排长|工兵|地雷|炸弹/.test(playText), playText.slice(0, 60));
        T('两步走子 POST {fx,fy,tx,ty} 服务端接受',
            body && body.fx === plan.fx && body.fy === plan.fy && body.tx === plan.tx && body.ty === plan.ty && mvOk === true,
            `body=${mvBody} ok=${mvOk}`);
    } else T('找可动子', false);
    page.off('request', mvReq); page.off('response', mvResp);
    await page.screenshot({ path: SHOTS + '/deploy_playing.png', fullPage: true });

    // 6 拓扑渲染（新开一局看 setup 期棋盘）
    const id2 = await page.evaluate(async () => { const r = await fetch('/api/v1/games/armychess/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1, mode: 'open' }) }); const j = await r.json(); return j.data.id; });
    await page.goto(BASE + '/Games/armychess/Play/' + id2);
    await sleep(1500);
    const topo = await page.evaluate(() => {
        const svg = document.querySelector('svg.gm-board');
        const html = svg.innerHTML;
        const texts = Array.from(svg.querySelectorAll('text')).map(t => t.textContent);
        return {
            hasMountain: html.includes('山') || texts.some(t => t.includes('山')),
            railThick: html.includes('stroke-width="7"') || /stroke-width=.?7/.test(html),
            campDenText: texts.some(t => t === '营') && texts.some(t => t.includes('大本营')),
            campDen: (sA2 => true)(html) && (html.includes('行营') || texts.length > 0),
            svgChildren: svg.childElementCount,
        };
    });
    T('拓扑渲染：山界标注 + 铁路粗线 + 行营/大本营标注', topo.hasMountain && topo.railThick && topo.campDenText, JSON.stringify(topo));
    await page.screenshot({ path: SHOTS + '/topology_setup.png', fullPage: true });

    await ctx.close();
    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
