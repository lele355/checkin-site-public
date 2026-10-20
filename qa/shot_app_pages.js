const { chromium } = require('playwright');
// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
const BASE = 'http://127.0.0.1:5188';
const OUT = 'D:/projects/checkin/qa/shots/app';

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // 登录
  await page.goto(BASE + '/Login');
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await Promise.all([page.waitForNavigation(), page.click('form:has(#Username) button[type=submit]')]);

  for (const [name, url] of [['about', '/About'], ['privacy', '/Privacy'], ['terms', '/Terms'], ['download', '/Download']]) {
    const resp = await page.goto(BASE + url);
    await page.waitForTimeout(500);
    $(0);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    // 页脚是否存在
    const foot = await page.locator('.site-foot').innerText().catch(() => '(无)');
    console.log(`${url} -> ${resp.status()} | 页脚: ${foot.replace(/\n/g, ' / ')}`);
  }

  // 手机视口看页脚换行
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const mp = await m.newPage();
  await mp.goto(BASE + '/Login');
  await mp.fill('#Username', ADMIN);
  await mp.fill('#Password', PW);
  await Promise.all([mp.waitForNavigation(), mp.click('form:has(#Username) button[type=submit]')]);
  await mp.goto(BASE + '/Privacy');
  await mp.waitForTimeout(400);
  await mp.evaluate(() => { const f = document.querySelector('.site-foot'); f && f.scrollIntoView({ block: 'center' }); });
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: `${OUT}/privacy-mobile.png` });

  console.log('JS 错误:', errs.length ? errs : '无');
  await browser.close();
})();
function $(n) { }
