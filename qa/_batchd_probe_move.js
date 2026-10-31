// _batchd_probe_move.js — 全程插桩探针：选中→走子→/move 请求→状态（QA 临时）
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'QA_gamma', password: 'QaGames2026!', device: 'probe2' }) });
    const gamma = (await r.json()).data.token;
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 430, height: 860 } });
    const page = await ctx.newPage();
    const reqs = [];
    page.on('request', req => { if (req.url().includes('/move')) reqs.push(req.url() + ' ' + req.postData()); });
    page.on('console', m => { if (m.text().includes('ERR') || m.type() === 'error') console.log('[console]', m.text()); });
    await page.goto(BASE + '/Login');
    await page.fill('#Username', 'QA_beta');
    await page.fill('#Password', 'QaGames2026!');
    await page.click('button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(400);
    await page.goto(BASE + '/Games/xiangqi');
    await sleep(300);
    const id = await page.evaluate(async () => {
        const rr = await fetch('/api/v1/games/xiangqi/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1 }) });
        const j = await rr.json(); return j.ok ? j.data.id : null;
    });
    await fetch(`${BASE}/api/v1/games/xiangqi/rooms/${id}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + gamma, 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 2 }) });
    await page.goto(BASE + '/Games/xiangqi/Play/' + id);
    await sleep(1600);
    const st = await page.evaluate(() => JSON.parse(document.getElementById('gmState').textContent));
    console.log('mySide=' + st.mySide, 'myTurn=' + st.myTurn, 'status=' + st.status, 'hints keys=' + Object.keys(st.state.hints || {}).length);
    const own = st.state.pieces.find(p => p.side === st.mySide && (st.state.hints[p.x + ',' + p.y] || []).length > 0);
    console.log('own=', JSON.stringify(own), 'hl=', JSON.stringify(st.state.hints[own.x + ',' + own.y]));

    const g2c = async (gx, gy) => page.evaluate(([gx, gy]) => {
        const geom = window.__gmLastGeom;
        const svg = document.getElementById('gmBoardHost').querySelector('svg');
        const vb = svg.viewBox.baseVal, rect = svg.getBoundingClientRect();
        const offX = geom.mode === 'point' ? 0 : geom.cw / 2, offY = geom.mode === 'point' ? 0 : geom.ch / 2;
        return {
            x: rect.left + (geom.pad + gx * geom.cw + offX) / vb.width * rect.width,
            y: rect.top + (geom.pad + gy * geom.ch + offY) / vb.height * rect.height,
        };
    }, [gx, gy]);

    let c = await g2c(own.x, own.y);
    await page.mouse.click(c.x, c.y);
    await sleep(250);
    let sel = await page.evaluate(() => {
        const svg = document.getElementById('gmBoardHost').querySelector('svg');
        const el = svg.querySelector('circle[stroke="#1a73e8"]');
        return el ? el.getAttribute('cx') + ',' + el.getAttribute('cy') : null;
    });
    console.log('选中后 sel 圈:', sel, '(期望 cx=' + (50 + own.x * 67.5) + ')');

    const target = st.state.hints[own.x + ',' + own.y][0];
    c = await g2c(target[0], target[1]);
    // 点击同时启动 10ms DOM 采样（600ms）
    const domSamplesP = page.evaluate(() => {
        const svg = document.getElementById('gmBoardHost').querySelector('svg');
        const samples = [];
        return new Promise(res => {
            const t0 = performance.now();
            (function tick() {
                const list = [];
                svg.querySelectorAll('circle').forEach(el => {
                    const cx = parseFloat(el.getAttribute('cx'));
                    if (!Number.isNaN(cx)) list.push(+cx.toFixed(1));
                });
                samples.push(list.join('|'));
                if (performance.now() - t0 < 600) setTimeout(tick, 10); else res(samples);
            })();
        });
    });
    await page.mouse.click(c.x, c.y);
    const domSamples = await domSamplesP;
    const uniq = [...new Set(domSamples)];
    console.log('600ms 内 DOM 采样帧数=' + domSamples.length + ' 不同帧=' + uniq.length);
    uniq.slice(0, 15).forEach((u, i) => console.log('  帧' + i + ': ' + u.slice(0, 150)));
    await sleep(1200);
    console.log('/move 请求:', JSON.stringify(reqs));
    const st2 = await page.evaluate(async () => {
        const id = location.pathname.split('/').pop();
        const r = await fetch('/api/v1/games/xiangqi/rooms/' + id, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
        return (await r.json()).data;
    });
    console.log('走子后 revision=' + st2.revision + ' 目标格有子=' + st2.state.pieces.some(p => p.x === target[0] && p.y === target[1] && p.side === st.mySide));
    // 动画即时采样（点完立刻采 1s）
    c = await g2c(own.x, own.y);
    await page.mouse.click(c.x, c.y);   // 注意：上一步已走子，(own) 可能空——仅为演示采样器时序
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
