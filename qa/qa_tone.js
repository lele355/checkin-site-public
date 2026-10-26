// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// 底色系（data-tone）测试：切换生效 + localStorage + 服务端落库 + 截图目检
// 用法: NODE_PATH=... node qa_tone.js
const QA = require('./_env');
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const results = [];
function check(name, ok, extra = '') { results.push({ name, ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : '')); }
function dbq(sql) { return JSON.parse(execSync(`"${PY}" D:/projects/checkin/qa/dbq.py`, { input: sql, encoding: 'utf8' })); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());

  // 登录
  await page.goto(BASE + '/Login');
  await page.fill('#Username', QA.USER);
  await page.fill('#Password', QA.PASS);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(800);

  // 每主题的备选底色（与 theme.js TONES 对齐）
  const PLAN = [
    ['editorial', ['mist', 'rose', 'wheat']],
    ['neumorphism', ['blue', 'rose', 'mint']],
    ['natural', ['clay', 'leaf', 'mist']],
    ['macos', ['midnight', 'plum', 'forest']],
    ['clay', ['mint', 'lilac', 'lemon']],
  ];

  for (const [theme, tones] of PLAN) {
    for (const tone of tones) {
      // 通过 UI 等价路径切换（直接调 apply 内部太难，模拟点底色圆点）
      await page.goto(BASE + '/');
      await page.waitForLoadState('networkidle');
      // 打开外观面板 → 点主题卡 → 点底色点
      await page.evaluate(([t, tn]) => {
        const el = document.documentElement;
        el.dataset.theme = t;
        window.applyTheme && 0;
      }, [theme, tone]);
      // 用面板真实点击路径
      await page.click('#appearanceBtn');
      await page.click(`.theme-card[data-theme-slug="${theme}"]`);
      await page.waitForTimeout(150);
      const dot = page.locator(`#toneDots .swatch[data-tone="${tone}"]`);
      if (!(await dot.count())) { check(`[${theme}/${tone}] 底色点存在`, false, 'swatch missing'); continue; }
      await dot.click();
      await page.waitForTimeout(250);

      // 1. data-tone 生效
      const dt = await page.evaluate(() => document.documentElement.dataset.tone || '');
      check(`[${theme}/${tone}] data-tone 生效`, dt === tone, `data-tone=${dt || '(空)'}`);

      // 2. 背景色确实变了（对比默认）——body 有 background transition，
      //    两个方向都必须等过渡完成（500ms > --dur）再读 computedStyle，否则读到过渡中间值
      await page.evaluate(() => { delete document.documentElement.dataset.tone; });
      await page.waitForTimeout(500);
      const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundImage + getComputedStyle(document.body).backgroundColor);
      await page.evaluate(tn => { document.documentElement.dataset.tone = tn; }, tone);
      await page.waitForTimeout(500);
      const bg1 = await page.evaluate(() => getComputedStyle(document.body).backgroundImage + getComputedStyle(document.body).backgroundColor);
      check(`[${theme}/${tone}] 背景随之变化`, bg0 !== bg1, bg1.slice(0, 60));

      // 3. localStorage 持久化
      const ls = await page.evaluate(() => localStorage.getItem('theme.tone'));
      check(`[${theme}/${tone}] localStorage 记录`, ls === tone, `theme.tone=${ls}`);

      // 4. 截图（工作台全景）
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/tone-${theme}-${tone}.png` });
    }

    // 5. 服务端落库（每主题最后一档触发一次同步即可，逐个查最后一次）
    await page.waitForTimeout(500);
    const row = dbq("SELECT Theme, Tone FROM Users WHERE Username=ADMIN");
    check(`[${theme}] 服务端落库`, row.length === 1 && row[0].Theme === theme && row[0].Tone === tones[tones.length - 1],
      `db: ${row.length ? row[0].Theme + '/' + row[0].Tone : 'none'}`);
  }

  // 6. 换风格保留底色：clay/lemon → 切到 natural（无 lemon 底色 → 回默认）
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  await page.click('#appearanceBtn');
  await page.click('.theme-card[data-theme-slug="natural"]');
  await page.waitForTimeout(250);
  const dtAfter = await page.evaluate(() => document.documentElement.dataset.tone || '');
  check('换主题后无效底色回落默认', dtAfter === '', `data-tone=${dtAfter || '(空)'}`);

  // 7. 白名单拒绝：POST tone=evil
  const rejected = await page.evaluate(async () => {
    const token = document.querySelector('input[name="__RequestVerificationToken"]');
    const r = await fetch('/Preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'theme=natural&accent=&tone=evil' + (token ? '&__RequestVerificationToken=' + encodeURIComponent(token.value) : '')
    });
    return r.status;
  });
  check('白名单外 tone 被吞（200 但落库为空）', rejected === 200 || rejected === 400, `status=${rejected}`);
  await page.waitForTimeout(400);
  const row2 = dbq("SELECT Tone FROM Users WHERE Username=ADMIN");
  check('库中 Tone 未被写入脏值', row2.length === 1 && row2[0].Tone !== 'evil', `db.Tone=${row2.length ? row2[0].Tone || '(空)' : 'none'}`);

  await browser.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\n== 底色系测试: ${pass} PASS / ${fail} FAIL ==`);
  fs.writeFileSync('D:/projects/checkin/qa/report-tone.json', JSON.stringify({ pass, fail, results }, null, 2));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
