// online_pwa.js — 线上验证 PWA：SW 注册/接管、manifest、离线兜底、sw.js 缓存头
// 用法：node qa/online_pwa.js
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = 'D:/projects/checkin/_shots';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const BASE = 'https://example.com';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`  ✅ ${n}${e ? ' — ' + e : ''}`)) : (fail++, console.log(`  ❌ ${n}${e ? ' — ' + e : ''}`)); };

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', ignoreHTTPSErrors: false });
    const page = await ctx.newPage();

    console.log('\n【1】Service Worker');
    await page.goto(BASE + '/Login', { waitUntil: 'load' });
    const swState = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return 'unsupported';
        const reg = await navigator.serviceWorker.ready;
        for (let i = 0; i < 40; i++) {
            if (reg.active && reg.active.state === 'activated') break;
            await new Promise(r => setTimeout(r, 100));
        }
        return reg.active ? reg.active.state : 'no-active';
    });
    ok('SW 已 activated', swState === 'activated', swState);

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(700);
    ok('页面已被 SW 接管', await page.evaluate(() => !!navigator.serviceWorker.controller));

    console.log('\n【2】缓存头（必须 no-cache，否则改了 SW 不生效）');
    const cc = await page.evaluate(async () => {
        const r = await fetch('/sw.js', { cache: 'no-store' });
        return { status: r.status, cc: r.headers.get('cache-control') || '' };
    });
    ok('sw.js 可访问', cc.status === 200);
    ok('sw.js 含 no-cache', /no-cache|no-store/i.test(cc.cc), cc.cc);

    console.log('\n【3】manifest 与图标');
    const mf = await page.evaluate(async () => (await fetch('/manifest.json', { cache: 'no-store' })).json());
    ok('4 个图标', (mf.icons || []).length === 4);
    ok('含 maskable', (mf.icons || []).some(i => i.purpose === 'maskable'));
    ok('3 个 shortcuts', (mf.shortcuts || []).length === 3, (mf.shortcuts || []).map(s => s.url).join(' '));
    const icons = await page.evaluate(async () => {
        const out = [];
        for (const u of ['/icons/icon-maskable-192.png', '/icons/icon-maskable-512.png']) {
            const r = await fetch(u); out.push([u.split('/').pop(), r.status]);
        }
        return out;
    });
    icons.forEach(([n, s]) => ok('图标 ' + n, s === 200, 'HTTP ' + s));

    console.log('\n【4】真断网回落');
    await ctx.setOffline(true);
    let shown = false, url = '';
    try {
        await page.goto(BASE + '/Memo', { waitUntil: 'load', timeout: 20000 });
        url = page.url();
        shown = (await page.evaluate(() => document.body.innerText)).includes('网络断开了');
    } catch (e) {
        shown = (await page.evaluate(() => document.body.innerText).catch(() => '')).includes('网络断开了');
        url = 'goto rejected: ' + String(e.message).slice(0, 50);
    }
    ok('断网导航显示兜底页', shown, url);
    await page.screenshot({ path: OUT + '/online-pwa-offline.png' });
    await ctx.setOffline(false);

    console.log('\n【5】壳脚本在线上不影响浏览器');
    // 兜底页监听了 online 事件会自动 reload，这里先重新导航，避免执行上下文被销毁
    await page.goto(BASE + '/Login', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const shell = await page.evaluate(async () => {
        const r = await fetch('/js/app-shell.js');
        return { status: r.status, hasCap: typeof window.Capacitor !== 'undefined', isNative: document.documentElement.classList.contains('is-native') };
    });
    ok('app-shell.js 可访问', shell.status === 200);
    ok('未误判为原生壳', shell.hasCap === false && shell.isNative === false);

    console.log(`\n=== 结果：${pass}/${pass + fail} 通过，${fail} 失败`);
    await browser.close();
    process.exit(fail ? 1 : 0);
})();
