// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 登录落地页验证：登录成功后固定进工作台（/），不跟随深链接 ReturnUrl
// 用法: NODE_PATH=... node qa_login_redirect.js
const { chromium } = require('playwright');

const BASE = 'http://localhost:5188';
const results = [];
function check(name, ok, extra = '') { results.push({ name, ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : '')); }

async function login(page) {
  await page.goto(BASE + '/Login');
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(800);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // 1. 普通登录（无 ReturnUrl）→ 工作台
  await login(page);
  const u1 = page.url();
  const title1 = await page.evaluate(() => document.querySelector('.page-head h1, .dash-title, h1')?.textContent?.trim() || '');
  check('普通登录落地工作台', u1 === BASE + '/', `url=${u1}`);

  // 2. 带深链接 ReturnUrl 登录 → 仍回工作台（不跳 /Schedule）
  await page.goto(BASE + '/Logout', { waitUntil: 'networkidle' }).catch(() => {});
  // 退出是 POST 表单：清 cookie 直接重建上下文更干净
  await ctx.clearCookies();
  await page.goto(BASE + '/Login?ReturnUrl=%2FSchedule');
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(800);
  const u2 = page.url();
  check('深链接登录也落地工作台', u2 === BASE + '/', `url=${u2}`);

  // 3. 已登录再访问 /Login（带 ReturnUrl）→ 工作台
  await page.goto(BASE + '/Login?ReturnUrl=%2FMemo');
  await page.waitForTimeout(500);
  const u3 = page.url();
  check('已登录访问 /Login 直进工作台', u3 === BASE + '/', `url=${u3}`);

  // 4. 页面确实是工作台（含聚合内容标识）
  const isDash = await page.evaluate(() => (document.body.innerText || '').length > 0 &&
    /工作台|今天|提醒|打卡/.test(document.body.innerText));
  check('落地页为工作台内容', isDash);

  await browser.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\n== 登录跳转验证: ${pass} PASS / ${fail} FAIL ==`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
