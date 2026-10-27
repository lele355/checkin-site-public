// test_pwa.js — 验证 PWA 补全：SW 注册/接管、manifest(maskable)、离线兜底页
// 前置：站点跑在 http://localhost:5188
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = 'D:/projects/checkin/_shots';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:5188';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
    else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();

    console.log('\n【1】Service Worker 注册与接管');
    await page.goto(BASE + '/Login', { waitUntil: 'load' });
    const swState = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return 'unsupported';
        const reg = await navigator.serviceWorker.ready;
        // ready 之后 state 可能还是 activating，轮询到终态再断言（否则是测试自己的时序问题）
        for (let i = 0; i < 40; i++) {
            if (reg.active && reg.active.state === 'activated') break;
            await new Promise(r => setTimeout(r, 100));
        }
        return reg.active ? reg.active.state : 'no-active';
    });
    ok('SW 已 activated', swState === 'activated', swState);

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    ok('页面已被 SW 接管', controlled);

    const swRes = await page.evaluate(async () => {
        const r = await fetch('/sw.js');
        return { status: r.status, type: r.headers.get('content-type'), text: (await r.text()).slice(0, 40) };
    });
    ok('sw.js 可访问且是 JS', swRes.status === 200 && /javascript/.test(swRes.type || ''), JSON.stringify(swRes).slice(0, 90));

    console.log('\n【2】manifest 校验');
    const mf = await page.evaluate(async () => {
        const r = await fetch('/manifest.json');
        return await r.json();
    });
    ok('manifest 含 4 个图标', Array.isArray(mf.icons) && mf.icons.length === 4, String(mf.icons && mf.icons.length));
    ok('含 maskable 图标', mf.icons.some(i => i.purpose === 'maskable'));
    ok('display=standalone 且有 id', mf.display === 'standalone' && mf.id === '/');
    ok('shortcuts 已配置', Array.isArray(mf.shortcuts) && mf.shortcuts.length === 3, (mf.shortcuts || []).map(s => s.url).join(' '));

    const iconRes = await page.evaluate(async () => {
        const list = ['/icons/icon-maskable-192.png', '/icons/icon-maskable-512.png'];
        const out = [];
        for (const u of list) { const r = await fetch(u); out.push([u, r.status]); }
        return out;
    });
    iconRes.forEach(([u, s]) => ok(`图标可访问 ${u.split('/').pop()}`, s === 200, 'HTTP ' + s));

    console.log('\n【3】断网兜底页');
    const offRes = await page.evaluate(async () => {
        const r = await fetch('/offline.html');
        return { status: r.status, text: await r.text() };
    });
    ok('/offline.html 存在', offRes.status === 200);
    ok('兜底页含提示文案', offRes.text.includes('网络断开了'));

    // 真断网：导航到另一个页面，SW 应回落 offline.html
    await ctx.setOffline(true);
    let offlineShown = false, offlineUrl = '';
    try {
        await page.goto(BASE + '/Memo', { waitUntil: 'load', timeout: 15000 });
        offlineUrl = page.url();
        const body = await page.evaluate(() => document.body.innerText);
        offlineShown = body.includes('网络断开了');
    } catch (e) {
        const body = await page.evaluate(() => document.body.innerText).catch(() => '');
        offlineShown = body.includes('网络断开了');
        offlineUrl = 'goto rejected: ' + String(e.message).slice(0, 60);
    }
    ok('断网导航回落到兜底页', offlineShown, offlineUrl);
    await page.screenshot({ path: OUT + '/pwa-offline.png' });
    await ctx.setOffline(false);

    console.log(`\n=== 结果：${pass}/${pass + fail} 通过，${fail} 失败`);
    await browser.close();
    process.exit(fail ? 1 : 0);
})();
