// 密码保存方式三选一语义测试（登录页单选组）
// autologin = 下次直接进入跳过登录页（30 天持久 cookie）
// prefill  = 仅填充密码（会话 cookie，下次仍到登录页但已填好）
// none     = 不保存（并清旧档）
// 「模拟浏览器重启」= storageState 里剔除会话 cookie（expires=-1），持久 cookie 与 localStorage 保留
// 用法: NODE_PATH=... node qa_login_options.js
const QA = require('./_env');
const { chromium } = require('playwright');

const BASE = 'http://localhost:5188';
const results = [];
function check(name, ok, extra = '') { results.push({ name, ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : '')); }

async function loginWithMode(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/Login');
  await page.fill('#Username', QA.USER);
  await page.fill('#Password', QA.PASS);
  await page.check(`input[name="RememberMode"][value="${mode}"]`);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(900);
  const ok = !page.url().includes('/Login');
  const state = await ctx.storageState();
  await ctx.close();
  return { ok, state };
}

function simulateRestart(state) {
  return { ...state, cookies: state.cookies.filter(c => c.expires > 0) };
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });

  // ---- 模式一：autologin → 重启后跳过登录页直接进 ----
  {
    const r = await loginWithMode(browser, 'autologin');
    check('[autologin] 登录成功', r.ok);
    const cookies = r.state.cookies.filter(c => c.name === 'checkin_auth');
    check('[autologin] 登录 cookie 为持久(30 天)', cookies.length === 1 && cookies[0].expires > 0,
      cookies.length ? `expires=${new Date(cookies[0].expires * 1000).toISOString().slice(0, 10)}` : 'no cookie');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: simulateRestart(r.state) });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.waitForLoadState('networkidle');
    check('[autologin] 重启后跳过登录页直达工作台', page.url() === BASE + '/', `url=${page.url().replace(BASE, '') || '/'}`);
    await ctx.close();
  }

  // ---- 模式二：prefill → 重启后仍到登录页，但已填充 ----
  {
    const r = await loginWithMode(browser, 'prefill');
    check('[prefill] 登录成功', r.ok);
    const cookies = r.state.cookies.filter(c => c.name === 'checkin_auth');
    check('[prefill] 登录 cookie 为会话级(不跳过登录)', cookies.length === 1 && cookies[0].expires === -1,
      cookies.length ? `expires=${cookies[0].expires}` : 'no cookie');
    check('[prefill] 密码档写入 localStorage', (() => {
      const origins = r.state.origins || [];
      for (const o of origins) if (o.localStorage) for (const it of o.localStorage) if (it.name === 'checkin_remember') return !!it.value;
      return false;
    })());
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: simulateRestart(r.state) });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.waitForLoadState('networkidle');
    const atLogin = page.url().includes('/Login');
    check('[prefill] 重启后仍到登录页(不跳过)', atLogin, `url=${page.url().replace(BASE, '')}`);
    const u = await page.inputValue('#Username').catch(() => '');
    const p = await page.inputValue('#Password').catch(() => '');
    check('[prefill] 登录页账号密码已自动填充', u === QA.USER && p.length > 0, `u=${u} p.len=${p.length}`);
    const modeChecked = await page.isChecked('input[name="RememberMode"][value="prefill"]').catch(() => false);
    check('[prefill] 单选保持为仅填充', modeChecked);
    await ctx.close();
  }

  // ---- 模式三：none → 重启后登录页空白且旧档被清 ----
  {
    const r = await loginWithMode(browser, 'none');
    check('[none] 登录成功', r.ok);
    check('[none] 不留密码档', (() => {
      const origins = r.state.origins || [];
      for (const o of origins) if (o.localStorage) for (const it of o.localStorage) if (it.name === 'checkin_remember') return false;
      return true;
    })());
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: simulateRestart(r.state) });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.waitForLoadState('networkidle');
    const atLogin = page.url().includes('/Login');
    check('[none] 重启后到登录页', atLogin, `url=${page.url().replace(BASE, '')}`);
    const u = await page.inputValue('#Username').catch(() => '');
    const p = await page.inputValue('#Password').catch(() => '');
    check('[none] 登录页输入框为空', u === '' && p === '', `u=${u} p.len=${p.length}`);
    await ctx.close();
  }

  // ---- 模式粘性：prefill 提交后再开登录页，单选仍是 prefill ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/Login');
    await page.check('input[name="RememberMode"][value="prefill"]');
    await page.fill('#Username', QA.USER);
    await page.fill('#Password', QA.PASS);
    await page.click('#loginForm button[type="submit"]');
    await page.waitForTimeout(900);
    await ctx.clearCookies();          // 清登录态逼出登录页
    await page.goto(BASE + '/Login');
    await page.waitForLoadState('networkidle');
    const sticky = await page.isChecked('input[name="RememberMode"][value="prefill"]').catch(() => false);
    check('模式偏好粘性(下次登录页默认同一选择)', sticky);
    await ctx.close();
  }

  await browser.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\n== 密码保存方式测试: ${pass} PASS / ${fail} FAIL ==`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
