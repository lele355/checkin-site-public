// _batchd_verify.js — Batch D 在制品独立验证 v2（QA 严过关 2026-10-31）。
// 任务二交互反馈实测（象棋/斗兽棋/翻棋/暗棋）+ 任务四 melon 连击/特效实测。
// v2 修正：①状态断言改走 in-page fetch 实时 API（#gmState 是 SSR 快照不回写）
//          ②动画采样改非阻塞 rAF（阻塞 evaluate 会排在 Playwright 命令队列里卡住后续点击）
//          ③闪光环采样改 25ms×12 帧取峰值（rAF 帧率不稳，单点采样踩空）
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:5188';
const SHOTS = 'D:/checkin-work/docs/qa/shots-2026-10-31';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }

async function loginApi(u, p) {
    const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, device: 'batchd2' }) });
    const j = await r.json();
    return j.ok ? j.data.token : null;
}
async function apiPost(path, token, body) {
    const r = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body || {}),
    });
    return r.json();
}
async function uiLogin(page, u, p) {
    await page.goto(BASE + '/Login');
    await page.fill('#Username', u);
    await page.fill('#Password', p);
    await page.click('button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(400);
}
// 实时状态（服务端真值，不依赖 #gmState 快照）
async function liveState(page, gameKey, id) {
    return page.evaluate(async ([gk, rid]) => {
        const r = await fetch('/api/v1/games/' + gk + '/rooms/' + rid, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
        const j = await r.json();
        return j.ok ? j.data : { error: j };
    }, [gameKey, id]);
}
// D-4 提示按需化适配：state.hints 已移到 GET /rooms/{id}/hints 单子接口（QA §3-P1）。
// 这里按候选子逐子拉取并拼回原表形 —— 断言语义不变（提示可用性/绿点数/吃子搜索）。
async function pieceHints(page, gameKey, id, fx, fy) {
    return page.evaluate(async ([gk, rid, x, y]) => {
        const r = await fetch(`/api/v1/games/${gk}/rooms/${rid}/hints?fx=${x}&fy=${y}`, { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
        const j = await r.json();
        return (j && j.ok && j.data) ? (j.data[`${x},${y}`] || []) : [];
    }, [gameKey, id, fx, fy]);
}
async function pieceHintsTok(token, gameKey, id, fx, fy) {
    const j = await (await fetch(`${BASE}/api/v1/games/${gameKey}/rooms/${id}/hints?fx=${fx}&fy=${fy}`, { headers: { 'X-Requested-With': 'fetch', Authorization: 'Bearer ' + token } })).json().catch(() => null);
    return (j && j.ok && j.data) ? (j.data[`${fx},${fy}`] || []) : [];
}
async function fullHints(page, gameKey, id, state) {
    const mine = ((state.state && state.state.pieces) || []).filter(p => p.side === mySideOf(state));
    const map = {};
    for (const p of mine) {
        const t = await pieceHints(page, gameKey, id, p.x, p.y);
        if (t && t.length) map[p.x + ',' + p.y] = t;
    }
    return map;
}
async function fullHintsTok(token, gameKey, id, state) {
    const mine = ((state.state && state.state.pieces) || []).filter(p => p.side === mySideOf(state));
    const map = {};
    for (const p of mine) {
        const t = await pieceHintsTok(token, gameKey, id, p.x, p.y);
        if (t && t.length) map[p.x + ',' + p.y] = t;
    }
    return map;
}
// 翻棋的己方口径 = 色号（myColor），其余 = 座位（mySide）
function mySideOf(state) {
    return (state.state && state.state.mode === 'fanqi' && state.state.myColor) ? state.state.myColor : state.mySide;
}
async function gridToClient(page, gx, gy) {
    return page.evaluate(([gx, gy]) => {
        const geom = window.__gmLastGeom;
        const svg = document.getElementById('gmBoardHost').querySelector('svg');
        const vb = svg.viewBox.baseVal;
        const rect = svg.getBoundingClientRect();
        const offX = geom.mode === 'point' ? 0 : geom.cw / 2;
        const offY = geom.mode === 'point' ? 0 : geom.ch / 2;
        const vx = geom.pad + gx * geom.cw + offX;
        const vy = geom.pad + gy * geom.ch + offY;
        return { x: rect.left + vx / vb.width * rect.width, y: rect.top + vy / vb.height * rect.height };
    }, [gx, gy]);
}
async function clickGrid(page, gx, gy) {
    const c = await gridToClient(page, gx, gy);
    await page.mouse.click(c.x, c.y);
    await sleep(120);
}
async function marks(page) {
    return page.evaluate(() => {
        const svg = document.getElementById('gmBoardHost').querySelector('svg');
        return {
            green: svg.querySelectorAll('circle[fill="#2e7d32"]').length,
            redRing: svg.querySelectorAll('circle[stroke="#e53935"]').length,
            redRect: svg.querySelectorAll('rect[stroke="#e53935"]').length,
            selCircle: svg.querySelectorAll('circle[stroke="#1a73e8"]').length,
            selRect: svg.querySelectorAll('rect[stroke="#1a73e8"]').length,
        };
    });
}
// 非阻塞动画/鬼影采样：立即返回，rAF 后台采 2.6s 写 window.__batchdSamples。
// 判据：圆心/矩形中心落在格点（cell 模式偏移 cw/2）上=静态；分数格点=滑动插值帧。
function startSampler(page) {
    return page.evaluate(() => {
        const geom = window.__gmLastGeom;
        const svg = document.getElementById('gmBoardHost').querySelector('svg');
        const offX = geom.mode === 'point' ? 0 : geom.cw / 2;
        const offY = geom.mode === 'point' ? 0 : geom.ch / 2;
        const isFrac = v => { const d = Math.abs(v - Math.round(v)); return d > 0.02 && d < 0.98; };
        window.__batchdSamples = { frac: [], ghost: [] };
        const t0 = performance.now();
        (function tick() {
            let f = 0;
            svg.querySelectorAll('circle').forEach(el => {
                const cx = parseFloat(el.getAttribute('cx')), cy = parseFloat(el.getAttribute('cy'));
                if (Number.isNaN(cx) || Number.isNaN(cy)) return;
                if (isFrac((cx - geom.pad - offX) / geom.cw) || isFrac((cy - geom.pad - offY) / geom.ch)) f++;
            });
            svg.querySelectorAll('rect').forEach(el => {
                const x = parseFloat(el.getAttribute('x')), w = parseFloat(el.getAttribute('width'));
                const y = parseFloat(el.getAttribute('y')), h = parseFloat(el.getAttribute('height'));
                if (Number.isNaN(x) || Number.isNaN(w) || Number.isNaN(y) || Number.isNaN(h)) return;
                if (w > 400 || h > 400) return;   // 整幅背景矩形（y 中心落半格）排除
                if (isFrac((x + w / 2 - geom.pad - offX) / geom.cw) || isFrac((y + h / 2 - geom.pad - offY) / geom.ch)) f++;
            });
            // D-5 图标集成后棋子为 <image>（滑动插值同走 x/y）——采样一并纳入（工程师补，QA 知悉）
            svg.querySelectorAll('image').forEach(el => {
                const x = parseFloat(el.getAttribute('x')), w = parseFloat(el.getAttribute('width'));
                const y = parseFloat(el.getAttribute('y')), h = parseFloat(el.getAttribute('height'));
                if (Number.isNaN(x) || Number.isNaN(w) || Number.isNaN(y) || Number.isNaN(h)) return;
                if (w > 400 || h > 400) return;
                if (isFrac((x + w / 2 - geom.pad - offX) / geom.cw) || isFrac((y + h / 2 - geom.pad - offY) / geom.ch)) f++;
            });
            window.__batchdSamples.frac.push(f);
            let g = 0;
            svg.querySelectorAll('g[opacity]').forEach(el => {
                const a = parseFloat(el.getAttribute('opacity'));
                if (a > 0.02 && a < 0.98) g++;
            });
            window.__batchdSamples.ghost.push(g);
            if (performance.now() - t0 < 2600) requestAnimationFrame(tick);
        })();
    });
}
function readSampler(page) {
    return page.evaluate(() => window.__batchdSamples);
}

(async () => {
    const betaToken = await loginApi('QA_beta', 'QaGames2026!');
    const gammaToken = await loginApi('QA_gamma', 'QaGames2026!');
    T('QA_beta/QA_gamma API 登录', !!betaToken && !!gammaToken);

    const browser = await chromium.launch({ channel: 'msedge' });
    const ctxA = await browser.newContext({ viewport: { width: 430, height: 860 } });
    const pageA = await ctxA.newPage();
    pageA.setDefaultTimeout(25000);
    await uiLogin(pageA, 'QA_beta', 'QaGames2026!');
    T('QA_beta UI 登录', !pageA.url().toLowerCase().includes('login'), pageA.url());

    // ================= 象棋 =================
    console.log('\n---- [象棋] 选中/提示/取消/动画/吃子鬼影 ----');
    await pageA.goto(BASE + '/Games/xiangqi');
    await sleep(300);
    const xq = await pageA.evaluate(async () => {
        const r = await fetch('/api/v1/games/xiangqi/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1 }) });
        const j = await r.json(); return j.ok ? j.data.id : null;
    });
    T('象棋建房', !!xq, 'id=' + xq);
    await apiPost(`/api/v1/games/xiangqi/rooms/${xq}/join`, gammaToken, { side: 2 });
    await pageA.goto(BASE + '/Games/xiangqi/Play/' + xq);
    await sleep(1600);
    let st = await liveState(pageA, 'xiangqi', xq);
    let hm0 = await fullHints(pageA, 'xiangqi', xq, st);
    T('象棋初始下发 hints（我方回合）', Object.keys(hm0).length > 0, 'keys=' + Object.keys(hm0).length);

    const own = st.state.pieces.find(p => p.side === st.mySide && (hm0[p.x + ',' + p.y] || []).length > 0);
    T('找到可动己方子', !!own, JSON.stringify(own));
    if (own) {
        await clickGrid(pageA, own.x, own.y);
        let m = await marks(pageA);
        const hl = hm0[own.x + ',' + own.y];
        const expGreen = hl.filter(t => !st.state.pieces.some(q => q.x === t[0] && q.y === t[1])).length;
        T('象棋选中高亮出现', m.selCircle >= 1, JSON.stringify(m));
        T('象棋可走提示点=提示表（绿点 ' + expGreen + '）', m.green === expGreen, 'green=' + m.green + ' expect=' + expGreen);
        await pageA.screenshot({ path: SHOTS + '/xiangqi-selected-hints.png' });

        // 点别处（非法空格）→ 规格：取消选中
        let far = null;
        for (let yy = 0; yy < 10 && !far; yy++) for (let xx = 0; xx < 9 && !far; xx++) {
            const isSelf = xx === own.x && yy === own.y;
            const isHint = hl.some(t => t[0] === xx && t[1] === yy);
            const occupied = st.state.pieces.some(q => q.x === xx && q.y === yy);
            if (!isSelf && !isHint && !occupied) far = { x: xx, y: yy };
        }
        if (far) {
            await clickGrid(pageA, far.x, far.y);
            m = await marks(pageA);
            T('象棋点别处取消选中（规格：高亮应清零）', m.selCircle === 0 && m.green === 0, JSON.stringify(m));
            await pageA.screenshot({ path: SHOTS + '/xiangqi-click-elsewhere.png' });
        }

        // 走子动画：重新选中 → 点提示目标 → 非阻塞采样
        await clickGrid(pageA, own.x, own.y);
        const target = hl[0];
        await startSampler(pageA);
        await sleep(50);
        await clickGrid(pageA, target[0], target[1]);
        await sleep(2800);
        const s = await readSampler(pageA);
        const maxFrac = Math.max(...s.frac);
        T('象棋移动有滑动动画（非格点插值帧 ' + maxFrac + '）', maxFrac >= 1, 'fracMax=' + maxFrac);
        st = await liveState(pageA, 'xiangqi', xq);
        T('象棋落子到位', st.state.pieces.some(p => p.x === target[0] && p.y === target[1] && p.side === st.mySide), 'rev=' + st.revision);
        await pageA.screenshot({ path: SHOTS + '/xiangqi-after-move.png' });

        // 吃子：找我方可吃目标（实时状态），UI 执行
        let cap = null;
        st = await liveState(pageA, 'xiangqi', xq);
        const hmc = await fullHints(pageA, 'xiangqi', xq, st);
        if (Object.keys(hmc).length) {
            outer:
            for (const [key, lst] of Object.entries(hmc)) {
                const [fx, fy] = key.split(',').map(Number);
                for (const t of lst) {
                    const victim = st.state.pieces.find(q => q.x === t[0] && q.y === t[1] && q.side && q.side !== st.mySide);
                    if (victim) { cap = { fx, fy, tx: t[0], ty: t[1] }; break outer; }
                }
            }
        }
        // 没有就双方按 hints 推几步再找（beta 走页面 cookie，gamma 走 Bearer）
        for (let k = 0; k < 20 && !cap; k++) {
            for (const tok of [null, gammaToken]) {
                const jj = tok
                    ? await (await fetch(`${BASE}/api/v1/games/xiangqi/rooms/${xq}`, { headers: { 'X-Requested-With': 'fetch', Authorization: 'Bearer ' + tok } })).json().catch(() => null)
                    : await liveState(pageA, 'xiangqi', xq);
                const dto = tok ? (jj && jj.ok ? jj.data : null) : jj;
                if (!dto || !dto.state) continue;
                const hm = tok ? await fullHintsTok(tok, 'xiangqi', xq, dto) : await fullHints(pageA, 'xiangqi', xq, dto);
                const keys = Object.keys(hm);
                if (!keys.length) continue;
                const pick = keys[Math.floor(Math.random() * keys.length)];
                const [fx, fy] = pick.split(',').map(Number);
                const t = hm[pick][Math.floor(Math.random() * hm[pick].length)];
                if (tok) await apiPost(`/api/v1/games/xiangqi/rooms/${xq}/move`, tok, { fx, fy, tx: t[0], ty: t[1] });
                else await pageA.evaluate(async ([rid, mv]) => {
                    await fetch('/api/v1/games/xiangqi/rooms/' + rid + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, credentials: 'same-origin', body: JSON.stringify(mv) });
                }, [xq, { fx, fy, tx: t[0], ty: t[1] }]);
                await sleep(60);
            }
            st = await liveState(pageA, 'xiangqi', xq);
            const hm2 = await fullHints(pageA, 'xiangqi', xq, st);
            if (Object.keys(hm2).length) {
                outer2:
                for (const [key, lst] of Object.entries(hm2)) {
                    const [fx, fy] = key.split(',').map(Number);
                    for (const t of lst) {
                        const victim = st.state.pieces.find(q => q.x === t[0] && q.y === t[1] && q.side && q.side !== st.mySide);
                        if (victim) { cap = { fx, fy, tx: t[0], ty: t[1] }; break outer2; }
                    }
                }
            }
        }
        T('找到可吃局面', !!cap, JSON.stringify(cap));
        if (cap) {
            await sleep(1500);   // 等轮询同步 UI 视图（myTurn/局面）
            await clickGrid(pageA, cap.fx, cap.fy);
            let mm = await marks(pageA);
            if (mm.selCircle === 0) { await sleep(1300); await clickGrid(pageA, cap.fx, cap.fy); mm = await marks(pageA); }
            T('象棋可吃目标标红', mm.redRing + mm.redRect >= 1, JSON.stringify(mm));
            await pageA.screenshot({ path: SHOTS + '/xiangqi-capture-target.png' });
            await startSampler(pageA);
            await sleep(50);
            await clickGrid(pageA, cap.tx, cap.ty);
            await sleep(2800);
            const s2 = await readSampler(pageA);
            const maxG = Math.max(...s2.ghost);
            T('象棋吃子鬼影淡出（ghost 帧 ' + maxG + '）', maxG >= 1, 'ghostMax=' + maxG);
            await pageA.screenshot({ path: SHOTS + '/xiangqi-capture-ghost.png' });
        }
    }

    // ================= 斗兽棋 =================
    console.log('\n---- [斗兽棋] 选中/提示/取消/动画 ----');
    await pageA.goto(BASE + '/Games/jungle');
    await sleep(300);
    const jg = await pageA.evaluate(async () => {
        const r = await fetch('/api/v1/games/jungle/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1 }) });
        const j = await r.json(); return j.ok ? j.data.id : null;
    });
    T('斗兽棋建房', !!jg, 'id=' + jg);
    await apiPost(`/api/v1/games/jungle/rooms/${jg}/join`, gammaToken, { side: 2 });
    await pageA.goto(BASE + '/Games/jungle/Play/' + jg);
    await sleep(1600);
    st = await liveState(pageA, 'jungle', jg);
    const jhm = await fullHints(pageA, 'jungle', jg, st);
    T('斗兽棋初始下发 hints', Object.keys(jhm).length === 8, 'keys=' + Object.keys(jhm).length);
    const jOwn = st.state.pieces.find(p => p.side === st.mySide && (jhm[p.x + ',' + p.y] || []).length > 0);
    if (jOwn) {
        await clickGrid(pageA, jOwn.x, jOwn.y);
        let m = await marks(pageA);
        const hl = jhm[jOwn.x + ',' + jOwn.y];
        const expGreen = hl.filter(t => !st.state.pieces.some(q => q.x === t[0] && q.y === t[1])).length;
        T('斗兽棋选中高亮出现', m.selRect >= 1, JSON.stringify(m));
        T('斗兽棋可走提示点=提示表', m.green === expGreen, 'green=' + m.green + ' expect=' + expGreen);
        await pageA.screenshot({ path: SHOTS + '/jungle-selected-hints.png' });
        let far = null;
        for (let yy = 0; yy < 9 && !far; yy++) for (let xx = 0; xx < 7 && !far; xx++) {
            const isSelf = xx === jOwn.x && yy === jOwn.y;
            const isHint = hl.some(t => t[0] === xx && t[1] === yy);
            const occupied = st.state.pieces.some(q => q.x === xx && q.y === yy);
            if (!isSelf && !isHint && !occupied) far = { x: xx, y: yy };
        }
        if (far) {
            await clickGrid(pageA, far.x, far.y);
            m = await marks(pageA);
            T('斗兽棋点别处取消选中（规格：高亮应清零）', m.selRect === 0 && m.green === 0, JSON.stringify(m));
            await pageA.screenshot({ path: SHOTS + '/jungle-click-elsewhere.png' });
        }
        await clickGrid(pageA, jOwn.x, jOwn.y);
        const t0 = hl[0];
        await startSampler(pageA);
        await sleep(50);
        await clickGrid(pageA, t0[0], t0[1]);
        await sleep(2800);
        const s = await readSampler(pageA);
        T('斗兽棋移动有滑动动画', Math.max(...s.frac) >= 1, 'fracMax=' + Math.max(...s.frac));
        st = await liveState(pageA, 'jungle', jg);
        T('斗兽棋落子到位', st.state.pieces.some(p => p.x === t0[0] && p.y === t0[1] && p.side === st.mySide), 'rev=' + st.revision);
        await pageA.screenshot({ path: SHOTS + '/jungle-after-move.png' });
    }

    // ================= 军棋·翻棋 =================
    console.log('\n---- [翻棋] 翻子单击/无动画/已翻子提示 ----');
    await pageA.goto(BASE + '/Games/armychess');
    await sleep(300);
    const fq = await pageA.evaluate(async () => {
        const r = await fetch('/api/v1/games/armychess/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1, mode: 'fanqi' }) });
        const j = await r.json(); return j.ok ? j.data.id : null;
    });
    T('翻棋建房', !!fq, 'id=' + fq);
    await apiPost(`/api/v1/games/armychess/rooms/${fq}/join`, gammaToken, { side: 2 });
    await pageA.goto(BASE + '/Games/armychess/Play/' + fq);
    await sleep(1600);
    st = await liveState(pageA, 'armychess', fq);
    const fh0 = await fullHints(pageA, 'armychess', fq, st);
    T('翻棋初始 hints=null（未定阵营/无已翻子）', Object.keys(fh0).length === 0, 'keys=' + JSON.stringify(Object.keys(fh0)));
    // 翻棋开棋方随机（GamesApi：Turn = Random.Next(1,3)）——不是我方先走就先让 gamma 翻一手
    if (!st.myTurn) {
        const hG = st.state.pieces.find(p => p.hidden);
        await apiPost(`/api/v1/games/armychess/rooms/${fq}/move`, gammaToken, { x: hG.x, y: hG.y });
        await sleep(1500);
        st = await liveState(pageA, 'armychess', fq);
    }
    const hidden = st.myTurn ? st.state.pieces.find(p => p.hidden) : null;
    if (hidden) {
        await startSampler(pageA);
        await sleep(50);
        await clickGrid(pageA, hidden.x, hidden.y);
        await sleep(1600);
        const s = await readSampler(pageA);
        T('翻子无滑动动画（fx=tx 哨兵契约）', Math.max(...s.frac) === 0, 'fracMax=' + Math.max(...s.frac));
        const stF = await liveState(pageA, 'armychess', fq);
        T('翻子生效（该格已翻开）', stF.state.pieces.some(p => p.x === hidden.x && p.y === hidden.y && !p.hidden), 'rev=' + stF.revision);
        await pageA.screenshot({ path: SHOTS + '/fanqi-after-flip.png' });
    }
    // 推进到阵营已定且轮到我方 → 已翻子提示
    let settledOk = false;
    for (let k = 0; k < 30 && !settledOk; k++) {
        const cur = await liveState(pageA, 'armychess', fq);
        const chm = (cur.state.settled && cur.myTurn) ? await fullHints(pageA, 'armychess', fq, cur) : {};
        if (cur.state.settled && cur.myTurn && Object.keys(chm).length > 0) {
            const keys = Object.keys(chm);
            const allRevealedMine = keys.every(key => {
                const [x, y] = key.split(',').map(Number);
                const p = cur.state.pieces.find(q => q.x === x && q.y === y);
                return p && !p.hidden && p.side === cur.state.myColor;   // side=色号，与 myColor 比（不是 mySide 玩家号）
            });
            T('翻棋提示只含已翻己方子', allRevealedMine, 'keys=' + keys.length);
            settledOk = true;
            const [x, y] = keys[0].split(',').map(Number);
            await sleep(1500);   // 等轮询同步 UI 视图
            await clickGrid(pageA, x, y);
            const m = await marks(pageA);
            T('翻棋选中高亮+提示点出现', m.selRect >= 1 && m.green + m.redRing + m.redRect > 0, JSON.stringify(m));
            await pageA.screenshot({ path: SHOTS + '/fanqi-selected-hints.png' });
            let far = null;
            for (let yy = 0; yy < 12 && !far; yy++) for (let xx = 0; xx < 5 && !far; xx++) {
                const isHint = (chm[keys[0]] || []).some(t => t[0] === xx && t[1] === yy);
                const occupied = cur.state.pieces.some(q => q.x === xx && q.y === yy);
                if (!isHint && !occupied) far = { x: xx, y: yy };
            }
            if (far) {
                await clickGrid(pageA, far.x, far.y);
                const m2 = await marks(pageA);
                T('翻棋点别处取消选中（fanqi 分支）', m2.selRect === 0 && m2.green === 0, JSON.stringify(m2));
            }
            break;
        }
        const h = cur.state.pieces.find(p => p.hidden);
        if (!h) break;
        if (cur.myTurn) await clickGrid(pageA, h.x, h.y);
        else await apiPost(`/api/v1/games/armychess/rooms/${fq}/move`, gammaToken, { x: h.x, y: h.y });
        await sleep(700);
    }
    T('翻棋推进到阵营已定并验证提示', settledOk, '');

    // ================= 军棋·暗棋 =================
    console.log('\n---- [暗棋] 暗己方可选中+提示 ----');
    await pageA.goto(BASE + '/Games/armychess');
    await sleep(300);
    const dk = await pageA.evaluate(async () => {
        const r = await fetch('/api/v1/games/armychess/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1, mode: 'dark' }) });
        const j = await r.json(); return j.ok ? j.data.id : null;
    });
    T('暗棋建房', !!dk, 'id=' + dk);
    await apiPost(`/api/v1/games/armychess/rooms/${dk}/join`, gammaToken, { side: 2 });
    await pageA.goto(BASE + '/Games/armychess/Play/' + dk);
    await sleep(1600);
    st = await liveState(pageA, 'armychess', dk);
    const dhm = await fullHints(pageA, 'armychess', dk, st);
    T('暗棋初始下发 hints', Object.keys(dhm).length > 0, 'keys=' + Object.keys(dhm).length);
    const dOwn = st.state.pieces.find(p => p.side === st.mySide && (dhm[p.x + ',' + p.y] || []).length > 0);
    if (dOwn) {
        await clickGrid(pageA, dOwn.x, dOwn.y);
        const m = await marks(pageA);
        const hl = dhm[dOwn.x + ',' + dOwn.y];
        const expGreen = hl.filter(t => !st.state.pieces.some(q => q.x === t[0] && q.y === t[1])).length;
        T('暗棋选中高亮+提示点（含暗己方子）', m.selRect >= 1 && m.green === expGreen, JSON.stringify(m) + ' expect=' + expGreen);
        await pageA.screenshot({ path: SHOTS + '/armychess-dark-selected-hints.png' });
        // 暗棋 two 分支同样验证点别处取消
        let far = null;
        for (let yy = 0; yy < 12 && !far; yy++) for (let xx = 0; xx < 5 && !far; xx++) {
            const isSelf = xx === dOwn.x && yy === dOwn.y;
            const isHint = hl.some(t => t[0] === xx && t[1] === yy);
            const occupied = st.state.pieces.some(q => q.x === xx && q.y === yy);
            if (!isSelf && !isHint && !occupied) far = { x: xx, y: yy };
        }
        if (far) {
            await clickGrid(pageA, far.x, far.y);
            const m2 = await marks(pageA);
            T('暗棋点别处取消选中（规格：高亮应清零）', m2.selRect === 0 && m2.green === 0, JSON.stringify(m2));
        }
    }

    // ================= melon 连击 + 特效 =================
    console.log('\n---- [melon] 连击倍率/HUD/闪光环/教程同规 ----');
    await pageA.goto(BASE + '/Games/melon/Solo');
    await sleep(1200);
    const melonReady = await pageA.evaluate(() => !!(window.__melonGame && window.__melonGame.debugAdd));
    T('melon 引擎就绪（__melonGame 钩子 Debug 门内可见 = P3-2 已收敛，构建开关口径）', melonReady);
    if (melonReady) {
        const comboSeq = await pageA.evaluate(async () => {
            const g = window.__melonGame;
            const out = [];
            const pair = (lv, y) => { g.debugAdd(lv, 100, y); g.debugAdd(lv, 122, y); };
            const snap = () => out.push({ score: g.score, combo: g.combo, mult: g.comboMult });
            pair(4, 400); await new Promise(r => setTimeout(r, 350)); snap();
            pair(5, 300); await new Promise(r => setTimeout(r, 350)); snap();
            pair(6, 200); await new Promise(r => setTimeout(r, 350)); snap();
            pair(7, 100); await new Promise(r => setTimeout(r, 350)); snap();
            return out;
        });
        const d1 = comboSeq[0].score, d2 = comboSeq[1].score - comboSeq[0].score,
            d3 = comboSeq[2].score - comboSeq[1].score, d4 = comboSeq[3].score - comboSeq[2].score;
        T('melon 网页连击 ×1/×1.2/×1.5/×2（+4/+6/+9/+14）', d1 === 4 && d2 === 6 && d3 === 9 && d4 === 14, JSON.stringify(comboSeq));
        T('melon comboMult 状态正确', comboSeq[3].mult === 2, JSON.stringify(comboSeq[3]));
        const hud = await pageA.evaluate(() => {
            const c = document.getElementById('soloCanvas');
            const g = window.__melonGame;
            const ctx = c.getContext('2d');
            const img = ctx.getImageData(0, 0, 160, 40).data;
            let orange = 0;
            for (let i = 0; i < img.length; i += 4) {
                if (img[i] === 255 && img[i + 1] === 111 && img[i + 2] === 0 && img[i + 3] > 0) orange++;
            }
            return { orange, combo: g.combo };
        });
        T('连击 HUD 上屏（橙色像素 ' + hud.orange + '）', hud.orange > 0, JSON.stringify(hud));
        await pageA.screenshot({ path: SHOTS + '/melon-combo-hud.png' });
        // 闪光环：合并前后白像素峰值对照（25ms×12 采样）
        const flash = await pageA.evaluate(async () => {
            const c = document.getElementById('soloCanvas');
            const g = window.__melonGame;
            const ctx = c.getContext('2d');
            const countWhite = () => {
                const img = ctx.getImageData(0, 0, c.width, c.height).data;
                let w = 0;
                for (let i = 0; i < img.length; i += 4) {
                    const r = img[i], gg = img[i + 1], b = img[i + 2];
                    if (r > 235 && Math.abs(r - gg) <= 10 && Math.abs(gg - b) <= 10 && img[i + 3] > 0) w++;
                }
                return w;
            };
            const before = countWhite();
            const scoreBefore = g.score;
            let peak = before, frames = 0;
            const done = new Promise(res => {
                (function tick() {
                    peak = Math.max(peak, countWhite());
                    frames++;
                    if (frames < 45) requestAnimationFrame(tick); else res();
                })();
            });
            g.debugAdd(8, 200, 300); g.debugAdd(8, 222, 300);
            await done;
            return { before, peak, scoreBefore, scoreAfter: g.score };
        });
        T('闪光环测试中合成发生', flash.scoreAfter > flash.scoreBefore, JSON.stringify(flash));
        T('合成闪光环上屏（白像素 ' + flash.before + '→峰值 ' + flash.peak + '）', flash.peak - flash.before > 20, JSON.stringify(flash));
        await pageA.screenshot({ path: SHOTS + '/melon-flash-ring.png' });
    }
    await pageA.goto(BASE + '/Games/melon/Rules');
    await sleep(600);
    const tut = await pageA.evaluate(() => document.body.innerText);
    T('melon 教程含连击规则（×1.2/×1.5/×2 封顶）', tut.includes('×1.2') && tut.includes('×1.5') && tut.includes('×2'), '');
    T('melon 教程含西瓜不吃连击说明', tut.includes('不吃连击'), '');

    // ================= 汇总 =================
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== _batchd_verify v2: ${pass} 通过 / ${fail} 失败 =====`);
    for (const r of results.filter(x => !x.ok)) console.log('FAIL  ' + r.n + '  [' + r.e + ']');
    await browser.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
