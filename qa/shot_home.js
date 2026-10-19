const { chromium } = require('playwright');
// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5188/Login');
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await page.click('#loginForm button[type=submit]');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.goto('http://localhost:5188/');
  await page.waitForSelector('#dashGrid [data-card]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/projects/checkin/_shots/ui4_phone_home2.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('http://localhost:5188/');
  await page.waitForSelector('#dashGrid [data-card]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/projects/checkin/_shots/ui4_pc_home2.png' });
  await browser.close();
})();
