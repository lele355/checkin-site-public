// 四修复验证（2026-10-18 晚）：日历缓存版本号 / 图钉免刷新+FLIP / 置顶标 45° / 侧栏竞态
const QA = require('./_env');
const { chromium } = require('playwright');
const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  const ok = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (extra ? ' | ' + extra : ''));

  await page.goto(BASE + '/Login');
  await page.fill('input#Username, input[name="Username"]', QA.USER);
  await page.fill('input[type="password"]', QA.PASS);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');

  // 1) calendar.js 带版本号（缓存不再毒化）
  await page.goto(BASE + '/Schedule?view=calendar');
  await page.waitForTimeout(600);
  let st = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll('script[src]')).map(x => x.src).filter(x => /calendar\.js/.test(x));
    return { src: s[0] || '', cells: document.querySelectorAll('.cal-cell').length };
  });
  ok('1a calendar.js 带 ?v= 版本号', /calendar\.js\?v=/.test(st.src), st.src);
  ok('1b 日历直接进渲染', st.cells >= 28, 'cells=' + st.cells);

  // 1c) pjax 进日历也渲染
  await page.goto(BASE + '/Schedule?view=list');
  await page.waitForTimeout(400);
  await page.locator('.vs-btn', { hasText: '日历' }).first().click({ force: true });
  await page.waitForTimeout(1000);
  st = await page.evaluate(() => ({ cells: document.querySelectorAll('.cal-cell').length, agenda: (document.getElementById('calAgenda') || {}).innerHTML.length > 50 }));
  ok('1c pjax 视图切换进日历渲染', st.cells >= 28 && st.agenda, 'cells=' + st.cells);

  // 2) 工作台图钉：免刷新 + FLIP 动画存在
  await page.goto(BASE + '/');
  await page.waitForTimeout(600);
  // 先保证有一个未置顶的卡片可点（取消现有置顶再点）
  await page.evaluate(() => { window.__qaMark = 7; });
  const anyPin = page.locator('.card-pin').first();
  const pid = await anyPin.getAttribute('data-pin');
  await anyPin.click({ force: true });
  await page.waitForTimeout(300);
  const flipCount = await page.evaluate(() => document.getAnimations().length);
  await page.waitForTimeout(900);
  st = await page.evaluate(() => ({
    mark: window.__qaMark || 0,
    first: (document.querySelector('#dashGrid [data-card]') || {}).dataset ? document.querySelector('#dashGrid [data-card]').dataset.card : null,
    anims: document.getAnimations().filter(a => a.playState === 'running').length
  }));
  ok('2a 图钉点击不整页刷新', st.mark === 7, 'mark=' + st.mark);
  ok('2b 重排走 FLIP 动画', flipCount > 0, 'animInFlight=' + flipCount);

  // 3) 置顶标识：加粗 + 倾斜 45°（先保证有一个置顶态）
  await page.evaluate(() => {
    const b = document.querySelector('.card-pin.on') || document.querySelector('.card-pin');
    if (b && !b.classList.contains('on')) b.click();
  });
  await page.waitForTimeout(800);
  st = await page.evaluate(() => {
    const on = document.querySelector('.card-pin.on svg');
    if (!on) return null;
    const cs = getComputedStyle(on);
    return { t: cs.transform, sw: cs.strokeWidth };
  });
  const rot = st && st.t && st.t !== 'none' ? parseFloat(st.t.split('(')[1].split(',')[0]) : 0;
  // rotate(-45°)×scale(1.12) → cos45°×1.12 ≈ 0.792；加粗看 stroke-width ≥ 2.5
  ok('3 置顶标 45°+加粗', !!st && Math.abs(rot - 0.792) < 0.06 && parseFloat(st.sw) >= 2.5, JSON.stringify(st));
  await page.screenshot({ path: OUT + '/fix_pin_style.png' });

  // 4) 侧栏连点竞态：快速连点两个栏目，最终只亮一个且与 URL 一致
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('.sidebar .nav-item'));
      const memo = links.find(a => a.getAttribute('href') === '/Memo');
      const sch = links.find(a => a.getAttribute('href') === '/Schedule');
      if (memo && sch) { memo.click(); sch.click(); }   // 不留间隔，制造响应乱序
    });
    await page.waitForTimeout(1200);
    st = await page.evaluate(() => {
      const act = Array.from(document.querySelectorAll('.sidebar .nav-item.active')).map(a => a.getAttribute('href'));
      return { act, path: location.pathname };
    });
    const expect = st.path.toLowerCase();
    const match = st.act.length === 1 && st.act[0].toLowerCase() === expect;
    ok('4 连点竞态第' + (round + 1) + '轮只亮当前栏目', match, JSON.stringify(st));
  }
  await page.screenshot({ path: OUT + '/fix_nav_race.png' });

  // 4b) 用户事故链回归：/Schedule?view=calendar → 点备忘 → 点日程
  //     旧 bug：page:load 早于 pushState → 视图记忆串页 → /Memo?view=calendar + 点日程被顶掉 + 双下划线
  await page.goto(BASE + '/Schedule?view=calendar');
  await page.waitForTimeout(500);
  await page.locator('.sidebar .nav-item', { hasText: '备忘' }).first().click({ force: true });
  await page.waitForTimeout(1000);
  st = await page.evaluate(() => ({
    url: location.pathname + location.search,
    act: Array.from(document.querySelectorAll('.sidebar .nav-item.active')).map(a => a.getAttribute('href')),
    isMemo: !!document.querySelector('.memo-row, .view-switch')
  }));
  ok('4b1 点备忘落在纯 /Memo（不带日程视图参数）', st.url === '/Memo' && st.act.length === 1 && st.act[0] === '/Memo', JSON.stringify(st));

  await page.mouse.move(2, 2);   // 挪开鼠标，排除 hover 干扰
  await page.locator('.sidebar .nav-item', { hasText: '日程' }).first().click({ force: true });
  await page.waitForTimeout(1200);
  st = await page.evaluate(() => {
    const underlined = Array.from(document.querySelectorAll('.sidebar .nav-item')).filter(a => {
      const t = getComputedStyle(a.querySelector('.label'), '::after').transform;
      return t && t !== 'none' && t !== 'matrix(0, 0, 0, 1, 0, 0)';
    }).map(a => a.getAttribute('href'));
    return {
      url: location.pathname + location.search,
      act: Array.from(document.querySelectorAll('.sidebar .nav-item.active')).map(a => a.getAttribute('href')),
      cells: document.querySelectorAll('#calGrid .cal-cell').length,
      underlined
    };
  });
  ok('4b2 点日程真的跳到日程日历', st.url.indexOf('/Schedule') === 0 && st.cells >= 28, JSON.stringify(st));
  ok('4b3 只亮一个栏目（无双下划线）', st.underlined.length === 1 && st.act.length === 1, JSON.stringify(st.underlined));

  // 5) 手机端日历渲染
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const mp = await mctx.newPage();
  await mp.goto(BASE + '/Login');
  await mp.fill('input#Username, input[name="Username"]', QA.USER);
  await mp.fill('input[type="password"]', QA.PASS);
  await mp.click('button[type="submit"]');
  await mp.waitForLoadState('networkidle');
  await mp.goto(BASE + '/Schedule?view=calendar');
  await mp.waitForTimeout(800);
  st = await mp.evaluate(() => ({
    cells: document.querySelectorAll('#calGrid .cal-cell').length,
    vis: (document.getElementById('calGrid') || {}).offsetHeight || 0,
    agenda: (document.getElementById('calAgenda') || {}).innerHTML.length > 50
  }));
  ok('5 手机端日历渲染', st.cells >= 28 && st.vis > 100 && st.agenda, JSON.stringify(st));
  await mp.screenshot({ path: OUT + '/fix_mobile_cal.png', fullPage: true });

  console.log('--- errors ---');
  errs.slice(0, 10).forEach(e => console.log(e));
  await browser.close();
})();
