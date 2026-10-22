// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 验证：① 行内操作常显（无 hover 也能看见）② 自己的文件底部有「删除」且真能删
const { chromium } = require('playwright');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const PASS = process.env.QA_PASS || PW;
const NAME = '验证-删除按钮';

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })).newPage();
  p.on('dialog', d => d.accept());

  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', ADMIN);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(600);

  // 造一个自己的文件
  await p.click('[data-act="fmNewFile"]');
  await p.waitForTimeout(300);
  await p.fill('#pySnipTitle', NAME);
  await p.fill('#pySnipCode', "print('删除按钮验证')");
  await p.click('[data-act="snipSave"]');
  await p.waitForFunction(n => [...document.querySelectorAll('#pyFmList .py-fm-name')]
    .some(e => e.textContent.trim() === n + '.py'), NAME, { timeout: 15000 });
  console.log('文件已创建:', NAME + '.py');

  await p.evaluate(n => {
    const r = [...document.querySelectorAll('#pyFmList .py-fm-row')]
      .find(x => x.querySelector('.py-fm-name').textContent.trim() === n + '.py');
    if (r) r.click();
  }, NAME);
  await p.waitForTimeout(1200);

  const st = await p.evaluate(n => {
    const r = [...document.querySelectorAll('#pyFmList .py-fm-row')]
      .find(x => x.querySelector('.py-fm-name').textContent.trim() === n + '.py');
    const acts = r && r.querySelector('.py-fm-acts');
    return {
      行内按钮: acts ? [...acts.querySelectorAll('button')].map(x => x.textContent.trim()) : [],
      行内透明度: acts ? getComputedStyle(acts).opacity : null,
      底部删除可见: !document.querySelector('#pySnipDel').hidden,
      底部另存可见: !document.querySelector('#pySnipSaveAs').hidden
    };
  }, NAME);
  console.log('自己的文件:', JSON.stringify(st));

  // 编辑器卡片（含底部按钮）截图
  const card = p.locator('[data-sub="code"] .card').nth(1);
  await card.screenshot({ path: 'shots/fm_editor_own.png' });

  // 真删一次
  await p.locator('#pySnipDel').click();
  await p.waitForFunction(n => ![...document.querySelectorAll('#pyFmList .py-fm-name')]
    .some(e => e.textContent.trim() === n + '.py'), NAME, { timeout: 15000 });
  console.log('删除成功，列表里已消失');

  await b.close();
})().catch(e => { console.error('崩溃', e); process.exit(1); });
