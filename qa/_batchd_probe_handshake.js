// _batchd_probe_handshake.js — 换房握手断点定位探针（QA 临时）
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctxA = await browser.newContext({ viewport: { width: 900, height: 950 } });
    const ctxB = await browser.newContext({ viewport: { width: 900, height: 950 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    pageA.on('console', m => console.log('[A-console]', m.type(), m.text().slice(0, 150)));
    pageA.on('request', r => { if (r.url().includes('/rebuild')) console.log('[A-req]', r.method(), r.url().replace(BASE, ''), r.postData()); });
    pageA.on('response', async r => { if (r.url().includes('/rebuild')) console.log('[A-resp]', r.status(), (await r.text().catch(() => '')).slice(0, 150)); });
    pageA.on('dialog', d => { console.log('[A-dialog]', d.message()); d.dismiss().catch(() => {}); });
    for (const [p, u] of [[pageA, 'QA_alpha'], [pageB, 'QA_beta']]) {
        await p.goto(BASE + '/Login');
        await p.fill('input[type="text"]', u);
        await p.fill('input[type="password"]', 'QaGames2026!');
        await p.click('button:has-text("登")');
        await p.waitForTimeout(1000);
    }
    await pageA.goto(BASE + '/Games/gomoku');
    await sleep(300);
    const id = await pageA.evaluate(async () => {
        const r = await fetch('/api/v1/games/gomoku/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1 }) });
        return (await r.json()).data.id;
    });
    await pageB.goto(BASE + '/Games/gomoku');
    await pageB.evaluate(async (rid) => {
        await fetch('/api/v1/games/gomoku/rooms/' + rid + '/join', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 2 }) });
    }, id);
    await pageA.goto(BASE + '/Games/gomoku/Play/' + id);
    await pageB.goto(BASE + '/Games/gomoku/Play/' + id);
    await sleep(1200);
    console.log('room=' + id);

    await pageA.goto(BASE + '/Games/gomoku/Settings');
    await sleep(300);
    const cur = await pageA.$eval('select[name="size"]', el => el.value);
    await pageA.selectOption('select[name="size"]', cur === '19' ? '13' : '19');
    await pageA.click('button:has-text("保存设置")');
    await sleep(700);
    await pageA.click('button:has-text("一键重建")');
    await sleep(5000);
    // A 端页面状态
    console.log('A url:', pageA.url());
    // B 端快照 rebuild 字段 + 按钮
    const snap = await pageB.evaluate(async (rid) => {
        const j = await (await fetch('/api/v1/games/gomoku/rooms/' + rid, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' })).json();
        return { rebuild: j.data && j.data.rebuild, mySide: j.data && j.data.mySide, status: j.data && j.data.status };
    }, id);
    console.log('B snapshot:', JSON.stringify(snap));
    const btns = await pageB.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()));
    console.log('B buttons:', JSON.stringify(btns.slice(0, 8)), '共', btns.length);
    // 刷新后诊断
    await pageB.reload();
    await sleep(2500);
    const diag = await pageB.evaluate(() => {
        const st = JSON.parse(document.getElementById('gmState').textContent);
        return {
            url: location.href,
            hasBar: !!document.getElementById('gmRebuildBar'),
            btns: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(Boolean).slice(0, 10),
            gmRebuild: st.rebuild, mySide: st.mySide,
            bodyLen: document.body.innerText.length,
        };
    });
    console.log('B reload 后:', JSON.stringify(diag));
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
