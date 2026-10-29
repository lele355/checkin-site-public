// shot_courses.js — 截 /Courses 的桌面与手机两种视口，用来肉眼比对 App 的观感。
// 口令一律走 _env.js（QA_PASS），不写死在文件里 —— 见 _env.js 顶部的铁律。
//
//   export QA_PASS='…' && node shot_courses.js
const { chromium } = require('playwright');
const { USER, PASS } = require('./_env');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const OUT = process.env.QA_SHOT_DIR || '.';

async function login(page) {
    await page.goto(BASE + '/Login');
    await page.fill('input[name="Username"]', USER);
    await page.fill('input[name="Password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(u => !u.pathname.toLowerCase().includes('/login'), { timeout: 20000 });
}

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });

    const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await desk.newPage();
    await login(page);
    await page.goto(BASE + '/Courses');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${OUT}/courses-desktop.png`, fullPage: true });

    const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await mob.newPage();
    await login(mp);
    await mp.goto(BASE + '/Courses');
    await mp.waitForLoadState('networkidle');
    await mp.screenshot({ path: `${OUT}/courses-mobile.png`, fullPage: true });

    await browser.close();
    console.log('done:', `${OUT}/courses-desktop.png`, `${OUT}/courses-mobile.png`);
})();
