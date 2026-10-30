// _verify_283.js — 2.8.3 发版前点验：P1 斗兽棋 AI 兽穴 + P2 两段式改选起点
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const fs = require('fs');
const SHOTS = 'D:/checkin/site/qa/shots_283';
fs.mkdirSync(SHOTS, { recursive: true });
const { execFileSync } = require('child_process');
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'v283' }) }); return (await r.json()).data.token; }
async function api(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, json: j }; }
function jungleSetup() {
    const ip = [
        [0, 0, 7, 2], [6, 0, 6, 2], [1, 1, 3, 2], [5, 1, 2, 2], [0, 2, 1, 2], [2, 2, 5, 2], [4, 2, 4, 2], [6, 2, 8, 2],
        [6, 8, 7, 1], [0, 8, 6, 1], [5, 7, 3, 1], [1, 7, 2, 1], [6, 6, 1, 1], [4, 6, 5, 1], [2, 6, 4, 1], [0, 6, 8, 1],
    ];
    return ip.map(([x, y, v, s]) => ({ t: 'setup', s, x, y, v }));
}
function craftDb(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    const py = "import sqlite3\nc = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')\n"
        + "c.execute(\"\"\"update GameRooms set MovesJson='" + json + "'" + (extra || '') + " where Id=" + id + "\"\"\")\n"
        + "c.commit()\nc.close()";
    fs.writeFileSync('D:/checkin/site/qa/_tmp_craft.py', py, 'utf8');
    execFileSync('python', ['D:/checkin/site/qa/_tmp_craft.py']);
}

(async () => {
    const alpha = await loginApi('QA_alpha');
    const beta = await loginApi('QA_beta');
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    async function openAiRoom(gk) {
        await page.goto(BASE + '/Games/' + gk);
        await page.waitForLoadState('load');
        const res = await page.evaluate(async gk2 => {
            const r = await fetch('/api/v1/games/' + gk2 + '/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1, opponent: 'ai', aiLevel: 2 }) });
            const j = await r.json(); return j.ok ? { id: j.data.id } : { err: 'create fail' };
        }, gk);
        if (!res.id) { T(gk + ' AI 建房', false, res.err); return null; }
        await page.goto(BASE + '/Games/' + gk + '/Play/' + res.id);
        await sleep(1500);
        return res.id;
    }
    async function getGeom(gk) {
        return page.evaluate(gk2 => {
            const st = JSON.parse(document.getElementById('gmState').textContent);
            const mod = window[{ gomoku: 'GomokuBoard', reversi: 'ReversiBoard', jungle: 'JungleBoard', xiangqi: 'XiangqiBoard', armychess: 'ArmyChessBoard' }[gk2]];
            const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const geom = mod.render(tmp, st.state || {}, { showCoord: st.showCoord, mySide: st.mySide, myTurn: st.myTurn, lastMark: false, tapConfirm: false });
            return geom;
        }, gk);
    }
    async function cellPoint(gk, c, r, geomOverride) {
        const geom = geomOverride || await getGeom(gk);
        return page.evaluate(({ gk, c, r, geom }) => {
            const svg = document.querySelector('svg.gm-board');
            const rect = svg.getBoundingClientRect();
            const vb = svg.viewBox.baseVal;
            const vw = vb.width || 640, vh = vb.height || 640;
            const vx = geom.mode === 'point' ? geom.pad + c * geom.cw : geom.pad + c * geom.cw + geom.cw / 2;
            const vy = geom.mode === 'point' ? geom.pad + r * geom.ch : geom.pad + r * geom.ch + geom.ch / 2;
            return { relX: vx / vw * rect.width, relY: vy / vh * rect.height };
        }, { gk, c, r, geom });
    }
    function attachCapture() {
        const cap = { body: null, resp: null };
        cap.req = req => { if (req.url().includes('/move') && req.method() === 'POST') cap.body = req.postData(); };
        cap.res = async resp => { if (resp.url().includes('/move') && resp.request().method() === 'POST') { try { cap.resp = await resp.json(); } catch (_) { } } };
        page.on('request', cap.req); page.on('response', cap.res);
        cap.off = () => { page.off('request', cap.req); page.off('response', cap.res); };
        return cap;
    }
    async function clickCell(gk, c, r) {
        const pt = await cellPoint(gk, c, r);
        await page.locator('svg.gm-board').first().click({ position: { x: pt.relX, y: pt.relY } });
    }

    // ===== P1 斗兽棋 AI 兽穴 =====
    // P1a 工程师场景
    {
        const id = await openAiRoom('jungle');
        if (id) {
            const setup = jungleSetup().map(e => {
                if (e.s === 2 && e.v === 7) { e.x = 3; e.y = 7; }   // 蓝狮 → (3,7)
                if (e.s === 1 && e.v === 1) { e.x = 3; e.y = 6; }   // 红鼠 → (3,6)（狮可吃鼠）
                if (e.s === 1 && e.v === 8) { e.x = 0; e.y = 2; }   // 红象 → (0,2) 远处
                return e;
            });
            craftDb(id, setup, ", Turn=2, Status='playing', Revision=10");
            let fin = null;
            for (let i = 0; i < 10 && !fin; i++) {
                await sleep(800);
                const s = await api('GET', `/api/v1/games/jungle/rooms/${id}`, undefined, alpha);
                if (s.json.data.status === 'finished') fin = s.json.data;
            }
            T('P1a AI 弃吃鼠直取兽穴（winner=2 reason=den）', !!fin && fin.winner === 2 && fin.resultReason === 'den',
                fin ? `winner=${fin.winner} reason=${fin.resultReason}` : '未终局');
        }
    }
    // P1b 反向：红狮进蓝兽穴
    {
        const id = await openAiRoom('jungle');
        if (id) {
            const setup = jungleSetup().map(e => {
                if (e.s === 1 && e.v === 7) { e.x = 3; e.y = 1; }   // 红狮 → (3,1) 邻蓝兽穴 (3,0)
                return e;
            });
            craftDb(id, setup, ", Turn=1, Status='playing', Revision=10");
            await page.evaluate(async id2 => { const r = await fetch('/api/v1/games/jungle/rooms/' + id2 + '/move', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fx: 3, fy: 1, tx: 3, ty: 0 }) }); return r.status; }, id);
            const s = (await api('GET', `/api/v1/games/jungle/rooms/${id}`, undefined, alpha)).json.data;
            T('P1b 反向 红狮进蓝兽穴（winner=1 reason=den）', s.status === 'finished' && s.winner === 1 && s.resultReason === 'den',
                `status=${s.status} winner=${s.winner} reason=${s.resultReason}`);
        }
    }
    // P1c 困毙
    {
        const id = await openAiRoom('jungle');
        if (id) {
            craftDb(id, jungleSetup().filter(e => e.s === 2), ", Turn=2, Status='playing', Revision=10"); // 只留蓝方 → 红方无子
            let fin = null;
            for (let i = 0; i < 10 && !fin; i++) {
                await sleep(800);
                const s = await api('GET', `/api/v1/games/jungle/rooms/${id}`, undefined, alpha);
                if (s.json.data.status === 'finished') fin = s.json.data;
            }
            T('P1c 困毙：无子方判负（winner=2 reason=blocked）', !!fin && fin.winner === 2 && fin.resultReason === 'blocked',
                fin ? `winner=${fin.winner} reason=${fin.resultReason}` : '未终局');
        }
    }

    // ===== P2 两段式改选起点 =====
    // 象棋：点马(1,9) → 点己方相(2,9)（0 请求，改选）→ 点 (0,7) → POST {fx:2,fy:9,tx:0,ty:7}
    {
        const id = await openAiRoom('xiangqi');
        if (id) {
            const cap = attachCapture();
            await clickCell('xiangqi', 1, 9);
            await sleep(500);
            const selHtml = await page.evaluate(() => document.querySelector('svg.gm-board').innerHTML);
            await clickCell('xiangqi', 2, 9);
            await sleep(500);
            T('P2 象棋 点己方另一子=改选（0 请求）', cap.body === null, 'post=' + cap.body);
            await clickCell('xiangqi', 0, 7);
            await sleep(900);
            let body = null; try { body = JSON.parse(cap.body); } catch (_) { }
            T('P2 象棋 改选后落子起点=相(2,9) 且服务端接受',
                body && body.fx === 2 && body.fy === 9 && body.tx === 0 && body.ty === 7 && cap.resp && cap.resp.ok,
                `body=${cap.body} ok=${cap.resp && cap.resp.ok} err=${cap.resp && cap.resp.error}`);
            cap.off();
            await page.screenshot({ path: SHOTS + '/p2_xiangqi.png' });
        }
    }
    // 斗兽棋：点象(6,6) → 点狼(2,6)（0 请求）→ 点 (2,5) → POST 起点=狼(2,6)
    {
        const id = await openAiRoom('jungle');
        if (id) {
            const cap = attachCapture();
            await clickCell('jungle', 6, 6);
            await sleep(500);
            await clickCell('jungle', 2, 6);
            await sleep(500);
            T('P2 斗兽棋 点己方另一子=改选（0 请求）', cap.body === null, 'post=' + cap.body);
            await clickCell('jungle', 3, 6);
            await sleep(900);
            let body = null; try { body = JSON.parse(cap.body); } catch (_) { }
            T('P2 斗兽棋 改选后落子起点=狼(2,6) 且服务端接受',
                body && body.fx === 2 && body.fy === 6 && body.tx === 3 && body.ty === 6 && cap.resp && cap.resp.ok,
                `body=${cap.body} ok=${cap.resp && cap.resp.ok} err=${cap.resp && cap.resp.error}`);
            cap.off();
        }
    }
    // 军棋：动态找两枚己方子 A(可走)、B；选 A → 点 B（0 请求）→ 点 B 的空邻 → POST 起点=B
    {
        const id = await openAiRoom('armychess');
        if (id) {
            const cap = attachCapture();
            const plan = await page.evaluate(() => {
                const st = JSON.parse(document.getElementById('gmState').textContent);
                const occ = new Set((st.state.pieces || []).map(p => p.x + ',' + p.y));
                const mine = (st.state.pieces || []).filter(p => p.side === st.mySide);
                const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                for (const p of mine) for (const [dx, dy] of dirs) {
                    const nx = p.x + dx, ny = p.y + dy;
                    if (nx < 0 || nx > 4 || ny < 0 || ny > 11) continue;
                    if (!occ.has(nx + ',' + ny)) {
                        // B = 另一枚有同样空邻的己方子（用于改选）
                        for (const q of mine) {
                            if (q.x === p.x && q.y === p.y) continue;
                            for (const [dx2, dy2] of dirs) {
                                const bx = q.x + dx2, by = q.y + dy2;
                                if (bx < 0 || bx > 4 || by < 0 || by > 11) continue;
                                if (!occ.has(bx + ',' + by)) return { A: { x: p.x, y: p.y }, B: { x: q.x, y: q.y }, Bto: { x: bx, y: by } };
                            }
                        }
                    }
                }
                return null;
            });
            if (!plan) { T('P2 军棋 找到两枚可动己方子', false); }
            else {
                const ptA = await cellPoint('armychess', plan.A.x, plan.A.y);
                await page.locator('svg.gm-board').first().click({ position: { x: ptA.relX, y: ptA.relY } });
                await sleep(500);
                const ptB = await cellPoint('armychess', plan.B.x, plan.B.y);
                await page.locator('svg.gm-board').first().click({ position: { x: ptB.relX, y: ptB.relY } });
                await sleep(500);
                T('P2 军棋 点己方另一子=改选（0 请求）', cap.body === null, 'post=' + cap.body);
                const ptTo = await cellPoint('armychess', plan.Bto.x, plan.Bto.y);
                await page.locator('svg.gm-board').first().click({ position: { x: ptTo.relX, y: ptTo.relY } });
                await sleep(900);
                let body = null; try { body = JSON.parse(cap.body); } catch (_) { }
                T('P2 军棋 改选后落子起点=B 且服务端接受',
                    body && body.fx === plan.B.x && body.fy === plan.B.y && body.tx === plan.Bto.x && body.ty === plan.Bto.y && cap.resp && cap.resp.ok,
                    `body=${cap.body} plan=${JSON.stringify(plan)} ok=${cap.resp && cap.resp.ok}`);
            }
            cap.off();
        }
    }

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
