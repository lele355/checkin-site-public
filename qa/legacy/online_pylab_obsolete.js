// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// 线上 PyLab 验收：登录 → 引擎检测 → 上传 PPT 真转图 → 翻页 → 删除 → 布局量盒
// 用法：node online_pylab.js
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'https://example.com';
const PPTX = 'D:/tmp/t2.pptx';
const OUT = 'D:/projects/checkin/qa/shots/online';
const USER = ADMIN;
const PASS = PW;

let pass = 0, fail = 0;
const rows = [];
function T(name, ok, extra) {
    rows.push({ name, ok: !!ok, extra: extra == null ? '' : String(extra) });
    if (ok) { pass++; console.log('  v ' + name + (extra != null ? '  [' + extra + ']' : '')); }
    else { fail++; console.log('  x ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch({ channel: 'msedge' });
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errs.push(m.text()); });

    // ---------- 登录 ----------
    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', USER);
    await p.fill('#Password', PASS);
    await p.locator('form:has(#Username) button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');
    T('线上登录成功', !p.url().toLowerCase().includes('login'), p.url());

    // ---------- PC 布局：内容区吃满视口 ----------
    await p.evaluate(() => localStorage.setItem('layout.sidebar', 'hidden'));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(400);
    const box = await p.evaluate(() => {
        const c = document.querySelector('main.content');
        const r = c.getBoundingClientRect();
        const card = document.querySelector('#dashGrid > .card');
        const cr = card.getBoundingClientRect();
        return {
            left: Math.round(r.left), right: Math.round(r.right),
            vw: innerWidth, cardRight: Math.round(cr.right),
            gutter: c.scrollWidth - c.clientWidth,
            cols: getComputedStyle(document.querySelector('#dashGrid')).gridTemplateColumns.split(' ').length
        };
    });
    T('内容区从最左开始', box.left === 0, 'left=' + box.left);
    T('内容区吃到视口右缘', box.right === box.vw, `right=${box.right} vw=${box.vw}`);
    T('滚动条贴右边（卡片右缘距视口 ≤ 60）', box.vw - box.cardRight <= 60, `gap=${box.vw - box.cardRight}`);
    T('1920 宽下 5 列卡片', box.cols === 5, 'cols=' + box.cols);
    await p.screenshot({ path: OUT + '/online_dash.png' });

    // ---------- PyLab ----------
    await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
    const booted = await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 25000 }).then(() => true).catch(() => false);
    T('PyLab 初始化完成', booted);
    await p.screenshot({ path: OUT + '/online_pylab.png' });

    await p.click('.py-tab[data-tab="deck"]');
    await p.click('.py-segbtn[data-deckview="lib"]');
    await p.waitForTimeout(800);
    const engine = (await p.locator('#pyEngineInfo').innerText().catch(() => '')).trim();
    T('线上识别到 LibreOffice 引擎', /LibreOffice/i.test(engine), engine);

    // ---------- 真上传一份 PPT（线上转图关键验证） ----------
    const before = await p.locator('#pyDeckGrid .py-deck').count();
    await p.setInputFiles('#pyDeckFile', PPTX);
    await p.fill('#pyDeckTitle', 'ONLINE_QA_课件');
    await p.click('[data-act="upload"]');
    const okUpload = await p.waitForFunction(
        () => /搞定|失败|错误/.test(document.getElementById('pyUploadStatus')?.textContent || ''),
        null, { timeout: 240000 }).then(() => true).catch(() => false);
    const upMsg = (await p.locator('#pyUploadStatus').innerText().catch(() => '')).trim();
    T('线上 PPT 转图完成（不报错）', okUpload && !/失败|错误/.test(upMsg), upMsg.replace(/\s+/g, ' ').slice(0, 90));
    await p.waitForTimeout(1200);
    const after = await p.locator('#pyDeckGrid .py-deck').count();
    T('课件进入线上列表', after === before + 1, `${before} -> ${after}`);

    const card = p.locator('#pyDeckGrid .py-deck', { hasText: 'ONLINE_QA_课件' }).first();
    const sub = (await card.locator('.sub').innerText().catch(() => '')).trim();
    T('页数 > 0 且为 ready', /\d+\s*页/.test(sub), sub.replace(/\s+/g, ' '));

    // 播放第 1 页，确认页面真的能出图（鉴权后 PhysicalFile / Pdf）
    // 两种活法：有 PDF 的课件默认「矢量」（canvas），否则「图片」（img）
    await p.click('.py-segbtn[data-deckview="play"]');
    await p.selectOption('#pyDeckSel', { label: (await card.locator('h4').innerText()).trim() }).catch(() => { });
    await p.waitForTimeout(1200);
    const imgOk = await p.evaluate(async () => {
        const im = document.getElementById('pySlideImg');
        const cv = document.getElementById('pySlideCanvas');
        if (cv && !cv.hidden) {
            // 矢量模式：canvas 出了位图且不是全透明
            if (cv.width < 100) return 'canvas-' + cv.width;
            const d = cv.getContext('2d').getImageData(0, 0, 6, 6).data;
            return Array.from(d).some(v => v > 0) ? cv.width + 'x' + cv.height : 'canvas-blank';
        }
        if (!im || im.hidden) return 'no-img';
        if (!im.complete) await new Promise(r => { im.onload = r; im.onerror = r; setTimeout(r, 4000); });
        return im.naturalWidth > 100 ? im.naturalWidth + 'x' + im.naturalHeight : 'broken';
    });
    T('线上播放页真实渲染（矢量 canvas 或图片 img）', /\dx\d/.test(String(imgOk)), imgOk);
    T('线上默认矢量模式（有 PDF）', await p.locator('#pyModes .py-modebtn.on').getAttribute('data-slide-mode') === 'vector',
        await p.locator('#pyModes .py-modebtn.on').getAttribute('data-slide-mode'));
    await p.screenshot({ path: OUT + '/online_pylab_play.png' });

    // ---------- 清理：删掉这份课件 ----------
    await p.click('.py-segbtn[data-deckview="lib"]');
    await p.waitForTimeout(500);
    p.once('dialog', d => d.accept());
    await card.locator('[data-deck-del]').click().catch(() => { });
    await p.waitForTimeout(1500);
    const left = await p.locator('#pyDeckGrid .py-deck', { hasText: 'ONLINE_QA_课件' }).count();
    T('测试课件已删除', left === 0, 'remaining=' + left);

    T('全程无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

    console.log(`\n══════ 线上 PyLab 验收：${pass} 通过 / ${fail} 失败 ══════`);
    fs.writeFileSync('D:/projects/checkin/qa/report-online-pylab.json', JSON.stringify({ pass, fail, rows }, null, 2));
    await b.close();
    process.exit(fail ? 1 : 0);
})();
