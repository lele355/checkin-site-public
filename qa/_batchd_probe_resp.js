// _batchd_probe_resp.js — 打印 move API 响应体（QA 临时）
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'QA_gamma', password: 'QaGames2026!', device: 'probe3' }) });
    const gamma = (await r.json()).data.token;
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 430, height: 860 } });
    const page = await ctx.newPage();
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
    await sleep(1500);
    const resp = await page.evaluate(async (id) => {
        const r = await fetch('/api/v1/games/xiangqi/rooms/' + id + '/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
            credentials: 'same-origin',
            body: JSON.stringify({ fx: 0, fy: 6, tx: 0, ty: 5 }),
        });
        const text = await r.text();
        return { status: r.status, body: text.slice(0, 500) };
    }, id);
    console.log('move 响应:', JSON.stringify(resp, null, 1));
    // 对照：用 Bearer token 的 gamma 走黑棋（1,2→1,4 炮？）看响应
    const resp2 = await fetch(`${BASE}/api/v1/games/xiangqi/rooms/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + gamma },
        body: JSON.stringify({ fx: 1, fy: 2, tx: 1, ty: 4 }),
    });
    console.log('gamma move 响应:', resp2.status, (await resp2.text()).slice(0, 300));
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
