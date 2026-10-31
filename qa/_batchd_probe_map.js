// _batchd_probe_map.js — 点击坐标换算探针（QA 临时）：验证 gridToClient → GameBoards.hit 往返
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
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
        const r = await fetch('/api/v1/games/xiangqi/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1 }) });
        const j = await r.json(); return j.ok ? j.data.id : null;
    });
    await page.goto(BASE + '/Games/xiangqi/Play/' + id);
    await sleep(1600);
    const probe = await page.evaluate(() => {
        const geom = window.__gmLastGeom;
        const svg = document.getElementById('gmBoardHost').querySelector('svg');
        const vb = svg.viewBox.baseVal;
        const rect = svg.getBoundingClientRect();
        const par = svg.getAttribute('preserveAspectRatio');
        const out = { geom, vb: { w: vb.width, h: vb.height, x: vb.x, y: vb.y }, rect: { l: rect.left, t: rect.top, w: rect.width, h: rect.height }, par };
        // 往返：格(4,6) 中心 → client → 反算 vb → hit
        const gx = 4, gy = 6;
        const vx = geom.pad + gx * geom.cw, vy = geom.pad + gy * geom.ch;
        out.vbTarget = { vx, vy };
        out.client = { x: rect.left + vx / vb.width * rect.width, y: rect.top + vy / vb.height * rect.height };
        // 反算（模拟点击处理）
        const cx = out.client.x, cy = out.client.y;
        const x2 = (cx - rect.left) / rect.width * vb.width;
        const y2 = (cy - rect.top) / rect.height * vb.height;
        out.backVb = { x2, y2 };
        out.hit = window.GameBoards.hit(geom, x2, y2);
        return out;
    });
    console.log(JSON.stringify(probe, null, 1));
    // 真点 (4,6)（红帅位下方空格？(4,6) 是空位；点己方子 (4,9) 帅）
    const geom = probe.geom;
    const vx = geom.pad + 4 * geom.cw, vy = geom.pad + 9 * geom.ch;
    const cx = probe.rect.l + vx / probe.vb.w * probe.rect.w;
    const cy = probe.rect.t + vy / probe.vb.h * probe.rect.h;
    await page.mouse.click(cx, cy);
    await sleep(300);
    const sel = await page.evaluate(() => {
        const svg = document.getElementById('gmBoardHost').querySelector('svg');
        const circle = svg.querySelector('circle[stroke="#1a73e8"]');
        return circle ? { cx: circle.getAttribute('cx'), cy: circle.getAttribute('cy') } : null;
    });
    console.log('点帅(4,9)后选中圈:', JSON.stringify(sel), ' 期望 cx=' + vx + ' cy=' + vy);
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
