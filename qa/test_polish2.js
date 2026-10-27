// 第二批 UI 优化验证：课表定宽横滑+节次列吸左 / 图表标签对比度 / 单行输入条 / 行内表单按钮独占行
const QA = require('./_env');
const { chromium } = require('playwright');
const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';
let pass = 0, fail = 0;
function T(name, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  ok ? pass++ : fail++;
}
async function login(page) {
  await page.goto(BASE + '/Login');
  await page.fill('#Username', QA.USER);
  await page.fill('#Password', QA.PASS);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.toLowerCase().includes('login'), { timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });

  // ================= 手机 =================
  const ctxM = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    reducedMotion: 'reduce',
  });
  const pm = await ctxM.newPage();
  const jsErr = [];
  pm.on('pageerror', e => jsErr.push(e.message));
  await login(pm);

  // --- 课表：定宽列横滑 + 节次列吸左 ---
  await pm.goto(BASE + '/Courses');
  await pm.waitForSelector('.ttm-scroll');
  const tt = await pm.evaluate(() => {
    const sc = document.querySelector('.ttm-scroll');
    const gut = document.querySelector('.ttm-gutter');
    const col = document.querySelector('.ttm-day');
    return {
      scrollable: sc.scrollWidth - sc.clientWidth,
      colW: Math.round(col.getBoundingClientRect().width),
      gutBefore: Math.round(gut.getBoundingClientRect().left),
    };
  });
  T('课表日期列加宽到可读（≥72px）', tt.colW >= 72, tt.colW + 'px');
  T('课表可横向滑动看完整一周', tt.scrollable > 60, 'overflow=' + tt.scrollable);
  await pm.evaluate(() => { document.querySelector('.ttm-scroll').scrollLeft = 160; });
  await pm.waitForTimeout(250);
  const tt2 = await pm.evaluate(() => {
    const sc = document.querySelector('.ttm-scroll');
    const gut = document.querySelector('.ttm-gutter');
    const corner = document.querySelector('.ttm-corner');
    return {
      scLeft: Math.round(sc.getBoundingClientRect().left),
      gutLeft: Math.round(gut.getBoundingClientRect().left),
      cornerLeft: Math.round(corner.getBoundingClientRect().left),
      scrollLeft: Math.round(sc.scrollLeft),
    };
  });
  T('横滑后节次列吸左不动', tt2.scrollLeft > 100 && Math.abs(tt2.gutLeft - tt2.scLeft) <= 2,
    JSON.stringify(tt2));
  T('横滑后表头节次格同步吸左', Math.abs(tt2.cornerLeft - tt2.scLeft) <= 2, tt2.cornerLeft + ' vs ' + tt2.scLeft);
  const overflowTT = await pm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  T('课表页无整页横向溢出', overflowTT <= 1, 'overflowX=' + overflowTT);
  await pm.evaluate(() => { document.querySelector('.ttm-scroll').scrollLeft = 0; });
  await pm.screenshot({ path: OUT + '/p2_courses_m.png', fullPage: false });

  // --- 统计：标签不再是 --text-weak ---
  await pm.goto(BASE + '/Stats');
  await pm.waitForTimeout(300);
  const lbl = await pm.evaluate(() => {
    const el = document.querySelector('.bar-label');
    const val = document.querySelector('.bar-val');
    return {
      color: getComputedStyle(el).color,
      weight: getComputedStyle(el).fontWeight,
      size: getComputedStyle(el).fontSize,
      valColor: getComputedStyle(val).color,
    };
  });
  T('排行榜习惯名加粗加深', lbl.weight === '600' && /rgb\(2[0-9], 2[0-9], 2[0-9]\)|rgb\(1[0-9], 1[0-9], 1[0-9]\)/.test(lbl.color),
    JSON.stringify(lbl));
  T('排行榜数值用次级色', lbl.valColor !== lbl.color, lbl.valColor);
  await pm.screenshot({ path: OUT + '/p2_stats_m.png' });

  // --- 记账：分类条标签 ---
  await pm.goto(BASE + '/Expenses');
  await pm.waitForTimeout(300);
  const cap = await pm.evaluate(() => {
    const c = document.querySelector('.bar-caption');
    const l = document.querySelector('.bar-label');
    return { cap: !!c, capText: c && c.textContent.trim(), labelW: l && getComputedStyle(l).fontWeight };
  });
  T('记账分类条与统计页同一套排版', cap.cap && cap.labelW === '600', JSON.stringify(cap));
  await pm.screenshot({ path: OUT + '/p2_expenses_m.png' });

  // --- 经期：备注字段旁的保存键独占一行 ---
  await pm.goto(BASE + '/Period');
  await pm.waitForTimeout(300);
  const btn = await pm.evaluate(() => {
    const b = [...document.querySelectorAll('form .btn')].find(x => x.textContent.includes('保存'));
    const noteField = [...document.querySelectorAll('.field')].find(f => f.textContent.includes('备注'));
    const br = b.getBoundingClientRect(), nr = noteField.getBoundingClientRect();
    return {
      w: Math.round(br.width), formW: Math.round(b.parentElement.getBoundingClientRect().width),
      top: Math.round(br.top), noteBottom: Math.round(nr.bottom),
    };
  });
  T('经期保存键手机独占一行', Math.abs(btn.w - btn.formW) <= 2 && btn.top >= btn.noteBottom,
    JSON.stringify(btn));
  await pm.screenshot({ path: OUT + '/p2_period_m.png' });

  // --- 留言板 / 情侣小纸条：输入框套皮肤 ---
  await pm.goto(BASE + '/Board');
  await pm.waitForTimeout(300);
  const bd = await pm.evaluate(() => {
    const i = document.querySelector('.inline-form > input');
    const cs = getComputedStyle(i);
    return {
      h: Math.round(i.getBoundingClientRect().height),
      bw: parseFloat(cs.borderTopWidth), bg: cs.backgroundColor, fs: cs.fontSize,
      // 和 .field input 完全同一套皮肤（editorial 主题圆角为 0，故不比 border-radius）
      skin: cs.backgroundColor === getComputedStyle(document.querySelector('.field input') || i).backgroundColor,
    };
  });
  T('留言输入框套上统一皮肤（描边+底色）', bd.h <= 40 && bd.bw >= 1 && bd.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(bd));
  await pm.screenshot({ path: OUT + '/p2_board_m.png' });

  await pm.goto(BASE + '/Couples');
  await pm.waitForTimeout(300);
  const cp = await pm.evaluate(() => {
    const i = document.querySelector('.inline-form > input');
    const cs = getComputedStyle(i);
    const btnH = Math.round(document.querySelector('.inline-form .btn').getBoundingClientRect().height);
    return { h: Math.round(i.getBoundingClientRect().height), btnH, radius: cs.borderRadius };
  });
  T('小纸条输入框与按钮同高', Math.abs(cp.h - cp.btnH) <= 2, JSON.stringify(cp));
  await pm.screenshot({ path: OUT + '/p2_couples_m.png' });

  T('手机各页无 JS 报错', jsErr.length === 0, jsErr.join(' | '));

  // ================= 桌面 =================
  const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const pd = await ctxD.newPage();
  await login(pd);
  await pd.goto(BASE + '/Stats');
  await pd.waitForTimeout(300);
  await pd.screenshot({ path: OUT + '/p2_stats_d.png' });
  await pd.goto(BASE + '/Couples');
  await pd.waitForTimeout(300);
  await pd.screenshot({ path: OUT + '/p2_couples_d.png' });
  await pd.goto(BASE + '/Expenses');
  await pd.waitForTimeout(300);
  await pd.screenshot({ path: OUT + '/p2_expenses_d.png' });

  console.log('===== 结果: ' + pass + '/' + (pass + fail) + ' 通过 =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
