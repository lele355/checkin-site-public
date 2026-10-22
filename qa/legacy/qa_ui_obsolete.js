// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab 课堂版 GUI（假 tkinter）专项：
// 控件树渲染 / 点按钮改界面 / 输入框回传 / 运行复位 / Canvas 图元 / 主题 / 安全（无 Tcl）
// 线上：QA_BASE=https://example.com QA_PASS=xxx node qa_ui.js
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
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(500);

  // 内置书例已从网站移除（2026-10-21）：用原 s09_tk 的代码自建一个夹具
  const TK_CODE = [
    'import tkinter as tk',
    'count = 0',
    'def add():',
    '    global count',
    '    count += 1',
    '    label.config(text="点了 %d 次" % count)',
    'def hello():',
    '    label.config(text="你好，" + name.get())',
    'root = tk.Tk()',
    'root.title("我的第一个窗口")',
    'root.geometry("320x210")',
    'label = tk.Label(root, text="点下面的按钮试试")',
    'label.pack(pady=10)',
    'tk.Button(root, text="点我 +1", command=add).pack(pady=4)',
    'name = tk.Entry(root)',
    'name.insert(0, "管理员")',
    'name.pack(pady=6)',
    'tk.Button(root, text="打招呼", command=hello).pack(pady=4)',
    'root.mainloop()',
  ].join('\n');
  const FX = await p.evaluate(async code => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const fd = new URLSearchParams({ title: 'tkinter 界面夹具QA', code, expect: '', categoryId: '' });
    const r = await fetch('/PyLab?handler=SnipSave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
      body: fd.toString()
    }).then(r => r.json());
    return r.ok ? r.data.key : null;
  }, TK_CODE);
  T('tkinter 夹具已入库', !!FX, FX);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(500);

  sec('打开 tkinter 示例（界面渲染）');
  await p.locator('#pyFmList .py-fm-row[data-fm-file="' + FX + '"]').click();
  await p.waitForFunction(() => document.querySelector('.py-ui .py-ui-btn'), null, { timeout: 30000 }).catch(() => {});
  T('渲染出窗口卡片', (await p.locator('.py-ui .py-ui-win').count()) === 1);
  T('窗口标题正确', (await p.locator('.py-ui-titlebar').innerText()).includes('我的第一个窗口'));
  T('两个按钮都在', (await p.locator('.py-ui .py-ui-btn').count()) === 2);
  T('输入框渲染', (await p.locator('.py-ui .py-ui-entry').count()) === 1);
  T('初始文字正确', (await p.locator('.py-ui .py-ui-label').first().innerText()).includes('点下面的按钮试试'));

  sec('点按钮 → 界面变化');
  await p.locator('.py-ui .py-ui-btn').first().click();
  await p.waitForFunction(() => (document.querySelector('.py-ui .py-ui-label') || {}).textContent?.includes('点了 1 次'),
    null, { timeout: 20000 }).catch(() => {});
  T('点 1 次显示「点了 1 次」', (await p.locator('.py-ui .py-ui-label').first().innerText()).includes('点了 1 次'));
  await p.locator('.py-ui .py-ui-btn').first().click();
  await p.waitForFunction(() => (document.querySelector('.py-ui .py-ui-label') || {}).textContent?.includes('点了 2 次'),
    null, { timeout: 20000 }).catch(() => {});
  T('再点 1 次显示「点了 2 次」（事件不重复回放）',
    (await p.locator('.py-ui .py-ui-label').first().innerText()).includes('点了 2 次'));

  sec('输入框 → 点按钮读取值');
  await p.locator('.py-ui .py-ui-entry').fill('乐酱');
  await p.locator('.py-ui .py-ui-btn').last().click();
  await p.waitForFunction(() => (document.querySelector('.py-ui .py-ui-label') || {}).textContent?.includes('你好'),
    null, { timeout: 20000 }).catch(() => {});
  T('打招呼读到输入值', (await p.locator('.py-ui .py-ui-label').first().innerText()).includes('你好，乐酱'));
  T('输入框值保留', (await p.locator('.py-ui .py-ui-entry').inputValue()) === '乐酱');

  sec('点「运行」复位界面');
  await p.click('[data-act="snipRun"]');
  await p.waitForFunction(() => (document.querySelector('.py-ui .py-ui-label') || {}).textContent?.includes('点下面的按钮试试'),
    null, { timeout: 30000 }).catch(() => {});
  T('复位回初始文字', (await p.locator('.py-ui .py-ui-label').first().innerText()).includes('点下面的按钮试试'));

  sec('Canvas 与消息框');
  await p.fill('#pySnipCode',
    'import tkinter as tk\n' +
    'from tkinter import messagebox\n' +
    'root = tk.Tk()\nroot.title("画布")\n' +
    'cv = tk.Canvas(root, width=200, height=120, bg="white")\ncv.pack()\n' +
    'cv.create_rectangle(10, 10, 90, 70, fill="#8ecae6", outline="#023047")\n' +
    'cv.create_line(10, 100, 190, 100, width=3, fill="#e63946")\n' +
    'cv.create_text(100, 40, text="你好")\n' +
    'tk.Button(root, text="提示", command=lambda: messagebox.showinfo("提示", "点了消息框")).pack()\n' +
    'root.mainloop()');
  await p.click('[data-act="snipRun"]');
  await p.waitForFunction(() => !!document.querySelector('.py-ui canvas'), null, { timeout: 30000 }).catch(() => {});
  T('画布元素渲染', (await p.locator('.py-ui canvas').count()) === 1);
  const painted = await p.evaluate(() => {
    const cv = document.querySelector('.py-ui canvas');
    if (!cv) return -1;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  T('画布上确实画了东西', painted > 500, painted + ' 个像素');
  await p.locator('.py-ui .py-ui-btn').first().click();
  await p.waitForFunction(() => !!document.querySelector('.py-ui-msg'), null, { timeout: 20000 }).catch(() => {});
  T('消息框内容显示出来', (await p.locator('.py-ui-msg').innerText()).includes('点了消息框'));

  sec('安全：没有真 Tcl（无法 exec 系统命令）');
  await p.fill('#pySnipCode', 'import tkinter as tk\nprint("有 Tcl 吗：", hasattr(tk, "Tcl"))\nprint("模块文件：", tk.__file__)');
  await p.click('[data-act="snipRun"]');
  await p.waitForFunction(() => (document.querySelector('#pySnipOut') || {}).textContent?.includes('有 Tcl 吗'),
    null, { timeout: 20000 }).catch(() => {});
  const safeOut = await p.locator('#pySnipOut').innerText();
  T('tk.Tcl 不存在', safeOut.includes('有 Tcl 吗： False'), safeOut.split('\n')[0]);
  T('加载的是课堂版 shim', /uishim/.test(safeOut), (safeOut.split('\n')[1] || '').slice(-32));

  // 主展示「按页挂载 + 交互」已随转图模块删除：现在只验 iframe 通道能正常切过去（挂载交互在 qa_wps.js 里覆盖）
  sec('在线演示可切换');
  await p.click('.py-navbtn[data-view="wps"]');
  await p.waitForTimeout(500);
  T('在线演示面板可见', await p.locator('.py-panel[data-panel="wps"].on').isVisible());

  sec('主题适配');
  // 回到代码文件视图（上面的主展示段切走了）
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(300);
  // 先切回带界面的示例（上面的安全检查把代码换成了纯 print）
  await p.locator('#pyFmList .py-fm-row[data-fm-file="' + FX + '"]').click();
  await p.waitForFunction(() => !!document.querySelector('.py-ui .py-ui-win'), null, { timeout: 30000 }).catch(() => {});
  for (const th of ['macos', 'clay']) {
    await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), th);
    await p.waitForTimeout(200);
    const v = await p.evaluate(() => {
      const w = document.querySelector('.py-ui-win');
      if (!w) return null;
      const cs = getComputedStyle(w);
      return { bg: cs.backgroundColor, border: parseFloat(cs.borderTopWidth) };
    });
    T(th + ' 窗口可见且有边框', v && v.bg !== 'rgba(0, 0, 0, 0)' && v.border >= 1,
      v ? v.bg : 'no win');
  }
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'editorial'));
  await p.waitForTimeout(200);

  sec('截图');
  await p.locator('#pyFmList .py-fm-row[data-fm-file="' + FX + '"]').click();
  await p.waitForFunction(() => document.querySelector('.py-ui .py-ui-btn'), null, { timeout: 30000 }).catch(() => {});
  await p.locator('.py-ui .py-ui-btn').first().click();
  await p.waitForTimeout(1500);
  await p.locator('.py-sub[data-sub="code"]').screenshot({ path: SHOTS + '/ui_editorial.png' }).catch(() => {});
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'macos'));
  await p.waitForTimeout(300);
  await p.locator('.py-sub[data-sub="code"]').screenshot({ path: SHOTS + '/ui_macos.png' }).catch(() => {});

  // 清场：删掉夹具
  await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const d = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const s of d.data.snippets) {
      if (/^tkinter 界面夹具QA/.test(s.title)) {
        const fd = new URLSearchParams({ id: s.id });
        await fetch('/PyLab?handler=SnipDelete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
          body: fd.toString()
        });
      }
    }
  });

  T('全程无 JS 错误', jsErrs.length === 0, jsErrs.slice(0, 2).join(' | '));

  await b.close();
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
