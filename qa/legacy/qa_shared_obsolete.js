// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab 共享库专项：内置书例已移除 + 代码/分类/课件全员共享（跨账号增删改查）
// 本地：node qa_shared.js   线上：QA_BASE=https://example.com QA_PASS=… QA_PASS2=… node qa_shared.js
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const U1 = process.env.QA_USER || ADMIN;
const P1 = process.env.QA_PASS || PW;
const U2 = process.env.QA_USER2 || 'QA_ME';
const P2 = process.env.QA_PASS2 || 'Qa#2026Bb';   // test_me.js 跑完后 QA_ME 的密码

let pass = 0, fail = 0;
const T = (n, c, x) => { if (c) { pass++; console.log('  v ' + n + (x != null ? '  [' + x + ']' : '')); } else { fail++; console.log('  x ' + n + (x != null ? '  [' + x + ']' : '')); } };
const sec = t => console.log('\n■ ' + t);

async function login(browser, user, pass) {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })).newPage();
  p.on('dialog', d => d.accept());
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', user);
  await p.fill('#Password', pass);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 25000 });
  return p;
}

// 统一走页面内 fetch（带防伪 token）
const api = (p, handler, body) => p.evaluate(async ([h, b]) => {
  const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
  if (b === null) {
    const r = await fetch('/PyLab?handler=' + h);
    return r.json();
  }
  const fd = new URLSearchParams();
  for (const k in b) fd.append(k, b[k]);
  const r = await fetch('/PyLab?handler=' + h, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
    body: fd.toString()
  });
  return r.json();
}, [handler, body]);

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const A = await login(b, U1, P1);
  const B = await login(b, U2, P2);

  sec('内置书例已移除');
  const bootPayload = await A.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const r = await fetch('/PyLab?handler=Call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'RequestVerificationToken': tok },
      body: JSON.stringify({ action: 'bootstrap', payload: {} })
    });
    return r.json();
  });
  T('bootstrap 不再包含 snippets', bootPayload && bootPayload.ok && !(bootPayload.data && bootPayload.data.result && bootPayload.data.result.snippets),
    JSON.stringify(Object.keys((bootPayload.data && bootPayload.data.result) || {})));

  await A.click('.py-navbtn[data-view="files"]');
  await A.click('.py-subtab[data-sub="code"]');
  await A.waitForTimeout(600);
  T('左树没有「内置书例」', (await A.locator('#pyFmTree .py-fm-node', { hasText: '内置书例' }).count()) === 0);
  T('计数文案改成共享库', (await A.locator('#pySnipCount').innerText()).includes('共享库'));

  sec('A 建代码文件 / 分类');
  const tag = String(Date.now()).slice(-6);
  const snipName = '共享验证-' + tag;
  const catName = '共享分类-' + tag;
  // 建分类
  await A.evaluate(() => {
    if (!document.querySelector('[data-fm-cat-input]')) {
      const el = document.querySelector('[data-fm-cat-new]');
      if (el) el.click();
    }
  });
  await A.waitForTimeout(300);
  await A.fill('[data-fm-cat-input]', catName);
  await A.keyboard.press('Enter');
  await A.waitForFunction(n => [...document.querySelectorAll('#pyFmTree .nm')].some(e => e.textContent.trim() === n), catName, { timeout: 15000 });
  T('A 建分类成功', true);

  // 建文件（放进新分类）
  await A.click('[data-act="fmNewFile"]');
  await A.waitForTimeout(300);
  await A.fill('#pySnipTitle', snipName);
  await A.fill('#pySnipCode', "print('shared ok')");
  await A.evaluate(n => {
    const sel = document.querySelector('#pySnipCat');
    const opt = [...sel.options].find(o => o.textContent.trim() === n);
    if (opt) sel.value = opt.value;
  }, catName);
  await A.click('[data-act="snipSave"]');
  await A.waitForFunction(n => [...document.querySelectorAll('#pyFmList .py-fm-name')].some(e => e.textContent.trim() === n + '.py'), snipName, { timeout: 15000 });
  T('A 建文件成功', true);

  // A 建 WPS 课件（只存链接，不依赖本地 LibreOffice）
  const wpsTitle = '共享WPS-' + tag;
  await A.click('.py-navbtn[data-view="files"]');
  await A.click('.py-subtab[data-sub="ppt"]');
  await A.waitForTimeout(500);
  await A.fill('#pyWpsTitle', wpsTitle);
  await A.fill('#pyWpsUrl', 'https://www.kdocs.cn/l/SHARED' + tag);
  await A.click('[data-act="wpsAdd"]');
  await A.waitForTimeout(1200);

  sec('B 能看到 A 的东西（含创建者）');
  await B.click('.py-navbtn[data-view="files"]');
  await B.click('.py-subtab[data-sub="code"]');
  await B.waitForTimeout(800);
  const bTree = await B.locator('#pyFmTree .nm').allInnerTexts();
  T('B 看到 A 的分类', bTree.some(t => t.trim() === catName), bTree.join('/'));
  await B.click('#pyFmTree .py-fm-node:has-text("全部文件")');
  await B.waitForTimeout(500);
  const bRow = await B.evaluate(n => {
    const r = [...document.querySelectorAll('#pyFmList .py-fm-row')]
      .find(x => x.querySelector('.py-fm-name').textContent.trim() === n + '.py');
    return r ? r.querySelector('.py-fm-sub').textContent.trim() : null;
  }, snipName);
  T('B 看到 A 的代码文件', bRow !== null, bRow || '未找到');
  T('行里标出创建者', !!bRow && bRow.includes('管理员'), bRow || '');

  await B.click('.py-subtab[data-sub="ppt"]');
  await B.waitForTimeout(800);
  const bWps = await B.locator('#pyWpsList').innerText();
  T('B 看到 A 的 iframe 课件', bWps.includes(wpsTitle));
  T('iframe 课件标出创建者', bWps.includes('管理员'));

  sec('B 跨用户改 / 删');
  await B.click('.py-subtab[data-sub="code"]');
  await B.waitForTimeout(600);
  const renamed = '被别人改名-' + tag;
  await B.evaluate(async ([n, nn]) => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const d = await fetch('/PyLab?handler=Snips').then(r => r.json());
    const s = d.data.snippets.find(x => x.title === n);
    const fd = new URLSearchParams({ id: s.id, title: nn });
    await fetch('/PyLab?handler=SnipRename', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
      body: fd.toString()
    });
  }, [snipName, renamed]);
  await A.reload({ waitUntil: 'domcontentloaded' });
  await A.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 25000 });
  await A.click('.py-navbtn[data-view="files"]');
  await A.click('.py-subtab[data-sub="code"]');
  await A.waitForTimeout(800);
  const aNames = await A.locator('#pyFmList .py-fm-name').allInnerTexts();
  T('A 看到 B 改后的名字', aNames.some(t => t.trim() === renamed + '.py'), aNames.slice(0, 4).join(','));

  // B 删 A 的 WPS 课件
  await B.click('.py-subtab[data-sub="ppt"]');
  await B.waitForTimeout(800);
  const delOk = await B.evaluate(async t => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const d = await fetch('/PyLab?handler=WpsDecks').then(r => r.json());
    const w = d.data.decks.find(x => x.title === t);
    if (!w) return false;
    const fd = new URLSearchParams({ id: w.id });
    const r = await fetch('/PyLab?handler=WpsDelete', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
      body: fd.toString()
    }).then(r => r.json());
    return !!r.ok;
  }, wpsTitle);
  T('B 能删 A 的 iframe 课件', delOk);
  await A.click('.py-subtab[data-sub="ppt"]');
  await A.waitForTimeout(900);
  T('A 那边课件已消失', !(await A.locator('#pyWpsList').innerText()).includes(wpsTitle));

  sec('清理（B 删 A 的文件与分类，验证跨用户删除）');
  const cleaned = await B.evaluate(async ([n, c]) => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const post = (h, f) => {
      const fd = new URLSearchParams();
      for (const k in f) fd.append(k, f[k]);
      return fetch('/PyLab?handler=' + h, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
        body: fd.toString()
      }).then(r => r.json());
    };
    const s = await fetch('/PyLab?handler=Snips').then(r => r.json());
    const snip = s.data.snippets.find(x => x.title === n);
    let ok1 = false, ok2 = false;
    if (snip) ok1 = !!(await post('SnipDelete', { id: snip.id })).ok;
    const cat = s.data.categories.find(x => x.name === c);
    if (cat) ok2 = !!(await post('SnipCatDelete', { id: cat.id })).ok;
    return { ok1, ok2 };
  }, [renamed, catName]);
  T('B 能删 A 的代码文件', cleaned.ok1);
  T('B 能删 A 的分类', cleaned.ok2);

  await b.close();
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃', e); process.exit(1); });
