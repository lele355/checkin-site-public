// _batchd_settings_gap.js — settings_verify 补缺口 + BUG-1 再存复验 + FindPlayingRoom 抽验（QA 临时）。
// 覆盖工程师 28 条没锁的：melon 面板（走查表 8 款里缺的那款）/ fish 三个负向项 /
// BUG-1「存→读→再存」完整往返（扁平泄漏的静默丢弃路径）/ 多局并行取最近局。
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 900, height: 950 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(BASE + '/Login');
    await page.fill('input[type="text"]', 'QA_alpha');
    await page.fill('input[type="password"]', 'QaGames2026!');
    await page.click('button:has-text("登")');
    await page.waitForTimeout(1200);

    // ---- [G1] melon 面板（走查表 §2.1：网页 0 项） ----
    await page.goto(BASE + '/Games/melon/Settings');
    await sleep(300);
    const melonBody = await page.evaluate(() => document.body.innerText);
    const melonItems = ['落子确认', '坐标显示', '最后落子标记', '盘面大小', '禁手', '军旗模式', '单步限时', '每方总用时', '每方总局时'];
    const melonLeak = melonItems.filter(x => melonBody.includes(x));
    T('melon 面板不显示任何棋类设置项（走查表：网页 0 项）', melonLeak.length === 0, 'leaked=' + melonLeak.join(','));
    T('melon 面板音效项口径记录（走查表未列音效，D-4 新增开关）', true,
        '含音效=' + melonBody.includes('音效') + ' 含震动=' + melonBody.includes('震动'));

    // ---- [G2] fish 三个漏锁负向项 ----
    await page.goto(BASE + '/Games/fish/Settings');
    await sleep(300);
    const fishBody = await page.evaluate(() => document.body.innerText);
    const fishExtra = ['禁手', '军旗模式', '每方总用时', '每方总局时'];
    const fishLeak = fishExtra.filter(x => fishBody.includes(x));
    T('fish 面板不显示 禁手/军旗模式/总用时（补锁 3 负向）', fishLeak.length === 0, 'leaked=' + fishLeak.join(','));

    // ---- [G3] BUG-1 存→读→再存：非五子棋规则 + Sound 二次保存不丢 ----
    const resave = await page.evaluate(async () => {
        const get = async (p) => (await (await fetch(p, { credentials: 'same-origin', cache: 'no-store' })).json()).data;
        const put = (p, body) => fetch(p, {
            method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        // 军旗：mode=dark + 限时 → 再存同值 → 验证不被静默丢弃
        await put('/api/v1/games/armychess/settings', { mode: 'dark', moveTimeoutSec: 15, totalTimeoutSec: 300 });
        const a1 = await get('/api/v1/games/armychess/settings');
        await put('/api/v1/games/armychess/settings', { mode: a1.rules.mode, moveTimeoutSec: a1.rules.moveTimeoutSec, totalTimeoutSec: a1.rules.totalTimeoutSec });
        const a2 = await get('/api/v1/games/armychess/settings');
        // Sound=false → 再存 → 不丢
        const d0 = await get('/api/v1/games/settings');
        await put('/api/v1/games/settings', { tapConfirm: d0.tapConfirm, showCoord: d0.showCoord, lastMark: d0.lastMark, vibrate: d0.vibrate, sound: false });
        const d1 = await get('/api/v1/games/settings');
        await put('/api/v1/games/settings', { tapConfirm: d1.tapConfirm, showCoord: d1.showCoord, lastMark: d1.lastMark, vibrate: d1.vibrate, sound: d1.sound });
        const d2 = await get('/api/v1/games/settings');
        // 恢复现场
        await put('/api/v1/games/armychess/settings', { mode: 'open', moveTimeoutSec: 0, totalTimeoutSec: 0 });
        await put('/api/v1/games/settings', { tapConfirm: d0.tapConfirm, showCoord: d0.showCoord, lastMark: d0.lastMark, vibrate: d0.vibrate, sound: d0.sound });
        return { a1: a1.rules, a2: a2.rules, d1: d1.sound, d2: d2.sound };
    });
    T('BUG-1 军旗模式/限时 二次保存存活（dark/15/300）',
        resave.a2.mode === 'dark' && resave.a2.moveTimeoutSec === 15 && resave.a2.totalTimeoutSec === 300,
        JSON.stringify(resave.a2));
    T('BUG-1 Sound=false 二次保存存活', resave.d1 === false && resave.d2 === false, `d1=${resave.d1} d2=${resave.d2}`);

    // ---- [G4] FindPlayingRoom 取最近局（多局并行） ----
    const rooms = await page.evaluate(async () => {
        const mk = async () => {
            const r = await fetch('/api/v1/games/gomoku/rooms', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ side: 1, opponent: 'ai', aiLevel: 1 }),
            });
            return (await r.json()).data.id;
        };
        return [await mk(), await mk()];
    });
    T('双 AI 局并行建立', rooms[0] && rooms[1] && rooms[0] !== rooms[1], JSON.stringify(rooms));
    const reqUrls = [];
    page.on('request', r => { if (r.url().includes('/rebuild')) reqUrls.push(r.url() + ' ' + (r.postData() || '')); });
    await page.goto(BASE + '/Games/gomoku/Settings');
    await sleep(250);
    const cur = await page.$eval('select[name="size"]', el => el.value);
    await page.selectOption('select[name="size"]', cur === '19' ? '13' : '19');
    await page.click('button:has-text("保存设置")');
    await sleep(800);
    await page.click('button:has-text("一键重建")');
    await sleep(4000);
    const hitNewest = reqUrls.some(u => u.includes('/rooms/' + rooms[1] + '/rebuild'));
    const hitOldest = reqUrls.some(u => u.includes('/rooms/' + rooms[0] + '/rebuild'));
    T('FindPlayingRoom 取最近局（rebuild 打到新局 ' + rooms[1] + '）', hitNewest && !hitOldest, JSON.stringify(reqUrls.slice(0, 3)));

    await browser.close();
    const fail = results.filter(r => !r.ok).length;
    console.log(`\n===== settings_gap: ${results.length - fail} 通过 / ${fail} 失败 =====`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL ' + e.message); process.exit(1); });
