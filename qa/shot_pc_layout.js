// PC 端布局目检截图：不同视口宽度 × 侧栏展开/收起，覆盖工作台 / PyLab / 备忘
const QA = require('./_env');
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://127.0.0.1:5188';
const OUT = 'D:/projects/checkin/qa/shots/pc';

async function shot(p, name) {
    await p.waitForTimeout(450);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    console.log('  shot ' + name);
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch({ channel: 'msedge' });

    const sizes = [[1920, 1080], [2560, 1440], [1440, 900], [1280, 800]];
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));

    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', QA.USER);
    await p.fill('#Password', QA.PASS);
    await p.locator('form:has(#Username) button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');

    for (const [w, h] of sizes) {
        await p.setViewportSize({ width: w, height: h });

        // 侧栏展开（写 localStorage，否则每次 goto 会被 site.js 还原）
        await p.evaluate(() => { localStorage.setItem('layout.sidebar', 'shown'); document.documentElement.removeAttribute('data-sidebar'); });
        await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await shot(p, `dash_${w}_side`);
        await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 }).catch(() => { });
        await shot(p, `pylab_roll_${w}_side`);

        // 侧栏收起
        await p.evaluate(() => { localStorage.setItem('layout.sidebar', 'hidden'); document.documentElement.setAttribute('data-sidebar', 'hidden'); });
        await p.waitForTimeout(400);
        await shot(p, `pylab_roll_${w}_hid`);
        await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await shot(p, `dash_${w}_hid`);
        await p.goto(BASE + '/Memo', { waitUntil: 'domcontentloaded' });
        await shot(p, `memo_${w}_hid`);
    }

    // 课件播放视图 + 课件库（1920 收起侧栏）
    await p.setViewportSize({ width: 1920, height: 1080 });
    await p.evaluate(() => { localStorage.setItem('layout.sidebar', 'hidden'); });
    await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 }).catch(() => { });
    await p.click('.py-tab[data-tab="deck"]');
    await shot(p, 'pylab_deck_1920_hid');
    await p.click('.py-segbtn[data-deckview="lib"]');
    await shot(p, 'pylab_lib_1920_hid');

    console.log(errs.length ? 'JS ERRORS: ' + JSON.stringify(errs) : 'no js errors');
    await b.close();
})();
