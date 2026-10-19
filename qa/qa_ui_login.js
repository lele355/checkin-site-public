// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// UI 控件改造截图目检 + 登录新功能测试
// 用法: NODE_PATH=... node qa_ui_login.js
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';
const results = [];
function check(name, ok, extra = '') { results.push({ name, ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : '')); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());

  // ---------- 登录页 ----------
  await page.goto(BASE + '/Login');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/login-new.png`, clip: { x: 380, y: 60, width: 520, height: 640 } });
  check('登录页有密码保存方式三选一', await page.locator('.remember-me input[type="radio"]').count() === 3 && await page.locator('input[name="RememberMode"][value="autologin"]').count() === 1 && await page.locator('input[name="RememberMode"][value="prefill"]').count() === 1 && await page.locator('input[name="RememberMode"][value="none"]').count() === 1);

  // 错误次数提示：用随机用户名避免限速器残留计数污染（限速按 username+ip 计）
  const failUser = 'QAFail_' + Date.now().toString(36);
  await page.fill('#Username', failUser);
  await page.fill('#Password', 'WrongPass1!');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(800);
  const err1 = await page.locator('.msg.error').textContent().catch(() => '');
  check('首次失败提示剩余次数', /还可尝试 4 次/.test(err1 || ''), (err1 || '').trim().slice(0, 45));

  // 错第 2 次 → 还可尝试 3 次
  await page.fill('#Password', 'WrongPass2!');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(800);
  const err2 = await page.locator('.msg.error').textContent().catch(() => '');
  check('二次失败剩余次数递减', /还可尝试 3 次/.test(err2 || ''), (err2 || '').trim().slice(0, 45));

  // 记住密码：勾选后正确登录 → 重新打开登录页应预填（模拟：登出后看预填）
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await page.check('input[name="RememberMode"][value="autologin"]');   // 自动进入=持久 cookie
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(900);
  check('勾选记住密码后登录成功', page.url().includes('/Login') === false, page.url().replace(BASE, ''));

  const saved = await page.evaluate(() => localStorage.getItem('checkin_remember'));
  check('记住密码写入 localStorage', !!saved && JSON.parse(saved).u === ADMIN);

  // 持久 cookie：Expires 不为会话级
  const cookies = await ctx.cookies(BASE);
  const auth = cookies.find(c => c.name === 'checkin_auth');
  check('登录 cookie 为 30 天持久', auth && auth.expires > 0, auth ? `expires=${new Date(auth.expires * 1000).toISOString().slice(0, 10)}` : 'no cookie');

  // 登出 → 回登录页 → 预填验证
  await page.goto(BASE + '/Logout');
  await page.waitForTimeout(300);
  await page.locator('form[action*="Logout"] button, .bottombar button:has-text("退出"), button:has-text("退出")').first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.goto(BASE + '/Login');
  await page.waitForLoadState('networkidle');
  const preU = await page.inputValue('#Username').catch(() => '');
  const preP = await page.inputValue('#Password').catch(() => '');
  const preR = await page.isChecked('input[name="RememberMode"][value="autologin"]').catch(() => false);
  check('重开登录页自动预填账号密码', preU === ADMIN && preP.length > 0 && preR, `u=${preU} p=${preP ? '***' : '空'} r=${preR}`);
  await page.screenshot({ path: `${OUT}/login-prefill.png`, clip: { x: 380, y: 60, width: 520, height: 640 } });

  // ---------- 五主题控件截图 ----------
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(900);

  const themes = [
    ['editorial', ''],
    ['neumorphism', ''],
    ['natural', ''],
    ['macos', ''],
    ['clay', ''],
  ];
  for (const [slug, accent] of themes) {
    await page.evaluate(([t, a]) => {
      localStorage.setItem('theme.slug', t);
      localStorage.setItem('theme.accent', a);
    }, [slug, accent]);

    // 日历视图（cal-btn + view-switch）
    await page.goto(BASE + '/Schedule?view=calendar');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/ctl-cal-${slug}.png`, clip: { x: 250, y: 60, width: 1000, height: 420 } });
    const calBtnBg = await page.evaluate(() => {
      const b = document.querySelector('.cal-btn');
      return b ? getComputedStyle(b).backgroundColor + ' | r=' + getComputedStyle(b).borderRadius : 'missing';
    });
    check(`[${slug}] cal-btn 有主题样式`, calBtnBg !== 'missing', calBtnBg);

    // 视图切换器特写
    const sw = await page.locator('.view-switch').first();
    if (await sw.count()) await sw.screenshot({ path: `${OUT}/ctl-vs-${slug}.png` });

    // AI 输入框
    await page.goto(BASE + '/Ai');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const ta = await page.locator('.ai-input-card').first();
    if (await ta.count()) await ta.screenshot({ path: `${OUT}/ctl-ai-${slug}.png` });
    const aiBg = await page.evaluate(() => {
      const t = document.querySelector('.ai-input-row textarea');
      return t ? getComputedStyle(t).backgroundColor + ' | r=' + getComputedStyle(t).borderRadius : 'missing';
    });
    check(`[${slug}] AI 输入框有主题样式`, aiBg !== 'missing', aiBg);

    // 日期控件（纪念日新建弹窗打开列表页用裸日期也行——直接看课表学期起始）
    await page.goto(BASE + '/Courses');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const dt = await page.locator('.tt-semester').first();
    if (await dt.count()) await dt.screenshot({ path: `${OUT}/ctl-date-${slug}.png` });
    const dateBg = await page.evaluate(() => {
      const d = document.querySelector('.tt-semester input[type="date"]');
      return d ? getComputedStyle(d).backgroundColor + ' | scheme=' + getComputedStyle(d).colorScheme : 'missing';
    });
    const schemeOk = slug === 'macos' ? /dark/.test(dateBg) : true;
    check(`[${slug}] 日期控件主题化`, dateBg !== 'missing' && schemeOk, dateBg);
  }

  await browser.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\n== UI+登录测试: ${pass} PASS / ${fail} FAIL ==`);
  fs.writeFileSync('D:/projects/checkin/qa/report-ui-login.json', JSON.stringify({ pass, fail, results }, null, 2));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
