// 原生壳性能优化后的视觉校验：三个主题各截一张，并读回关键计算样式，
// 确认渐变底 / 32px 圆角 / 三层阴影 / 入场动画这些「视觉」一个都没被动到。
const QA = require('./_env');
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://127.0.0.1:5188';
const OUT = 'D:/projects/checkin/qa/shots/native-perf';

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch({ channel: 'msedge' });
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));

    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', QA.USER);
    await p.fill('#Password', QA.PASS);
    await p.locator('form:has(#Username) button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');
    await p.waitForTimeout(800);

    const rows = [];
    for (const t of ['clay', 'default', 'macos']) {
        await p.evaluate(th => { document.documentElement.dataset.theme = th; }, t);
        await p.waitForTimeout(600);
        await p.screenshot({ path: `${OUT}/${t}.png` });

        const probe = await p.evaluate(() => {
            const foot = document.querySelector('.sidebar .sidebar-foot');
            const side = document.querySelector('.sidebar');
            const card = document.querySelector('.card');
            const top = document.querySelector('.topbar');
            const g = el => (el ? getComputedStyle(el) : null);
            const f = g(foot), s = g(side), c = g(card), tp = g(top);
            return {
                footBlur: f && f.backdropFilter,
                footBg: f && f.backgroundColor,
                sideBlur: s && s.backdropFilter,
                topBlur: tp && tp.backdropFilter,
                cardBgImage: c && c.backgroundImage.slice(0, 70),
                cardRadius: c && c.borderRadius,
                cardShadow: c && c.boxShadow.slice(0, 110),
                cardTransition: c && c.transitionProperty,
                revealCount: document.querySelectorAll('.reveal').length,
                revealInCount: document.querySelectorAll('.reveal.is-in').length
            };
        });
        rows.push(Object.assign({ theme: t }, probe));
    }

    console.log(JSON.stringify(rows, null, 1));
    console.log('pageerror:', errs.length ? errs : 'none');
    await b.close();
})().catch(e => { console.error(e); process.exit(1); });
