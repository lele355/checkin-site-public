// _batchd_probe_flip.js — 翻棋翻子点击全程插桩（QA 临时）
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'QA_gamma', password: 'QaGames2026!', device: 'probe4' }) });
    const gamma = (await r.json()).data.token;
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 430, height: 860 } });
    const page = await ctx.newPage();
    page.on('request', req => { if (req.url().includes('/move')) console.log('[req]', req.postData()); });
    page.on('response', async res => { if (res.url().includes('/move')) console.log('[resp]', res.status(), (await res.text().catch(() => '')).slice(0, 120)); });
    await page.goto(BASE + '/Login');
    await page.fill('#Username', 'QA_beta');
    await page.fill('#Password', 'QaGames2026!');
    await page.click('button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(400);
    await page.goto(BASE + '/Games/armychess');
    await sleep(300);
    const id = await page.evaluate(async () => {
        const rr = await fetch('/api/v1/games/armychess/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1, mode: 'fanqi' }) });
        const j = await rr.json(); return j.ok ? j.data.id : null;
    });
    await fetch(`${BASE}/api/v1/games/armychess/rooms/${id}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + gamma, 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 2 }) });
    await page.goto(BASE + '/Games/armychess/Play/' + id);
    await sleep(1600);
    const st = await page.evaluate(async (rid) => {
        const rr = await fetch('/api/v1/games/armychess/rooms/' + rid, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
        return (await rr.json()).data;
    }, id);
    console.log('status=' + st.status, 'myTurn=' + st.myTurn, 'mySide=' + st.mySide, 'mode=' + st.state.mode, 'settled=' + st.state.settled);
    const hidden = st.state.pieces.find(p => p.hidden);
    console.log('hidden piece =', JSON.stringify(hidden));
    const c = await page.evaluate(([gx, gy]) => {
        const geom = window.__gmLastGeom;
        const svg = document.getElementById('gmBoardHost').querySelector('svg');
        const vb = svg.viewBox.baseVal, rect = svg.getBoundingClientRect();
        const offX = geom.mode === 'point' ? 0 : geom.cw / 2, offY = geom.mode === 'point' ? 0 : geom.ch / 2;
        const vx = geom.pad + gx * geom.cw + offX, vy = geom.pad + gy * geom.ch + offY;
        const x = rect.left + vx / vb.width * rect.width, y = rect.top + vy / vb.height * rect.height;
        // 反算 hit
        const x2 = (x - rect.left) / rect.width * vb.width, y2 = (y - rect.top) / rect.height * vb.height;
        const hit = window.GameBoards.hit(geom, x2, y2);
        return { x, y, hit, geom, rect: { l: rect.left, t: rect.top, w: rect.width, h: rect.height }, vb: { w: vb.width, h: vb.height } };
    }, [hidden.x, hidden.y]);
    console.log('click client=', c.x.toFixed(1), c.y.toFixed(1), ' 反算 hit=', JSON.stringify(c.hit), ' geom=', JSON.stringify(c.geom));
    await page.mouse.click(c.x, c.y);
    await sleep(1800);
    const st2 = await page.evaluate(async (rid) => {
        const rr = await fetch('/api/v1/games/armychess/rooms/' + rid, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
        return (await rr.json()).data;
    }, id);
    console.log('点击后 rev=' + st2.revision, '该格翻开=' + st2.state.pieces.some(p => p.x === hidden.x && p.y === hidden.y && !p.hidden));
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
