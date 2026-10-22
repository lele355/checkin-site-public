// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab 线上压力抽样：上传一份指定 PPT，量转换耗时 / 页数 / 落盘体积，跑完删掉
// 用法：FILE=D:/tmp/big.pptx node pylab_loadtest.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://example.com';
const FILE = process.env.FILE || 'D:/tmp/big.pptx';
const KEEP = process.env.KEEP === '1';

(async () => {
    const b = await chromium.launch({ channel: 'msedge' });
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', ADMIN);
    await p.fill('#Password', PW);
    await p.locator('form:has(#Username) button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');

    await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 25000 });
    await p.click('.py-tab[data-tab="deck"]');
    await p.click('.py-segbtn[data-deckview="lib"]');
    await p.waitForTimeout(600);

    const title = 'LOADTEST_' + path.basename(FILE) + '_' + Date.now().toString().slice(-5);
    const sizeMB = (fs.statSync(FILE).size / 1048576).toFixed(2);

    await p.setInputFiles('#pyDeckFile', FILE);
    await p.fill('#pyDeckTitle', title);
    const t0 = Date.now();
    await p.click('[data-act="upload"]');
    await p.waitForFunction(
        () => /搞定|失败|错误|✗|⚠|太大/.test(document.getElementById('pyUploadStatus')?.textContent || ''),
        null, { timeout: 600000 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const msg = (await p.locator('#pyUploadStatus').innerText()).trim().replace(/\s+/g, ' ');

    await p.waitForTimeout(800);
    const card = p.locator('#pyDeckGrid .py-deck', { hasText: title }).first();
    const sub = (await card.locator('.sub').innerText().catch(() => '')).trim().replace(/\s+/g, ' ');

    console.log(JSON.stringify({ file: path.basename(FILE), sizeMB, totalSeconds: secs, status: msg, card: sub }, null, 1));

    if (!KEEP) {
        p.once('dialog', d => d.accept());
        await card.locator('[data-deck-del]').click().catch(() => { });
        await p.waitForTimeout(1500);
        const left = await p.locator('#pyDeckGrid .py-deck', { hasText: title }).count();
        console.log('cleaned=' + (left === 0));
    } else {
        console.log('kept deck id -> ' + title);
    }
    await b.close();
})();
