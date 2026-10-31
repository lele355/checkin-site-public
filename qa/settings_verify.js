// settings_verify.js —— D-4 设置体系走查断言（网页侧）。
// 覆盖走查表 §2.1 每款面板只显示适用项 / §3 重建提醒+一键重建 / 音效开关 / 红线 19 分形状。
// 用法：node settings_verify.js   （站点 127.0.0.1:5188 已起）
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 每款面板期望项（走查表 §2.1 + 音效项按「有音效的游戏才显示」）
const EXPECT = {
    gomoku:    { has: ['落子确认', '坐标显示', '最后落子标记', '盘面大小', '禁手', '单步限时', '每方总局时'], not: ['音效', '军旗模式'] },
    jungle:    { has: ['落子确认', '坐标显示', '最后落子标记', '单步限时', '每方总局时'], not: ['盘面大小', '禁手', '军旗模式', '音效'] },
    xiangqi:   { has: ['落子确认', '坐标显示', '最后落子标记', '单步限时', '每方总局时'], not: ['盘面大小', '禁手', '军旗模式', '音效'] },
    armychess: { has: ['落子确认', '最后落子标记', '军旗模式', '单步限时', '每方总局时'], not: ['坐标显示', '盘面大小', '禁手', '音效'] },
    reversi:   { has: ['落子确认', '坐标显示', '最后落子标记', '单步限时', '每方总局时'], not: ['盘面大小', '禁手', '军旗模式', '音效'] },
    ludo:      { has: ['落子确认', '最后落子标记', '单步限时', '每方总局时'], not: ['坐标显示', '盘面大小', '禁手', '军旗模式', '音效'] },
    fish:      { has: ['音效'], not: ['落子确认', '坐标显示', '最后落子标记', '盘面大小', '单步限时'] },
};

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 900, height: 950 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const dbg = [];
    page.on('console', m => dbg.push('console:' + m.text()));
    page.on('dialog', d => { dbg.push('dialog:' + d.message()); d.dismiss().catch(() => {}); });

    // 登录（QA_alpha）
    await page.goto(BASE + '/Login');
    if (await page.$('input[type="password"]')) {
        await page.fill('input[type="text"]', 'QA_alpha');
        await page.fill('input[type="password"]', 'QaGames2026!');
        await page.click('button:has-text("登")');
        await page.waitForTimeout(1200);
    }

    // ---- [A] 每款面板只显示适用项（§2.1 逐格） ----
    for (const [key, exp] of Object.entries(EXPECT)) {
        await page.goto(BASE + '/Games/' + key + '/Settings');
        await sleep(250);
        const body = await page.evaluate(() => document.body.innerText);
        const missing = exp.has.filter(x => !body.includes(x));
        const leaked = exp.not.filter(x => body.includes(x));
        T(key + ' 面板显示适用项（' + exp.has.length + ' 项）', missing.length === 0, 'missing=' + missing.join(','));
        T(key + ' 面板不显示不适用项', leaked.length === 0, 'leaked=' + leaked.join(','));
    }

    // ---- [A2] melon 面板（走查表 §2.1：网页 0 项；断言源 QA _batchd_settings_gap.js，已征得复用） ----
    await page.goto(BASE + '/Games/melon/Settings');
    await sleep(250);
    const melonBody = await page.evaluate(() => document.body.innerText);
    const melonItems = ['落子确认', '坐标显示', '最后落子标记', '盘面大小', '禁手', '军旗模式', '单步限时', '每方总局时', '每方总局时'];
    const melonLeak = melonItems.filter(x => melonBody.includes(x));
    T('melon 面板不显示任何棋类设置项（走查表：网页 0 项）', melonLeak.length === 0, 'leaked=' + melonLeak.join(','));
    T('melon 面板音效项口径记录（走查表未列音效，D-4 新增开关）', true,
        '含音效=' + melonBody.includes('音效') + ' 含震动=' + melonBody.includes('震动'));

    // ---- [B] 重建层字段形状（红线 19：分 DTO） ----
    const shape = await page.evaluate(async () => {
        const g = await (await fetch('/api/v1/games/gomoku/settings', { credentials: 'same-origin', cache: 'no-store' })).json();
        const a = await (await fetch('/api/v1/games/armychess/settings', { credentials: 'same-origin', cache: 'no-store' })).json();
        const j = await (await fetch('/api/v1/games/jungle/settings', { credentials: 'same-origin', cache: 'no-store' })).json();
        return {
            gomokuRules: g.data.rules, armyRules: a.data.rules, jungleRules: j.data.rules,
            modeOptions: a.data.modeOptions, sizeOptions: g.data.sizeOptions,
        };
    });
    T('gomoku 规则形状含 size/forbidden', 'size' in shape.gomokuRules && 'forbidden' in shape.gomokuRules, JSON.stringify(shape.gomokuRules));
    T('armychess 规则形状含 mode 不含 size', 'mode' in shape.armyRules && !('size' in shape.armyRules), JSON.stringify(shape.armyRules));
    T('jungle 规则形状只有限时', !('size' in shape.jungleRules) && !('mode' in shape.jungleRules) && 'moveTimeoutSec' in shape.jungleRules, JSON.stringify(shape.jungleRules));
    T('军旗模式可选值 open/dark/fanqi', JSON.stringify(shape.modeOptions) === JSON.stringify(['open', 'dark', 'fanqi']), JSON.stringify(shape.modeOptions));
    T('盘面可选值 13/15/19', JSON.stringify(shape.sizeOptions) === JSON.stringify([13, 15, 19]), JSON.stringify(shape.sizeOptions));

    // ---- [C] 军旗模式存取往返（ArmyChessModeDto 独立入口） ----
    const roundTrip = await page.evaluate(async () => {
        const before = await (await fetch('/api/v1/games/armychess/settings', { credentials: 'same-origin', cache: 'no-store' })).json();
        await fetch('/api/v1/games/armychess/settings', {
            method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'fanqi', moveTimeoutSec: 30, totalTimeoutSec: 600 }),
        });
        const after = await (await fetch('/api/v1/games/armychess/settings', { credentials: 'same-origin', cache: 'no-store' })).json();
        await fetch('/api/v1/games/armychess/settings', {
            method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: before.data.rules.mode, moveTimeoutSec: before.data.rules.moveTimeoutSec, totalTimeoutSec: before.data.rules.totalTimeoutSec }),
        });
        return { before: before.data.rules, after: after.data.rules };
    });
    T('军旗模式 fanqi 存取往返', roundTrip.after.mode === 'fanqi' && roundTrip.after.moveTimeoutSec === 30 && roundTrip.after.totalTimeoutSec === 600,
        JSON.stringify(roundTrip.after) + ' was=' + JSON.stringify(roundTrip.before));

    // ---- [D] 音效开关存取往返（DisplayDto.Sound） ----
    const soundTrip = await page.evaluate(async () => {
        const before = await (await fetch('/api/v1/games/settings', { credentials: 'same-origin', cache: 'no-store' })).json();
        await fetch('/api/v1/games/settings', {
            method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tapConfirm: before.data.tapConfirm, showCoord: before.data.showCoord, lastMark: before.data.lastMark, vibrate: before.data.vibrate, sound: false }),
        });
        const after = await (await fetch('/api/v1/games/settings', { credentials: 'same-origin', cache: 'no-store' })).json();
        await fetch('/api/v1/games/settings', {
            method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tapConfirm: before.data.tapConfirm, showCoord: before.data.showCoord, lastMark: before.data.lastMark, vibrate: before.data.vibrate, sound: before.data.sound }),
        });
        return { before: before.data, after: after.data };
    });
    T('音效开关存取往返（false 生效可回存）', soundTrip.after.sound === false, JSON.stringify(soundTrip.after));
    T('音效默认开', soundTrip.before.sound === true, JSON.stringify(soundTrip.before.sound));

    // ---- [E] 重建提醒 + 一键重建（AI 局，走查表 §3） ----
    await page.goto(BASE + '/Games/gomoku');
    await sleep(300);
    const oldId = await page.evaluate(async () => {
        const r = await fetch('/api/v1/games/gomoku/rooms', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ side: 1, opponent: 'ai', aiLevel: 2 }),
        });
        const j = await r.json(); return j.ok ? j.data.id : null;
    });
    T('建 AI 局（重建流程用）', !!oldId, 'id=' + oldId);
    if (oldId) {
        await page.goto(BASE + '/Games/gomoku/Settings');
        await sleep(250);
        // 改重建层（盘面换成与当前不同的档）保存 → 应弹「需重建房间生效」提醒
        const curSize = await page.$eval('select[name="size"]', el => el.value);
        const newSize = curSize === '19' ? '13' : '19';
        await page.selectOption('select[name="size"]', newSize);
        await page.click('button:has-text("保存设置")');
        await sleep(600);
        const barText = await page.evaluate(() => document.body.innerText);
        T('对局中改重建层 → 弹重建提醒', barText.includes('需重建房间生效'), barText.slice(0, 120));
        T('提醒含一键重建按钮', await page.$('button:has-text("一键重建")') !== null);
        // 一键重建 → 建新关旧 → 跳新房
        await page.click('button:has-text("一键重建")');
        let newUrl = '';
        for (let i = 0; i < 20 && !/\/Play\/\d+/.test(newUrl); i++) { await sleep(500); newUrl = page.url(); }
        const newId = (newUrl.match(/\/Play\/(\d+)/) || [])[1];
        T('一键重建跳到新房', !!newId && Number(newId) !== oldId, 'url=' + newUrl + ' dbg=' + JSON.stringify(dbg.slice(-5)));
        const olds = await page.evaluate(async (id) => {
            const j = await (await fetch('/api/v1/games/gomoku/rooms/' + id, { credentials: 'same-origin' })).json();
            return j.ok ? j.data.status : 'missing';
        }, oldId);
        T('旧房已关（aborted）', olds === 'aborted', 'status=' + olds);
        const nroom = newId ? await page.evaluate(async (id) => {
            const j = await (await fetch('/api/v1/games/gomoku/rooms/' + id, { credentials: 'same-origin', cache: 'no-store' })).json();
            return j.ok ? j.data : null;
        }, Number(newId)) : null;
        T('新房按新参数开（size ' + newSize + '）', nroom && nroom.size === Number(newSize), JSON.stringify(nroom && nroom.size));
    }

    await browser.close();
    const fail = results.filter(r => !r.ok).length;
    console.log(`\n===== settings_verify: ${results.length - fail} 通过 / ${fail} 失败 =====`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL ' + e.message); process.exit(1); });
