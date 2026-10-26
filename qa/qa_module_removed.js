// PyLab（Python 教学平台）整块删除专项（2026-10-22）
// 验证：/PyLab 404、侧栏与侧栏自定义里没有入口、权限页没有 pylab.use、
//       其余模块照常工作、无 JS 错误。
// 本地：node qa_module_removed.js   线上：QA_BASE=https://example.com QA_PASS=xxx node qa_module_removed.js
const QA = require('./_env');
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const USER = QA.USER;
const PASS = QA.PASS;
const SHOTS = 'D:/projects/checkin/qa/shots/pylab';

let pass = 0, fail = 0;
function T(name, cond, extra) {
  if (cond) { pass++; console.log('  v ' + name + (extra != null ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  x ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
function sec(t) { console.log('\n■ ' + t); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const jsErrs = [];
  p.on('pageerror', e => jsErrs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) jsErrs.push(m.text()); });
  p.on('dialog', d => d.accept().catch(() => {}));

  sec('登录');
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', USER);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  T('登录成功', !p.url().toLowerCase().includes('login'), p.url());

  sec('/PyLab 已不存在');
  const r = await p.request.get(BASE + '/PyLab', { maxRedirects: 0 });
  T('/PyLab 返回 404', r.status() === 404, r.status());
  const r2 = await p.request.get(BASE + '/PyLab?handler=WpsDecks', { maxRedirects: 0 });
  T('/PyLab?handler=WpsDecks 也是 404', r2.status() === 404, r2.status());

  sec('侧栏没有 Python 教学');
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  const navText = await p.locator('.sidebar').innerText();
  T('侧栏无「Python 教学」', !navText.includes('Python'), navText.replace(/\n+/g, '/').slice(0, 120));
  T('侧栏无指向 /PyLab 的链接', (await p.locator('.sidebar a[href="/PyLab"]').count()) === 0);
  const navCount = await p.locator('.sidebar .nav-item').count();
  T('侧栏项目数正常（≥15）', navCount >= 15, navCount + ' 项');

  sec('侧栏自定义弹窗里也没有');
  await p.evaluate(() => { if (window.openNavCustomize) openNavCustomize(); });
  await p.waitForTimeout(500);
  const dlgOpen = await p.locator('#navCustomizeModal').evaluate(el => el.open).catch(() => false);
  if (dlgOpen) {
    const dlgText = await p.locator('#navCustomizeModal').innerText();
    T('自定义弹窗无 Python 教学', !dlgText.includes('Python'));
    await p.evaluate(() => document.getElementById('navCustomizeModal').close());
  } else {
    console.log('  - 自定义弹窗未打开，跳过');
  }

  sec('权限页没有 pylab.use');
  await p.goto(BASE + '/Admin/Roles', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  const rolesHtml = await p.content();
  T('角色/权限页无 pylab', !/pylab/i.test(rolesHtml));
  T('权限页仍能打开（200 级）', !(await p.title()).toLowerCase().includes('error'));

  sec('其余模块照常');
  for (const [path, label] of [['/', '工作台'], ['/Schedule', '日程'], ['/Memo', '备忘'],
                               ['/Expenses', '记账'], ['/Habits', '打卡'], ['/Stats', '统计']]) {
    const resp = await p.request.get(BASE + path, { maxRedirects: 5 });
    T(label + ' 可访问', resp.status() === 200, path + ' → ' + resp.status());
  }

  sec('截图目检（侧栏无 Python 教学）');
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'editorial'));
  await p.waitForTimeout(200);
  await p.locator('.sidebar').screenshot({ path: SHOTS + '/module_removed_sidebar.png' }).catch(() => {});
  T('侧栏截图已存', fs.existsSync(SHOTS + '/module_removed_sidebar.png'));

  sec('JS 错误');
  const realErrs = jsErrs.filter(e => !/net::|Failed to load resource|403|404/i.test(e));
  T('无 JS 错误', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃：', e); process.exit(1); });
