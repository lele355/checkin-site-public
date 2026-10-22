// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// PyLab 专项测试：名单导入（xlsx / 粘贴）、点名考勤、课件上传/分类/播放/全屏/页码挂片段
// 只覆盖本次新增功能，不跑全量 qa_full。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:5188';
const SHOTS = 'D:/projects/checkin/qa/shots/pylab';
const XLSX = 'D:/tmp/roster.xlsx';
const PPTX = 'D:/tmp/t2.pptx';
const CLASS_A = '计科2301';
const CLASS_B = '冒烟测试班';

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
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const jsErrs = [];
  p.on('pageerror', e => jsErrs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) jsErrs.push(m.text()); });

  const $ = (sel) => p.locator(sel);
  const txt = async (sel) => (await p.locator(sel).first().innerText().catch(() => '')).trim();

  // ---------- 登录 ----------
  sec('登录');
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', ADMIN);
  await p.fill('#Password', PW);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  T('管理员登录成功', !p.url().toLowerCase().includes('login'), p.url());

  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 })
    .then(() => T('页面初始化完成（bridge + 名单 + 课件）', true))
    .catch(() => T('页面初始化完成（bridge + 名单 + 课件）', false));

  // ---------- 清场 ----------
  sec('清场（可重复运行）');
  await p.evaluate(async (classes) => {
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
    for (const c of classes) await post('RosterClear', { className: c });
    const d = await fetch('/PyLab?handler=Decks').then(r => r.json());
    for (const deck of d.data.decks) if (/^测试课件/.test(deck.title)) await post('DeckDelete', { id: deck.id });
    for (const cat of d.data.categories) if (/^测试分类/.test(cat.name)) await post('CatDelete', { id: cat.id });
  }, [CLASS_A, CLASS_B]);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });

  // ---------- ① 名单导入：xlsx ----------
  sec('① 名单导入');
  await p.click('[data-act="roster"]');
  await p.waitForTimeout(400);
  T('名单管理面板打开', await p.locator('#pyRosterCard').isVisible());

  await p.fill('#pyClassInput', CLASS_A);
  await p.setInputFiles('#pyRosterFile', XLSX);
  await p.waitForTimeout(300);
  T('文件名回显', (await txt('#pyFileName')).includes('roster.xlsx'), await txt('#pyFileName'));
  await p.click('[data-act="importFile"]');
  await p.waitForFunction((cls) => (window.__pyLab.roster.classes || [])
    .some(c => c.raw === cls && c.count === 5), CLASS_A, { timeout: 15000 }).catch(() => { });
  await p.waitForTimeout(600);

  const roster = await p.evaluate(() => window.__pyLab.roster);
  const clsA = roster.classes.find(c => c.raw === '计科2301');
  T('xlsx 解析出 5 人并归入班级', clsA && clsA.count === 5, JSON.stringify(clsA));
  T('导入后自动切到该班级', await p.evaluate(() => window.__pyLab.className) === CLASS_A);
  const rowCount = await p.locator('#pyRosterTable tbody tr').count();
  T('名单表格 5 行', rowCount === 5, rowCount);
  const firstRow = await p.locator('#pyRosterTable tbody tr').first().innerText();
  T('学号/姓名/班级三列都解析对', firstRow.includes('20231001') && firstRow.includes('陈一'), firstRow.replace(/\s+/g, ' '));

  // ---------- 粘贴导入 ----------
  await p.fill('#pyClassInput', CLASS_B);
  await p.fill('#pyRosterText', '张三\n李四\n王五,备注忽略\n');
  await p.click('[data-act="importText"]');
  await p.waitForTimeout(900);
  const roster2 = await p.evaluate(() => window.__pyLab.roster);
  const clsB = roster2.classes.find(c => c.raw === '冒烟测试班');
  T('粘贴 3 行全部导入', clsB && clsB.count === 3, JSON.stringify(clsB));

  // 重复导入应跳过
  await p.fill('#pyClassInput', CLASS_A);
  await p.setInputFiles('#pyRosterFile', XLSX);
  await p.click('[data-act="importFile"]');
  await p.waitForTimeout(900);
  const roster3 = await p.evaluate(() => window.__pyLab.roster);
  T('同一份名单再导一次不重复', roster3.classes.find(c => c.raw === '计科2301').count === 5);

  await p.screenshot({ path: SHOTS + '/1-roster.png' });

  // ---------- 点名 + 考勤 ----------
  sec('① 点名与考勤');
  await p.selectOption('#pyClass', CLASS_A);
  await p.waitForTimeout(300);
  await p.click('[data-act="pick"]');
  await p.waitForFunction(() => {
    const n = document.getElementById('pyName');
    return n && n.textContent && n.textContent !== '准备上课' && n.textContent !== '名单是空的';
  }, null, { timeout: 10000 });
  const pickedName = await txt('#pyName');
  T('抽到一位学生', pickedName.length >= 1, pickedName);
  T('提示本轮剩余人数', /本轮剩余 \d+ \/ 5 人/.test(await txt('#pyMeta')), await txt('#pyMeta'));

  await p.click('[data-act="mark"][data-status="present"]');
  await p.waitForTimeout(800);
  await p.click('[data-act="attendance"]');
  await p.waitForTimeout(800);
  const att = await txt('#pyAttendance');
  T('考勤统计表出现该学生', att.includes(pickedName), att.split('\n')[0]);
  T('出勤率算出来了', /出勤率|100%/.test(att));

  await p.screenshot({ path: SHOTS + '/2-attendance.png' });

  // ---------- ② 课件库 ----------
  sec('② 课件库：分类 + 上传 + 转换');
  await p.click('.py-tab[data-tab="deck"]');
  await p.click('[data-deckview="lib"]');
  await p.waitForTimeout(500);
  const engine = await txt('#pyEngineInfo');
  T('显示可用转换引擎', /PowerPoint|LibreOffice/.test(engine), engine);

  await p.fill('#pyNewCat', '测试分类A');
  await p.click('[data-act="catAdd"]');
  await p.waitForTimeout(800);
  const catId = await p.evaluate(() => {
    const c = window.__pyLab.decks.categories.find(x => x.name === '测试分类A');
    return c ? c.id : null;
  });
  T('新建分类成功', catId !== null, catId);

  await p.setInputFiles('#pyDeckFile', PPTX);
  await p.fill('#pyDeckTitle', '测试课件-连锁酒店');
  await p.selectOption('#pyDeckCat', String(catId));
  await p.click('[data-act="upload"]');
  await p.waitForFunction(() => {
    const s = document.getElementById('pyUploadStatus');
    return s && /搞定|失败|✗/.test(s.textContent);
  }, null, { timeout: 120000 });
  const upStatus = await txt('#pyUploadStatus');
  T('PPT 上传并转换成功', upStatus.includes('搞定'), upStatus);

  // 上传状态先更新、列表后刷新（loadDecks 是异步的），这里要等列表真的到位再断言
  await p.waitForFunction(() => window.__pyLab.decks.decks
    .some(x => x.title === '测试课件-连锁酒店' && x.status === 'ready'), null, { timeout: 30000 })
    .catch(() => { });
  const deck = await p.evaluate(() => {
    const d = window.__pyLab.decks.decks.find(x => x.title === '测试课件-连锁酒店');
    return d || null;
  });
  T('课件进入列表且状态 ready', deck && deck.status === 'ready', deck && (deck.status + ' / ' + deck.pageCount + ' 页'));
  T('页数与转换引擎正确', deck && deck.pageCount > 5 && /powerpoint|libreoffice/.test(deck.engine),
    deck && (deck.pageCount + ' 页 / ' + deck.engine));
  T('分类归属正确', deck && deck.categoryName === '测试分类A', deck && deck.categoryName);

  await p.screenshot({ path: SHOTS + '/3-library.png' });

  // 分类筛选 + 改归属
  await p.selectOption('#pyFilterCat', String(catId));
  await p.waitForTimeout(400);
  T('按分类筛选只剩 1 份', (await p.locator('.py-deck').count()) === 1, await p.locator('.py-deck').count());
  await p.selectOption('#pyFilterCat', '');
  await p.waitForTimeout(300);

  const catCount = await p.locator('.py-cat').first().innerText();
  T('分类标签显示课件数', /1/.test(catCount), catCount.replace(/\s+/g, ' '));

  // ---------- 播放 ----------
  sec('③ 播放器：翻页 / 缩略图 / 全屏');
  await p.click('.py-deck [data-play]');
  await p.waitForTimeout(900);
  T('切到播放视图', await p.locator('#pyPlayView').isVisible());

  // 播放器有两种模式：有 PDF 的课件默认「矢量」（canvas 出图），否则「图片」（img 原图）。
  // 断言要认这两种活法，否则会因为 img 被 canvas 顶替而误判「没渲染」。
  const slideMode = await p.evaluate(() => {
    const on = document.querySelector('#pyModes .py-modebtn.on');
    return on ? on.getAttribute('data-slide-mode') : 'image';
  });
  const imgOk = await p.waitForFunction(() => {
    const img = document.getElementById('pySlideImg');
    const cv = document.getElementById('pySlideCanvas');
    if (cv && !cv.hidden) return cv.width > 100 && cv.getContext('2d').getImageData(0, 0, 8, 8).data.some(v => v > 0);
    return img && !img.hidden && img.naturalWidth > 100;
  }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  T('第 1 页真实渲染出来（' + (slideMode === 'vector' ? '矢量 canvas' : '图片 img') + '）', imgOk);
  T('有 PDF 的课件默认矢量模式', slideMode === 'vector', slideMode);
  T('页码显示 1 / N', /第 1 \/ \d+ 页/.test(await txt('#pyPageNo')), await txt('#pyPageNo'));

  await p.click('.py-slidebar [data-act="dnext"]');
  await p.waitForTimeout(500);
  T('下一页到第 2 页', /第 2 \/ \d+ 页/.test(await txt('#pyPageNo')), await txt('#pyPageNo'));

  await p.click('.py-thumbs img[data-thumb="5"]');
  await p.waitForTimeout(500);
  T('点缩略图跳到第 5 页', /第 5 \/ \d+ 页/.test(await txt('#pyPageNo')), await txt('#pyPageNo'));
  T('缩略图高亮跟随', (await p.locator('.py-thumbs img.on').getAttribute('data-thumb')) === '5');

  await p.click('.py-slidebar [data-act="dfirst"]');
  await p.waitForTimeout(400);

  // ---------- 页码挂片段 ----------
  sec('③ 页码挂代码片段 + 当场运行');
  await p.click('.py-thumbs img[data-thumb="2"]');
  await p.waitForTimeout(400);
  const snipOptions = await p.locator('#pyPageSnip option').count();
  T('片段下拉有可选项', snipOptions >= 2, snipOptions);

  const snipId = await p.locator('#pyPageSnip option').nth(1).getAttribute('value');
  await p.selectOption('#pyPageSnip', snipId);
  await p.click('[data-act="savePageSnip"]');
  await p.waitForTimeout(800);
  T('挂载提示更新', /已挂载|挂载/.test(await txt('#pyPageSnipInfo')), await txt('#pyPageSnipInfo'));

  const mapped = await p.evaluate(() => {
    const d = window.__pyLab.decks.decks.find(x => x.title === '测试课件-连锁酒店');
    return d && d.snippets ? d.snippets['2'] : null;
  });
  T('挂载关系落库并回读', mapped === snipId, mapped);

  await p.click('[data-act="runPage"]');
  await p.waitForFunction(() => {
    const o = document.getElementById('pyPageOut');
    return o && o.textContent && o.textContent !== '尚未运行' && o.textContent !== '运行中…';
  }, null, { timeout: 30000 });
  const codeTxt = await txt('#pyPageCode');
  const outTxt = await txt('#pyPageOut');
  T('源码显示出来', /import|print|def|for|=/.test(codeTxt), codeTxt.split('\n')[0]);
  T('Python 跑出输出', outTxt.length > 0, outTxt.split('\n')[0]);

  await p.screenshot({ path: SHOTS + '/4-player.png' });

  // ---------- 全屏 ----------
  await p.click('.py-slidebar [data-act="fs"]');
  await p.waitForTimeout(900);
  const fsOn = await p.evaluate(() => !!document.fullscreenElement);
  T('进入全屏', fsOn);
  if (fsOn) {
    await p.screenshot({ path: SHOTS + '/5-fullscreen.png' });
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(500);
    T('全屏下 → 键翻页', /第 3 \/ \d+ 页/.test(await txt('#pyPageNo')), await txt('#pyPageNo'));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(700);
    T('Esc 退出全屏', !(await p.evaluate(() => !!document.fullscreenElement)));
    const fsBtnText = await txt('.py-slidebar [data-act="fs"]');
    T('退出后按钮文案复位', fsBtnText.includes('全屏播放'), fsBtnText);
  }

  // ---------- 现有页面回归 ----------
  sec('回归：其它页面不受影响');
  let bad = 0;
  for (const [u, n] of [['/', '工作台'], ['/Schedule', '日程'], ['/Memo', '备忘'], ['/Admin/Users', '用户管理']]) {
    const r = await p.goto(BASE + u, { waitUntil: 'domcontentloaded' });
    if (!r || r.status() !== 200) bad++;
    T(n + ' HTTP 200', r && r.status() === 200, r && r.status());
  }

  // pjax 往返：从别的页面点侧栏回来，必须能重新初始化（脚本重跑）
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.click('.nav-item[href="/PyLab"]');
  await p.waitForURL('**/PyLab', { timeout: 10000 });
  const pjaxOk = await p.waitForFunction(() => window.__pyLab && window.__pyLab.decks
    && window.__pyLab.decks.decks.length >= 0 && document.getElementById('pyDeckSel'), null, { timeout: 20000 })
    .then(() => true).catch(() => false);
  T('pjax 从侧栏进入也能正常初始化', pjaxOk);

  // ---------- 清理 ----------
  sec('清理测试数据');
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
    const d = await fetch('/PyLab?handler=Decks').then(r => r.json());
    for (const deck of d.data.decks) if (/^测试课件/.test(deck.title)) await post('DeckDelete', { id: deck.id });
    for (const cat of d.data.categories) if (/^测试分类/.test(cat.name)) await post('CatDelete', { id: cat.id });
    await post('RosterClear', { className: '计科2301' });
    await post('RosterClear', { className: '冒烟测试班' });
  });
  const left = await p.evaluate(async () => {
    const r = await fetch('/PyLab?handler=Decks').then(x => x.json());
    const s = await fetch('/PyLab?handler=Roster').then(x => x.json());
    return { decks: r.data.decks.filter(d => /^测试课件/.test(d.title)).length, students: s.data.total };
  });
  T('测试课件已删除', left.decks === 0, left.decks);
  T('测试名单已清空', left.students === 0, left.students);

  T('全程无 JS 错误', jsErrs.length === 0, jsErrs.join(' | ').slice(0, 200));

  await b.close();
  const summary = { pass, fail, results, at: new Date().toISOString() };
  fs.writeFileSync('D:/projects/checkin/qa/report-pylab.json', JSON.stringify(summary, null, 2));
  console.log('\n══════════ 结果：' + pass + ' 通过 / ' + fail + ' 失败 ══════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃：', e); process.exit(2); });
