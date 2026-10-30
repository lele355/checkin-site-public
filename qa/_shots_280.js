const { chromium } = require('playwright');
const fs = require('fs');
const SHOTS = 'D:/checkin/site/qa/shots_280';
const BASE = 'http://127.0.0.1:5188';
(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch({ channel: 'msedge' });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.setDefaultTimeout(20000);
    for (const gk of ['Gomoku', 'Reversi', 'Jungle', 'Xiangqi', 'Ludo', 'Armychess']) {
        await page.goto(BASE + '/Games/' + gk);
        await page.waitForLoadState('load');
        await page.screenshot({ path: SHOTS + '/lobby_' + gk + '.png', fullPage: true });
        await page.goto(BASE + '/Games/' + gk + '/Rules');
        await page.waitForLoadState('load');
        await page.screenshot({ path: SHOTS + '/rules_' + gk + '.png', fullPage: true });
        // 建房截图盘面
        await page.goto(BASE + '/Games/' + gk);
        await page.waitForLoadState('load');
        const btn = page.locator('form button[type="submit"]').filter({ hasText: /新建|我先手|开始/ }).first()
            .or(page.locator('form[action*="reate"] button').first());
        if (await btn.count()) {
            await Promise.all([page.waitForURL(/\/Play\//i, { timeout: 15000 }).catch(() => null), btn.click()]);
            await page.waitForTimeout(900);
            await page.screenshot({ path: SHOTS + '/play_' + gk + '.png', fullPage: true });
            console.log('play', gk, page.url());
        } else console.log('no create btn', gk);
    }
    // 手机视口抽查
    const mp = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    for (const gk of ['Gomoku', 'Armychess']) {
        await mp.goto(BASE + '/Games/' + gk);
        await mp.waitForLoadState('load');
        const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
        console.log('mobile', gk, 'overflow=', overflow);
        await mp.screenshot({ path: SHOTS + '/mobile_' + gk + '.png', fullPage: true });
    }
    await browser.close();
    console.log('screenshots done');
})();
