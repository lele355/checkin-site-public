// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// 课表改版目检：手机视口截图（登录 → 课表 → 设置）
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://127.0.0.1:5199';
const USER = process.env.QA_USER || ADMIN;
const PASS = process.env.QA_PASS || process.env.QA_PASS;
const OUT = process.env.OUT || 'D:/checkin-work/tmp/tt';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  await page.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="Username"], #Username', USER);
  await page.fill('input[name="Password"], #Password', PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);

  await page.goto(BASE + '/Courses', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/courses-mobile.png', fullPage: false });

  const info = await page.evaluate(() => {
    const sc = document.querySelector('.ttm-scroll');
    const today = document.querySelector('.ttm-dhead.today');
    return {
      hasLegend: !!document.querySelector('.tt-legend'),
      hasSemesterForm: !!document.querySelector('.tt-semester'),
      todayText: today ? today.innerText.replace(/\n/g, ' ') : null,
      scrollLeft: sc ? Math.round(sc.scrollLeft) : null,
      todayLeft: today ? Math.round(today.getBoundingClientRect().left) : null,
      scrollBoxLeft: sc ? Math.round(sc.getBoundingClientRect().left) : null,
    };
  });

  await page.goto(BASE + '/Courses/Settings', { waitUntil: 'networkidle' });
  await page.screenshot({ path: OUT + '/courses-settings.png', fullPage: true });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
