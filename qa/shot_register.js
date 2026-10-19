// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// shot_register.js — 目检用截图（注册页 PC/手机、邀请码页、用户管理待审核态）
// 用法：NODE_PATH=... node shot_register.js
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/docs';

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });

    // PC：注册页
    const pc = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const p = await pc.newPage();
    await p.goto(BASE + '/Register');
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, '注册页-PC.png') });

    // 手机：注册页
    const mb = await browser.newContext({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
        isMobile: true, hasTouch: true, reducedMotion: 'reduce',
    });
    const m = await mb.newPage();
    await m.goto(BASE + '/Register');
    await m.waitForTimeout(400);
    await m.screenshot({ path: path.join(OUT, '注册页-手机.png') });

    // 管理端：邀请码 + 用户管理
    const ac = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const a = await ac.newPage();
    await a.goto(BASE + '/Login');
    await a.fill('#Username', ADMIN);
    await a.fill('#Password', PW);
    await a.click('form button[type=submit]');
    await a.waitForLoadState('networkidle').catch(() => { });

    await a.goto(BASE + '/Admin/Invitations');
    await a.fill('#Count', '3');
    await a.fill('#Note', '小林');
    await a.click('.invite-form button[type=submit]');
    await a.waitForLoadState('networkidle').catch(() => { });
    await a.waitForTimeout(500);
    await a.screenshot({ path: path.join(OUT, '邀请码页.png') });

    await a.goto(BASE + '/Admin/Users');
    await a.waitForTimeout(300);
    await a.screenshot({ path: path.join(OUT, '用户管理.png') });

    await browser.close();
    console.log('shots ok');
})().catch(e => { console.error(e); process.exit(1); });
