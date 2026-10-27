// PC 侧栏测试：独立滚动 / 收起展开 / 偏好持久化 / 手机不受影响 + 截图
// 用法: NODE_PATH=... node qa_sidebar.js
const QA = require('./_env');
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';
const results = [];
function check(name, ok, extra = '') { results.push({ name, ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : '')); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });

  // ============ PC 1280x800 ============
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/Login');
  await page.fill('#Username', QA.USER);
  await page.fill('#Password', QA.PASS);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(800);

  // 0. 侧栏开关按钮存在且可见（PC）
  const btnVisible = await page.locator('.sidebar-toggle').isVisible();
  check('PC 侧栏开关按钮可见', btnVisible);

  // 1. 侧栏展开态几何（1280=桌面档，宽度 var(--sidebar-w)=224px 宽栏；768-1023 平板档才是 72px 窄图标栏）
  let g = await page.evaluate(() => {
    const s = document.querySelector('.sidebar').getBoundingClientRect();
    return { w: Math.round(s.width), h: Math.round(s.height) };
  });
  check('PC 侧栏展开宽度 224px(桌面档)', g.w === 224, `w=${g.w}`);

  // 2. 滚动分离：内容区滚动时侧栏不动
  //    找一个内容够长的页面（工作台 -> 统计 -> 备忘依次找）
  let longPage = null;
  for (const p of ['/', '/Statistics', '/Memo?view=list', '/Schedule?view=list']) {
    await page.goto(BASE + p);
    await page.waitForLoadState('networkidle');
    const scrollable = await page.evaluate(() => {
      const c = document.querySelector('.content');
      return c.scrollHeight > c.clientHeight + 20;
    });
    if (scrollable) { longPage = p; break; }
  }
  check('存在可滚动内容页', !!longPage, `page=${longPage || 'none'}`);

  if (longPage) {
    const before = await page.evaluate(() => {
      const c = document.querySelector('.content'), s = document.querySelector('.sidebar');
      return { cTop: c.scrollTop, sTop: s.scrollTop, win: window.scrollY };
    });
    await page.mouse.move(700, 500);            // 主内容区
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const c = document.querySelector('.content'), s = document.querySelector('.sidebar');
      return { cTop: c.scrollTop, sTop: s.scrollTop, win: window.scrollY };
    });
    check('内容区滚动生效', after.cTop > before.cTop + 50, `content ${before.cTop}->${after.cTop}`);
    check('内容滚动时侧栏不动', after.sTop === before.sTop, `sidebar ${before.sTop}->${after.sTop}`);
    check('窗口本体不滚动(应用式)', after.win === 0, `window.scrollY=${after.win}`);

    // 侧栏自身滚动（若菜单高度溢出）
    const sScrollable = await page.evaluate(() => {
      const s = document.querySelector('.sidebar');
      return s.scrollHeight > s.clientHeight;
    });
    if (sScrollable) {
      await page.mouse.move(36, 500);           // 侧栏区
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
      const s2 = await page.evaluate(() => document.querySelector('.sidebar').scrollTop);
      const c2 = await page.evaluate(() => document.querySelector('.content').scrollTop);
      check('侧栏自身可独立滚动', s2 > 0, `sidebar.scrollTop=${s2}`);
      check('侧栏滚动不带动内容区', c2 === after.cTop, `content=${c2}`);
    } else {
      check('侧栏自身可独立滚动', true, '菜单未溢出跳过');
      check('侧栏滚动不带动内容区', true, '菜单未溢出跳过');
    }
  }

  // 3. 收起侧栏
  await page.click('.sidebar-toggle');
  await page.waitForTimeout(900);   // 等宽过渡完（--dur 最大 .5s + 弹性缓动长尾）
  g = await page.evaluate(() => {
    const s = document.querySelector('.sidebar').getBoundingClientRect();
    const c = document.querySelector('.content').getBoundingClientRect();
    return { sw: Math.round(s.width), cw: Math.round(c.width), ds: document.documentElement.dataset.sidebar || '' };
  });
  check('收起后侧栏宽度为 0', g.sw === 0, `sidebar w=${g.sw}`);
  check('收起后内容区变宽', g.cw > 1000, `content w=${g.cw}`);
  check('收起状态标记 data-sidebar=hidden', g.ds === 'hidden', `data-sidebar=${g.ds || '(空)'}`);
  const ls1 = await page.evaluate(() => localStorage.getItem('layout.sidebar'));
  check('收起偏好写入 localStorage', ls1 === 'hidden', `layout.sidebar=${ls1}`);
  await page.screenshot({ path: `${OUT}/sidebar-collapsed.png` });

  // 4. 刷新后仍收起（防闪恢复）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const afterReload = await page.evaluate(() => {
    const s = document.querySelector('.sidebar').getBoundingClientRect();
    return { sw: Math.round(s.width), ds: document.documentElement.dataset.sidebar || '' };
  });
  check('刷新后保持收起', afterReload.sw === 0 && afterReload.ds === 'hidden', `w=${afterReload.sw} ds=${afterReload.ds || '(空)'}`);

  // 5. 再点展开
  await page.click('.sidebar-toggle');
  await page.waitForTimeout(900);   // 等宽过渡完（--dur 最大 .5s + 弹性缓动长尾）
  g = await page.evaluate(() => {
    const s = document.querySelector('.sidebar').getBoundingClientRect();
    return { sw: Math.round(s.width), ds: document.documentElement.dataset.sidebar || '', ls: localStorage.getItem('layout.sidebar') };
  });
  check('展开后侧栏恢复 224px', g.sw === 224, `w=${g.sw}`);
  check('展开偏好写入 localStorage', g.ls === 'shown', `layout.sidebar=${g.ls}`);
  await page.screenshot({ path: `${OUT}/sidebar-expanded.png` });

  await ctx.close();

  // ============ 手机 390x844 不受影响 ============
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mpage = await mctx.newPage();
  await mpage.goto(BASE + '/Login');
  await mpage.fill('#Username', QA.USER);
  await mpage.fill('#Password', QA.PASS);
  await mpage.click('#loginForm button[type="submit"]');
  await mpage.waitForTimeout(800);
  const mToggleVisible = await mpage.locator('.sidebar-toggle').isVisible();
  check('手机不显示侧栏开关', !mToggleVisible);
  const mDrawerBtn = await mpage.locator('.hamburger').isVisible();
  check('手机汉堡照常可用', mDrawerBtn);
  await mpage.click('.hamburger');
  await mpage.waitForTimeout(300);
  const drawerOpen = await mpage.evaluate(() => document.body.classList.contains('drawer-open') &&
    getComputedStyle(document.querySelector('.sidebar')).display === 'flex');
  check('手机抽屉正常打开', drawerOpen);
  await mctx.close();

  await browser.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\n== 侧栏测试: ${pass} PASS / ${fail} FAIL ==`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
