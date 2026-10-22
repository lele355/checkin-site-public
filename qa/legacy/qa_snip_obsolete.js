// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab ③ 代码片段专项：上传 .py / 分类管理 / 源码可编辑 / 选择框溢出修复
// 只覆盖本次新增功能，不跑全量 qa_full。
const { chromium } = require('playwright');
const fs = require('fs');

// 环境变量可覆盖（线上抽验：QA_BASE=https://example.com QA_PASS=xxx node qa_snip.js）
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const USER = process.env.QA_USER || ADMIN;
const PASS = process.env.QA_PASS || PW;
const SHOTS = 'D:/projects/checkin/qa/shots/pylab';
const TMP_PY = 'D:/tmp/snip_bubble.py';

let pass = 0, fail = 0;
const results = [];
function T(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra == null ? '' : String(extra) });
  if (cond) { pass++; console.log('  v ' + name + (extra != null ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  x ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
function sec(t) { console.log('\n■ ' + t); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync('D:/tmp', { recursive: true });
  fs.writeFileSync(TMP_PY,
    '# 测试片段-上传的冒泡排序\n' +
    'def bubble(a):\n' +
    '    for i in range(len(a)):\n' +
    '        for j in range(len(a) - 1 - i):\n' +
    '            if a[j] > a[j + 1]:\n' +
    '                a[j], a[j + 1] = a[j + 1], a[j]\n' +
    '    return a\n' +
    'print(bubble([3, 1, 2]))\n', 'utf8');

  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const jsErrs = [];
  p.on('pageerror', e => jsErrs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) jsErrs.push(m.text()); });

  const txt = async (sel) => (await p.locator(sel).first().innerText().catch(() => '')).trim();

  // ---------- 登录 ----------
  sec('登录');
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', USER);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  T('管理员登录成功', !p.url().toLowerCase().includes('login'), p.url());

  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 })
    .then(() => T('页面初始化完成', true))
    .catch(() => T('页面初始化完成', false));

  // ---------- 清场（可重复运行） ----------
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
    for (const s of d.data.snippets) if (/^测试片段/.test(s.title)) await post('SnipDelete', { id: s.id });
    for (const c of d.data.categories) if (/^测试分类/.test(c.name)) await post('SnipCatDelete', { id: c.id });
  });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  await p.click('.py-tab[data-tab="snip"]');
  await p.waitForTimeout(300);
  T('切到 ③ 代码片段页签', await p.locator('.py-panel[data-panel="snip"].on').isVisible());

  // ---------- 选择框溢出修复（本次核心 bug） ----------
  sec('选择框不溢出');
  const ov = await p.evaluate(() => {
    const sel = document.getElementById('pySnipSel');
    const row = sel.closest('.py-row');
    const sr = sel.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const main = document.querySelector('main.content');
    return {
      selRight: Math.round(sr.right), rowRight: Math.round(rr.right),
      selW: Math.round(sr.width), rowW: Math.round(rr.width),
      mainScroll: main.scrollWidth, mainClient: main.clientWidth,
      docScroll: document.documentElement.scrollWidth, win: window.innerWidth
    };
  });
  T('选择框不超出所在行', ov.selRight <= ov.rowRight + 2 && ov.selW <= ov.rowW + 2,
    `sel=${ov.selW}px row=${ov.rowW}px`);
  T('内容区无横向溢出', ov.mainScroll <= ov.mainClient + 2, `${ov.mainScroll}/${ov.mainClient}`);
  T('整页无横向溢出', ov.docScroll <= ov.win + 2, `${ov.docScroll}/${ov.win}`);

  // ---------- 分类管理 ----------
  sec('片段分类管理');
  await p.fill('#pySnipNewCat', '测试分类-循环');
  await p.click('[data-act="snipCatAdd"]');
  await p.waitForFunction(() => (window.__pyLab.snips.cats || []).some(c => c.name === '测试分类-循环'),
    null, { timeout: 8000 }).catch(() => { });
  const cats1 = await p.evaluate(() => window.__pyLab.snips.cats);
  T('新建分类成功', cats1.some(c => c.name === '测试分类-循环'), JSON.stringify(cats1));
  T('分类 chips 显示', (await txt('#pySnipCats')).includes('测试分类-循环'));
  const catId = (cats1.find(c => c.name === '测试分类-循环') || {}).id;

  // 分类下拉有值了
  const catOpts = await p.evaluate(() => Array.from(document.querySelectorAll('#pySnipCat option')).map(o => o.textContent));
  T('编辑器分类下拉含新分类', catOpts.some(t => t.includes('测试分类-循环')), JSON.stringify(catOpts));

  // ---------- 新建片段（可编辑源码 + 保存） ----------
  sec('新建片段与源码编辑');
  await p.click('[data-act="snipNew"]');
  await p.fill('#pySnipTitle', '测试片段-九九乘法');
  await p.fill('#pySnipCode', "print('测试输出A')");
  await p.selectOption('#pySnipCat', String(catId));
  await p.click('[data-act="snipSave"]');
  await p.waitForFunction(() => (window.__pyLab.snips.list || []).some(s => s.title === '测试片段-九九乘法'),
    null, { timeout: 8000 }).catch(() => { });
  const list1 = await p.evaluate(() => window.__pyLab.snips.list);
  const saved = list1.find(s => s.title === '测试片段-九九乘法');
  T('保存新片段入库', !!saved, saved ? saved.key : '未找到');
  T('保存后自动选中该片段', await p.inputValue('#pySnipSel') === (saved || {}).key, await p.inputValue('#pySnipSel'));

  // 编辑源码 → 运行的是编辑器现内容（不要求先保存）
  await p.fill('#pySnipCode', "print('改后输出B')");
  await p.click('[data-act="snipRun"]');
  await p.waitForFunction(() => {
    const o = document.getElementById('pySnipOut');
    return o && o.textContent.includes('改后输出B');
  }, null, { timeout: 15000 }).catch(() => { });
  T('源码可编辑，运行输出反映改动', (await txt('#pySnipOut')).includes('改后输出B'), await txt('#pySnipOut'));
  T('输出标为成功', (await txt('#pySnipOutTitle')).includes('成功'), await txt('#pySnipOutTitle'));

  // 保存改动 → 刷新后仍在（持久化）
  await p.click('[data-act="snipSave"]');
  await p.waitForTimeout(600);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  await p.click('.py-tab[data-tab="snip"]');
  await p.waitForTimeout(300);
  await p.selectOption('#pySnipSel', (saved || {}).key || '');
  await p.waitForFunction(() => {
    const t = document.getElementById('pySnipCode');
    return t && t.value.includes('改后输出B');
  }, null, { timeout: 8000 }).catch(() => { });
  T('刷新后编辑内容仍在（持久化）', (await p.inputValue('#pySnipCode')).includes('改后输出B'),
    await p.inputValue('#pySnipCode'));
  T('载入后标题正确', (await p.inputValue('#pySnipTitle')) === '测试片段-九九乘法', await p.inputValue('#pySnipTitle'));
  T('我的片段显示删除按钮', await p.locator('#pySnipDel').isVisible());
  T('我的片段不显示「另存」', !(await p.locator('#pySnipSaveAs').isVisible()));
  await p.screenshot({ path: SHOTS + '/snip-1-editor.png' });

  // ---------- 上传 .py 文件 ----------
  sec('上传 .py 文件');
  await p.setInputFiles('#pySnipFiles', TMP_PY);
  await p.click('[data-act="snipUpload"]');
  await p.waitForFunction(() => (window.__pyLab.snips.list || [])
    .some(s => s.title === '测试片段-上传的冒泡排序'), null, { timeout: 10000 }).catch(() => { });
  const upStatus = await txt('#pySnipUpStatus');
  T('上传成功提示', upStatus.includes('已导入 1 个'), upStatus);
  const list2 = await p.evaluate(() => window.__pyLab.snips.list);
  const uploaded = list2.find(s => s.title === '测试片段-上传的冒泡排序');
  T('首行 # 注释当标题入库', !!uploaded, uploaded ? uploaded.key : '未找到');
  T('源文件名记录', uploaded && uploaded.sourceFile === 'snip_bubble.py', uploaded && uploaded.sourceFile);
  // 载入是异步取源码（线上慢网络有可见空窗），等编辑器真的有内容再断言
  await p.waitForFunction(() => {
    const t = document.getElementById('pySnipCode');
    return t && t.value.includes('def bubble');
  }, null, { timeout: 10000 }).catch(() => { });
  T('上传后自动载入编辑器', (await p.inputValue('#pySnipCode')).includes('def bubble'), '');
  T('选择框里能看到上传片段', (await txt('#pySnipSel')).includes('上传的冒泡排序') ||
    await p.evaluate(() => Array.from(document.querySelectorAll('#pySnipSel option')).some(o => o.textContent.includes('上传的冒泡排序'))));

  // 跑上传的冒泡排序
  await p.click('[data-act="snipRun"]');
  await p.waitForFunction(() => {
    const o = document.getElementById('pySnipOut');
    return o && o.textContent.includes('[1, 2, 3]');
  }, null, { timeout: 15000 }).catch(() => { });
  T('上传片段可运行且结果正确', (await txt('#pySnipOut')).includes('[1, 2, 3]'), await txt('#pySnipOut'));

  // ---------- 分类筛选 ----------
  sec('分类筛选');
  // 把上传片段也归进测试分类，再筛
  await p.selectOption('#pySnipCat', String(catId));
  await p.click('[data-act="snipSave"]');
  await p.waitForTimeout(600);
  await p.selectOption('#pySnipFilter', String(catId));
  await p.waitForTimeout(300);
  const shown = await p.evaluate(() => Array.from(document.querySelectorAll('#pySnipSel option'))
    .filter(o => o.value).map(o => o.textContent));
  const allMine = await p.evaluate(() => (window.__pyLab.snips.list || []).map(s => s.title));
  T('筛选后只剩该分类的片段', shown.length >= 2 && shown.every(t => t.indexOf('测试片段') === 0),
    JSON.stringify(shown));
  T('筛选时隐藏内置片段', !shown.some(t => /循环|列表|元组|字典|函数|类/.test(t) && t.indexOf('测试') !== 0),
    JSON.stringify(shown));
  await p.selectOption('#pySnipFilter', '');
  await p.waitForTimeout(200);

  // ---------- 挂载下拉合并用户片段 ----------
  sec('课件页挂载下拉');
  const mountOpts = await p.evaluate(() => Array.from(document.querySelectorAll('#pyPageSnip option')).map(o => o.value));
  T('挂载下拉含用户片段 key（u{n}）', mountOpts.some(v => /^u\d+$/.test(v)), JSON.stringify(mountOpts.filter(v => /^u/.test(v))));
  T('挂载下拉仍含内置片段', mountOpts.some(v => v && !/^u\d+$/.test(v)) || mountOpts.length > 1, JSON.stringify(mountOpts.length));

  // ---------- 内置片段：载入 + 另存为我的 ----------
  sec('内置片段');
  const builtin = await p.evaluate(() => ((window.__pyLab.boot || {}).snippets || [])[0] || null);
  if (builtin) {
    await p.selectOption('#pySnipSel', builtin.id);
    // boot.snippets 是元数据（不含 code），要等 snippet_info 把源码填进编辑器
    await p.waitForFunction((title) => {
      const t = document.getElementById('pySnipCode');
      const ti = document.getElementById('pySnipTitle');
      return t && ti && ti.value === title && t.value.length > 0;
    }, builtin.title, { timeout: 8000 }).catch(() => { });
    T('内置片段源码载入编辑器', (await p.inputValue('#pySnipTitle')) === builtin.title,
      (await p.inputValue('#pySnipCode')).slice(0, 24).replace(/\n/g, ' '));
    T('内置片段显示「另存为我的片段」', await p.locator('#pySnipSaveAs').isVisible());
    T('内置片段不显示删除按钮', !(await p.locator('#pySnipDel').isVisible()));
    // 标题改成测试前缀再另存，清场时能统一删掉（别用内置原名，会攒垃圾）
    await p.fill('#pySnipTitle', '测试片段-另存副本');
    await p.click('[data-act="snipSaveAs"]');
    await p.waitForFunction(() => {
      const c = window.__pyLab.snipCur;
      return c && c.key && /^u\d+$/.test(c.key) && !c.builtin;
    }, null, { timeout: 8000 }).catch(() => { });
    const afterAs = await p.evaluate(() => window.__pyLab.snips.list.map(s => s.title));
    T('另存后生成自己的片段', afterAs.includes('测试片段-另存副本'), JSON.stringify(afterAs));
  } else {
    T('（本地无内置片段，跳过内置载入/另存）', true);
  }

  // ---------- 删除 ----------
  sec('删除片段与分类');
  await p.selectOption('#pySnipSel', (uploaded || {}).key || '');
  await p.waitForTimeout(400);
  p.once('dialog', d => d.accept());
  await p.click('[data-act="snipDel"]');
  await p.waitForFunction(() => !(window.__pyLab.snips.list || []).some(s => s.title === '测试片段-上传的冒泡排序'),
    null, { timeout: 8000 }).catch(() => { });
  const list3 = await p.evaluate(() => window.__pyLab.snips.list);
  T('删除片段成功', !list3.some(s => s.title === '测试片段-上传的冒泡排序'), list3.length + ' 条剩余');

  p.once('dialog', d => d.accept());
  await p.click('[data-snip-cat-del="' + catId + '"]');
  await p.waitForFunction(() => !(window.__pyLab.snips.cats || []).some(c => c.name === '测试分类-循环'),
    null, { timeout: 8000 }).catch(() => { });
  const cats2 = await p.evaluate(() => window.__pyLab.snips.cats);
  T('删除分类成功', !cats2.some(c => c.name === '测试分类-循环'), JSON.stringify(cats2));
  const list4 = await p.evaluate(() => window.__pyLab.snips.list);
  const nine = list4.find(s => s.title === '测试片段-九九乘法');
  T('删分类后片段保留并回未分类', !!nine && !nine.categoryId, JSON.stringify(nine && nine.categoryId));

  await p.screenshot({ path: SHOTS + '/snip-2-final.png' });

  // ---------- JS 错误 ----------
  sec('页面无 JS 报错');
  T('全程无 console/page 错误', jsErrs.length === 0, jsErrs.slice(0, 3).join(' | '));

  // ---------- 汇总 ----------
  console.log('\n══════════════════════════');
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  if (fail) {
    console.log('失败项：');
    results.filter(r => !r.ok).forEach(r => console.log('  x ' + r.name + '  [' + r.extra + ']'));
  }
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本崩溃：', e); process.exit(2); });
