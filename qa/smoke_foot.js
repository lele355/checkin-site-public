const { chromium } = require('playwright');
// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
const BASE = 'http://127.0.0.1:5188';
const OUT = 'D:/projects/checkin/qa/shots/app';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const errs = [];

  // 桌面：抽查几个页面的页脚位置（不该跑出可视区或压住底部按钮）
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('desktop: ' + e.message));
  await page.goto(BASE + '/Login');
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await Promise.all([page.waitForNavigation(), page.click('form:has(#Username) button[type=submit]')]);

  for (const u of ['/', '/Schedule', '/Memo', '/Me']) {
    const r = await page.goto(BASE + u);
    await page.waitForTimeout(350);
    const info = await page.evaluate(() => {
      const f = document.querySelector('.site-foot');
      if (!f) return { ok: false, why: '无页脚' };
      const b = f.getBoundingClientRect();
      const links = [...f.querySelectorAll('.foot-links a')].map(a => a.textContent.trim());
      // 内容容器是否被撑出横向滚动
      const main = document.querySelector('main.content');
      return { ok: true, w: Math.round(b.width), links, hScroll: main ? main.scrollWidth > main.clientWidth + 1 : null };
    });
    console.log(u.padEnd(10), r.status(), JSON.stringify(info));
  }

  // 手机：页脚与底栏是否打架
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const mp = await m.newPage();
  mp.on('pageerror', e => errs.push('mobile: ' + e.message));
  await mp.goto(BASE + '/Login');
  await mp.fill('#Username', ADMIN);
  await mp.fill('#Password', PW);
  await Promise.all([mp.waitForNavigation(), mp.click('form:has(#Username) button[type=submit]')]);
  await mp.goto(BASE + '/');
  await mp.waitForTimeout(400);
  await mp.evaluate(() => {
    const main = document.querySelector('main.content');
    if (main) main.scrollTop = main.scrollHeight;
    const f = document.querySelector('.site-foot');
    f && f.scrollIntoView({ block: 'end' });
  });
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: `${OUT}/home-mobile-foot.png` });

  const overlap = await mp.evaluate(() => {
    const f = document.querySelector('.site-foot');
    const bar = document.querySelector('.bottombar');
    if (!f || !bar) return '缺少元素';
    return { footBottom: Math.round(f.getBoundingClientRect().bottom), barTop: Math.round(bar.getBoundingClientRect().top) };
  });
  console.log('手机页脚/底栏:', JSON.stringify(overlap));
  console.log('JS 错误:', errs.length ? errs : '无');
  await browser.close();
})();
