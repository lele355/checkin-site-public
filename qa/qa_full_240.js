// 2.4.x 全流程回归（网页端）—— 页面可达性 + 学期功能 API + 留言时间 + UI 一致性
//
// 说明：页面级只做「能不能打开 / 有没有溢出 / 关键元素在不在」（稳定、可长期跑）；
// 写操作走同一会话的 fetch，避免脆弱的表单交互（页面上有自绘选择器，模拟点击很脆）。
//
// 跑法：NODE_PATH=... node qa/qa_full_240.js

const { chromium } = require('playwright');
const fs = require('fs');

const { USER, PASS } = require('./_env');
const BASE = process.env.QA_BASE || process.env.BASE || 'http://127.0.0.1:5188';
const OUT = process.env.OUT || 'D:/checkin-work/tmp/qa240';
const TAG = 'QA240';

const issues = [];
const bad = (area, msg) => { issues.push({ area, msg }); console.log(`  x [${area}] ${msg}`); };
const ok = (area, msg) => console.log(`  v [${area}] ${msg}`);

async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('input[name="Username"]', USER);
  await p.fill('input[name="Password"]', PASS);
  await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), p.click('button[type="submit"]')]);
  return p;
}

async function overX(page) {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await login(ctx);

  // ---- 1. 关键页面可达性 ----
  const pages = [
    ['/', '工作台'], ['/Schedule', '日程'], ['/Memo', '备忘'], ['/Habits', '打卡'],
    ['/Courses', '课程表'], ['/Courses/Settings', '课表设置'], ['/Courses/Semesters', '学期管理'],
    ['/Expenses', '记账'], ['/Anniversaries', '纪念日'], ['/Board', '留言板'],
    ['/Me', '我的'], ['/Stats', '统计'], ['/Reminders', '提醒'],
  ];
  for (const [path, label] of pages) {
    let res = null;
    try { res = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' }); }
    catch (e) { bad(label, '导航失败：' + String(e.message).split('\n')[0]); continue; }
    const url = page.url();
    if (!res || res.status() >= 400) { bad(label, `打不开（${res && res.status()}）`); continue; }
    if (url.toLowerCase().includes('login')) { bad(label, '被重定向到登录页（会话失效）'); continue; }
    const over = await overX(page);
    if (over > 2) bad(label, `横向溢出 ${over}px`);
    else ok(label, '可打开 / 无溢出');
    await page.screenshot({ path: `${OUT}/page-${path.replace(/[^a-z]/gi, '') || 'home'}.png` });
  }

  // ---- 2. 学期功能（同会话 fetch）----
  const api = (method, path, body) => page.evaluate(async ([m, p, b]) => {
    const r = await fetch(p, {
      method: m,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let j = null; try { j = await r.json(); } catch (e) { }
    return { status: r.status, json: j };
  }, [method, BASE + '/api/v1' + path, body]);

  const r0 = await api('GET', '/courses/semesters');
  if (!r0.json || !r0.json.ok) bad('学期 API', '列表接口异常');
  else {
    const before = r0.json.data.items.length;
    ok('学期 API', `列表 ${before} 个，当前 id=${r0.json.data.currentId}`);

    const created = await api('POST', '/courses/semesters', { name: TAG + ' 学期', startDate: '2026-03-02' });
    if (!created.json || !created.json.ok) bad('学期 API', '新建失败 ' + JSON.stringify(created.json));
    else {
      const newId = created.json.data.id;
      ok('学期 API', `新建 id=${newId}（${created.json.data.name} / ${created.json.data.startDate}）`);

      const list1 = await api('GET', '/courses/semesters');
      const cur = list1.json.data.items.find(x => x.isCurrent);
      if (!cur || cur.id !== newId) bad('学期 API', `新建后当前学期没切过去（当前 ${cur && cur.name}）`);
      else ok('学期 API', '新建后自动切为当前');

      const c1 = await api('GET', '/courses');
      if (c1.json.data.items.length !== 0) bad('学期隔离', `新学期课表还有 ${c1.json.data.items.length} 门课`);
      else ok('学期隔离', '新学期课表为空');

      const orig = list1.json.data.items.find(x => !x.isCurrent);
      if (orig) {
        await api('POST', `/courses/semesters/${orig.id}/switch`);
        const c2 = await api('GET', '/courses');
        if (c2.json.data.items.length === 0) bad('学期切换', '切回原学期后课程为空');
        else ok('学期切换', `切回「${orig.name}」，${c2.json.data.items.length} 门课`);

        const del = await api('DELETE', `/courses/semesters/${newId}`);
        if (!del.json || !del.json.ok) bad('学期 API', '删除失败');
        else {
          const list2 = await api('GET', '/courses/semesters');
          if (list2.json.data.items.length !== before) bad('学期 API', `删除后剩 ${list2.json.data.items.length}，预期 ${before}`);
          else ok('学期 API', '删除成功，数量复位');
          const cur2 = list2.json.data.items.find(x => x.isCurrent);
          if (!cur2) bad('学期 API', '删除后没有当前学期了');
          else ok('学期 API', `删除后当前仍是「${cur2.name}」`);
        }
      } else bad('学期 API', '找不到原学期，无法测切换');
    }
  }

  // ---- 3. 留言时间 ----
  const stamp = new Date();
  await api('POST', '/board', { content: `${TAG} 时间校验` });
  const bd = await api('GET', '/board');
  const first = bd.json && bd.json.data && bd.json.data.items && bd.json.data.items[0];
  if (!first) bad('留言板', '发完读不到最新留言');
  else {
    const shown = new Date(first.createdAt.replace('T', ' '));
    const diff = Math.abs(stamp - shown) / 60000;
    if (diff > 3) bad('留言板', `时间偏差 ${diff.toFixed(0)} 分钟（API 返回 ${first.createdAt}）`);
    else ok('留言板', `时间正确（偏差 ${diff.toFixed(0)} 分钟）`);
    await api('DELETE', '/board/' + first.id);
  }

  // ---- 4. UI 一致性：三视口 ----
  let shots = 0;
  for (const [w, h, tag] of [[390, 844, 'mobile'], [820, 1180, 'tablet'], [1440, 900, 'desktop']]) {
    const c2 = await browser.newContext({ viewport: { width: w, height: h } });
    const p2 = await login(c2);
    for (const [path, label] of [['/', '工作台'], ['/Courses', '课程表'], ['/Memo', '备忘'], ['/Expenses', '记账'], ['/Courses/Semesters', '学期管理']]) {
      await p2.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      const over = await overX(p2);
      if (over > 2) bad(`${label}@${tag}`, `横向溢出 ${over}px`);
      // 只算「可见」按钮：隐藏的（display:none / 零尺寸）高度是 0，
      // 混进来会让「高度不一致」变成误报 —— 第一轮就是这么误报的 9 条。
      const hs = await p2.evaluate(() => Array.from(document.querySelectorAll('.btn'))
        .map(b => b.getBoundingClientRect())
        .filter(r => r.height > 4 && r.width > 4)
        .slice(0, 4)
        .map(r => Math.round(r.height)));
      if (hs.length >= 2 && Math.max(...hs) - Math.min(...hs) > 8) bad(`${label}@${tag}`, `同页按钮高度不一致 ${hs.join('/')}`);
      await p2.screenshot({ path: `${OUT}/ui-${tag}-${path.replace(/[^a-z]/gi, '') || 'home'}.png` });
      shots++;
    }
    await c2.close();
  }
  ok('UI 一致性', `三视口 x 5 页截图 ${shots} 张`);

  await browser.close();
  fs.writeFileSync(OUT + '/result.json', JSON.stringify({ issues }, null, 2));
  console.log('\n=== 结果 ===');
  console.log(issues.length === 0 ? '全部通过' : `问题 ${issues.length} 个`);
  process.exit(issues.length ? 1 : 0);
})();
