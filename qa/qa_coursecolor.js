// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// 课程配色改造专项验证
//   ① 颜色按「课程」而不是「类别」：同名同色、跨主题变量正确
//   ② 编辑页/新建页的色板选择器
//   ③ 非本周课程虚化 + 开关
//   ④ 没课格子底色
//   ⑤ API 返回算好的 color（App 直接用，不在客户端重算）
// 用法：export QA_PASS='本地密码'; NODE_PATH=... node qa_coursecolor.js
const QA = require('./_env');
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const OUT = 'D:/checkin/work/releases/qa-cc';
const results = [];
function check(name, ok, extra = '') {
    results.push({ name, ok, extra });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : ''));
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());

    await page.goto(BASE + '/Login');
    await page.waitForLoadState('domcontentloaded');
    await page.fill('#Username', QA.USER);
    await page.fill('#Password', QA.PASS);
    await page.check('input[name="RememberMode"][value="none"]');
    await page.click('#loginForm button[type="submit"]');
    await page.waitForURL(u => !u.toString().includes('/Login'), { timeout: 15000 });

    // ================= ① 课表页 =================
    await page.goto(BASE + '/Courses');
    await page.waitForLoadState('domcontentloaded');

    // 每张课程卡片都必须带 cs-* 类名（不再是 cat-*）
    const cards = page.locator('.course-card, .ttm-card');
    const n = await cards.count();
    check('课表有课程卡片', n > 0, n + ' 张');

    const cls = await cards.evaluateAll(els => els.map(e => e.className));
    const csCount = cls.filter(c => /\bcs-(violet|blue|teal|amber|rose|green|indigo|orange)\b/.test(c)).length;
    check('卡片全部用 cs-* 配色类', csCount === n, `${csCount}/${n}`);

    const catLeft = cls.filter(c => /\bcat-/.test(c)).length;
    check('没有残留 cat-* 类名', catLeft === 0, catLeft + ' 处');

    // 同名课程必须同色
    // 注意：桌面表格 + 手机网格是两套 DOM（.tt 和 .ttm），同一门课会出现两次，
    // 所以按「课名 → 颜色集合」判断前要先按课名归并，不能当成重复渲染。
    const nameColor = await cards.evaluateAll(els => els.map(e => {
        const nm = (e.querySelector('.cc-name') || e).textContent.trim().split(/\s+/)[0];
        const m = e.className.match(/\bcs-([a-z]+)\b/);
        return { nm, color: m ? m[1] : '' };
    }));
    const byName = {};
    nameColor.forEach(({ nm, color }) => {
        if (!byName[nm]) byName[nm] = new Set();
        byName[nm].add(color);
    });
    const split = Object.entries(byName).filter(([, s]) => s.size > 1);
    check('同名课程同色', split.length === 0,
        split.length ? split.map(([k, s]) => k + '=' + [...s].join('/')).join(', ') : Object.keys(byName).length + ' 门课');

    // 同一份课表里不同课尽量不撞色：8 色板，撞色属可接受，但不应全挤在 1~2 个色
    const distinct = new Set(nameColor.map(x => x.color));
    check('配色有区分度', distinct.size >= Math.min(3, Object.keys(byName).length),
        `${Object.keys(byName).length} 门课用 ${distinct.size} 个色`);

    // CSS 变量真的算出了颜色（不是 fallback 成透明/黑）
    const vars = await cards.first().evaluate(e => {
        const s = getComputedStyle(e);
        return { fg: s.color, bg: s.backgroundColor };
    });
    check('卡片前景色有值', !!vars.fg && vars.fg !== 'rgba(0, 0, 0, 0)', vars.fg);
    check('卡片底色有值', !!vars.bg && vars.bg !== 'rgba(0, 0, 0, 0)', vars.bg);

    await page.screenshot({ path: `${OUT}/courses-desktop.png`, fullPage: true });

    // 非本周课程虚化（若当前周恰好全有课则跳过这条，只打印状态）
    const offCount = await page.locator('.course-card.off-week, .ttm-card.off-week').count();
    console.log(`  [info] 非本周课程 ${offCount} 张（虚化样式 ${offCount > 0 ? '生效' : '本周末出现'}）`);

    // 开关条存在且可点
    const toggle = page.locator('.tt-opt-toggle');
    check('有「显示非本周课程」开关', await toggle.count() >= 1);
    if (await toggle.count() >= 1) {
        const onBefore = await toggle.first().evaluate(e => e.classList.contains('on'));
        // 点完必须等导航真的发生再读状态，否则读到的还是旧 DOM（会看到 false → false）
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
            toggle.first().click(),
        ]);
        const onAfter = await page.locator('.tt-opt-toggle').first().evaluate(e => e.classList.contains('on'));
        check('开关能切且状态写入后端', onBefore !== onAfter, `${onBefore} → ${onAfter}`);
        // 切回去，别把用户原来的设置改了
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
            page.locator('.tt-opt-toggle').first().click(),
        ]);
    }

    // 没课格子底色
    const emptyBg = await page.locator('.tt td.tt-empty').first().evaluate(e => getComputedStyle(e).backgroundColor)
        .catch(() => '');
    check('空格子有底色', !!emptyBg && emptyBg !== 'rgba(0, 0, 0, 0)', emptyBg);

    await page.screenshot({ path: `${OUT}/courses-grid.png`, fullPage: false });

    // ================= ② 新建页色板 =================
    await page.goto(BASE + '/Courses/New');
    await page.waitForLoadState('domcontentloaded');
    check('新建页有 9 个色块（8 色 + 自动）', await page.locator('.cc-swatch').count() === 9);
    check('默认选「自动」', await page.locator('.cc-swatch[data-key="auto"].on').count() === 1);
    check('有颜色预览条', await page.locator('#ccPreview').count() === 1);
    check('类别下拉文案不再提「决定颜色」',
        !/决定.*颜色/.test(await page.locator('label').filter({ hasText: '课程类别' }).first().innerText()));

    // 点第 3 个色块（青），预览跟着变
    await page.locator('.cc-swatch[data-key="teal"]').click();
    await page.waitForTimeout(200);
    check('点色块后选中态转移', await page.locator('.cc-swatch[data-key="teal"].on').count() === 1
        && await page.locator('.cc-swatch[data-key="auto"].on').count() === 0);
    check('预览条换成该色', /cs-teal/.test(await page.locator('#ccPreview').getAttribute('class')));

    // 真存一门课，验证色值落库
    const uniq = 'QA课' + Date.now().toString().slice(-6);
    await page.fill('#Name', uniq);
    await page.selectOption('#Weekday', '3');
    await page.selectOption('#StartPeriod', '1');
    await page.selectOption('#EndPeriod', '2');
    await page.click('.form-actions button[type="submit"]');
    await page.waitForURL(u => u.toString().includes('/Courses') && !u.toString().includes('/New'), { timeout: 15000 });
    const newCard = page.locator('.course-card, .ttm-card').filter({ hasText: uniq });
    check('新建课程出现在课表', await newCard.count() >= 1);
    check('新建课程用了选的青色', /cs-teal/.test(await newCard.first().getAttribute('class') || ''));

    // 同名再加一节（不选色）→ 应沿用上一节的颜色
    await page.goto(BASE + '/Courses/New');
    await page.waitForLoadState('domcontentloaded');
    await page.fill('#Name', uniq);
    await page.selectOption('#Weekday', '5');
    await page.selectOption('#StartPeriod', '3');
    await page.selectOption('#EndPeriod', '4');
    await page.click('.form-actions button[type="submit"]');
    await page.waitForURL(u => u.toString().includes('/Courses') && !u.toString().includes('/New'), { timeout: 15000 });
    const same = page.locator('.course-card, .ttm-card').filter({ hasText: uniq });
    const sameCls = [...new Set(await same.evaluateAll(els => els.map(e => (e.className.match(/\bcs-[a-z]+\b/) || ['none'])[0])))];
    // 两套渲染（桌面表格 / 手机网格）会各出一份，所以去重后应当只剩一个颜色
    check('同名课第二次自动沿用同色', sameCls.length === 1 && sameCls[0] === 'cs-teal', sameCls.join(' / '));

    // ================= ③ 编辑页 =================
    const editHref = await newCard.first().getAttribute('href');
    if (editHref) {
        await page.goto(new URL(editHref, BASE).toString());
        await page.waitForLoadState('domcontentloaded');
        check('编辑页有 9 个色块', await page.locator('.cc-swatch').count() === 9);
        check('编辑页回显已存的颜色', await page.locator('.cc-swatch.on[data-key="teal"]').count() === 1);

        // 改成玫红并存
        await page.locator('.cc-swatch[data-key="rose"]').click();
        await page.click('.form-actions button[type="submit"]');
        await page.waitForURL(u => u.toString().match(/\/Courses(\?|$)/), { timeout: 15000 });
        const roseCard = page.locator('.course-card, .ttm-card').filter({ hasText: uniq });
        const roseCls = [...new Set(await roseCard.evaluateAll(els => els.map(e => (e.className.match(/\bcs-[a-z]+\b/) || ['none'])[0])))];
        check('改色后同名几节一起变', roseCls.length === 1 && roseCls[0] === 'cs-rose', roseCls.join(' / '));

        // 改回「自动」→ 落库值应清空，且同一门课的其它节也要一起回到自动色
        // （只清自己那一条，其余节还留着旧色，同一门课会分裂成两种颜色）
        await page.goto(BASE + (await roseCard.first().getAttribute('href')));
        await page.waitForLoadState('domcontentloaded');
        await page.locator('.cc-swatch[data-key="auto"]').click();
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
            page.click('.form-actions button[type="submit"]'),
        ]);
        const autoCls = [...new Set(await page.locator('.course-card, .ttm-card')
            .filter({ hasText: uniq })
            .evaluateAll(els => els.map(e => (e.className.match(/\bcs-[a-z]+\b/) || ['none'])[0])))];
        check('改回「自动」后同名课仍同色', autoCls.length === 1, autoCls.join(' / '));
        check('改回「自动」不是玫红（真的重算了）', autoCls[0] !== 'cs-rose', autoCls.join(' / '));
    }

    // ================= ④ API 返回 color =================
    // /api/v1 走 Bearer，页面 cookie 不通用；这里用 node 侧 fetch 先换 token 再问
    const api = await page.evaluate(async (pass) => {
        const lr = await fetch('/api/v1/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: ADMIN, password: pass, device: 'qa' }),
        });
        if (!lr.ok) return { ok: false, code: 'login ' + lr.status };
        const lj = await lr.json();
        const token = (lj.data && lj.data.token) || lj.token;
        if (!token) return { ok: false, code: 'no token' };
        const r = await fetch('/api/v1/courses', { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) return { ok: false, code: 'courses ' + r.status };
        const j = await r.json();
        return { ok: true, items: ((j.data && j.data.items) || j.items || []).slice(0, 40) };
    }, QA.PASS).catch(e => ({ ok: false, code: String(e) }));
    if (api.ok) {
        check('API 课程返回 color 字段', api.items.length > 0 && api.items.every(x => 'color' in x),
            api.items.length + ' 条');
        const bad = api.items.filter(x => !/^(violet|blue|teal|amber|rose|green|indigo|orange)$/.test(x.color || ''));
        check('API color 都是合法色板键', bad.length === 0, bad.map(x => x.name + '=' + x.color).join(', '));
    } else {
        check('API 课程返回 color 字段', false, api.code);
    }

    // ================= ⑤ 暗色主题下的可读性 =================
    await page.goto(BASE + '/Courses');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'macos');
        document.documentElement.setAttribute('data-tone', 'midnight');
    });
    await page.waitForTimeout(300);
    if (await cards.count() > 0) {
        const dark = await page.locator('.course-card, .ttm-card').first().evaluate(e => {
            const s = getComputedStyle(e);
            return { fg: s.color, bg: s.backgroundColor };
        });
        // 暗色档下底色应该是半透明深色（rgba 且 alpha < 1），不是浅色实底
        check('macos 主题下卡片换了暗色档', /rgba/.test(dark.bg) && !/^rgb\(24[0-9]|^rgb\(25[0-5]/.test(dark.bg), `${dark.fg} / ${dark.bg}`);
    }
    await page.screenshot({ path: `${OUT}/courses-macos.png`, fullPage: false });

    // ================= ⑥ 清理测试课程 =================
    // 走 API 删（DELETE /api/v1/courses/{id}）：页面上的删除按钮带 confirm 二次确认，
    // 在自动化里跟 dialog 与导航的时序缠在一起很容易假超时，而清理不是被测对象。
    await page.evaluate(async ({ nm, pass }) => {
        const lr = await fetch('/api/v1/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: ADMIN, password: pass, device: 'qa' }),
        });
        const lj = await lr.json();
        const token = (lj.data && lj.data.token) || lj.token;
        if (!token) return;
        const r = await fetch('/api/v1/courses', { headers: { Authorization: 'Bearer ' + token } });
        const j = await r.json();
        const items = (j.data && j.data.items) || j.items || [];
        for (const it of items.filter(x => String(x.name).includes(nm))) {
            await fetch('/api/v1/courses/' + it.id, {
                method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
            });
        }
    }, { nm: uniq, pass: QA.PASS }).catch(() => { });
    await page.goto(BASE + '/Courses');
    await page.waitForLoadState('domcontentloaded');
    check('测试课程已清理', await page.locator('.course-card, .ttm-card').filter({ hasText: uniq }).count() === 0);

    await browser.close();

    const bad = results.filter(r => !r.ok);
    console.log(`\n===== ${results.length - bad.length}/${results.length} 通过 =====`);
    if (bad.length) { bad.forEach(r => console.log(' - ' + r.name)); process.exit(1); }
})().catch(e => { console.error('EXCEPTION', e); process.exit(1); });