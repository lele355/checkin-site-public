// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab 代码绘图专项：matplotlib 图形输出 + 沙箱传递依赖回归
// 只覆盖本次新增功能，不跑全量 qa_full。
// 线上抽验：QA_BASE=https://example.com QA_USER=admin QA_PASS=xxx node qa_plot.js
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const USER = process.env.QA_USER || ADMIN;
const PASS = process.env.QA_PASS || PW;
const ONLINE = /^https?:\/\/(?!127\.)/.test(BASE);
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
  // 编辑器改动未保存时切片段会弹 confirm —— 测试里一律确认切换
  p.on('dialog', d => d.accept().catch(() => {}));
  const jsErrs = [];
  p.on('pageerror', e => jsErrs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) jsErrs.push(m.text()); });

  // ---------- 登录 ----------
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

  // ---------- ③ 绘图片段（内置书例已移除，用同源代码自建夹具） ----------
  const PLOT_CODE = [
    'import matplotlib.pyplot as plt',
    'days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]',
    'hours = [1.5, 2.0, 1.0, 2.5, 3.0, 4.0, 2.2]',
    'plt.plot(days, hours, marker="o", color="royalblue")',
    'plt.title("本周学习时长")',
    'plt.xlabel("星期")',
    'plt.ylabel("小时")',
    'plt.grid(alpha=0.3)',
    'print("平均每天 %.2f 小时" % (sum(hours) / len(hours)))',
  ].join('\n');
  const LOOP_CODE = [
    'total = 0',
    'for i in range(1, 101):',
    '    total += i',
    'print("1+2+...+100 =", total)',
  ].join('\n');
  const makeFixture = (p, title, code) => p.evaluate(async ([t, c]) => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const fd = new URLSearchParams({ title: t, code: c, expect: '', categoryId: '' });
    const r = await fetch('/PyLab?handler=SnipSave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
      body: fd.toString()
    }).then(r => r.json());
    return r.ok ? r.data.key : null;
  }, [title, code]);

  const FX_PLOT = await makeFixture(p, 'QA-折线图夹具', PLOT_CODE);
  const FX_LOOP = await makeFixture(p, 'QA-循环夹具', LOOP_CODE);
  T('绘图片段夹具已入库', !!FX_PLOT && !!FX_LOOP, FX_PLOT + ' / ' + FX_LOOP);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });

  sec('③ 绘图片段（matplotlib）');
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(400);
  const hasS08 = await p.locator('#pyFmList .py-fm-row[data-fm-file="' + FX_PLOT + '"]').count();
  T('文件列表含折线图夹具', hasS08 === 1);
  // 点文件即自动跑一遍，不要再手动点「运行」（会和自动运行抢输出框）
  await p.locator('#pyFmList .py-fm-row[data-fm-file="' + FX_PLOT + '"]').click();
  await p.waitForFunction(
    () => (document.querySelector('#pySnipOut') || {}).textContent?.includes('平均每天'),
    null, { timeout: 30000 }).catch(() => {});
  T('运行出文本输出', (await p.locator('#pySnipOut').innerText()).includes('平均每天'));
  await p.waitForFunction(
    () => {
      const img = document.querySelector('.py-sub[data-sub="code"] .py-figs img');
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 20000 }).catch(() => {});
  const fig1 = await p.locator('.py-sub[data-sub="code"] .py-figs img').count();
  T('输出下方渲染出图形', fig1 >= 1, fig1 + ' 张');
  const w = await p.locator('.py-sub[data-sub="code"] .py-figs img').first()
    .evaluate(el => el.naturalWidth).catch(() => 0);
  T('图形像素有效', w > 100, '宽 ' + w);
  await p.evaluate(() => {
    const el = document.querySelector('#pySnipOut');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await p.screenshot({ path: SHOTS + '/plot_snip.png' });

  // ---------- 预装绘图库：seaborn ----------
  sec('预装库 seaborn 出图');
  const SNS_CODE = [
    'import seaborn as sns',
    'import matplotlib.pyplot as plt',
    'import pandas as pd',
    'df = pd.DataFrame({"科目": ["语文", "数学", "英语"], "分数": [88, 95, 79]})',
    'sns.barplot(data=df, x="科目", y="分数")',
    'plt.title("seaborn 柱状图")',
    'print("seaborn", sns.__version__)',
  ].join('\n');
  const FX_SNS = await makeFixture(p, 'QA-seaborn夹具', SNS_CODE);
  T('seaborn 夹具已入库', !!FX_SNS, FX_SNS);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(400);
  await p.locator('#pyFmList .py-fm-row[data-fm-file="' + FX_SNS + '"]').click();
  await p.waitForFunction(
    () => {
      const img = document.querySelector('.py-sub[data-sub="code"] .py-figs img');
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 40000 }).catch(() => {});
  const snsFigs = await p.locator('.py-sub[data-sub="code"] .py-figs img').count();
  T('seaborn 图被捕获渲染', snsFigs >= 1, snsFigs + ' 张');
  T('seaborn 运行无报错', (await p.locator('#pySnipOut').innerText()).includes('seaborn 0.'),
    (await p.locator('#pySnipOut').innerText()).split('\n')[0]);

  // ---------- 传递依赖回归（json 曾被误拦 _io） ----------
  sec('传递依赖回归');
  await p.fill('#pySnipCode', 'import json, random\nprint(json.dumps({"a": 1}))\nprint(random.randint(1, 1))');
  await p.click('.py-sub[data-sub="code"] button[data-act="snipRun"]');
  await p.waitForFunction(
    () => (document.querySelector('#pySnipOut') || {}).textContent?.includes('"a"'),
    null, { timeout: 20000 }).catch(() => {});
  const jsonOut = await p.locator('#pySnipOut').innerText();
  T('import json 正常', jsonOut.includes('"a"') && !jsonOut.includes('沙箱限制'), jsonOut.split('\n')[0]);
  const figsAfter = await p.locator('.py-sub[data-sub="code"] .py-figs').first()
    .evaluate(el => el.style.display).catch(() => '');
  T('无图时图形区收起', figsAfter === 'none');

  // ---------- 沙箱负面：import os 仍被拦 ----------
  sec('沙箱负面');
  await p.fill('#pySnipCode', 'import os\nprint(os.getcwd())');
  await p.click('.py-sub[data-sub="code"] button[data-act="snipRun"]');
  await p.waitForFunction(
    () => (document.querySelector('#pySnipOut') || {}).textContent?.includes('沙箱限制'),
    null, { timeout: 20000 }).catch(() => {});
  const osOut = await p.locator('#pySnipOut').innerText();
  T('import os 仍被拦', osOut.includes('沙箱限制'), osOut.split('\n').slice(-1)[0]);

  // ---------- 多图 ----------
  sec('多图捕获');
  await p.fill('#pySnipCode',
    'import matplotlib.pyplot as plt\n' +
    'plt.figure()\nplt.plot([1, 2, 3])\n' +
    'plt.figure()\nplt.bar([1, 2, 3], [2, 1, 3])\nprint("two figs")');
  await p.click('.py-sub[data-sub="code"] button[data-act="snipRun"]');
  await p.waitForFunction(
    () => (document.querySelector('#pySnipOut') || {}).textContent?.includes('two figs'),
    null, { timeout: 40000 }).catch(() => {});
  await p.waitForFunction(
    () => document.querySelectorAll('.py-sub[data-sub="code"] .py-figs img').length >= 2,
    null, { timeout: 20000 }).catch(() => {});
  const fig2 = await p.locator('.py-sub[data-sub="code"] .py-figs img').count();
  T('两张图都渲染', fig2 === 2, fig2 + ' 张');

  // ---------- ④ 拓展应用已删除：不再有拓展卡入口，对应断言一并移除 ----------

  // ---------- 普通片段回归（for 循环） ----------
  sec('普通片段回归');
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(200);
  await p.locator('#pyFmList .py-fm-row[data-fm-file="' + FX_LOOP + '"]').click();
  await p.waitForFunction(
    () => (document.querySelector('#pySnipOut') || {}).textContent?.includes('5050'),
    null, { timeout: 20000 }).catch(() => {});
  T('循环夹具照常跑通', (await p.locator('#pySnipOut').innerText()).includes('5050'));

  // 清场：删掉两个夹具
  await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const d = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const s of d.data.snippets) {
      if (/^QA-(折线图|循环|seaborn)夹具/.test(s.title)) {
        const fd = new URLSearchParams({ id: s.id });
        await fetch('/PyLab?handler=SnipDelete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
          body: fd.toString()
        });
      }
    }
  });

  // 环境噪音（不是本站的错）：资源 403、PDF.js 在 0 尺寸容器里算负宽、监控脚本没 dsn、kdocs SDK
  const realErrs = jsErrs.filter(e => !/favicon|Failed to load resource|negative value is not valid|monjs|请设置正确的dsn|reading 'install'|kdocs|cloud-file-sdk|cross-origin frame/i.test(e));
  T('全程无 JS 错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

  await b.close();
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
