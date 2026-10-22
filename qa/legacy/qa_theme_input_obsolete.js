// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 专项：分类内联输入框（新建/改名分类、文件改名）在 5 主题 × 各底色 下「字必须看得见」
// 回归背景：editorial 的 accent 与 --text 都是 #1C1C1C，输入框透明底透出黑 accent，黑底黑字看不见。
// 本地：node qa_theme_input.js   线上：QA_BASE=https://example.com QA_PASS=xxx node qa_theme_input.js
// 判据：输入框实际底色（含透明透底）与字色的对比度 ≥ 4.5
const { chromium } = require('playwright');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const PASS = process.env.QA_PASS || PW;

const COMBOS = [
  ['editorial', ''], ['editorial', 'mist'], ['editorial', 'wheat'],
  ['neumorphism', ''], ['neumorphism', 'rose'],
  ['natural', ''], ['natural', 'clay'],
  ['macos', ''], ['macos', 'midnight'],
  ['clay', ''], ['clay', 'mint'], ['clay', 'lemon']
];
const DEF_ACCENT = { editorial: '', neumorphism: 'violet', natural: '', macos: 'blue', clay: 'pink' };

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })).newPage();
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', ADMIN);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 }).catch(() => {});
  await p.click('.py-navbtn[data-view="files"]');
  await p.click('.py-subtab[data-sub="code"]');
  await p.waitForTimeout(500);

  let fail = 0;
  for (const [theme, tone] of COMBOS) {
    await p.evaluate(([t, tn, ac]) => {
      const r = document.documentElement;
      r.dataset.theme = t; r.dataset.accent = ac;
      if (tn) r.dataset.tone = tn; else delete r.dataset.tone;
    }, [theme, tone, DEF_ACCENT[theme] || '']);
    // 确保输入框开着
    await p.evaluate(() => {
      if (!document.querySelector('[data-fm-cat-input]')) {
        const el = document.querySelector('[data-fm-cat-new]');
        if (el) el.click();
      }
    });
    await p.waitForTimeout(150);
    await p.fill('[data-fm-cat-input]', '第一章 基础语法');
    await p.waitForTimeout(150);
    const r = await p.evaluate(() => {
      const inp = document.querySelector('[data-fm-cat-input]');
      const cs = getComputedStyle(inp);
      // 透明就往上找实际打底色
      let el = inp, bg = cs.backgroundColor;
      while ((bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && el.parentElement) {
        el = el.parentElement; bg = getComputedStyle(el).backgroundColor;
      }
      const lum = c => {
        const m = c.match(/[\d.]+/g).map(Number);
        const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
        return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]);
      };
      const l1 = lum(cs.color), l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
      return { color: cs.color, bg, ratio: Math.round(ratio * 100) / 100 };
    });
    const ok = r.ratio >= 4.5;
    if (!ok) fail++;
    console.log((ok ? 'PASS ' : 'FAIL ') + theme + '/' + (tone || '默认') +
      ' 字:' + r.color + ' 底:' + r.bg + ' 对比度:' + r.ratio);
    if (process.env.QA_SHOTS) {
      const box = await p.locator('#pyFmTree').boundingBox();
      await p.screenshot({ path: 'shots/theme_input_' + theme + '_' + (tone || 'def') + '.png', clip: box });
    }
  }
  console.log(fail ? ('✗ ' + fail + ' 个组合不可见') : '✓ 全部组合可见');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃', e); process.exit(1); });
