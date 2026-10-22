// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 临时调试2：新建分类按钮「无效」全场景重现（本地 + 线上）
// 场景：A回车建成 / B✓建成 / C-Esc后重试 / D双击 / E改名中点新建 / F中文IME / G视图切换后 / H空名报错后 / I同名报错后卡死 / J pjax重进
const { chromium } = require('playwright');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const PASS = process.env.QA_PASS || PW;
const U = Date.now();   // 名字唯一化，避免同名分类污染状态

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text().slice(0, 150)); });
  p.on('dialog', d => d.accept());

  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', ADMIN);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');

  async function toCode() {
    await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 }).catch(() => {});
    await p.click('.py-navbtn[data-view="files"]');
    await p.click('.py-subtab[data-sub="code"]');
    await p.waitForTimeout(500);
  }
  const treeHas = name => p.evaluate(n =>
    Array.from(document.querySelectorAll('#pyFmTree .nm')).some(e => e.textContent.trim() === n), name);
  const state = () => p.evaluate(() => ({
    fmCatNew: window.__pyLab.fmCatNew,
    inputs: document.querySelectorAll('[data-fm-cat-input]').length,
    addBtn: document.querySelectorAll('[data-fm-cat-new]').length,
    err: ((document.querySelector('#pyErr') || {}).textContent || '').trim()
  }));
  async function clickNew(tag) {
    await p.click('[data-fm-cat-new]', { timeout: 3000 }).catch(e => console.log(tag, '点击异常', e.message.split('\n')[0]));
    await p.waitForTimeout(500);
    console.log(tag, JSON.stringify(await state()));
  }
  async function tryCreate(name) {
    await p.fill('[data-fm-cat-input]', name).catch(() => {});
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1200);
  }

  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await toCode();

  console.log('== A. 点击→输入→回车 ==');
  await clickNew('A-click');
  await tryCreate('调试A-' + U);
  console.log('A result', JSON.stringify({ created: await treeHas('调试A-' + U), st: await state() }));

  console.log('== B. 点击→输入→点✓ ==');
  await clickNew('B-click');
  await p.fill('[data-fm-cat-input]', '调试B-' + U).catch(() => {});
  await p.evaluate(() => { const el = document.querySelector('[data-fm-cat-save]'); if (el) el.click(); });
  await p.waitForTimeout(1200);
  console.log('B result', JSON.stringify({ created: await treeHas('调试B-' + U), st: await state() }));

  console.log('== C. 点击→Esc→再点击 ==');
  await clickNew('C-click1');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  console.log('C after esc', JSON.stringify(await state()));
  await clickNew('C-click2');
  await tryCreate('调试C-' + U);
  console.log('C result', JSON.stringify({ created: await treeHas('调试C-' + U), st: await state() }));

  console.log('== D. 快速三连击按钮 ==');
  await p.evaluate(() => {
    const el = document.querySelector('[data-fm-cat-new]');
    if (el) { el.click(); }
  });
  await p.waitForTimeout(150);
  await p.evaluate(() => {
    const el = document.querySelector('[data-fm-cat-new]');
    if (el) { el.click(); }
  });
  await p.waitForTimeout(500);
  console.log('D result', JSON.stringify(await state()));
  await p.keyboard.press('Escape').catch(() => {});
  await p.waitForTimeout(300);

  console.log('== E. 分类改名中点新建 ==');
  await p.evaluate(() => {
    const el = document.querySelector('[data-fm-cat-rename]');
    if (el) el.click();
  });
  await p.waitForTimeout(300);
  await clickNew('E-click');
  await tryCreate('调试E-' + U);
  console.log('E result', JSON.stringify({ created: await treeHas('调试E-' + U), st: await state() }));

  console.log('== F. 中文 IME 式输入（insertText + 组合Enter） ==');
  await clickNew('F-click');
  await p.evaluate(() => { const i = document.querySelector('[data-fm-cat-input]'); if (i) { i.focus(); i.value = ''; } });
  await p.keyboard.insertText('调试F-' + U);
  await p.evaluate(() => {
    const i = document.querySelector('[data-fm-cat-input]');
    if (i) i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
  });
  await p.waitForTimeout(1000);
  console.log('F after composing-Enter', JSON.stringify(await state()));
  if ((await state()).inputs) {
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1000);
  }
  console.log('F result', JSON.stringify({ created: await treeHas('调试F-' + U), st: await state() }));

  console.log('== G. 切视图 show→wps→files→code 后点击 ==');
  await p.click('.py-navbtn[data-view="show"]');
  await p.waitForTimeout(300);
  await p.click('.py-navbtn[data-view="wps"]');
  await p.waitForTimeout(800);
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(500);
  await clickNew('G-click');
  await tryCreate('调试G-' + U);
  console.log('G result', JSON.stringify({ created: await treeHas('调试G-' + U), st: await state() }));

  console.log('== H. 空名回车报错后重试 ==');
  await clickNew('H-click1');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  console.log('H after empty', JSON.stringify(await state()));
  await tryCreate('调试H-' + U);
  console.log('H result', JSON.stringify({ created: await treeHas('调试H-' + U), st: await state() }));

  console.log('== I. 同名报错 → 观察状态是否自洽 → 换名重试 ==');
  await clickNew('I-click1');
  await tryCreate('调试A-' + U);            // 故意撞同名
  const i1 = await state();
  console.log('I after dup', JSON.stringify(i1), '按钮回来了吗:', i1.addBtn > 0);
  // 自洽判据：编辑态（fmCatNew）时输入框在、按钮让位；非编辑态时按钮在
  const consistent = i1.fmCatNew ? (i1.inputs === 1 && i1.addBtn === 0) : (i1.addBtn === 1 && i1.inputs === 0);
  console.log('I 状态自洽:', consistent, '(真卡死 = 既没按钮也没输入框)');
  if (!consistent) console.log('I ✗卡死：按钮和输入框都不见了');
  if (i1.inputs) {
    await p.fill('[data-fm-cat-input]', '调试I-' + U).catch(() => {});
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1200);
    console.log('I 报错后换名回车', JSON.stringify({ created: await treeHas('调试I-' + U), st: await state() }));
  } else {
    await clickNew('I-click2');
    await tryCreate('调试I-' + U);
    console.log('I result', JSON.stringify({ created: await treeHas('调试I-' + U), st: await state() }));
  }

  console.log('== J. pjax 离开再回来后点击 ==');
  const home = p.locator('nav a[href="/"], aside a[href="/"], a[href="/Dashboard"]').first();
  await home.click().catch(() => { console.log('J 没找到回首页链接'); });
  await p.waitForTimeout(1000);
  const side = p.locator('a[href="/PyLab"]').first();
  if (await side.count()) {
    await side.click();
    await p.waitForURL('**/PyLab', { timeout: 15000 }).catch(() => console.log('pjax URL 等待超时'));
    await toCode();
    await clickNew('J-click');
    await tryCreate('调试J-' + U);
    console.log('J result', JSON.stringify({ created: await treeHas('调试J-' + U), st: await state() }));
  }

  console.log('== 清理：删除所有 调试* 分类 ==');
  for (const c of ['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I', 'J']) {
    const ok = await p.evaluate(n => {
      const rows = Array.from(document.querySelectorAll('#pyFmTree .py-fm-node'));
      const row = rows.find(r => r.querySelector('.nm') && r.querySelector('.nm').textContent.trim() === n);
      const del = row && row.querySelector('[data-fm-cat-del]');
      if (del) { del.click(); return true; }
      return false;
    }, '调试' + c + '-' + U);
    if (ok) await p.waitForTimeout(800);
  }
  console.log('清理完', JSON.stringify(await state()));

  await b.close();
})().catch(e => { console.error('崩溃', e); process.exit(1); });
