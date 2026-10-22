// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab ③ 代码文件（资源管理器）专项：
// 分类树 / 文件列表 / 新建 / 改名 / 移动 / 删除 / 搜索 / 分类增删改 + ② 选代码弹窗 + 主题适配
// 线上：QA_BASE=https://example.com QA_PASS=xxx node qa_fm.js
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
  T('三段导航就位（在线演示/文件管理/实用工具）', (await p.locator('.py-navbtn').count()) === 3);
  T('面板 3 个（主展示已删除）', (await p.locator('.py-panel').count()) === 3);

  // 清场：删掉上次遗留的测试分类与测试文件
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
    const d = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const s of d.data.snippets) if (/^测试文件/.test(s.title)) await post('SnipDelete', { id: s.id });
    for (const c of d.data.categories) if (/^测试分类/.test(c.name)) await post('SnipCatDelete', { id: c.id });
    // 内置书例已移除：库里可能空着，先放一个夹具，下面的列表断言才有对象
    await post('SnipSave', { title: '测试文件-基座', code: "print('base')", expect: '', categoryId: '' });
  });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });

  sec('③ 资源管理器');
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(600);
  T('左树有「全部文件」', (await p.locator('#pyFmTree .py-fm-node', { hasText: '全部文件' }).count()) === 1);
  T('内置书例已移除', (await p.locator('#pyFmTree .py-fm-node', { hasText: '内置书例' }).count()) === 0);
  T('左树有「未分类」', (await p.locator('#pyFmTree .py-fm-node', { hasText: '未分类' }).count()) === 1);
  const allRows = await p.locator('#pyFmList .py-fm-row').count();
  T('文件列表有内容', allRows >= 1, allRows + ' 个');
  const firstName = (await p.locator('#pyFmList .py-fm-name').first().innerText()).trim();
  T('文件以 .py 文件名区分', /\.py$/.test(firstName), firstName);

  sec('分类树过滤');
  await p.click('#pyFmTree .py-fm-node:has-text("未分类")');
  await p.waitForTimeout(400);
  const uncatRows = await p.locator('#pyFmList .py-fm-row').count();
  T('点「未分类」只列未分类文件', uncatRows <= allRows, uncatRows + ' / 共 ' + allRows);
  await p.click('#pyFmTree .py-fm-node:has-text("全部文件")');
  await p.waitForTimeout(400);
  T('点「全部文件」恢复全量', (await p.locator('#pyFmList .py-fm-row').count()) === allRows);

  sec('新建文件（存进当前分类）');
  await p.click('#pyFmTree .py-fm-node:has-text("全部文件")');
  await p.waitForTimeout(200);
  await p.click('[data-act="fmNewFile"]');
  await p.waitForTimeout(300);
  T('新建后编辑器标题变「新建文件」', (await p.locator('#pyEdTitle').innerText()).includes('新建文件'));
  await p.fill('#pySnipTitle', '测试文件-甲');
  await p.fill('#pySnipCode', 'print("hello from file manager")');
  await p.click('[data-act="snipSave"]');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyFmList .py-fm-name'))
    .some(e => e.textContent.trim() === '测试文件-甲.py'), null, { timeout: 15000 });
  await p.waitForTimeout(400);
  T('列表里出现「测试文件-甲.py」', true);

  sec('上传 .py（放进当前分类）');
  fs.mkdirSync('D:/tmp', { recursive: true });
  const TMP_PY = 'D:/tmp/fm_upload.py';
  fs.writeFileSync(TMP_PY, '# 测试文件-上传冒泡\n' +
    'def bubble(a):\n    return sorted(a)\n\nprint(bubble([3, 1, 2]))\n', 'utf8');
  await p.setInputFiles('#pySnipFiles', TMP_PY);
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyFmList .py-fm-name'))
    .some(e => e.textContent.includes('测试文件-上传冒泡')), null, { timeout: 25000 }).catch(() => {});
  await p.waitForFunction(() => (document.querySelector('#pySnipCode') || {}).value
    && document.querySelector('#pySnipCode').value.includes('def bubble'), null, { timeout: 20000 }).catch(() => {});
  T('上传后列表出现该文件', (await p.locator('#pyFmList .py-fm-name').allInnerTexts())
    .some(t => t.includes('测试文件-上传冒泡')));
  T('上传后自动载入编辑器', (await p.locator('#pySnipCode').inputValue()).includes('def bubble'));
  T('上传状态有反馈', (await p.locator('#pySnipUpStatus').innerText()).includes('已导入'),
    (await p.locator('#pySnipUpStatus').innerText()).slice(0, 24));

  sec('点文件打开（不丢改动确认）');  await p.locator('#pyFmList .py-fm-row:has-text("测试文件-甲.py")').click();
  await p.waitForTimeout(1200);
  T('编辑器载入该文件', (await p.locator('#pySnipCode').inputValue()).includes('hello from file manager'));
  T('编辑器标题显示文件名', (await p.locator('#pyEdTitle').innerText()).includes('测试文件-甲.py'));

  sec('文件改名（内联）');
  await p.locator('#pyFmList .py-fm-row:has-text("测试文件-甲.py")').hover();
  await p.locator('#pyFmList .py-fm-row:has-text("测试文件-甲.py") [data-fm-rename]').click();
  await p.waitForTimeout(300);
  const rnInput = await p.locator('[data-fm-rename-input]').count();
  T('出现内联改名输入框', rnInput === 1);
  await p.fill('[data-fm-rename-input]', '测试文件-乙');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyFmList .py-fm-name'))
    .some(e => e.textContent.trim() === '测试文件-乙.py'), null, { timeout: 15000 });
  T('改名后列表显示新文件名', true);

  sec('搜索');
  await p.fill('#pyFmSearch', '测试文件-乙');
  await p.waitForTimeout(300);
  T('搜索只剩 1 行', (await p.locator('#pyFmList .py-fm-row').count()) === 1);
  await p.fill('#pyFmSearch', '不存在的东西zzz');
  await p.waitForTimeout(300);
  T('搜不到显示空态', (await p.locator('#pyFmList .py-fm-empty').count()) === 1);
  await p.fill('#pyFmSearch', '');
  await p.waitForTimeout(300);

  sec('新建分类 / 改名 / 移动文件 / 删分类');
  await p.click('[data-fm-cat-new]');
  await p.waitForFunction(() => document.querySelectorAll('[data-fm-cat-input]').length === 1, null, { timeout: 15000 }).catch(() => {});
  T('出现新分类输入框', (await p.locator('[data-fm-cat-input]').count()) === 1);
  await p.fill('[data-fm-cat-input]', '测试分类-甲');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyFmTree .nm'))
    .some(e => e.textContent.trim() === '测试分类-甲'), null, { timeout: 15000 });
  await p.waitForTimeout(400);
  T('分类树出现「测试分类-甲」', true);

  await p.locator('#pyFmTree .py-fm-node:has-text("测试分类-甲") [data-fm-cat-rename]').click();
  await p.waitForTimeout(300);
  await p.fill('[data-fm-cat-input]', '测试分类-乙');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyFmTree .nm'))
    .some(e => e.textContent.trim() === '测试分类-乙'), null, { timeout: 15000 });
  await p.waitForTimeout(400);
  T('分类改名成功', true);

  // 移动：行内「移动」→ 弹窗里点分类
  await p.fill('#pyFmSearch', '测试文件-乙');
  await p.waitForTimeout(300);
  await p.locator('#pyFmList [data-fm-move]').first().click();
  await p.waitForTimeout(600);
  T('移动弹窗打开', await p.locator('#pyPickDlg').evaluate(d => d.open));
  T('弹窗提示移动模式', (await p.locator('#pyPickTitle').innerText()).includes('移动'));
  await p.locator('#pyPickTree .py-fm-node:has-text("测试分类-乙")').click();
  await p.waitForFunction(() => !document.querySelector('#pyPickDlg').open, null, { timeout: 15000 });
  await p.fill('#pyFmSearch', '');
  await p.waitForTimeout(400);
  await p.click('#pyFmTree .py-fm-node:has-text("测试分类-乙")');
  await p.waitForTimeout(400);
  T('文件已被移动进分类', (await p.locator('#pyFmList .py-fm-name').allInnerTexts())
    .some(t => t.trim() === '测试文件-乙.py'));

  // 删分类：文件回未分类
  await p.locator('#pyFmTree .py-fm-node:has-text("测试分类-乙") [data-fm-cat-del]').click();
  await p.waitForTimeout(1200);
  T('分类已删除', (await p.locator('#pyFmTree .nm', { hasText: '测试分类-乙' }).count()) === 0);
  await p.click('#pyFmTree .py-fm-node:has-text("未分类")');
  await p.waitForTimeout(400);
  T('文件回到未分类', (await p.locator('#pyFmList .py-fm-name').allInnerTexts())
    .some(t => t.trim() === '测试文件-乙.py'));

  sec('删除文件');
  await p.locator('#pyFmList .py-fm-row:has-text("测试文件-乙.py") [data-fm-del]').click();
  await p.waitForFunction(() => !Array.from(document.querySelectorAll('#pyFmList .py-fm-name'))
    .some(e => e.textContent.trim() === '测试文件-乙.py'), null, { timeout: 15000 });
  T('文件已删除', true);

  // 回归：行内操作曾经 opacity:0 只靠 hover 出现，触屏/平板上等于没有删除按钮
  sec('行内操作不依赖 hover');
  const actsSt = await p.evaluate(() => {
    const a = document.querySelector('#pyFmList .py-fm-acts');
    if (!a) return null;
    return { op: parseFloat(getComputedStyle(a).opacity), btn: [...a.querySelectorAll('button')].map(b => b.textContent.trim()) };
  });
  T('操作区常显（不用悬停看得见）', actsSt !== null && actsSt.op > 0, actsSt ? 'opacity=' + actsSt.op : '无行');

  sec('② 选代码弹窗（挂到整份 PPT）');
  // 主展示「按页挂载」已随本地课件库删除：现在唯一入口是「在线演示」里的整份 PPT 挂载。
  // 先用接口造一份 WPS 夹具（iframe 通道的挂载必须有一份 PPT），跑完删。
  const wpsId = await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const fd = new URLSearchParams({ title: '测试文件-WPS夹具', url: 'https://www.kdocs.cn/l/FMTEST01', remark: '' });
    const r = await fetch('/PyLab?handler=WpsSave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
      body: fd.toString()
    }).then(r => r.json());
    return r.ok ? r.data.id : null;
  });
  T('WPS 夹具已建', !!wpsId, wpsId);
  await p.click('.py-navbtn[data-view="wps"]');
  await p.waitForTimeout(600);
  T('页面没有旧的页码下拉', (await p.locator('select#pyPageSnip').count()) === 0);
  T('挂载入口是「＋ 挂载代码…」', (await p.locator('[data-act="wpsPick"]').count()) === 1);
  await p.evaluate(id => { window.__pyLab.wps.curId = id; }, wpsId);
  await p.click('[data-act="wpsPick"]');
  await p.waitForTimeout(600);
  T('弹窗打开', await p.locator('#pyPickDlg').evaluate(d => d.open));
  T('弹窗里也有分类树', (await p.locator('#pyPickTree .py-fm-node').count()) >= 2);
  T('弹窗候选里有共享文件', (await p.locator('#pyPickList .py-fm-row').count()) >= 1);
  await p.locator('#pyPickList .py-fm-row').first().click();
  await p.waitForFunction(() => !document.querySelector('#pyPickDlg').open, null, { timeout: 15000 });
  await p.waitForFunction(() => (document.querySelectorAll('#pyWpsMounts .py-wps-mount').length) === 1,
    null, { timeout: 15000 });
  T('挂载列表出现 1 条', true);
  T('提示是整份 PPT 粒度', (await p.locator('#pyWpsMountInfo').innerText()).includes('整份'));
  await p.locator('#pyWpsMounts [data-wps-unmount]').first().evaluate(el => el.click());
  await p.waitForFunction(() => (document.querySelectorAll('#pyWpsMounts .py-wps-mount').length) === 0,
    null, { timeout: 15000 });
  T('取消挂载后清空', true);
  // 夹具收尾（挂载已清，删 PPT 只动链接）
  await p.evaluate(async id => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const fd = new URLSearchParams({ id: String(id) });
    await fetch('/PyLab?handler=WpsDelete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
      body: fd.toString()
    });
  }, wpsId);

  sec('下拉框 / 弹窗主题适配');
  for (const th of ['(none)', 'editorial', 'natural', 'macos', 'clay']) {
    await p.evaluate(t => {
      const el = document.documentElement;
      if (t === '(none)') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', t);
    }, th);
    await p.waitForTimeout(200);
    const v = await p.evaluate(() => {
      const s = document.querySelector('#pySnipCat');
      const cs = getComputedStyle(s);
      const dlg = document.querySelector('#pyPickDlg');
      const dcs = getComputedStyle(dlg);
      return {
        bg: cs.backgroundColor, img: cs.backgroundImage,
        dlgBg: dcs.backgroundColor, dlgImg: dcs.backgroundImage,
        dlgBorder: parseFloat(dcs.borderTopWidth),
        dlgRadius: dcs.borderRadius
      };
    });
    // editorial 是透明底线式；clay 的底色是渐变（backgroundColor 本身透明）——按设计分别判定
    const selectOk = th === 'editorial'
      ? /linear-gradient/.test(v.img)
      : (v.bg !== 'rgba(0, 0, 0, 0)' && /linear-gradient/.test(v.img));
    T(th + ' 下拉有皮肤+箭头', selectOk, v.bg);
    const dlgPaintOk = (v.dlgBg !== 'rgba(0, 0, 0, 0)' || /gradient/.test(v.dlgImg)) && v.dlgBorder >= 1;
    T(th + ' 弹窗有主题底色/边框', dlgPaintOk, v.dlgBg + ' / ' + v.dlgImg.slice(0, 24));
  }
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'editorial'));
  await p.waitForTimeout(200);

  sec('截图');
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(500);
  await p.locator('.py-sub[data-sub="code"]').screenshot({ path: SHOTS + '/fm_editorial.png' }).catch(() => {});
  // 选代码/移动共用同一个 <dialog>：这里用「移动」入口取证，免得再造 WPS 夹具
  const moveBtn = p.locator('#pyFmList [data-fm-move]').first();
  if (await moveBtn.count()) {
    await moveBtn.evaluate(el => el.click());
    await p.waitForTimeout(600);
    await p.screenshot({ path: SHOTS + '/fm_dialog.png' });
    await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'macos'));
    await p.waitForTimeout(300);
    await p.screenshot({ path: SHOTS + '/fm_dialog_macos.png' });
    await p.click('[data-act="pickClose"]');
    await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'editorial'));
  } else {
    console.log('  - 库里没有文件，跳过弹窗截图');
  }

  sec('清场');
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
    const d = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const s of d.data.snippets) if (/^测试文件/.test(s.title)) await post('SnipDelete', { id: s.id });
    for (const c of d.data.categories) if (/^测试分类/.test(c.name)) await post('SnipCatDelete', { id: c.id });
  });

  // 夹具 PPT 会在 iframe 里加载金山文档播放器，它家 SDK 自己会打一堆跨域探测噪音，
  // 那不是本站的错误（与 qa_wps.js 同一条过滤规则）
  const realErrs = jsErrs.filter(e => !/net::|Failed to load resource|iframe|kdocs|wps\.cn|wpscdn|getFileSwitch|cloud-file-sdk|Extention|当前环境|SecurityError/i.test(e));
  T('全程无 JS 错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

  await b.close();
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
