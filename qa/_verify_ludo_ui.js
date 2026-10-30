// _verify_ludo_ui.js — B3/T06 飞行棋十字盘可玩环 UI 冒烟（真实浏览器 msedge）
// 覆盖：§9.2 十字盘渲染 → 服务端 movable 高亮 → 点 ✈ 走子 → 骰子按钮/额外回合推进。
// 用法：node _verify_ludo_ui.js    （站点 127.0.0.1:5188 已起，CHECKIN_LOCAL=1 自动登录 admin）
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const BASE = 'http://127.0.0.1:5188';
const SHOTS = 'D:/checkin/site/qa/shots_b3';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function db(sql, mode = 'ro') {
    const out = execFileSync('python', ['-c',
        `import sqlite3,json
c=sqlite3.connect(r'file:D:/checkin/site/CheckinApp/data/checkin.db?mode=${mode}', uri=True)
cur=c.cursor(); cur.execute("""${sql.replace(/"/g, '\\"')}""")
rows=cur.fetchall() if cur.description else []
cols=[d[0] for d in cur.description] if cur.description else []
${mode === 'ro' ? '' : 'c.commit()'}
c.close()
print(json.dumps({'cols':cols,'rows':rows}, default=str, ensure_ascii=False))`], { encoding: 'utf8' });
    return JSON.parse(out);
}
function craft(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    db(`update GameRooms set MovesJson='${json}'${extra} where Id=${id}`, 'rw');
}
async function login(u) {
    const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'b3-ludo-ui' }) });
    return (await r.json()).data.token;
}

(async () => {
    const beta = await login('QA_beta');
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 900, height: 950 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    // ---- admin 建房（页面会话）+ QA_beta 加入 ----
    await page.goto(BASE + '/Games/ludo');
    await page.waitForLoadState('load');
    const id = await page.evaluate(async () => {
        const r = await fetch('/api/v1/games/ludo/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1 }) });
        const j = await r.json(); return j.ok ? j.data.id : null;
    });
    const j = await fetch(`${BASE}/api/v1/games/ludo/rooms/${id}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: '{}' });
    T('建房+加入（进入对局）', !!id && (await j.json()).ok, `id=${id}`);

    // ---- 场景 A：已掷 6 未走 → movable=[0,1,2,3] ----
    craft(id, [{ t: 'roll', s: 1, v: 6 }], ", Turn=1, Status='playing', Revision=90");
    await page.goto(BASE + '/Games/ludo/Play/' + id);
    await sleep(1500);

    const board = await page.evaluate(() => {
        const svg = document.querySelector('svg.gm-board');
        if (!svg) return { ok: false };
        const texts = [...svg.querySelectorAll('text')];
        return {
            ok: true,
            planes: texts.filter(t => t.textContent === '✈').length,
            dice: texts.some(t => t.textContent === '6'),
            rings: svg.querySelectorAll('circle[stroke="#f57c00"]').length,
        };
    });
    T('A1 十字盘渲染：svg + 8 ✈ + 骰点 6', board.ok && board.planes === 8 && board.dice, JSON.stringify(board));
    T('A2 movable 高亮 4 架（服务端 movable 直供）', board.rings === 4, `rings=${board.rings}`);

    const uiA = await page.evaluate(() => ({
        barHidden: (document.getElementById('gmLudoBar') || {}).hidden ?? true,
        status: (document.getElementById('gmStatusText') || {}).textContent || '',
    }));
    T('A3 已掷未走：状态「选一架飞机」+ 掷骰条隐藏', /选一架飞机/.test(uiA.status) && uiA.barHidden, JSON.stringify(uiA));
    await page.screenshot({ path: SHOTS + '/ludo_a_movable.png' });

    // ---- 点高亮 ✈ → 发 {p} 走子（起飞） ----
    let mvBody = null, mvOk = null;
    page.on('request', r => { if (r.url().includes('/move')) mvBody = r.postData(); });
    page.on('response', async r => { if (r.url().includes('/move')) { try { mvOk = (await r.json()).ok; } catch (_) { } } });
    const pt = await page.evaluate(() => {
        const c = document.querySelector('svg.gm-board circle[stroke="#f57c00"]');
        const b = c.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.click(pt.x, pt.y);
    await sleep(900);
    T('A4 点 ✈ 发出走子请求 {"p":…}', !!mvBody && /"p"\s*:\s*\d/.test(mvBody), mvBody);
    T('A5 走子请求受理（掷 6 起飞）', mvOk === true, `mvOk=${mvOk}`);
    const snapA = await page.evaluate(async id2 => { const r = await fetch('/api/v1/games/ludo/rooms/' + id2, { credentials: 'same-origin' }); return (await r.json()).data; }, id);
    const p0 = (snapA.state.pieces || []).find(p => p.side === 1 && p.p === 0);
    T('A6 起飞落起点 pos=0', p0 && p0.pos === 0, `pos=${p0 && p0.pos}`);
    const uiB = await page.evaluate(() => ({
        barHidden: (document.getElementById('gmLudoBar') || {}).hidden ?? true,
        status: (document.getElementById('gmStatusText') || {}).textContent || '',
    }));
    T('A7 掷 6 额外回合：回「掷骰子」+ 掷骰条出现', /掷骰子/.test(uiB.status) && !uiB.barHidden, JSON.stringify(uiB));

    // ---- 掷骰按钮 → /roll 接口 ----
    let rollOk = null;
    page.on('response', async r => { if (r.url().includes('/roll')) { try { rollOk = (await r.json()).ok; } catch (_) { } } });
    await page.locator('#gmLudoBar button').first().click();
    await sleep(900);
    T('A8 掷骰按钮触发 /roll 且受理', rollOk === true, `rollOk=${rollOk}`);

    // ---- 场景 B：p0 在主环 pos3、掷 4 → movable=[0] 单机高亮 ----
    craft(id, [
        { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 1, p: 0, v: 3 },
        { t: 'roll', s: 1, v: 4 },
    ], ", Turn=1, Status='playing', Revision=91");
    await page.reload();
    await sleep(1200);
    const boardB = await page.evaluate(() => ({
        rings: document.querySelectorAll('svg.gm-board circle[stroke="#f57c00"]').length,
    }));
    T('B1 主环机 movable 单机高亮', boardB.rings === 1, `rings=${boardB.rings}`);
    mvBody = null; mvOk = null;
    const ptB = await page.evaluate(() => {
        const c = document.querySelector('svg.gm-board circle[stroke="#f57c00"]');
        const b = c.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.click(ptB.x, ptB.y);
    await sleep(900);
    T('B2 点主环 ✈ 走子受理', mvOk === true, `body=${mvBody} mvOk=${mvOk}`);
    const snapB = await page.evaluate(async id2 => { const r = await fetch('/api/v1/games/ludo/rooms/' + id2, { credentials: 'same-origin' }); return (await r.json()).data; }, id);
    const p0b = (snapB.state.pieces || []).find(p => p.side === 1 && p.p === 0);
    T('B3 走子落点与引擎一致 pos=7', p0b && p0b.pos === 7, `pos=${p0b && p0b.pos}`);
    await page.screenshot({ path: SHOTS + '/ludo_b_track.png' });

    T('页面零脚本异常', errs.length === 0, errs.join(' | ').slice(0, 200));

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
