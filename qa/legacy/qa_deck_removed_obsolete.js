// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab「PPT 转图模块已彻底删除」专项回归（2026-10-22）
// 目标：站内只剩 WPS/金山文档 iframe 一条课件通道，本地课件库的界面、接口、静态资源全部消失，
//       而 iframe 通道本身照旧可用（添加 / 播放 / 整份 PPT 挂代码 / 运行 / 删除）。
// 本地：node qa_deck_removed.js   线上：QA_BASE=https://example.com QA_PASS=xxx node qa_deck_removed.js
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
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const jsErrs = [];
  p.on('pageerror', e => jsErrs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) jsErrs.push(m.text()); });
  p.on('dialog', d => d.accept('测试DEL-改名').catch(() => {}));

  sec('登录 + 初始化');
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', USER);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  T('登录成功', !p.url().toLowerCase().includes('login'), p.url());
  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  T('页面初始化完成', true);

  sec('导航只剩三段，默认落在「在线演示」');
  const navs = await p.locator('.py-navbtn').allInnerTexts();
  T('导航 3 个', navs.length === 3, navs.map(s => s.split('\n')[0]).join('/'));
  T('没有「主展示」', !navs.join('').includes('主展示'));
  T('有「在线演示」', navs.join('').includes('在线演示'));
  T('默认面板是 wps', await p.locator('.py-panel[data-panel="wps"].on').isVisible());
  T('show 面板已不存在', (await p.locator('.py-panel[data-panel="show"]').count()) === 0);
  T('data-view=show 按钮已不存在', (await p.locator('.py-navbtn[data-view="show"]').count()) === 0);

  sec('本地课件库的 DOM 全消失');
  const gone = await p.evaluate(() => {
    const ids = ['pyDeckSel', 'pySlideImg', 'pySlideCanvas', 'pyThumbs', 'pyDeckGrid', 'pyCats',
      'pyDeckFile', 'pyDeckTitle', 'pyDeckCat', 'pyFilterCat', 'pyNewCat', 'pyEngineInfo',
      'pyJump', 'pyPageSnip', 'pyPageOut', 'pyPageCode', 'pyProg', 'pyUploadStatus', 'pyModes'];
    return ids.filter(id => document.getElementById(id));
  });
  T('旧元素一个不剩', gone.length === 0, gone.join(','));
  const cls = await p.evaluate(() => {
    const sels = ['.py-deck', '.py-slide', '.py-slidebar', '.py-thumbs', '.py-modes', '.py-cats',
      '.py-drop', '.py-prog', '.py-status', '.py-uploadbar'];
    return sels.filter(s => document.querySelector(s));
  });
  T('旧样式类没有残留节点', cls.length === 0, cls.join(','));
  T('PDF.js 静态资源已删', (await p.evaluate(async () => {
    const r = await fetch('/lib/pdfjs/pdf.min.js');
    return r.status;
  })) === 404);

  sec('后端课件接口已下线');
  // handler 名字不存在时 Razor Pages 会回落到 OnGet（吐整页 HTML，200），
  // 所以判据不是状态码，而是「不再有课件 JSON」。
  const api = await p.evaluate(async () => {
    const s = {};
    for (const h of ['Decks', 'Image', 'Pdf']) {
      const r = await fetch('/PyLab?handler=' + h + '&deckId=1&pageNo=1');
      const ct = r.headers.get('content-type') || '';
      let isJson = false;
      if (ct.includes('json')) { try { await r.json(); isJson = true; } catch (e) { } }
      s[h] = { status: r.status, isJson };
    }
    return s;
  });
  T('handler=Decks 不再吐课件 JSON', !api.Decks.isJson, JSON.stringify(api.Decks));
  T('handler=Image 不再吐图片/JSON', !api.Image.isJson, JSON.stringify(api.Image));
  T('handler=Pdf 不再吐 PDF/JSON', !api.Pdf.isJson, JSON.stringify(api.Pdf));

  sec('文件管理 → PPT 文件：只剩链接管理');
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="ppt"]');
  await p.waitForTimeout(600);
  const heads = await p.locator('[data-sub="ppt"] .card h2').allInnerTexts();
  T('只有一张卡', heads.length === 1, heads.join('/'));
  T('卡片是「PPT 链接管理」', heads[0] && heads[0].includes('PPT 链接管理'), heads[0]);
  T('没有「上传课件」', !heads.join('').includes('上传课件'));
  T('没有「全部课件」', !heads.join('').includes('全部课件'));
  T('没有「课件分类」', !heads.join('').includes('课件分类'));

  sec('清场（删遗留测试数据）');
  await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const post = (h, f) => {
      const body = new URLSearchParams();
      for (const k in f) body.append(k, f[k]);
      return fetch('/PyLab?handler=' + h, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
        body: body.toString()
      }).then(r => r.json());
    };
    const d = await fetch('/PyLab?handler=WpsDecks').then(r => r.json());
    for (const w of d.data.decks) if (/^测试DEL/.test(w.title)) await post('WpsDelete', { id: w.id });
    const s = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const x of s.data.snippets) if (/^测试DEL/.test(x.title)) await post('SnipDelete', { id: x.id });
  });

  sec('iframe 通道可用：添加 → 播放');
  await p.fill('#pyWpsTitle', '测试DEL-PPT甲');
  await p.fill('#pyWpsUrl', 'https://www.kdocs.cn/l/DELTEST01');
  await p.click('[data-act="wpsAdd"]');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyWpsList h4'))
    .some(e => e.textContent.includes('测试DEL-PPT甲')), null, { timeout: 15000 });
  T('链接已入库', true);
  await p.click('.py-navbtn[data-view="wps"]');
  await p.waitForTimeout(700);
  const src = await p.locator('#pyWpsFrame').getAttribute('src');
  T('iframe 已显示', await p.locator('#pyWpsFrame').isVisible());
  T('src 指向 kdocs + 简化只读', (src || '').startsWith('https://www.kdocs.cn/l/DELTEST01') && /simple=1&readonly/.test(src || ''), src);

  sec('整份 PPT 挂代码并运行');
  const key = await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const fd = new URLSearchParams({ title: '测试DEL-片段', code: 'print("deck removed ok")', expect: '', categoryId: '' });
    const r = await fetch('/PyLab?handler=SnipSave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
      body: fd.toString()
    }).then(r => r.json());
    return r.ok ? r.data.key : null;
  });
  T('夹具片段已入库', !!key, key);
  await p.click('[data-act="wpsPick"]');
  await p.waitForTimeout(400);
  await p.fill('#pyPickSearch', '测试DEL-片段');
  await p.waitForTimeout(300);
  await p.locator('#pyPickList [data-fm-file]').first().click();
  await p.waitForFunction(() => (document.querySelectorAll('#pyWpsMounts .py-wps-mount').length) === 1,
    null, { timeout: 15000 });
  T('挂载成功', true);
  await p.locator('#pyWpsMounts [data-wps-run]').first().evaluate(el => el.click());
  await p.waitForFunction(() => (document.querySelector('#pyWpsOut') || {}).textContent
    && document.querySelector('#pyWpsOut').textContent.includes('deck removed ok'), null, { timeout: 25000 });
  T('挂载代码能在沙箱里跑出 stdout', true);

  sec('截图目检（在线演示 / PPT 链接管理）');
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'editorial'));
  await p.waitForTimeout(200);
  await p.locator('[data-panel="wps"] .py-split').screenshot({ path: SHOTS + '/after_removal_wps_editorial.png' });
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="ppt"]');
  await p.waitForTimeout(500);
  await p.locator('[data-sub="ppt"] .card').first().screenshot({ path: SHOTS + '/after_removal_ppt_editorial.png' });
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'macos'));
  await p.waitForTimeout(300);
  await p.locator('[data-sub="ppt"] .card').first().screenshot({ path: SHOTS + '/after_removal_ppt_macos.png' });
  T('截图已存', fs.existsSync(SHOTS + '/after_removal_wps_editorial.png')
    && fs.existsSync(SHOTS + '/after_removal_ppt_editorial.png'));

  sec('收尾清理 + JS 错误');
  await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const post = (h, f) => {
      const body = new URLSearchParams();
      for (const k in f) body.append(k, f[k]);
      return fetch('/PyLab?handler=' + h, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
        body: body.toString()
      }).then(r => r.json());
    };
    const d = await fetch('/PyLab?handler=WpsDecks').then(r => r.json());
    for (const w of d.data.decks) if (/^测试DEL/.test(w.title)) await post('WpsDelete', { id: w.id });
    const s = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const x of s.data.snippets) if (/^测试DEL/.test(x.title)) await post('SnipDelete', { id: x.id });
  });
  const realErrs = jsErrs.filter(e => !/net::|Failed to load resource|iframe|kdocs|wps\.cn|getFileSwitch|cloud-file-sdk|Extention|当前环境|404/i.test(e));
  T('无 JS 错误', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃：', e); process.exit(1); });
