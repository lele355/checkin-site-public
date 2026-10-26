// 手机端 UI 紧凑化目检截图（390×844，iPhone 14 逻辑分辨率）
// 用法：node shot_mobile.js   （需 5188 开发站运行中）
const QA = require('./_env');
const { chromium } = require('playwright');

const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();

  // 登录
  await page.goto(BASE + '/Login');
  await page.fill('input[name="Username"]', QA.USER);
  await page.fill('input[name="Password"]', QA.PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(u => !u.pathname.includes('Login'), { timeout: 10000 });

  const shots = [
    ['mobile_home', '/'],
    ['mobile_schedule_cal', '/Schedule?view=calendar'],
    ['mobile_schedule_list', '/Schedule?view=list'],
    ['mobile_memo', '/Memo'],
    ['mobile_checkin', '/Habits'],
    ['mobile_account', '/Expenses'],
    ['mobile_stats', '/Stats'],
    ['mobile_courses', '/Courses'],
  ];
  for (const [name, url] of shots) {
    await page.goto(BASE + url);
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/' + name + '.png' });
    console.log('shot', name);
  }

  // 弹窗表单目检：日程「新建」弹窗
  await page.goto(BASE + '/Schedule');
  await page.waitForTimeout(300);
  const newLink = page.locator('a[href="/Schedule/New"]').first();
  if (await newLink.count()) {
    await newLink.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: OUT + '/mobile_modal_form.png' });
    console.log('shot mobile_modal_form');
  } else {
    console.log('skip modal: no /Schedule/New link');
  }

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error(e); process.exit(1); });
