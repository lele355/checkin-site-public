// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 全站 UI 审计：所有页面截图（桌面/手机 × 暗/亮）+ 自动检查横向溢出/JS 错误
// 产物：D:/projects/checkin/_shots/audit/*.png + audit-report.json
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots/audit';
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['home', '/'],
  ['schedule', '/Schedule'],
  ['schedule_cal', '/Schedule?view=calendar'],
  ['memo', '/Memo'],
  ['email', '/Email'],
  ['ai', '/Ai'],
  ['habits', '/Habits'],
  ['courses', '/Courses'],
  ['anniversaries', '/Anniversaries'],
  ['couples', '/Couples'],
  ['board', '/Board'],
  ['expenses', '/Expenses'],
  ['period', '/Period'],
  ['reminders', '/Reminders'],
  ['stats', '/Stats'],
  ['export', '/Export'],
  ['me', '/Me'],
  ['admin_users', '/Admin/Users'],
  ['admin_roles', '/Admin/Roles'],
];

const THEMES = ['editorial', 'neumorphism', 'natural', 'macos', 'clay'];

const report = [];

async function login(page) {
  await page.goto(BASE + '/Login');
  await page.fill('#Username', ADMIN);
  await page.fill('#Password', PW);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.toLowerCase().includes('login'), { timeout: 10000 });
}

async function probe(page) {
  return await page.evaluate(() => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth - de.clientWidth;
    // 找出超宽的具体元素（排除横向滚动容器内部）
    const wide = [];
    document.querySelectorAll('main.content *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 2 && r.width > 30) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed') return;
        let p = el.parentElement, inScroller = false;
        while (p) { const s = getComputedStyle(p); if (s.overflowX === 'auto' || s.overflowX === 'scroll') { inScroller = true; break; } p = p.parentElement; }
        if (inScroller) return;
        wide.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' w=' + Math.round(r.width));
      }
    });
    // 极小字号（<10px 的可读性隐患）
    const tiny = [];
    document.querySelectorAll('main.content span, main.content div, main.content small, main.content td').forEach(el => {
      if (!el.textContent.trim() || el.children.length) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > 0 && fs < 10) tiny.push(Math.round(fs) + 'px:' + el.textContent.trim().slice(0, 12));
    });
    return { overflowX, wide: wide.slice(0, 6), tiny: tiny.slice(0, 6), title: document.title };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });

  // ---------- 桌面：所有页面（当前用户主题） ----------
  const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const pd = await ctxD.newPage();
  const errsD = [];
  pd.on('pageerror', e => errsD.push(e.message));
  await login(pd);
  for (const [name, url] of PAGES) {
    await pd.goto(BASE + url);
    await pd.waitForTimeout(350);
    const info = await probe(pd);
    report.push({ view: 'desktop', page: name, url, ...info, errors: errsD.splice(0) });
    await pd.screenshot({ path: `${OUT}/d_${name}.png` });
  }

  // ---------- 桌面：5 套主题的工作台 ----------
  for (const t of THEMES) {
    await pd.evaluate(theme => { document.documentElement.dataset.theme = theme; }, t);
    await pd.goto(BASE + '/');
    await pd.evaluate(theme => { document.documentElement.dataset.theme = theme; }, t);
    await pd.waitForTimeout(300);
    await pd.screenshot({ path: `${OUT}/theme_${t}.png` });
  }
  await pd.evaluate(() => { document.documentElement.dataset.theme = 'macos'; });

  // ---------- 手机：关键页面 ----------
  const ctxM = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  const pm = await ctxM.newPage();
  const errsM = [];
  pm.on('pageerror', e => errsM.push(e.message));
  await login(pm);
  for (const [name, url] of PAGES) {
    await pm.goto(BASE + url);
    await pm.waitForTimeout(350);
    const info = await probe(pm);
    report.push({ view: 'mobile', page: name, url, ...info, errors: errsM.splice(0) });
    await pm.screenshot({ path: `${OUT}/m_${name}.png` });
  }

  fs.writeFileSync(OUT + '/audit-report.json', JSON.stringify(report, null, 1));
  const bad = report.filter(r => r.overflowX > 1 || r.wide.length || r.errors.length);
  console.log('pages=' + report.length + '  problems=' + bad.length);
  bad.forEach(r => console.log(`${r.view}/${r.page}: overflowX=${r.overflowX} wide=${JSON.stringify(r.wide)} err=${JSON.stringify(r.errors)}`));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
