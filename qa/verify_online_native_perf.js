// 线上发版抽验：确认「视觉零改动」版真的上线生效。
// 检查点：主题样式原样 → 入场动画仍在 → 元素提前进入动画 → 无 JS 报错。
const QA = require('./_env');
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'https://example.com';
const OUT = 'D:/projects/checkin/qa/shots/native-perf';
const USER = QA.USER;
const PW = process.env.CHECKIN_PW || QA.PASS_ONLINE;

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch({ channel: 'msedge' });
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));

    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.fill('#Username', USER);
    await p.fill('#Password', PW);
    await p.locator('form:has(#Username) button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');
    await p.waitForTimeout(1500);

    const check = await p.evaluate(() => {
        const all = [...document.querySelectorAll('.reveal, .reveal-fade')];
        const vh = window.innerHeight;
        const below = all.filter(e => { const t = e.getBoundingClientRect().top; return t > vh && t < vh + 280; });
        const foot = document.querySelector('.sidebar .sidebar-foot');
        const card = document.querySelector('.card');
        const f = foot ? getComputedStyle(foot) : null;
        const c = card ? getComputedStyle(card) : null;
        return {
            path: location.pathname,
            theme: document.documentElement.getAttribute('data-theme'),
            revealTotal: all.length,
            revealIn: all.filter(e => e.classList.contains('is-in')).length,
            belowWithin280: below.length,
            belowAlreadyIn: below.filter(e => e.classList.contains('is-in')).length,
            footBlur: f && f.backdropFilter,
            cardRadius: c && c.borderRadius,
            cardShadow: c && c.boxShadow.slice(0, 40),
            hasAnimRule: [...document.styleSheets].some(s => {
                try { return [...s.cssRules].some(r => r.cssText && r.cssText.includes('reveal-up')); } catch (e) { return false; }
            })
        };
    });

    await p.screenshot({ path: `${OUT}/online-mobile.png`, fullPage: false });

    // 滚动一屏，看重绘是否跟得上（至少不报错、reveal 继续推进）
    await p.evaluate(() => window.scrollBy(0, 700));
    await p.waitForTimeout(900);
    const after = await p.evaluate(() => {
        const all = [...document.querySelectorAll('.reveal, .reveal-fade')];
        return { revealIn: all.filter(e => e.classList.contains('is-in')).length, scrollY: Math.round(window.scrollY) };
    });

    console.log('首屏:', JSON.stringify(check, null, 1));
    console.log('滚动后:', JSON.stringify(after));
    console.log('pageerror:', errs.length ? errs : 'none');
    await b.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
