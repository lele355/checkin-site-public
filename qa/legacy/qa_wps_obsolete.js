// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab WPS 在线演示专项（金山文档 iframe 播放）：
// 导航/面板 / 添加 / URL 白名单校验 / iframe src 与简化只读 / PPT 级挂载 / 运行输出 /
// GUI 交互（WPS 输出区独立事件队列）/ 改名 / 删除 / 与本地课件数据互不相通
// 本地：node qa_wps.js   线上：QA_BASE=https://example.com QA_PASS=xxx node qa_wps.js
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
  // confirm/prompt 一律放行；prompt 统一回「测试WPS-改名」（改名用例直接吃它）
  p.on('dialog', d => {
    if (d.type() === 'prompt') d.accept('测试WPS-改名').catch(() => {});
    else d.accept().catch(() => {});
  });

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
  T('三段导航就位（在线演示/文件管理/实用工具）', (await p.locator('.py-navbtn').count()) === 3);
  T('WPS 面板存在', (await p.locator('.py-panel[data-panel="wps"]').count()) === 1);

  sec('清场（删遗留测试课件）');
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
    for (const w of d.data.decks) if (/^测试WPS/.test(w.title)) await post('WpsDelete', { id: w.id });
    const s = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const x of s.data.snippets) if (/^测试WPS/.test(x.title)) await post('SnipDelete', { id: x.id });
  });

  sec('PPT 链接管理已并入 文件管理 → PPT 文件');
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="ppt"]');
  await p.waitForTimeout(700);
  const pptTitles = await p.locator('[data-sub="ppt"] .card h2').allInnerTexts();
  T('PPT 子页里有「PPT 链接管理」卡片', pptTitles.some(t => t.includes('PPT 链接管理')), pptTitles.join('/'));
  T('管理表单在 PPT 子页里', (await p.locator('[data-sub="ppt"] #pyWpsTitle').count()) === 1);
  T('WPS 播放面板里不再有管理表单', (await p.locator('[data-panel="wps"] #pyWpsTitle').count()) === 0);

  sec('切换到 WPS 视图');
  await p.click('.py-navbtn[data-view="wps"]');
  await p.waitForTimeout(600);
  T('WPS 面板可见', await p.locator('.py-panel[data-panel="wps"].on').isVisible());
  T('空状态提示出现', (await p.locator('#pyWpsEmpty').innerText()).includes('还没有 WPS 课件'));
  T('空状态指向新管理位置', (await p.locator('#pyWpsEmpty').innerText()).includes('PPT 文件'));
  T('iframe 初始隐藏', await p.locator('#pyWpsFrame').isHidden());

  sec('URL 白名单校验（后端把关）');
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="ppt"]');
  await p.waitForTimeout(500);
  await p.fill('#pyWpsTitle', '测试WPS-坏链接');
  await p.fill('#pyWpsUrl', 'https://evil.example.com/l/abc');
  await p.click('[data-act="wpsAdd"]');
  await p.waitForFunction(() => (document.querySelector('#pyErr') || {}).textContent?.includes('只支持金山文档'),
    null, { timeout: 15000 }).catch(() => {});
  T('非 kdocs/wps 域名被拒', (await p.locator('#pyErr').innerText()).includes('只支持金山文档'), (await p.locator('#pyErr').innerText()).trim());
  await p.fill('#pyWpsUrl', 'http://www.kdocs.cn/l/abc');
  await p.click('[data-act="wpsAdd"]');
  await p.waitForFunction(() => (document.querySelector('#pyErr') || {}).textContent?.includes('https'),
    null, { timeout: 15000 }).catch(() => {});
  T('http 链接被拒', (await p.locator('#pyErr').innerText()).includes('https'));
  T('被拒后列表仍为空', (await p.locator('#pyWpsList .py-item').count()) === 0);

  sec('在 PPT 子页添加 WPS 课件');
  await p.fill('#pyWpsTitle', '测试WPS-课件甲');
  await p.fill('#pyWpsUrl', 'https://www.kdocs.cn/l/QATEST01');
  await p.click('[data-act="wpsAdd"]');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyWpsList h4'))
    .some(e => e.textContent.includes('测试WPS-课件甲')), null, { timeout: 15000 });
  T('列表出现课件', true);
  await p.click('.py-navbtn[data-view="wps"]');
  await p.waitForTimeout(600);
  T('下拉自动选中', (await p.locator('#pyWpsSel').inputValue()) !== '');
  const src1 = await p.locator('#pyWpsFrame').getAttribute('src');
  T('iframe 已显示', await p.locator('#pyWpsFrame').isVisible());
  T('src 带简化只读参数', /simple=1&readonly/.test(src1 || ''), src1);
  T('src 指向 kdocs 链接', (src1 || '').startsWith('https://www.kdocs.cn/l/QATEST01'));

  sec('简化只读开关');
  await p.uncheck('#pyWpsSimple');
  await p.waitForTimeout(400);
  const src2 = await p.locator('#pyWpsFrame').getAttribute('src');
  T('取消后 src 回到原链接', src2 === 'https://www.kdocs.cn/l/QATEST01', src2);
  await p.check('#pyWpsSimple');
  await p.waitForTimeout(400);
  T('再勾上参数回来', /simple=1&readonly/.test(await p.locator('#pyWpsFrame').getAttribute('src')));

  sec('准备一个带 GUI 的测试代码文件');
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(500);
  await p.click('[data-act="fmNewFile"]');
  await p.waitForTimeout(300);
  await p.fill('#pySnipTitle', '测试WPS-计数器');
  await p.fill('#pySnipCode',
    'import tkinter as tk\n' +
    'print("wps mount ok")\n' +
    'n = 0\n' +
    'root = tk.Tk()\n' +
    'lab = tk.Label(root, text="点了 0 次")\n' +
    'def bump():\n' +
    '    global n\n' +
    '    n += 1\n' +
    '    lab.config(text="点了 %d 次" % n)\n' +
    'tk.Button(root, text="点我", command=bump).pack()\n' +
    'lab.pack()\n' +
    'root.mainloop()\n');
  await p.click('[data-act="snipSave"]');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyFmList .py-fm-name'))
    .some(e => e.textContent.trim() === '测试WPS-计数器.py'), null, { timeout: 15000 });
  T('测试代码已入库', true);

  sec('PPT 级挂载（弹窗选代码）');
  await p.click('.py-navbtn[data-view="wps"]');
  await p.waitForTimeout(600);
  await p.click('[data-act="wpsPick"]');
  await p.waitForTimeout(400);
  T('选代码弹窗打开', await p.locator('#pyPickDlg').evaluate(el => el.open === true || el.hasAttribute('open')));
  T('弹窗标题是 WPS 文案', (await p.locator('#pyPickTitle').innerText()).includes('WPS 课件'));
  await p.fill('#pyPickSearch', '测试WPS-计数器');
  await p.waitForTimeout(300);
  await p.locator('#pyPickList [data-fm-file]').first().click();
  await p.waitForFunction(() => (document.querySelectorAll('#pyWpsMounts .py-wps-mount').length) === 1,
    null, { timeout: 15000 });
  T('挂载列表出现 1 条', true);
  T('挂载行显示文件名', (await p.locator('#pyWpsMounts .nm').first().innerText()).includes('测试WPS-计数器'));
  T('提示是整份 PPT 粒度', (await p.locator('#pyWpsMountInfo').innerText()).includes('整份'));

  sec('运行挂载代码（输出 + GUI 交互）');
  await p.locator('#pyWpsMounts [data-wps-run]').first().evaluate(el => el.click());
  await p.waitForFunction(() => (document.querySelector('#pyWpsOut') || {}).textContent
    && document.querySelector('#pyWpsOut').textContent.includes('wps mount ok'), null, { timeout: 20000 });
  T('输出框有 stdout', true);
  T('源码区显示代码', (await p.locator('#pyWpsCode').innerText()).includes('tkinter'));
  await p.waitForFunction(() => !!document.querySelector('.py-ui[data-ui-for="pyWpsOut"] .py-ui-btn'),
    null, { timeout: 10000 });
  T('WPS 输出区渲染出 GUI', true);
  await p.locator('.py-ui[data-ui-for="pyWpsOut"] .py-ui-btn').first().evaluate(el => el.click());
  await p.waitForFunction(() => {
    const el = document.querySelector('.py-ui[data-ui-for="pyWpsOut"] .py-ui-label');
    return el && el.textContent.includes('点了 1 次');
  }, null, { timeout: 15000 });
  T('GUI 点击生效（独立事件队列）', true);

  sec('挂载管理');
  // 内置书例已移除：库里可能只有刚建的那一个文件，再造一个夹具才够验证「挂 2 条」
  const secondKey = await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const fd = new URLSearchParams({ title: '测试WPS-第二个', code: "print('second')", expect: '', categoryId: '' });
    const r = await fetch('/PyLab?handler=SnipSave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
      body: fd.toString()
    }).then(r => r.json());
    return r.ok ? r.data.key : null;
  });
  T('第二个夹具已入库', !!secondKey, secondKey);
  await p.click('[data-act="wpsPick"]');
  await p.waitForTimeout(400);
  await p.fill('#pyPickSearch', '测试WPS-第二个');
  await p.waitForTimeout(400);
  const rows = p.locator('#pyPickList [data-fm-file]');
  const n = await rows.count();
  T('弹窗里有可选文件', n >= 1, n + ' 个');
  await rows.first().click();
  await p.waitForFunction(() => (document.querySelectorAll('#pyWpsMounts .py-wps-mount').length) === 2,
    null, { timeout: 15000 });
  T('挂载列表到 2 条', true);
  await p.locator('#pyWpsMounts [data-wps-unmount]').last().evaluate(el => el.click());
  await p.waitForFunction(() => (document.querySelectorAll('#pyWpsMounts .py-wps-mount').length) === 1,
    null, { timeout: 15000 });
  T('取消挂载后剩 1 条', true);

  sec('改名 / 删除（在 PPT 子页里）');
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="ppt"]');
  await p.waitForTimeout(600);
  T('回到 PPT 子页能看到课件', (await p.locator('#pyWpsList .py-item').count()) >= 1);
  // 行内按钮有磁吸微位移（mag-live），物理点击会飘；统一 DOM 直击 + 覆写 prompt/confirm 稳住对话框
  await p.evaluate(() => { window.prompt = () => '测试WPS-改名'; window.confirm = () => true; });
  await p.locator('#pyWpsList [data-wps-ren]').first().evaluate(el => el.click());
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyWpsList h4'))
    .some(e => e.textContent.includes('测试WPS-改名')), null, { timeout: 15000 });
  T('改名成功', true);
  await p.locator('#pyWpsList [data-wps-del]').first().evaluate(el => el.click());
  await p.waitForFunction(() => (document.querySelectorAll('#pyWpsList .py-item').length) === 0,
    null, { timeout: 15000 });
  T('删除成功（挂载一并清）', (await p.locator('#pyWpsMounts').innerText()).includes('先添加'));

  sec('本地课件库已删除，iframe 是唯一通道');
  const indep = await p.evaluate(async () => {
    const w = await fetch('/PyLab?handler=WpsDecks').then(r => r.json());
    // 本地课件接口已下线：Razor 回落到 OnGet 吐 HTML，拿不到 JSON
    const r = await fetch('/PyLab?handler=Decks');
    const ct = r.headers.get('content-type') || '';
    let hadJson = false;
    if (ct.includes('json')) { try { await r.json(); hadJson = true; } catch (e) { } }
    return { wpsTotal: w.data.total, decksAlive: hadJson };
  });
  T('WPS 表已清空', indep.wpsTotal === 0, 'total=' + indep.wpsTotal);
  T('本地课件接口已不存在', !indep.decksAlive);

  sec('截图目检（iframe PPT 管理卡片 / WPS 播放器 · editorial + macos）');
  // 重新加一份用于截图（在 PPT 子页）
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="ppt"]');
  await p.waitForTimeout(500);
  await p.fill('#pyWpsTitle', '测试WPS-截图');
  await p.fill('#pyWpsUrl', 'https://www.kdocs.cn/l/QATEST01');
  await p.click('[data-act="wpsAdd"]');
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'editorial'));
  await p.waitForTimeout(200);
  const wpsCard = p.locator('[data-sub="ppt"] .card').last();
  await wpsCard.screenshot({ path: SHOTS + '/ppt_iframe_card_editorial.png' });
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'macos'));
  await p.waitForTimeout(300);
  await wpsCard.screenshot({ path: SHOTS + '/ppt_iframe_card_macos.png' });
  await p.click('.py-navbtn[data-view="wps"]');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'editorial'));
  await p.locator('[data-panel="wps"] .py-split').screenshot({ path: SHOTS + '/wps_editorial.png' });
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'macos'));
  await p.waitForTimeout(200);
  await p.locator('[data-panel="wps"] .py-split').screenshot({ path: SHOTS + '/wps_macos.png' });
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'editorial'));
  T('截图已存', fs.existsSync(SHOTS + '/wps_editorial.png') && fs.existsSync(SHOTS + '/ppt_iframe_card_editorial.png'));

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
    for (const w of d.data.decks) if (/^测试WPS/.test(w.title)) await post('WpsDelete', { id: w.id });
    const s = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const x of s.data.snippets) if (/^测试WPS/.test(x.title)) await post('SnipDelete', { id: x.id });
  });
  // 金山文档 iframe 内部会打一堆自家 SDK 的探测噪音（getFileSwitch / cloud-file-sdk 等），
  // 那是 kdocs 页面的控制台输出，不是本站的错，按来源词过滤掉
  const realErrs = jsErrs.filter(e => !/net::|Failed to load resource|iframe|kdocs|wps\.cn|getFileSwitch|cloud-file-sdk|Extention|当前环境/i.test(e));
  T('无 JS 错误', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃：', e); process.exit(1); });
