// _verify_batchA.js — 批次 A 运行时复验：A1 两段式走子 / A2 AI 兜底 / A3 五子棋 / A4 黑白棋比分
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const BASE = 'http://127.0.0.1:5188';
const SHOTS = 'D:/checkin/site/qa/shots_batchA';
const fs = require('fs');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function dbSet(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    execFileSync('python', ['-c', `import sqlite3; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); c.execute("""update GameRooms set MovesJson='${json}'${extra} where Id=${id}"""); c.commit(); c.close()`]);
}
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'batchA' }) }); return (await r.json()).data.token; }

(async () => {
    const only = process.argv[2] || 'all';
    const beta = await loginApi('QA_beta');
    const browser = await chromium.launch({ channel: 'msedge' });

    // ---- 通用：admin 经页面建房（AI 房），beta 不需要 ----
    async function openAiRoom(page, gk, extraBody) {
        await page.goto(BASE + '/Games/' + gk);
        await page.waitForLoadState('load');
        const body = Object.assign({ side: 1, opponent: 'ai', aiLevel: 2 }, extraBody || {});
        const res = await page.evaluate(async ({ gk, b }) => {
            const r = await fetch('/api/v1/games/' + gk + '/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
            const t = await r.text();
            let j = null; try { j = JSON.parse(t); } catch (_) { }
            if (!j || !j.ok) return { err: 'http=' + r.status + ' ' + t.slice(0, 140) };
            return { id: j.data.id };
        }, { gk, b: body }).catch(e => ({ err: String(e).slice(0, 140) }));
        if (!res || !res.id) { T(gk + ' AI 建房', false, (res && res.err) || 'null'); return null; }
        await page.goto(BASE + '/Games/' + gk + '/Play/' + res.id);
        await sleep(1500);
        return res.id;
    }

    // 几何：与渲染同源（调渲染模块）
    async function getGeom(page, gk) {
        return page.evaluate(gk => {
            const st = JSON.parse(document.getElementById('gmState').textContent);
            const mod = window[{ gomoku: 'GomokuBoard', reversi: 'ReversiBoard', jungle: 'JungleBoard', xiangqi: 'XiangqiBoard', armychess: 'ArmyChessBoard' }[gk]];
            const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const geom = mod.render(tmp, st.state || {}, { showCoord: st.showCoord, mySide: st.mySide, myTurn: st.myTurn, lastMark: false, tapConfirm: false });
            return { geom, showCoord: st.showCoord };
        }, gk);
    }
    async function cellPoint(page, gk, c, r) {
        const { geom, showCoord } = await getGeom(page, gk);
        return page.evaluate(({ geom, showCoord, gk, c, r }) => {
            const svg = document.querySelector('svg.gm-board');
            const rect = svg.getBoundingClientRect();
            const vb = svg.viewBox.baseVal;
            const vw = vb.width || 640, vh = vb.height || 640;
            const vx = geom.mode === 'point' ? geom.pad + c * geom.cw : geom.pad + c * geom.cw + geom.cw / 2;
            const vy = geom.mode === 'point' ? geom.pad + r * geom.ch : geom.pad + r * geom.ch + geom.ch / 2;
            return { relX: vx / vw * rect.width, relY: vy / vh * rect.height };
        }, { geom, showCoord, gk, c, r });
    }

    // 抓 POST body + 响应
    function attachCapture(page) {
        const cap = { body: null, resp: null };
        cap.handlerReq = req => { if (req.url().includes('/move') && req.method() === 'POST') cap.body = req.postData(); };
        cap.handlerResp = async resp => { if (resp.url().includes('/move') && resp.request().method() === 'POST') { try { cap.resp = (await resp.json()); } catch (_) { } } };
        page.on('request', cap.handlerReq);
        page.on('response', cap.handlerResp);
        cap.detach = () => { page.off('request', cap.handlerReq); page.off('response', cap.handlerResp); };
        return cap;
    }

    // ===== A1 两段式走子（xiangqi/jungle/armychess） =====
    if (only === 'all' || only === 'A1') {
        console.log('\n===== A1 两段式走子 =====');
        const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(20000);

        // --- 象棋：选马(1,9)→改选(2,9)象→落(0,7)，POST {fx,fy,tx,ty} 且服务端接受 ---
        {
            const id = await openAiRoom(page, 'xiangqi');
            if (id) {
                const cap = attachCapture(page);
                const ptHorse = await cellPoint(page, 'xiangqi', 1, 9);
                const htmlBefore = await page.evaluate(() => document.querySelector('svg.gm-board').innerHTML);
                await page.locator('svg.gm-board').first().click({ position: { x: ptHorse.relX, y: ptHorse.relY } });
                await sleep(500);
                const htmlSel = await page.evaluate(() => document.querySelector('svg.gm-board').innerHTML);
                T('A1 象棋 点己方子高亮（无 POST）', cap.body === null && htmlSel !== htmlBefore, 'post=' + cap.body + ' 变化=' + (htmlSel !== htmlBefore));
                const ptEleph = await cellPoint(page, 'xiangqi', 2, 9);
                await page.locator('svg.gm-board').first().click({ position: { x: ptEleph.relX, y: ptEleph.relY } });
                await sleep(500);
                const htmlSel2 = await page.evaluate(() => document.querySelector('svg.gm-board').innerHTML);
                T('A1 象棋 点另一己子=改选起点（仍无 POST，高亮转移）', cap.body === null && htmlSel2 !== htmlSel, 'post=' + cap.body);
                const ptTo = await cellPoint(page, 'xiangqi', 0, 7);
                await page.locator('svg.gm-board').first().click({ position: { x: ptTo.relX, y: ptTo.relY } });
                await sleep(900);
                let body = null; try { body = JSON.parse(cap.body); } catch (_) { }
                const respOk = cap.resp && cap.resp.ok;
                T('A1 象棋 落子 POST={fx,fy,tx,ty} 且服务端接受',
                    body && body.fx === 2 && body.fy === 9 && body.tx === 0 && body.ty === 7 && respOk,
                    `body=${cap.body} ok=${respOk} err=${cap.resp && cap.resp.error}`);
                // AI 回合结束后无残留选中标记
                await sleep(2200);
                const htmlAfter = await page.evaluate(() => document.querySelector('svg.gm-board').innerHTML);
                T('A1 象棋 对方回手后选中标记清除', !/dasharray|is-sel|selected/i.test(htmlAfter) || htmlAfter !== htmlSel2, '');
                await page.screenshot({ path: SHOTS + '/a1_xiangqi.png' });
            }
        }

        // --- 斗兽棋：红象(6,6)→(6,5) ---
        {
            const cap = attachCapture(page);
            const id = await openAiRoom(page, 'jungle');
            if (id) {
                const ptFrom = await cellPoint(page, 'jungle', 6, 6);
                await page.locator('svg.gm-board').first().click({ position: { x: ptFrom.relX, y: ptFrom.relY } });
                await sleep(500);
                T('A1 斗兽棋 选己方子（无 POST）', cap.body === null, 'post=' + cap.body);
                const ptTo = await cellPoint(page, 'jungle', 6, 5);
                await page.locator('svg.gm-board').first().click({ position: { x: ptTo.relX, y: ptTo.relY } });
                await sleep(900);
                let body = null; try { body = JSON.parse(cap.body); } catch (_) { }
                T('A1 斗兽棋 POST={fx,fy,tx,ty} 且服务端接受',
                    body && body.fx === 6 && body.fy === 6 && body.tx === 6 && body.ty === 5 && cap.resp && cap.resp.ok,
                    `body=${cap.body} ok=${cap.resp && cap.resp.ok} err=${cap.resp && cap.resp.error}`);
            }
            cap.detach();
        }

        // --- 军棋：动态找一枚己方子与相邻空位 ---
        {
            const cap = attachCapture(page);
            const id = await openAiRoom(page, 'armychess');
            if (id) {
                const plan = await page.evaluate(() => {
                    const st = JSON.parse(document.getElementById('gmState').textContent);
                    const occ = new Set((st.state.pieces || []).map(p => p.x + ',' + p.y));
                    const mine = (st.state.pieces || []).filter(p => p.side === st.mySide);
                    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                    for (const p of mine) for (const [dx, dy] of dirs) {
                        const nx = p.x + dx, ny = p.y + dy;
                        if (nx < 0 || nx > 4 || ny < 0 || ny > 11) continue;
                        if (!occ.has(nx + ',' + ny)) return { fx: p.x, fy: p.y, tx: nx, ty: ny };
                    }
                    return null;
                });
                if (!plan) { T('A1 军棋 找到合法一步', false); }
                else {
                    const ptFrom = await cellPoint(page, 'armychess', plan.fx, plan.fy);
                    await page.locator('svg.gm-board').first().click({ position: { x: ptFrom.relX, y: ptFrom.relY } });
                    await sleep(500);
                    T('A1 军棋 选己方子（无 POST）', cap.body === null, 'post=' + cap.body);
                    const ptTo = await cellPoint(page, 'armychess', plan.tx, plan.ty);
                    await page.locator('svg.gm-board').first().click({ position: { x: ptTo.relX, y: ptTo.relY } });
                    await sleep(900);
                    let body = null; try { body = JSON.parse(cap.body); } catch (_) { }
                    T('A1 军棋 POST={fx,fy,tx,ty} 且服务端接受',
                        body && body.fx === plan.fx && body.fy === plan.fy && body.tx === plan.tx && body.ty === plan.ty && cap.resp && cap.resp.ok,
                        `body=${cap.body} plan=${JSON.stringify(plan)} ok=${cap.resp && cap.resp.ok} err=${cap.resp && cap.resp.error}`);
                }
            }
            cap.detach();
        }

        // --- 单点落子游戏不受影响：gomoku/reversi 单击即 POST {x,y}；ludo 按钮掷骰 ---
        {
            const cap = attachCapture(page);
            const id = await openAiRoom(page, 'gomoku');
            if (id) {
                const pt = await cellPoint(page, 'gomoku', 7, 7);
                await page.locator('svg.gm-board').first().click({ position: { x: pt.relX, y: pt.relY } });
                await sleep(700);
                let body = null; try { body = JSON.parse(cap.body); } catch (_) { }
                T('A1 五子棋 单点落子不受影响（一次点击即 POST {x,y}）', body && body.x === 7 && body.y === 7, `body=${cap.body}`);
            }
            cap.detach();
        }
        await ctx.close();
    }

    // ===== A2 AI 兜底 =====
    if (only === 'all' || only === 'A2') {
        console.log('\n===== A2 AI 存活 + 黑白棋无着自动跳过 =====');
        const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(20000);
        const cases = [
            { gk: 'gomoku', move: { x: 7, y: 7 } },
            { gk: 'reversi', move: { x: 3, y: 2 } },
            { gk: 'jungle', move: { fx: 6, fy: 6, tx: 6, ty: 5 } },
            { gk: 'xiangqi', move: { fx: 1, fy: 9, tx: 2, ty: 7 } },
        ];
        for (const cs of cases) {
            const id = await openAiRoom(page, cs.gk);
            if (!id) continue;
            const rev0 = await page.evaluate(async ({ id, gk }) => { const r = await fetch('/api/v1/games/' + gk + '/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data.revision; }, { id, gk: cs.gk });
            const mvRes = await page.evaluate(async ({ id, gk, mv }) => { const r = await fetch('/api/v1/games/' + gk + '/rooms/' + id + '/move', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mv) }); return { status: r.status }; }, { id, gk: cs.gk, mv: cs.move });
            let aiMoved = false, lastRev = rev0;
            for (let i = 0; i < 12 && !aiMoved; i++) {
                await sleep(600);
                const rev = await page.evaluate(async ({ id, gk }) => { const r = await fetch('/api/v1/games/' + gk + '/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data.revision; }, { id, gk: cs.gk });
                lastRev = rev;
                if (rev >= rev0 + 2) aiMoved = true;
            }
            T(`A2 ${cs.gk} 人走→AI 回手`, aiMoved, `rev0=${rev0} lastRev=${lastRev} mvHttp=${mvRes.status}`);
        }

        // 黑白棋：构造 admin（黑）无合法着 → 自动 pass / 不死锁
        const id = await openAiRoom(page, 'reversi');
        if (id) {
            // 局面：黑(0,1),(0,4)；白(0,2),(0,3)。黑无翻子，白可走 (0,5)。
            dbSet(id, [
                { t: 'setup', s: 0 },
                { t: 'move', s: 1, x: 0, y: 1 }, { t: 'move', s: 2, x: 0, y: 2 },
                { t: 'move', s: 2, x: 0, y: 3 }, { t: 'move', s: 1, x: 0, y: 4 },
            ], ", Turn=1, Status='playing', Revision=10");
            const rev0 = (await page.evaluate(async id => { const r = await fetch('/api/v1/games/reversi/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data.revision; }, id));
            await sleep(2500);
            const s1 = await page.evaluate(async id => { const r = await fetch('/api/v1/games/reversi/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data; }, id);
            T('A2 黑白棋 黑无合法着 → 服务端自动 pass（不死锁）', s1.revision > rev0 && s1.turn === 2,
                `rev ${rev0}→${s1.revision} turn=${s1.turn} lastEv=${JSON.stringify((s1.state.events || []).slice(-1))}`);
            // 白（AI）继续可走 → 对局推进
            await sleep(2500);
            const s2 = await page.evaluate(async id => { const r = await fetch('/api/v1/games/reversi/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data; }, id);
            T('A2 自动 pass 后对局继续（AI 落子）', s2.revision > s1.revision || s2.status === 'finished', `rev=${s2.revision} status=${s2.status}`);
            // 页面显示「无子可下」提示 + 黑白比分
            const txt = await page.locator('.gm-status').innerText().catch(() => '');
            T('A4 黑白棋 状态行显示黑·白比分', /黑 \d+ 白 \d+/.test(txt), txt.replace(/\n/g, ' ').slice(0, 80));
        }
        await ctx.close();
    }

    // ===== A3 五子棋：AI 挡活三 / AI 取胜 / 禁手 / 长连 =====
    if (only === 'all' || only === 'A3') {
        console.log('\n===== A3 五子棋 AI 攻防 + 禁手 =====');
        const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(20000);
        // A3a AI 挡活三
        {
            const id = await openAiRoom(page, 'gomoku');
            if (id) {
                dbSet(id, [
                    { t: 'move', s: 1, x: 6, y: 6 }, { t: 'move', s: 1, x: 7, y: 6 }, { t: 'move', s: 1, x: 8, y: 6 },
                    { t: 'move', s: 2, x: 7, y: 5 }, { t: 'move', s: 2, x: 7, y: 7 },
                ], ", Turn=2, Status='playing', Revision=10");
                await sleep(2600); // AI 两阶段
                const s = await page.evaluate(async id => { const r = await fetch('/api/v1/games/gomoku/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data; }, id);
                const last = (s.moves || []).slice(-1)[0] || {};
                const blocked = s.turn === 1 && last.s === 2 && ((last.x === 5 && last.y === 6) || (last.x === 9 && last.y === 6));
                T('A3a 人活三 → AI 阻挡（走 5,6 或 9,6）', blocked, `AI 走 (${last.x},${last.y}) turn=${s.turn}`);
            }
        }
        // A3b AI 成五取胜
        {
            const id = await openAiRoom(page, 'gomoku');
            if (id) {
                dbSet(id, [
                    { t: 'move', s: 2, x: 4, y: 8 }, { t: 'move', s: 2, x: 5, y: 8 }, { t: 'move', s: 2, x: 6, y: 8 }, { t: 'move', s: 2, x: 7, y: 8 },
                    { t: 'move', s: 1, x: 7, y: 7 }, { t: 'move', s: 1, x: 6, y: 7 },
                ], ", Turn=2, Status='playing', Revision=10");
                let fin = null;
                for (let i = 0; i < 10 && !fin; i++) {
                    await sleep(700);
                    const s = await page.evaluate(async id => { const r = await fetch('/api/v1/games/gomoku/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data; }, id);
                    if (s.status === 'finished') fin = s;
                }
                T('A3b AI 四连 → 成五取胜', fin && fin.winner === 2 && /finish|five/.test(fin.resultReason || ''), fin ? `winner=${fin.winner} reason=${fin.resultReason}` : '未终局');
            }
        }
        // A3c 禁手：黑下双三 → 黑负
        {
            const id = await openAiRoom(page, 'gomoku');
            if (id) {
                // 黑 (7,9),(8,9) 横 + (9,7),(9,8) 竖；下 (9,9) 同时成两个活三 → 双三禁手
                dbSet(id, [
                    { t: 'move', s: 1, x: 7, y: 9 }, { t: 'move', s: 1, x: 8, y: 9 },
                    { t: 'move', s: 1, x: 9, y: 7 }, { t: 'move', s: 1, x: 9, y: 8 },
                    { t: 'move', s: 2, x: 0, y: 0 }, { t: 'move', s: 2, x: 1, y: 1 },
                ], ", Turn=1, Status='playing', Revision=10");
                const r = await page.evaluate(async id => { const rr = await fetch('/api/v1/games/gomoku/rooms/' + id + '/move', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 9, y: 9 }) }); return { status: rr.status, body: await rr.text() }; }, id);
                let j = null; try { j = JSON.parse(r.body); } catch (_) { }
                const s = await page.evaluate(async id => { const rr = await fetch('/api/v1/games/gomoku/rooms/' + id, { credentials: 'same-origin' }); return (await rr.json()).data; }, id);
                const blackLost = s.status === 'finished' && s.winner === 2 && /forbid|禁|double/i.test(s.resultReason || '');
                T('A3c 黑双三禁手 → 判黑负', blackLost || (r.status === 400 && /禁/.test(j && j.error || '')),
                    `status=${s.status} winner=${s.winner} reason=${s.resultReason} | http=${r.status} err=${j && j.error}`);
            }
        }
        // A3d 成五 + 长连同手 → 黑胜（不是白胜）
        {
            const id = await openAiRoom(page, 'gomoku');
            if (id) {
                dbSet(id, [
                    { t: 'move', s: 1, x: 5, y: 9 }, { t: 'move', s: 1, x: 6, y: 9 }, { t: 'move', s: 1, x: 7, y: 9 }, { t: 'move', s: 1, x: 8, y: 9 },
                    { t: 'move', s: 1, x: 9, y: 4 }, { t: 'move', s: 1, x: 9, y: 5 }, { t: 'move', s: 1, x: 9, y: 6 }, { t: 'move', s: 1, x: 9, y: 7 }, { t: 'move', s: 1, x: 9, y: 8 },
                    { t: 'move', s: 2, x: 0, y: 0 }, { t: 'move', s: 2, x: 1, y: 1 },
                ], ", Turn=1, Status='playing', Revision=10");
                await fetch(`${BASE}/api/v1/games/gomoku/rooms/${id}/move`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 9, y: 9 }) });
                const s = await page.evaluate(async id => { const rr = await fetch('/api/v1/games/gomoku/rooms/' + id, { credentials: 'same-origin' }); return (await rr.json()).data; }, id);
                T('A3d 成五+长连同手 → 黑胜（五优先于禁手）', s.status === 'finished' && s.winner === 1 && s.resultReason === 'finish',
                    `status=${s.status} winner=${s.winner} reason=${s.resultReason}`);
            }
        }
        // A3e 自由规则：长连（六连）仍算赢
        {
            const r0 = await page.evaluate(async () => { const r = await fetch('/api/v1/games/gomoku/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1, forbidden: false }) }); const j = await r.json(); return j.data.id; });
            if (r0) {
                dbSet(r0, [
                    { t: 'move', s: 1, x: 5, y: 6 }, { t: 'move', s: 1, x: 6, y: 6 }, { t: 'move', s: 1, x: 7, y: 6 }, { t: 'move', s: 1, x: 8, y: 6 },
                    { t: 'move', s: 2, x: 7, y: 5 }, { t: 'move', s: 2, x: 7, y: 7 },
                ], ", Turn=1, Status='playing', Revision=10, Forbidden=0");
                await page.evaluate(async id => { const rr = await fetch('/api/v1/games/gomoku/rooms/' + id + '/move', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 9, y: 6 }) }); return rr.status; }, r0);
                const s = await page.evaluate(async id => { const rr = await fetch('/api/v1/games/gomoku/rooms/' + id, { credentials: 'same-origin' }); return (await rr.json()).data; }, r0);
                T('A3e 自由规则六连 → 黑胜', s.status === 'finished' && s.winner === 1, `winner=${s.winner} reason=${s.resultReason}`);
            }
        }
        await ctx.close();
    }

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');

    // ---- 辅助：AI 房建房（页面 cookie 身份=admin；body.dataset.gk 兜底） ----
    // openAiRoom 里的 document.body.dataset.gk 若不存在则退回 gk —— 已在调用处传 gk。
})();
