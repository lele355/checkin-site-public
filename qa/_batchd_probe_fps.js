// _batchd_probe_fps.js — 无头 msedge rAF 帧率探针（QA 临时）
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
    await sleep(300);
    await page.goto(BASE + '/Games/melon/Solo');
    await sleep(800);
    const fps1 = await page.evaluate(() => new Promise(res => {
        let n = 0; const t0 = performance.now();
        (function tick() { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(n); })();
    }));
    console.log('后台 rAF 帧/秒 =', fps1);
    await page.bringToFront();
    const fps2 = await page.evaluate(() => new Promise(res => {
        let n = 0; const t0 = performance.now();
        (function tick() { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(n); })();
    }));
    console.log('bringToFront 后 rAF 帧/秒 =', fps2);
    console.log('visibilityState =', await page.evaluate(() => document.visibilityState));
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
