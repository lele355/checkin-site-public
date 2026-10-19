// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// UI 打磨验证：行内按钮尺寸 / 卡片底边对齐 / 手机权限单行 / 动效生效 + 尊重 reduced-motion
const { chromium } = require('playwright');
const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';
let pass = 0, fail = 0;
function T(name, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
  ok ? pass++ : fail++;
}

async function login(page) {
  await page.goto(BASE + '/Login');
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.toLowerCase().includes('login'), { timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });

  // ---------- 桌面（允许动画，验证动效真的跑） ----------
  const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pd = await ctxD.newPage();
  await login(pd);
  await pd.goto(BASE + '/');
  await pd.waitForSelector('#dashGrid [data-card]');
  await pd.waitForTimeout(900);

  const btnH = await pd.locator('.list-line .btn').first().evaluate(el => getComputedStyle(el).minHeight);
  T('行内打卡按钮压到 32px', btnH === '32px', btnH);

  // 有 .stack 的卡片：尾链接贴底（与卡片底距离 ≤ 卡片 padding+2）
  const foot = await pd.evaluate(() => {
    const out = [];
    document.querySelectorAll('#dashGrid > .card').forEach(card => {
      if (!card.querySelector('.stack')) return;
      const hint = card.querySelector(':scope > .hint:last-child');
      if (!hint) return;
      const cr = card.getBoundingClientRect(), hr = hint.getBoundingClientRect();
      out.push(Math.round(cr.bottom - hr.bottom));
    });
    return out;
  });
  T('列表卡尾链接贴底对齐', foot.length > 0 && foot.every(g => g <= 28), JSON.stringify(foot));

  const cardAnim = await pd.locator('#dashGrid > .card').first().evaluate(el => getComputedStyle(el).animationName);
  T('工作台卡片入场动效生效', cardAnim === 'card-in', cardAnim);

  await pd.goto(BASE + '/Stats');
  await pd.waitForTimeout(400);
  const barAnim = await pd.locator('.bar-fill').first().evaluate(el => getComputedStyle(el).animationName);
  T('统计进度条生长动效生效', barAnim === 'bar-grow', barAnim);
  const monthAnim = await pd.locator('.month-bar').first().evaluate(el => getComputedStyle(el).animationName);
  T('月柱升起动效生效', monthAnim === 'bar-rise', monthAnim);
  await pd.screenshot({ path: OUT + '/polish_stats.png' });

  await pd.goto(BASE + '/');
  await pd.waitForTimeout(900);
  await pd.screenshot({ path: OUT + '/polish_home_desktop.png' });

  // ---------- 手机 ----------
  const ctxM = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  const pm = await ctxM.newPage();
  await login(pm);
  await pm.goto(BASE + '/');
  await pm.waitForSelector('.perm-wrap');
  const perm = await pm.evaluate(() => {
    const el = document.querySelector('.perm-wrap');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { overflowX: cs.overflowX, h: Math.round(r.height), scrollable: el.scrollWidth > el.clientWidth };
  });
  T('手机权限 chips 收到一行横滑', perm.overflowX === 'auto' && perm.h <= 36, JSON.stringify(perm));
  const mBtnH = await pm.locator('.list-line .btn').first().evaluate(el => getComputedStyle(el).minHeight);
  T('手机行内打卡按钮 32px', mBtnH === '32px', mBtnH);
  await pm.screenshot({ path: OUT + '/polish_home_mobile.png' });

  // reduced-motion 下动效应关闭
  const rmAnim = await pm.locator('#dashGrid > .card').first().evaluate(el => getComputedStyle(el).animationName);
  T('reduced-motion 下卡片动效关闭', rmAnim === 'none', rmAnim);

  // 无横向溢出复查
  const ovf = await pm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  T('手机工作台无横向溢出', ovf <= 1, 'overflowX=' + ovf);

  console.log('===== 结果: ' + pass + '/' + (pass + fail) + ' 通过 =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
