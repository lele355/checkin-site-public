// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 本轮目检：AI 输入行布局 / 手机课表网格 / 节次时间设置页（390×844）
const { chromium } = require('playwright');
const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/Login');
  await page.fill('input[name="Username"]', ADMIN);
  await page.fill('input[name="Password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL(u => !u.pathname.includes('Login'), { timeout: 10000 });

  // ① AI 输入行：截图 + 验证按钮不再被 form-actions 撑开
  await page.goto(BASE + '/Ai');
  await page.waitForTimeout(400);
  const ai = await page.evaluate(() => {
    const row = document.querySelector('.ai-input-row');
    const btn = row && row.querySelector('.btn');
    const ta = row && row.querySelector('textarea');
    return {
      rowClasses: row ? row.className : null,
      btnW: btn ? Math.round(btn.getBoundingClientRect().width) : null,
      btnH: btn ? Math.round(btn.getBoundingClientRect().height) : null,
      btnFlex: btn ? getComputedStyle(btn).flex : null,
      taW: ta ? Math.round(ta.getBoundingClientRect().width) : null,
    };
  });
  console.log('AI row:', JSON.stringify(ai));
  await page.screenshot({ path: OUT + '/m2_ai_input.png' });

  // ② 手机课表网格
  await page.goto(BASE + '/Courses');
  await page.waitForTimeout(500);
  const ttm = await page.evaluate(() => {
    const grid = document.querySelector('.ttm');
    const cards = document.querySelectorAll('.ttm-card');
    const gut = document.querySelectorAll('.ttm-gcell');
    return {
      gridVisible: !!grid && getComputedStyle(grid).display !== 'none',
      tableHidden: getComputedStyle(document.querySelector('.tt-wrap')).display === 'none',
      cards: cards.length, gutCells: gut.length,
      firstCard: cards[0] ? { t: cards[0].style.top, h: cards[0].style.height, w: cards[0].style.width } : null,
    };
  });
  console.log('TTM:', JSON.stringify(ttm));
  await page.screenshot({ path: OUT + '/m2_courses_grid.png' });
  await page.screenshot({ path: OUT + '/m2_courses_grid_full.png', fullPage: true });

  // ③ 节次时间设置页
  await page.goto(BASE + '/Courses/Periods');
  await page.waitForTimeout(400);
  const pp = await page.evaluate(() => ({
    rows: document.querySelectorAll('.pp-row').length,
    firstRow: document.querySelector('.pp-row') ? document.querySelector('.pp-row').textContent.trim().slice(0, 30) : null,
  }));
  console.log('Periods:', JSON.stringify(pp));
  await page.screenshot({ path: OUT + '/m2_periods.png' });

  // ④ 桌面课表不受影响（1280 视口回归看一眼）
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(BASE + '/Courses');
  await page.waitForTimeout(400);
  const dt = await page.evaluate(() => ({
    tableVisible: getComputedStyle(document.querySelector('.tt-wrap')).display !== 'none',
    gridHidden: getComputedStyle(document.querySelector('.ttm')).display === 'none',
    blocks: document.querySelectorAll('.tt tbody tr').length,
  }));
  console.log('Desktop:', JSON.stringify(dt));
  await page.screenshot({ path: OUT + '/m2_courses_desktop.png' });

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
