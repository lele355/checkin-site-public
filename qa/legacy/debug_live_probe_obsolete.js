// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 快速探针：看线上 /PyLab 到底加载出了什么
const { chromium } = require('playwright');
const BASE = process.env.QA_BASE || 'https://example.com';
const PASS = process.env.QA_PASS || PW;

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text().slice(0, 150)); });

  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  console.log('login 页标题:', await p.title());
  await p.fill('#Username', ADMIN);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  console.log('登录后 URL:', p.url());

  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  console.log('PyLab URL:', p.url());
  const st = await p.evaluate(() => ({
    title: document.title,
    hasPyLab: typeof window.__pyLab,
    boot: !!(window.__pyLab && window.__pyLab.boot),
    navBtns: Array.from(document.querySelectorAll('.py-navbtn')).map(b => b.getAttribute('data-view')),
    panels: Array.from(document.querySelectorAll('.py-panel')).map(b => b.getAttribute('data-panel')),
    bodyHead: document.body.innerText.slice(0, 300)
  }));
  console.log(JSON.stringify(st, null, 1));
  await p.screenshot({ path: 'shots/debug_live_probe.png', fullPage: false });
  await b.close();
})().catch(e => { console.error('崩溃', e); process.exit(1); });
