// 体检：PyLab 下拉框在五个主题下的真实渲染 + 计算样式
const QA = require('./_env');
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const USER = QA.USER;
const PASS = QA.PASS;
const SHOTS = 'D:/projects/checkin/qa/shots/pylab';

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', USER);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  await p.click('.py-tab[data-tab="snip"]');
  await p.waitForTimeout(400);

  const themes = ['(default)', 'editorial', 'neumorphism', 'natural', 'macos', 'clay'];
  for (const t of themes) {
    await p.evaluate(th => {
      const el = document.documentElement;
      if (th === '(default)') el.removeAttribute('data-theme');
      else el.setAttribute('data-theme', th);
    }, t);
    await p.waitForTimeout(250);
    const info = await p.evaluate(() => {
      const s = document.querySelector('#pySnipSel');
      const cs = getComputedStyle(s);
      return {
        radius: cs.borderRadius, border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        bg: cs.backgroundColor, img: cs.backgroundImage.slice(0, 60),
        colorScheme: cs.colorScheme, appearance: cs.appearance,
        font: cs.fontSize + '/' + cs.minHeight, color: cs.color
      };
    });
    console.log(t.padEnd(13), JSON.stringify(info));
    await p.locator('section[data-panel="snip"] .card').first()
      .screenshot({ path: SHOTS + '/sel_' + t.replace(/\W/g, '') + '.png' }).catch(() => {});
  }
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
