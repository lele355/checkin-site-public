// shot_me.js — 个人主页目检截图（桌面 + 手机，滚动分段截，避免 fullPage 被固定底栏/内滚动容器干扰）
const QA = require('./_env');
const { chromium } = require('playwright');
const BASE = 'http://localhost:5188';
const QA_DIR = 'D:/projects/checkin/qa';

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });

    // 桌面
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(BASE + '/Login');
    await p.fill('#Username', QA.USER);
    await p.fill('#Password', QA.PASS);
    await p.click('form button[type=submit]');
    await p.waitForLoadState('networkidle').catch(() => { });
    await p.goto(BASE + '/Me');
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${QA_DIR}/shot_me_d1.png` });
    // 主区滚动到底再截
    await p.evaluate(() => { const m = document.querySelector('main.content'); if (m) m.scrollTop = m.scrollHeight; });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${QA_DIR}/shot_me_d2.png` });

    // 手机
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    const m = await ctx2.newPage();
    await m.goto(BASE + '/Login');
    await m.fill('#Username', QA.USER);
    await m.fill('#Password', QA.PASS);
    await m.click('form button[type=submit]');
    await m.waitForLoadState('networkidle').catch(() => { });
    await m.goto(BASE + '/Me');
    await m.waitForTimeout(600);
    await m.screenshot({ path: `${QA_DIR}/shot_me_m1.png` });
    await m.evaluate(() => window.scrollTo(0, 700));
    await m.waitForTimeout(300);
    await m.screenshot({ path: `${QA_DIR}/shot_me_m2.png` });
    await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await m.waitForTimeout(300);
    await m.screenshot({ path: `${QA_DIR}/shot_me_m3.png` });

    // 顺便打出正文长度，确认二级编辑入口与测试数据入口确实渲染了
    const has = await m.evaluate(() => ({
        edit: !!document.querySelector('a[href="/Me/Edit"]'),
        pwd: !!document.querySelector('a[href="/Me/Password"]'),
        sample: !!document.querySelector('a[href="/Me/Sample"]'),
        cards: document.querySelectorAll('.card').length,
        bodyH: document.body.scrollHeight
    }));
    console.log(JSON.stringify(has));
    await browser.close();
})();
