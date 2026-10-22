// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 沙箱控制台专项：help / pip list / pip install（可用/不可用）/ python 文件名 / ls / clear / 未知命令
// 本地：node qa_console.js   线上：QA_BASE=https://example.com QA_PASS=xxx node qa_console.js
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const USER = process.env.QA_USER || ADMIN;
const PASS = process.env.QA_PASS || PW;

let pass = 0, fail = 0;
const T = (n, c, x) => { if (c) { pass++; console.log('  v ' + n + (x != null ? '  [' + x + ']' : '')); } else { fail++; console.log('  x ' + n + (x != null ? '  [' + x + ']' : '')); } };
const sec = t => console.log('\n■ ' + t);

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })).newPage();
  const jsErrs = [];
  p.on('pageerror', e => jsErrs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) jsErrs.push(m.text()); });
  p.on('dialog', d => d.accept());

  const cmd = async (line) => {
    await p.fill('#pyConsoleIn', line);
    await p.press('#pyConsoleIn', 'Enter');
    await p.waitForTimeout(350);
    return (await p.locator('#pySnipOut').innerText()).trim();
  };

  sec('登录 + 进入代码页');
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', USER);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 25000 });
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(600);
  T('控制台输入框可见', await p.locator('#pyConsoleIn').isVisible());
  T('提示语写出常用命令', (await p.locator('#pyConsoleIn').getAttribute('placeholder')).includes('pip list'));

  sec('help');
  let out = await cmd('help');
  T('help 列出命令', out.includes('pip install') && out.includes('clear'), out.split('\n').slice(-1)[0]);

  sec('pip list');
  out = await cmd('pip list');
  T('列出可用模块总数', /沙箱可用模块（\d+ 个）/.test(out));
  T('包含 numpy', /numpy\s+\d/.test(out));
  T('包含 pandas（预装教学库）', /pandas\s+\d/.test(out));
  T('包含 seaborn（统计绘图）', /seaborn\s+\d/.test(out));
  T('包含 networkx（关系图）', /networkx\s+\d/.test(out));
  T('包含 tkinter 沙箱内置', out.includes('沙箱内置'));

  sec('pip install');
  out = await cmd('pip install pandas');
  T('已预装的库提示"已经可用"', out.includes('已经可用'), out.split('\n').slice(-1)[0]);
  out = await cmd('pip install requests');
  T('非白名单库说明不能装', out.includes('本站不能安装第三方包'));
  T('说明禁网/禁写/setup.py 三个原因', out.includes('禁网') && out.includes('禁写') && out.includes('setup.py'));

  sec('python --version / ls');
  out = await cmd('python --version');
  T('输出版本号', /Python 3\.\d+/.test(out), out.split('\n').slice(-1)[0]);
  out = await cmd('ls');
  T('ls 列文件', out.includes('.py'), out.split('\n')[1] || '');

  sec('python 文件名.py（真运行）');
  const FX = await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const fd = new URLSearchParams({
      title: 'QA-控制台夹具', code: "print('console-run-ok')\nprint(sum(range(10)))", expect: '', categoryId: ''
    });
    const r = await fetch('/PyLab?handler=SnipSave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
      body: fd.toString()
    }).then(r => r.json());
    return r.ok ? r.data.key : null;
  });
  T('夹具已入库', !!FX, FX);
  await p.click('.py-navbtn[data-view="wps"]');
  await p.waitForTimeout(300);
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  // 共享库列表是异步拉的，等它真的出现在左列表里再敲命令（线上慢，给足时间）
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#pyFmList .py-fm-name'))
    .some(e => e.textContent.trim() === 'QA-控制台夹具.py'), null, { timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(300);
  out = await cmd('python QA-控制台夹具.py');
  await p.waitForFunction(() => (document.querySelector('#pySnipOut') || {}).textContent?.includes('console-run-ok'),
    null, { timeout: 30000 }).catch(() => {});
  out = (await p.locator('#pySnipOut').innerText()).trim();
  // 注意：python 文件.py 会真跑一遍，输出框被程序输出覆盖 —— 所以这里不再断言回显
  T('文件被打开并运行', out.includes('console-run-ok') && out.includes('45'), out.split('\n').slice(0, 2).join(' / '));
  T('编辑器标题切到该文件', (await p.locator('#pyEdTitle').innerText()).includes('QA-控制台夹具'));

  sec('clear / 未知命令');
  out = await cmd('clear');
  T('clear 清空输出', out === '已清空', out);
  out = await cmd('foobar');
  T('未知命令有提示', out.includes('未知命令') && out.includes('help'));

  sec('历史记录（↑ 翻上一条）');
  await p.fill('#pyConsoleIn', 'help');
  await p.press('#pyConsoleIn', 'Enter');
  await p.waitForTimeout(300);
  await p.press('#pyConsoleIn', 'ArrowUp');
  T('↑ 取回上一条命令', (await p.locator('#pyConsoleIn').inputValue()) === 'help');

  sec('清场 + JS 错误');
  await p.evaluate(async () => {
    const tok = document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value;
    const d = await fetch('/PyLab?handler=Snips').then(r => r.json());
    for (const s of d.data.snippets) {
      if (/^QA-控制台夹具/.test(s.title)) {
        const fd = new URLSearchParams({ id: s.id });
        await fetch('/PyLab?handler=SnipDelete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': tok },
          body: fd.toString()
        });
      }
    }
  });
  // kdocs iframe 会刷自家 SDK 噪音、监控脚本没有 dsn、PDF.js 在 0 尺寸容器里算负宽 —— 都不是本站的错
  const realErrs = jsErrs.filter(e => !/net::|Failed to load resource|negative value is not valid|monjs|请设置正确的dsn|reading 'install'|kdocs|cloud-file-sdk|cross-origin frame/i.test(e));
  T('全程无 JS 错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

  await b.close();
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃', e); process.exit(1); });
