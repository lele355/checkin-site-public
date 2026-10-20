// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 量布局盒：确认 .content 铺满、padding 生效、滚动条贴边
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5188';

(async () => {
    const b = await chromium.launch({ channel: 'msedge' });
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', ADMIN);
    await p.fill('#Password', PW);
    await p.locator('form:has(#Username) button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');
    await p.evaluate(() => localStorage.setItem('layout.sidebar', 'hidden'));

    for (const w of [1280, 1440, 1600, 1920, 2560]) {
        await p.setViewportSize({ width: w, height: 1000 });
        await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(300);
        const m = await p.evaluate(() => {
            const c = document.querySelector('main.content');
            const cr = c.getBoundingClientRect();
            const cs = getComputedStyle(c);
            const side = document.querySelector('.sidebar');
            const first = document.querySelector('#dashGrid > .card');
            const fr = first ? first.getBoundingClientRect() : null;
            const cols = getComputedStyle(document.querySelector('#dashGrid')).gridTemplateColumns.split(' ').length;
            return {
                vw: innerWidth,
                sidebar: side ? Math.round(side.getBoundingClientRect().width) : -1,
                contentLeft: Math.round(cr.left),
                contentRight: Math.round(cr.right),
                contentW: Math.round(cr.width),
                padL: cs.paddingLeft, padR: cs.paddingRight,
                scrollW: Math.round(c.scrollWidth), clientW: Math.round(c.clientWidth),
                overflowY: c.scrollHeight > c.clientHeight,
                cardLeft: fr ? Math.round(fr.left) : null,
                cardRight: fr ? Math.round(fr.right) : null,
                cardW: fr ? Math.round(fr.width) : null,
                cols
            };
        });
        console.log(JSON.stringify(m));
    }
    await b.close();
})();
