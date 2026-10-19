// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 手机端外观面板截图（复现/验收用）
// 用法: NODE_PATH=... node shot_appearance.js before|after [theme]
const { chromium } = require('playwright');
const tag = process.argv[2] || 'shot';
const theme = process.argv[3] || '';
const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  // iPhone 12/13 尺寸 390x844
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE + '/Login');
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(800);

  await page.click('#appearanceBtn');
  await page.waitForTimeout(300);
  if (theme) {
    const card = page.locator(`.theme-card[data-theme-slug="${theme}"]`);
    if (await card.count()) { await card.click(); await page.waitForTimeout(300); }
  }

  // 面板几何信息（判断是否超出视口）
  const geo = await page.evaluate(() => {
    const p = document.querySelector('.appearance-panel');
    const r = p.getBoundingClientRect();
    return {
      viewport: { w: innerWidth, h: innerHeight },
      panel: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
      scroll: { scrollH: p.scrollHeight, clientH: p.clientHeight },
      overflowsScreen: r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.left < -1,
    };
  });
  console.log(JSON.stringify(geo, null, 2));

  await page.screenshot({ path: `${OUT}/mobile-appearance-${tag}${theme ? '-' + theme : ''}.png` });
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
