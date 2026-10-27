// PC 1920 全页面巡检截图（侧栏收起）：看布局是否铺满、有无溢出/错位
const QA = require('./_env');
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://127.0.0.1:5188';
const OUT = 'D:/projects/checkin/qa/shots/pc';

const PAGES = [
    ['/', 'p-index'], ['/Schedule', 'p-schedule'], ['/Memo', 'p-memo'],
    ['/Habits', 'p-habits'], ['/Expenses', 'p-expenses'], ['/Courses', 'p-courses'],
    ['/Stats', 'p-stats'], ['/Me', 'p-me'], ['/Reminders', 'p-remind'],
    ['/Export', 'p-export'], ['/Email', 'p-email'], ['/Ai', 'p-ai'],
    ['/Anniversaries', 'p-anniv'], ['/Board', 'p-board'], ['/Couples', 'p-couples'],
    ['/Period', 'p-period'], ['/Admin/Users', 'p-adminusers'],
    ['/Privacy', 'p-privacy'], ['/About', 'p-about'], ['/Terms', 'p-terms']
];

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch({ channel: 'msedge' });
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(p.url() + ' :: ' + e.message));

    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', QA.USER);
    await p.fill('#Password', QA.PASS);
    await p.locator('form:has(#Username) button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');
    await p.evaluate(() => localStorage.setItem('layout.sidebar', 'hidden'));

    for (const [u, n] of PAGES) {
        let res = null;
        try { res = await p.goto(BASE + u, { waitUntil: 'domcontentloaded' }); }
        catch (e) { console.log('  x ' + u + ' 导航失败 ' + e.message.split('\n')[0]); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => { }); continue; }
        await p.waitForTimeout(420);
        const info = await p.evaluate(() => {
            const c = document.querySelector('main.content');
            const overflowX = c.scrollWidth - c.clientWidth;
            return { status: document.title.slice(0, 0) || '', overflowX, url: location.pathname };
        });
        await p.screenshot({ path: `${OUT}/${n}.png` });
        console.log(`  ${info.overflowX > 1 ? 'x 溢出' : 'v'} ${u}  code=${res.status()} overflowX=${info.overflowX}`);
    }
    console.log(errs.length ? 'JS ERRORS:\n' + errs.join('\n') : 'no js errors');
    await b.close();
})();
