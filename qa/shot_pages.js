// shot_pages.js — 登录后按桌面/手机两种视口截若干页面，用来肉眼比对 App 的观感。
// 口令一律走 _env.js（QA_PASS），不写死在文件里 —— 见 _env.js 顶部的铁律。
//
//   export QA_PASS='…' && node shot_pages.js              # 默认截 / 与 /Courses
//   PAGES=Board,Couples node shot_pages.js                # 自己指定（可省前导斜杠）
//
// 注意：Git Bash 会把以 / 开头的环境变量当路径转换，所以 PAGES 里**别带前导斜杠**，
// 脚本自己补。真的要带就先 `export MSYS_NO_PATHCONV=1`（但那样 NODE_PATH 也要跟着改）。
const { chromium } = require('playwright');
const { USER, PASS } = require('./_env');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const OUT = process.env.QA_SHOT_DIR || '.';
const PAGES = (process.env.PAGES || '/,/Courses')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(s => (s === '/' ? '/' : '/' + s.replace(/^\/+/, '')));

async function login(page) {
    await page.goto(BASE + '/Login');
    await page.fill('input[name="Username"]', USER);
    await page.fill('input[name="Password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(u => !u.pathname.toLowerCase().includes('/login'), { timeout: 20000 });
}

const slug = p => (p === '/' ? 'home' : p.replace(/^\//, '').replace(/\//g, '-').toLowerCase()) || 'home';

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    for (const [tag, vp, mobile] of [
        ['desktop', { width: 1280, height: 900 }, false],
        ['mobile', { width: 390, height: 844 }, true],
    ]) {
        const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
        const page = await ctx.newPage();
        await login(page);
        for (const p of PAGES) {
            await page.goto(BASE + p);
            await page.waitForLoadState('networkidle');
            const f = `${OUT}/${slug(p)}-${tag}.png`;
            await page.screenshot({ path: f, fullPage: true });
            console.log('shot', f);
        }
        await ctx.close();
    }
    await browser.close();
    console.log('done');
})();
