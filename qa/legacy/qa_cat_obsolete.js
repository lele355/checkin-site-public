// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab ⑤ 代码分类管理专项：增删改查 + 内联重命名 + 搜索 + 跳转筛选
// 顺带体检：无 data-theme（默认）与五主题下，下拉框皮肤是否生效。
// 线上：QA_BASE=https://example.com QA_PASS=xxx node qa_cat.js
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const USER = process.env.QA_USER || ADMIN;
const PASS = process.env.QA_PASS || PW;
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
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
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
  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  T('页面初始化完成', true);

  // 清场：删掉上次遗留的测试分类
  await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const d = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const c of d.data.categories) {
      if (!/^测试分类/.test(c.name)) continue;
      const body = new URLSearchParams();
      body.append('id', c.id);
      await fetch('/PyLab?handler=SnipCatDelete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
        body: body.toString()
      });
    }
  });

  sec('⑤ 页签与列表');
  await p.click('.py-tab[data-tab="cat"]');
  await p.waitForTimeout(300);
  T('⑤ 代码分类页签可切换', await p.locator('.py-panel[data-panel="cat"].on').isVisible());
  T('分类网格已渲染', (await p.locator('#pyCatGrid .py-catcard').count()) >= 1);
  T('未分类卡存在', (await p.locator('#pyCatGrid .py-catcard.uncat').count()) === 1);

  sec('新增');
  await p.fill('#pyCatNewName', '测试分类-甲');
  await p.click('button[data-act="catCreate"]');
  await p.waitForFunction(() => document.querySelectorAll('#pyCatGrid [data-scat-card]').length >= 1, null, { timeout: 15000 });
  await p.waitForTimeout(400);        // 等 loadSnips 重画稳定再操作
  T('新建分类-甲出现', (await p.locator('#pyCatGrid .nm', { hasText: '测试分类-甲' }).count()) === 1);
  await p.fill('#pyCatNewName', '测试分类-乙');
  await p.click('button[data-act="catCreate"]');
  T('创建后输入框立即清空', (await p.locator('#pyCatNewName').inputValue()) === '');
  await p.waitForFunction(() => document.querySelectorAll('#pyCatGrid [data-scat-card]').length >= 2, null, { timeout: 15000 });
  await p.waitForTimeout(400);
  T('新建分类-乙出现', (await p.locator('#pyCatGrid .nm', { hasText: '测试分类-乙' }).count()) === 1);

  sec('改名（内联编辑）');
  const aId = await p.locator('#pyCatGrid .py-catcard', { hasText: '测试分类-甲' }).first()
    .getAttribute('data-scat-card');
  await p.locator(`[data-scat-rename="${aId}"]`).click();
  T('进入编辑态出现输入框', (await p.locator(`[data-scat-input="${aId}"]`).count()) === 1);
  await p.fill(`[data-scat-input="${aId}"]`, '测试分类-丙');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => !!Array.from(document.querySelectorAll('#pyCatGrid .nm'))
    .find(e => e.textContent.trim() === '测试分类-丙'), null, { timeout: 15000 });
  T('Enter 保存改名成功', true);
  T('旧名字消失', (await p.locator('#pyCatGrid .nm', { hasText: '测试分类-甲' }).count()) === 0);

  sec('查（搜索）');
  await p.fill('#pyCatSearch', '丙');
  await p.waitForTimeout(250);
  const cardsWhenSearch = await p.locator('#pyCatGrid .py-catcard[data-scat-card]').count();
  T('搜索「丙」只剩 1 个分类', cardsWhenSearch === 1, cardsWhenSearch + ' 个');
  await p.fill('#pyCatSearch', '这个分类不存在xyz');
  await p.waitForTimeout(250);
  T('搜不到时显示空态', (await p.locator('#pyCatGrid .py-catempty').count()) === 1);
  await p.fill('#pyCatSearch', '');
  await p.waitForTimeout(250);
  T('清空搜索恢复列表', (await p.locator('#pyCatGrid .py-catcard[data-scat-card]').count()) === 2);

  sec('删');
  await p.waitForTimeout(300);
  await p.locator(`[data-scat-del="${aId}"]`).click();
  await p.waitForFunction(id => !document.querySelector(`[data-scat-card="${id}"]`), aId, { timeout: 15000 });
  T('删除分类后卡片消失', true);
  T('未分类卡仍在', (await p.locator('#pyCatGrid .py-catcard.uncat').count()) === 1);

  sec('查（跳转筛选）');
  const bId = await p.locator('#pyCatGrid .py-catcard', { hasText: '测试分类-乙' }).first()
    .getAttribute('data-scat-card');
  await p.locator(`[data-scat-view="${bId}"]`).click();
  await p.waitForTimeout(400);
  T('跳回 ③ 片段页签', await p.locator('.py-panel[data-panel="snip"].on').isVisible());
  T('筛选框已选中该分类', (await p.locator('#pySnipFilter').inputValue()) === bId);
  await p.click('.py-tab[data-tab="cat"]');
  await p.waitForTimeout(200);

  sec('下拉框皮肤（无 data-theme + 五主题）');
  const probe = () => p.evaluate(() => {
    const s = document.querySelector('#pySnipSel');
    const cs = getComputedStyle(s);
    return {
      bw: parseFloat(cs.borderTopWidth), bg: cs.backgroundColor,
      radius: cs.borderRadius, img: cs.backgroundImage, scheme: cs.colorScheme
    };
  });
  const themes = ['(none)', 'editorial', 'neumorphism', 'natural', 'macos', 'clay'];
  for (const t of themes) {
    await p.evaluate(th => {
      const el = document.documentElement;
      if (th === '(none)') el.removeAttribute('data-theme');
      else el.setAttribute('data-theme', th);
    }, t);
    await p.waitForTimeout(200);
    const v = await probe();
    const hasArrow = /linear-gradient/.test(v.img);
    // editorial 是底线式（radius 0 / 边框只在底边），neumorphism 与 clay 设计上就没有边框
    const borderOk = (t === 'neumorphism' || t === 'clay') ? true : v.bw >= 1;
    if (t === 'editorial') {
      T(t + ' 有箭头', hasArrow && v.bw >= 0, `bw=${v.bw} radius=${v.radius}`);
    } else {
      T(t + ' 有底色/箭头（边框按设计）', borderOk && v.bg !== 'rgba(0, 0, 0, 0)' && hasArrow,
        `bw=${v.bw} bg=${v.bg} radius=${v.radius}`);
    }
    if (t === 'macos') T('macos 下拉弹层走暗色', v.scheme === 'dark', v.scheme);
  }
  // 默认（无 data-theme）应该是 editorial 观感：有透明的底线 + 箭头，不能裸奔
  await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await p.waitForTimeout(200);
  const def = await probe();
  T('默认态不再裸奔（有箭头）', /linear-gradient/.test(def.img), def.img.slice(0, 30));

  sec('截图');
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'editorial'));
  await p.click('.py-tab[data-tab="cat"]');
  await p.waitForTimeout(300);
  await p.locator('.py-panel[data-panel="cat"] .card').screenshot({ path: SHOTS + '/cat_editorial.png' });
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'macos'));
  await p.waitForTimeout(300);
  await p.locator('.py-panel[data-panel="cat"] .card').screenshot({ path: SHOTS + '/cat_macos.png' });
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'natural'));
  await p.click('.py-tab[data-tab="snip"]');
  await p.waitForTimeout(300);
  await p.locator('section[data-panel="snip"] .card').first().screenshot({ path: SHOTS + '/sel_natural.png' });

  sec('清场');
  await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const d = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const c of d.data.categories) {
      if (!/^测试分类/.test(c.name)) continue;
      const body = new URLSearchParams();
      body.append('id', c.id);
      await fetch('/PyLab?handler=SnipCatDelete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
        body: body.toString()
      });
    }
  });

  T('全程无 JS 错误', jsErrs.length === 0, jsErrs.slice(0, 2).join(' | '));

  await b.close();
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
