// _verify_b4_ui.js — B4 UI 冒烟（真实浏览器 msedge）：
// ① 建房表单玩法选择（明棋/暗棋/翻棋）→ 表单提交建翻棋房 ② 翻棋暗子「军」背 → 点击翻子 → 显 rank
// ③ 翻棋状态条阵营事实 ④ 明棋表单直达布阵期（模式开关双端之一半）
// 用法：node _verify_b4_ui.js    （站点 127.0.0.1:5188 已起，CHECKIN_LOCAL=1 自动登录 admin）
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const BASE = 'http://127.0.0.1:5188';
const SHOTS = 'D:/checkin/site/qa/shots_b4';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function login(u) {
    const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'b4-ui' }) });
    return (await r.json()).data.token;
}
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

(async () => {
    const beta = await login('QA_beta');
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 900, height: 950 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    // ---- ① 建房表单：玩法选择存在 + 表单提交建翻棋房 ----
    await page.goto(BASE + '/Games/armychess');
    await page.waitForLoadState('load');
    const form = await page.evaluate(() => {
        const sel = document.querySelector('select[name="mode"]');
        return {
            hasSelect: !!sel,
            options: sel ? Array.from(sel.options).map(o => o.value) : [],
        };
    });
    T('① 建房表单玩法选择（open/dark/fanqi）', form.hasSelect && ['open', 'dark', 'fanqi'].every(v => form.options.includes(v)), JSON.stringify(form));

    // 表单路径：选「翻棋」→ 我先手提交（Razor POST → 重定向 Play）
    const createForm = page.locator('form').filter({ has: page.locator('button', { hasText: '新开一盘（我先手）' }) }).first();
    await createForm.locator('select[name="mode"]').selectOption('fanqi');
    await Promise.all([
        page.waitForURL(/\/Games\/armychess\/Play\/\d+/),
        createForm.locator('button[type=submit]').click(),
    ]);
    await sleep(1500);
    const fanqiId = parseInt((page.url().match(/Play\/(\d+)/) || [])[1] || '0', 10);
    T('①b 表单提交建翻棋房并落到对局页', fanqiId > 0, `id=${fanqiId} url=${page.url()}`);

    // QA_beta 加入 → 对局开始
    await fetch(`${BASE}/api/v1/games/armychess/rooms/${fanqiId}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: '{}' });
    await page.reload();
    await sleep(1500);

    // ---- ② 翻棋盘：50 枚灰「军」背 + 阵营未定状态事实 ----
    const board1 = await page.evaluate(() => {
        const svg = document.querySelector('svg.gm-board');
        if (!svg) return { ok: false };
        const labels = [...svg.querySelectorAll('text')].map(t => t.textContent);
        return {
            ok: true,
            jun: labels.filter(s => s === '军').length,
            others: labels.filter(s => s !== '军').length,
            status: (document.getElementById('gmStatusText') || {}).textContent || '',
        };
    });
    T('② 翻棋盘 50 枚「军」暗背', board1.ok && board1.jun === 50, JSON.stringify(board1));
    T('②b 状态条阵营事实', /阵营未定/.test(board1.status), board1.status);

    // ---- ③ 点暗子 = 翻子 → 显 rank ----
    // 测试兜底（2026-10-30 QA 严过关修）：翻棋开棋方系统随机，若轮到对手（QA_beta），
    // UI 不会替对方发请求 —— 让 beta 先 API 翻 (4,0) 消耗回合，保证点击路径轮到浏览器侧。
    {
        const st0 = (await (await fetch(`${BASE}/api/v1/games/armychess/rooms/${fanqiId}`, { headers: { Authorization: 'Bearer ' + beta } })).json()).data;
        if (st0.turn === st0.mySide) {   // 轮到对手（QA_beta）：先 API 翻 (4,0) 消耗回合（2026-10-30 QA 修，原条件写反）
            await fetch(`${BASE}/api/v1/games/armychess/rooms/${fanqiId}/move`, {
                method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' },
                body: JSON.stringify({ x: 4, y: 0 }),
            });
            await page.reload();
            await sleep(1200);
        }
    }
    let flipBody = null, flipOk = null;
    page.on('request', r => { if (r.url().includes('/move')) flipBody = r.postData(); });
    page.on('response', async r => { if (r.url().includes('/move')) { try { flipOk = (await r.json()).ok; } catch (_) { } } });

    // (0,0) 一定有暗子（翻棋 50 子放满非行营格）；算格心点击
    const pt = await page.evaluate(() => {
        const svg = document.querySelector('svg.gm-board');
        const rect = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        const geom = window.__gmLastGeom || { pad: 24, cw: (vb.width - 48) / 5, ch: (vb.height - 48) / 12 };
        const vx = geom.pad + 0 * geom.cw + geom.cw / 2, vy = geom.pad + 0 * geom.ch + geom.ch / 2;
        return { x: rect.left + vx / vb.width * rect.width, y: rect.top + vy / vb.height * rect.height };
    });
    const junBefore = await page.evaluate(() => {
        const svg = document.querySelector('svg.gm-board');
        return [...svg.querySelectorAll('text')].map(t => t.textContent).filter(s => s === '军').length;
    });
    await page.mouse.click(pt.x, pt.y);
    await sleep(900);
    T('③ 点暗子发出翻子 {"x":0,"y":0}', !!flipBody && /"x"\s*:\s*0/.test(flipBody) && /"y"\s*:\s*0/.test(flipBody), flipBody);
    T('③b 翻子受理', flipOk === true, `flipOk=${flipOk}`);
    const after1 = await page.evaluate(() => {
        const svg = document.querySelector('svg.gm-board');
        const labels = [...svg.querySelectorAll('text')].map(t => t.textContent);
        return { jun: labels.filter(s => s === '军').length };
    });
    T('③c 翻开一枚（军-1）', after1.jun === junBefore - 1, `jun ${junBefore}→${after1.jun}`);

    // ---- ④ 连翻到阵营确定（同玩家连翻同色；轮流翻，限 40 轮）—— 状态条出现「你执」 ----
    let settled = false;
    for (let i = 0; i < 40 && !settled; i++) {
        const st = await page.evaluate(async id => {
            const r = await fetch('/api/v1/games/armychess/rooms/' + id, { credentials: 'same-origin' });
            return (await r.json()).data;
        }, fanqiId);
        if (st.state && st.state.settled) { settled = true; break; }
        const who = st.turn === st.mySide ? 'me' : 'opp';
        if (who === 'me') {
            // 点一枚暗子（找第一个「军」标签对应的格 —— 用 state 里的 hidden 坐标）
            const d = (st.state.pieces || []).find(p => p.hidden);
            if (!d) break;
            await page.evaluate(({ x, y }) => {
                const svg = document.querySelector('svg.gm-board');
                const rect = svg.getBoundingClientRect();
                const vb = svg.viewBox.baseVal;
                const geom = window.__gmLastGeom || { pad: 24, cw: (vb.width - 48) / 5, ch: (vb.height - 48) / 12 };
                const vx = geom.pad + x * geom.cw + geom.cw / 2, vy = geom.pad + y * geom.ch + geom.ch / 2;
                svg.dispatchEvent(new MouseEvent('click', { clientX: rect.left + vx / vb.width * rect.width, clientY: rect.top + vy / vb.height * rect.height, bubbles: true }));
            }, d);
            await sleep(500);
        } else {
            // 对方（QA_beta API）翻一子
            const s2 = (await (await fetch(`${BASE}/api/v1/games/armychess/rooms/${fanqiId}`, { headers: { Authorization: 'Bearer ' + beta } })).json()).data;
            const d = (s2.state.pieces || []).find(p => p.hidden);
            if (!d) break;
            await fetch(`${BASE}/api/v1/games/armychess/rooms/${fanqiId}/move`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: d.x, y: d.y }) });
            await sleep(500);
        }
    }
    await sleep(1200);
    const stFinal = await page.evaluate(async id => {
        const r = await fetch('/api/v1/games/armychess/rooms/' + id, { credentials: 'same-origin' });
        return (await r.json()).data;
    }, fanqiId);
    const statusFinal = await page.evaluate(() => (document.getElementById('gmStatusText') || {}).textContent || '');
    T('④ 翻到阵营确定', stFinal.state && stFinal.state.settled === true, `settled=${stFinal.state && stFinal.state.settled}`);
    T('④b 状态条透出执色', /你执[红蓝]/.test(statusFinal), statusFinal);
    await page.screenshot({ path: SHOTS + '/fanqi_settled.png' });

    // ---- ⑤ 明棋模式：表单选明棋 → 布阵期（部署按钮条） ----
    await page.goto(BASE + '/Games/armychess');
    await page.waitForLoadState('load');
    const createForm2 = page.locator('form').filter({ has: page.locator('button', { hasText: '新开一盘（我先手）' }) }).first();
    await createForm2.locator('select[name="mode"]').selectOption('open');
    await Promise.all([
        page.waitForURL(/\/Games\/armychess\/Play\/\d+/),
        createForm2.locator('button[type=submit]').click(),
    ]);
    await sleep(1200);
    const openId = parseInt((page.url().match(/Play\/(\d+)/) || [])[1] || '0', 10);
    await fetch(`${BASE}/api/v1/games/armychess/rooms/${openId}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: '{}' });
    await page.reload();
    await sleep(1500);
    const setupBar = await page.evaluate(() => {
        const el = document.getElementById('gmSetupBar');
        return { visible: el ? !el.hidden : false, btns: el ? Array.from(el.querySelectorAll('button')).map(b => b.textContent.trim()) : [] };
    });
    T('⑤ 明棋模式直达布阵期（随机布阵/确认布阵）', setupBar.visible && setupBar.btns.length >= 2, JSON.stringify(setupBar));
    await page.screenshot({ path: SHOTS + '/open_setup.png' });

    T('页面零脚本异常', errs.length === 0, errs.join(' | ').slice(0, 200));

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
