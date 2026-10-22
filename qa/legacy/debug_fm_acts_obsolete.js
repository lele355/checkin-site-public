// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 目检：文件管理→代码文件 ① 列表行常显操作（含删除）② 内置示例提示语
const { chromium } = require('playwright');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const PASS = process.env.QA_PASS || PW;

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
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

  // 不悬停：直接看行内按钮是否可见（模拟触屏）
  const firstRow = await p.evaluate(() => {
    const r = document.querySelector('#pyFmList .py-fm-row');
    if (!r) return null;
    const acts = r.querySelector('.py-fm-acts');
    return {
      text: r.querySelector('.py-fm-name').textContent.trim(),
      opacity: acts ? getComputedStyle(acts).opacity : 'none',
      buttons: acts ? [...acts.querySelectorAll('button')].map(b => b.textContent.trim()) : []
    };
  });
  console.log('首行（内置）操作区:', JSON.stringify(firstRow));

  // 选中一个内置示例 → 看提示语与底部按钮
  await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#pyFmList .py-fm-row')];
    const r = rows.find(x => /另存/.test(x.querySelector('.py-fm-acts').textContent));
    if (r) r.click();
  });
  await p.waitForTimeout(1500);
  const builtinState = await p.evaluate(() => ({
    info: document.querySelector('#pySnipInfo').textContent.trim(),
    saveAs: !document.querySelector('#pySnipSaveAs').hidden,
    del: !document.querySelector('#pySnipDel').hidden,
    title: document.querySelector('#pyEdTitle').textContent.trim()
  }));
  console.log('内置示例状态:', JSON.stringify(builtinState));
  const listBox = await p.locator('.py-fm').boundingBox();
  await p.screenshot({ path: 'shots/fm_acts_builtin.png', clip: listBox });

  // 选中自己的文件 → 底部应出现「删除」，行内应有 改名/移动/删除
  await p.evaluate(() => {
    const tree = document.querySelector('#pyFmTree');
    const node = [...tree.querySelectorAll('.py-fm-node')].find(n => n.textContent.includes('未分类'));
    if (node) node.click();
  });
  await p.waitForTimeout(600);
  const ownRow = await p.evaluate(() => {
    const r = document.querySelector('#pyFmList .py-fm-row');
    if (!r) return null;
    const acts = r.querySelector('.py-fm-acts');
    return {
      text: r.querySelector('.py-fm-name').textContent.trim(),
      opacity: acts ? getComputedStyle(acts).opacity : 'none',
      buttons: acts ? [...acts.querySelectorAll('button')].map(b => b.textContent.trim()) : []
    };
  });
  console.log('首行（自己的）操作区:', JSON.stringify(ownRow));
  if (ownRow) {
    await p.evaluate(() => { const r = document.querySelector('#pyFmList .py-fm-row'); if (r) r.click(); });
    await p.waitForTimeout(1500);
    const ownState = await p.evaluate(() => ({
      saveAs: !document.querySelector('#pySnipSaveAs').hidden,
      del: !document.querySelector('#pySnipDel').hidden,
      title: document.querySelector('#pyEdTitle').textContent.trim()
    }));
    console.log('自己的文件状态:', JSON.stringify(ownState));
    const box2 = await p.locator('.py-fm').boundingBox();
    await p.screenshot({ path: 'shots/fm_acts_own.png', clip: box2 });
    const foot = await p.locator('[data-sub="code"] .card').first().boundingBox();
    if (foot) await p.screenshot({ path: 'shots/fm_acts_own_full.png' });
  }

  await b.close();
})().catch(e => { console.error('崩溃', e); process.exit(1); });
