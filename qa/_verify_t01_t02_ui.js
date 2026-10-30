// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// _verify_t01_t02_ui.js — T01 设置语义 + Solo 分流（Playwright，auto-login 环境）
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const BASE = 'http://127.0.0.1:5188';
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
function db1(sql) {
    const out = execFileSync('python', ['-c', `import sqlite3,json; c=sqlite3.connect(r'file:D:/checkin/site/CheckinApp/data/checkin.db?mode=ro',uri=True); print(json.dumps(c.execute("""${sql}""").fetchall(), default=str, ensure_ascii=False))`], { encoding: 'utf8' });
    return JSON.parse(out);
}
(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.setDefaultTimeout(20000);
    page.on('dialog', d => d.accept());

    // ===== 1. 大厅页头「设置」入口 =====
    await page.goto(BASE + '/Games/gomoku');
    await page.waitForLoadState('load');
    const setLink = page.locator('.page-head a, .page-head button').filter({ hasText: /设置/ }).first();
    const setCnt = await setLink.count();
    T('T01-A 大厅页头有「设置」入口', setCnt > 0, 'count=' + setCnt);
    if (setCnt > 0) {
        await Promise.all([page.waitForURL(/\/Games\/gomoku\/Settings/i), setLink.click()]);
        T('T01-A 点设置进 /Games/gomoku/Settings', /\/Games\/gomoku\/Settings/i.test(page.url()), page.url());
        const title = await page.locator('h2').first().innerText();
        T('T01-C 设置页标题含「默认规则」', /默认规则/.test(title), title);
        // 页面正文无解释性文字（0.2）
        const body = await page.locator('.card').first().innerText();
        T('T01-C 设置页无解释性说明文字', !/说明|提示您|您可以|请点击|教程/.test(body), body.substring(0, 120).replace(/\n/g, ' '));
        // 改 size/forbidden/限时并保存
        const sizeSel = page.locator('select[name="size"]');
        const forbCb = page.locator('select[name="forbidden"]');
        const mtSel = page.locator('select[name="moveTimeoutSec"]');
        T('T01-B 设置页有 size/forbidden/限时控件',
            await sizeSel.count() > 0 && await forbCb.count() > 0 && await mtSel.count() > 0,
            `size=${await sizeSel.count()} forb=${await forbCb.count()} mt=${await mtSel.count()}`);
        await sizeSel.selectOption('19');
        await forbCb.selectOption('true');
        await mtSel.selectOption('30');
        await Promise.all([page.waitForLoadState('load'), page.locator('form button[type="submit"]').first().click()]);
        await page.waitForTimeout(600);
        const gs = db1("select GameSettings from Users where Username=ADMIN")[0][0];
        T('T01-B 保存落库 size=19/forbidden=true/限时30',
            /"Size":\s*19|"size":\s*19/i.test(gs) && /"Forbidden":\s*true|"forbidden":\s*true/i.test(gs) && /"MoveTimeoutSec":\s*30/i.test(gs),
            gs.substring(0, 180));
    }

    // ===== 2. AI 局不冲设置（2.8.2 防复燃） =====
    await page.goto(BASE + '/Games/reversi');
    await page.waitForLoadState('load');
    const beforeRoomId = Number(db1('select coalesce(max(Id),0) from GameRooms')[0][0]);
    const aiBtn = page.locator('form button[type="submit"]').filter({ hasText: /人机对战|AI/ }).first();
    T('T01-B 大厅有 AI 对战入口', await aiBtn.count() > 0);
    if (await aiBtn.count() > 0) {
        await Promise.all([page.waitForURL(/\/Play\//i), aiBtn.click()]);
        await page.waitForTimeout(800);
        const row = db1(`select Id,Size,Forbidden,MoveTimeoutSec,AiLevel from GameRooms where Id>${beforeRoomId} order by Id desc limit 1`)[0];
        if (row) {
            const [id, size, forb, mt, ai] = row;
            T('T01-B AI 局房间限时照设（不被清零）',
                Number(mt) > 0 && Number(ai) > 0,
                `room=${id} size=${size} forbidden=${forb} moveTimeout=${mt} aiLevel=${ai}`);
        } else T('T01-B 找到新建 AI 房间', false);
    }

    // ===== 3. Solo 分流：fish/melon 直达单机页 =====
    for (const [key, name] of [['fish', '大鱼吃小鱼'], ['melon', '合成大西瓜']]) {
        await page.goto(BASE + '/Games');
        await page.waitForLoadState('load');
        const card = page.getByText(name, { exact: false }).first();
        const c = await card.count();
        T(`T02-Solo 列表有「${name}」卡片`, c > 0);
        if (c) {
            await Promise.all([page.waitForURL(new RegExp('/Games/' + key + '/Solo', 'i')), card.click()]);
            T(`T02-Solo 点「${name}」直达 /Games/${key}/Solo（不进大厅）`, /\/Games\/fish\/Solo|\/Games\/melon\/Solo/i.test(page.url()), page.url());
            const body = await page.locator('body').innerText();
            T(`T02-Solo ${name} 单机页有玩法画布/按钮`, await page.locator('canvas, svg, button').count() > 0, 'canvas/btn 数=' + await page.locator('canvas, svg, button').count());
            // 上报接口存在（页面脚本里有 score 调用）
            // 上报接口存在（外链 JS 里有 score 调用）
            const jsPath = 'D:/checkin/site/CheckinApp/wwwroot/js/solo/' + key + '.js';
            const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
            T(`T02-Solo ${name} 外链 JS 含记分上报`, /\/score/.test(js) && /fetch\(/.test(js), jsPath);
        }
    }
    // 五款联机游戏入口不被破坏
    for (const [key, name] of [['gomoku', '五子棋'], ['reversi', '黑白棋'], ['ludo', '飞行棋']]) {
        await page.goto(BASE + '/Games');
        await page.waitForLoadState('load');
        const card = page.getByText(name, { exact: false }).first();
        await Promise.all([page.waitForURL(new RegExp('/Games/' + key + '$', 'i')), card.click()]);
        T(`T02-Solo 联机「${name}」仍进大厅`, new RegExp('/Games/' + key + '$', 'i').test(page.url()), page.url());
    }

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
