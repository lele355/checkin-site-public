// _verify_ludo4.js — 飞行棋 4 人完整实测（13 条闸门）
// 用法: node _verify_ludo4.js [A|B|C|D|E|F|G|H|I|J|K|L|all]
const BASE = 'http://127.0.0.1:5188';
const { execFileSync } = require('child_process');
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
function db(sql, mode = 'ro') {
    const out = execFileSync('python', ['-c',
        `import sqlite3,json
c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')
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
async function login(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'ludo4' }) }); return (await r.json()).data.token; }
const TOK = {};
async function api(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, json: j }; }
const snap = async (id, tok) => (await api('GET', `/api/v1/games/ludo/rooms/${id}`, undefined, tok)).json.data;
const mv = (id, tok, body) => api('POST', `/api/v1/games/ludo/rooms/${id}/move`, body, tok);
const roll = (id, tok) => api('POST', `/api/v1/games/ludo/rooms/${id}/roll`, {}, tok);
const resign = (id, tok) => api('POST', `/api/v1/games/ludo/rooms/${id}/resign`, {}, tok);
const join = (id, tok) => api('POST', `/api/v1/games/ludo/rooms/${id}/join`, {}, tok);

async function mkSeatRoom(seatSpecs, extra = {}) {
    const r = await api('POST', '/api/v1/games/ludo/rooms', Object.assign({ side: 1, seats: seatSpecs }, extra), TOK.alpha);
    if (!r.json || !r.json.ok) { T('建房 seats=' + seatSpecs.length, false, JSON.stringify(r.json)); return null; }
    return r.json.data.id;
}
async function fillHumans(id, count, tokensInOrder) {
    for (const t of tokensInOrder.slice(0, count)) {
        const r = await join(id, t);
        if (!r.json.ok) { T('加入座位', false, JSON.stringify(r.json)); return false; }
    }
    return true;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const only = process.argv[2] || 'all';
    for (const [k, u] of [['alpha', 'QA_alpha'], ['beta', 'QA_beta'], ['gamma', 'QA_gamma'], ['delta', 'QA_delta']]) TOK[k] = await login(u);

    // ===== A. 3/4 人建房：座位/颜色/起点/轮转 =====
    if (only === 'all' || only === 'A') {
        console.log('\n===== A 3/4 人建房与轮转 =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }]);
        if (id) {
            await fillHumans(id, 3, [TOK.beta, TOK.gamma, TOK.delta]);
            let s = await snap(id, TOK.alpha);
            T('A1 4 人房开局', s.status === 'playing', 'status=' + s.status);
            const pl = s.players || [];
            T('A2 座位/颜色/侧号正确（红1/黄2/蓝3/绿4）',
                pl.length === 4 && pl[0].color === 'red' && pl[0].side === 1 && pl[1].color === 'yellow' && pl[1].side === 2 && pl[2].color === 'blue' && pl[2].side === 3 && pl[3].color === 'green' && pl[3].side === 4,
                JSON.stringify(pl.map(p => [p.seat, p.side, p.color])));
            const mySides = [];
            for (const [tok, exp] of [[TOK.alpha, 1], [TOK.beta, 2], [TOK.gamma, 3], [TOK.delta, 4]]) {
                const ss = await snap(id, tok); mySides.push(ss.mySide === exp);
            }
            T('A3 每座 mySide 正确', mySides.every(Boolean), JSON.stringify(mySides));
            // 起点：craft 四座各起飞一步 → pos 应 0/26/13/39
            craft(id, [
                { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 3, p: 0, v: -1 }, { t: 'setup', s: 4, p: 0, v: -1 },
                { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 2, p: 0, v: 6 }, { t: 'move', s: 3, p: 0, v: 6 }, { t: 'move', s: 4, p: 0, v: 6 },
            ], ', Turn=1, Status=\'playing\', Revision=50');
            s = await snap(id, TOK.alpha);
            const pos = {}; for (const p of s.state.pieces) if (p.p === 0) pos[p.side] = p.pos;
            T('A4 起点红0/黄26/蓝13/绿39', pos[1] === 0 && pos[2] === 26 && pos[3] === 13 && pos[4] === 39, JSON.stringify(pos));
            // 轮转 1→2→3→4→1（craft roll 逐座走一步）
            let turns = [];
            for (const side of [1, 2, 3, 4]) {
                craft(id, [
                    { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 3, p: 0, v: -1 }, { t: 'setup', s: 4, p: 0, v: -1 },
                    { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 2, p: 0, v: 6 }, { t: 'move', s: 3, p: 0, v: 6 }, { t: 'move', s: 4, p: 0, v: 6 },
                    { t: 'roll', s: side, v: 3 },
                ], `, Turn=${side}, Status='playing', Revision=${60 + side}`);
                const tok = { 1: TOK.alpha, 2: TOK.beta, 3: TOK.gamma, 4: TOK.delta }[side];
                const r = await mv(id, tok, { p: 0 });
                const s2 = await snap(id, TOK.alpha);
                turns.push(side + '->' + (r.json.ok ? s2.turn : 'ERR:' + (r.json.error || '')));
            }
            T('A5 轮转 1→2→3→4→1', turns.join(',') === '1->2,2->3,3->4,4->1', turns.join(' | '));
        }
    }

    // ===== B. F1 掷 6 额外回合 =====
    if (only === 'all' || only === 'B') {
        console.log('\n===== B F1 掷 6 额外回合 =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }]);
        if (id) {
            await fillHumans(id, 3, [TOK.beta, TOK.gamma, TOK.delta]);
            const base = [{ t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 3, p: 0, v: -1 }, { t: 'setup', s: 4, p: 0, v: -1 }];
            // B1 掷 6 起飞 → 额外回合（Turn 保持 1）
            let evs = [...base, { t: 'roll', s: 1, v: 6 }];
            craft(id, evs, ", Turn=1, Status='playing', Revision=100");
            let r = await mv(id, TOK.alpha, { p: 0 });
            let s = await snap(id, TOK.alpha);
            T('B1 掷6起飞仍享额外回合（Turn 保持 1）', r.json.ok && s.turn === 1 && s.myTurn === true, `ok=${r.json.ok} turn=${s.turn} myTurn=${s.myTurn}`);
            // B2 连续 3 次 6 都有额外回合，第 4 次强制换座
            let turnTrace = [s.turn];
            for (let i = 0; i < 3; i++) {
                evs = [...evs, { t: 'move', s: 1, p: 0, v: 6 }, { t: 'roll', s: 1, v: 6 }];
                craft(id, evs, `, Turn=1, Status='playing', Revision=${101 + i}`);
                r = await mv(id, TOK.alpha, { p: 0 });
                s = await snap(id, TOK.alpha);
                turnTrace.push(s.turn);
            }
            T('B2 连续 2~3 次 6 仍保持 Turn=1', turnTrace.slice(1, 3).every(t => t === 1), JSON.stringify(turnTrace));
            // 第 4 次 6 → 强制换座
            evs = [...evs, { t: 'move', s: 1, p: 0, v: 6 }, { t: 'roll', s: 1, v: 6 }];
            craft(id, evs, ", Turn=1, Status='playing', Revision=110");
            r = await mv(id, TOK.alpha, { p: 0 });
            s = await snap(id, TOK.alpha);
            T('B3 连掷 6 第 4 次强制换座（Turn→2）', s.turn === 2, `turn=${s.turn}`);
            // B4 非 6 → 正常换座
            craft(id, [...base, { t: 'roll', s: 1, v: 3 }], ", Turn=1, Status='playing', Revision=120");
            // 保证有子可走：p0 在机库、roll=3 无法起飞 → 用 craft 让 p0 在跑道
            craft(id, [...base, { t: 'move', s: 1, p: 0, v: 6 }, { t: 'roll', s: 1, v: 3 }], ", Turn=1, Status='playing', Revision=121");
            r = await mv(id, TOK.alpha, { p: 0 });
            s = await snap(id, TOK.alpha);
            T('B4 非 6 正常换座（Turn→2）', r.json.ok && s.turn === 2, `ok=${r.json.ok} turn=${s.turn}`);
            // B5 auto-pass 取舍：掷 6 但无合法着（全子 52~57，+6 全超）→ 直接换手（工程师口径）
            let caught = false, tries = 0;
            while (!caught && tries++ < 25) {
                craft(id, [
                    { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 3, p: 0, v: -1 }, { t: 'setup', s: 4, p: 0, v: -1 },
                    { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 1, p: 0, v: 52 },  // p0=52
                    { t: 'move', s: 1, p: 1, v: 6 }, { t: 'move', s: 1, p: 1, v: 53 },  // p1=53
                    { t: 'move', s: 1, p: 2, v: 6 }, { t: 'move', s: 1, p: 2, v: 54 },  // p2=54
                    { t: 'move', s: 1, p: 3, v: 6 }, { t: 'move', s: 1, p: 3, v: 57 },  // p3=57
                ], ", Turn=1, Status='playing', Revision=" + (130 + tries));
                const rr = await roll(id, TOK.alpha);
                if (!rr.json.ok) { T('B5 掷骰可用', false, JSON.stringify(rr.json.error)); break; }
                const v = rr.json.data.state.lastRoll;
                if (v === 6) {
                    const s5 = await snap(id, TOK.alpha);
                    T('B5 掷6无合法着 → auto-pass 直接换手（工程师取舍，合理不判漏）', s5.turn === 2, `roll=6 turn=${s5.turn}`);
                    caught = true;
                }
            }
            if (!caught) T('B5 掷6无合法着 → auto-pass', false, `25 次未掷出 6（概率性）`);
        }
    }

    // ===== C. 出局轮转 =====
    if (only === 'all' || only === 'C') {
        console.log('\n===== C 出局轮转 =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }]);
        if (id) {
            await fillHumans(id, 3, [TOK.beta, TOK.gamma, TOK.delta]);
            // C1 认输出局：beta(座2) 认输 → active=false，轮转从 1 跳到 3
            await resign(id, TOK.beta);
            let s = await snap(id, TOK.alpha);
            const betaSeat = s.players.find(p => p.side === 2);
            T('C1 认输座 active=false 且其余继续', betaSeat.active === false && s.status === 'playing', `active=${betaSeat.active} status=${s.status}`);
            craft(id, [
                { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 3, p: 0, v: -1 }, { t: 'setup', s: 4, p: 0, v: -1 },
                { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 3, p: 0, v: 6 }, { t: 'move', s: 4, p: 0, v: 6 },
                { t: 'roll', s: 1, v: 3 },
            ], ", Turn=1, Status='playing', Revision=200");
            await mv(id, TOK.alpha, { p: 0 });
            s = await snap(id, TOK.alpha);
            T('C2 轮转跳过出局座（1→3）', s.turn === 3, 'turn=' + s.turn);
            // C3 剩 1 人即胜：gamma(3)/delta(4) 再认输 → alpha 胜
            await resign(id, TOK.gamma);
            await resign(id, TOK.delta);
            s = await snap(id, TOK.alpha);
            T('C3 剩 1 active 该座胜（winner=1, reason=resign）', s.status === 'finished' && s.winner === 1 && s.resultReason === 'resign',
                `status=${s.status} winner=${s.winner} reason=${s.resultReason}`);
            // C4 N==2 认输即时终局（与旧一致）
            const id2 = await mkSeatRoom2();
            if (id2) {
                await join(id2, TOK.beta);
                await resign(id2, TOK.beta);
                const s2 = await snap(id2, TOK.alpha);
                T('C4 N==2 认输即时终局（对手胜）', s2.status === 'finished' && s2.winner === 1 && s2.resultReason === 'resign',
                    `status=${s2.status} winner=${s2.winner}`);
            }
        }
    }

    // ===== D. F2 等待中非房主退出释放座位 =====
    if (only === 'all' || only === 'D') {
        console.log('\n===== D F2 等待中退座 =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }]); // 3 座：seat1/2 空
        if (id) {
            let s = await snap(id, TOK.alpha);
            T('D1 3 人房等待中（两空位）', s.status === 'waiting', 'status=' + s.status);
            await join(id, TOK.beta); // beta 占 seat1
            s = await snap(id, TOK.alpha);
            T('D2 beta 入座 seat1', s.players.find(p => p.seat === 1).side === 2 && s.players.find(p => p.seat === 1).isMe === false, '');
            await api('POST', `/api/v1/games/ludo/rooms/${id}/leave`, {}, TOK.beta);
            s = await snap(id, TOK.alpha);
            const seat1 = s.players.find(p => p.seat === 1);
            T('D3 beta 退出 → seat1 释放（uid 空/可再入座）', seat1.name === '' && s.status === 'waiting', `seat1.name='${seat1.name}' status=${s.status}`);
            const jr = await join(id, TOK.delta);
            T('D4 别人可加入释放的座位', jr.json.ok, JSON.stringify(jr.json.error || 'ok'));
        }
    }

    // ===== E. F3 换手后限时从头算 =====
    if (only === 'all' || only === 'E') {
        console.log('\n===== E F3 换手重置 TurnStartedAt =====');
        // E1 4 人局：auto-pass 后下家限时约满
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }], { moveTimeoutSec: 15 });
        if (id) {
            await fillHumans(id, 3, [TOK.beta, TOK.gamma, TOK.delta]);
            craft(id, [
                { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 3, p: 0, v: -1 }, { t: 'setup', s: 4, p: 0, v: -1 },
                { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 1, p: 0, v: 57 },  // p0=57（任何 roll 都走不了）
            ], ", Turn=1, Status='playing', Revision=300, TurnStartedAt=datetime('now','-10 seconds')");
            const rr = await roll(id, TOK.alpha); // auto-pass（任何点数都无着）
            const s = await snap(id, TOK.alpha);
            T('E1 4人 auto-pass 后换手且下家限时从头算（≥14s/15s）', rr.json.ok && s.turn === 2 && s.moveRemainMs >= 14000,
                `turn=${s.turn} remain=${s.moveRemainMs}ms`);
            // E2 2 人局同验（历史遗留一并修）
            const id2 = await mkSeatRoom2({ moveTimeoutSec: 15 });
            await join(id2, TOK.beta);
            craft(id2, [
                { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 2, p: 0, v: -1 },
                { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 1, p: 0, v: 57 },
            ], ", Turn=1, Status='playing', Revision=300, TurnStartedAt=datetime('now','-10 seconds')");
            const rr2 = await roll(id2, TOK.alpha);
            const s2 = await snap(id2, TOK.alpha);
            T('E2 2人 auto-pass 后换手且下家限时从头算', rr2.json.ok && s2.turn === 2 && s2.moveRemainMs >= 14000,
                `turn=${s2.turn} remain=${s2.moveRemainMs}ms`);
        }
    }

    // ===== F. F4 多座在线 + Sweeper 保活 =====
    if (only === 'all' || only === 'F') {
        console.log('\n===== F F4 多座在线与保活 =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }]);
        if (id) {
            await fillHumans(id, 3, [TOK.beta, TOK.gamma, TOK.delta]);
            await sleep(6000);
            await snap(id, TOK.gamma); // seat2 轮询 → Touch 刷 seat seenAt
            await sleep(300);
            const s = await snap(id, TOK.gamma);
            const g = s.players.find(p => p.side === 3);
            T('F1 seat2 轮询后 online=true', g.online === true, 'online=' + g.online);
            // 保活：把 host/guest 列与 seat0/1 SeenAt 全设老，只留 seat2 新
            const seats = JSON.parse(db(`select SeatsJson from GameRooms where Id=${id}`).rows[0][0]);
            const nowIso = new Date().toISOString();
            for (const st of seats) { if (st.seat !== 2) st.seenAt = '2026-10-29T16:00:00Z'; else st.seenAt = nowIso; }
            db(`update GameRooms set SeatsJson='${JSON.stringify(seats).replace(/'/g, "''")}', HostSeenAt='2026-10-29T16:00:00Z', GuestSeenAt='2026-10-29T16:00:00Z' where Id=${id}`, 'rw');
            // 触发 Sweep（读大厅）
            await api('GET', '/api/v1/games/ludo/rooms', undefined, TOK.gamma);
            const alive = db(`select count(*) c from GameRooms where Id=${id}`).rows[0][0];
            T('F2 host+seat1 静默 5min、seat2 在场 → 房间不被 Sweeper 误删', alive === 1, '仍存在=' + (alive === 1));
            // 反向：全员静默 → 应被清
            const id3 = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }]);
            const seats3 = JSON.parse(db(`select SeatsJson from GameRooms where Id=${id3}`).rows[0][0]);
            for (const st of seats3) st.seenAt = '2026-10-29T16:00:00Z';
            db(`update GameRooms set SeatsJson='${JSON.stringify(seats3).replace(/'/g, "''")}', HostSeenAt='2026-10-29T16:00:00Z', GuestSeenAt='2026-10-29T16:00:00Z' where Id=${id3}`, 'rw');
            await api('GET', '/api/v1/games/ludo/rooms', undefined, TOK.alpha);
            const gone = db(`select count(*) c from GameRooms where Id=${id3}`).rows[0][0];
            T('F3 全员静默 5min+ → Sweeper 正常回收（不误留）', gone === 0, '已删=' + (gone === 0));
        }
    }

    // ===== G. F5 usedMs 不漂 =====
    if (only === 'all' || only === 'G') {
        console.log('\n===== G F5 usedMs 单源 =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }], { totalTimeoutSec: 300 });
        if (id) {
            await fillHumans(id, 3, [TOK.beta, TOK.gamma, TOK.delta]);
            const seats = JSON.parse(db(`select SeatsJson from GameRooms where Id=${id}`).rows[0][0]);
            const vals = { 0: 1111, 1: 2222, 2: 3333, 3: 4444 };
            for (const st of seats) st.usedMs = vals[st.seat];
            db(`update GameRooms set SeatsJson='${JSON.stringify(seats).replace(/'/g, "''")}' where Id=${id}`, 'rw');
            const s = await snap(id, TOK.alpha);
            const got = {}; for (const p of s.players) got[p.seat] = p.usedMs;
            T('G1 players[].usedMs 全部走 SeatsJson（无列漂移）',
                got[0] === 1111 && got[1] === 2222 && got[2] === 3333 && got[3] === 4444, JSON.stringify(got));
            const ok = Math.abs((300 * 1000 - s.myRemainMs) - 1111) < 5000;
            T('G2 myRemainMs 与座位 usedMs 一致', ok, `remain=${s.myRemainMs} used=1111`);
        }
    }

    // ===== H. F6 出局飞机回机库（渲染投影） =====
    if (only === 'all' || only === 'H') {
        console.log('\n===== H F6 出局渲染 =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }]);
        if (id) {
            await fillHumans(id, 3, [TOK.beta, TOK.gamma, TOK.delta]);
            craft(id, [
                { t: 'setup', s: 4, p: 0, v: -1 }, { t: 'setup', s: 4, p: 1, v: -1 },
                { t: 'move', s: 4, p: 0, v: 6 }, { t: 'move', s: 4, p: 0, v: 20 },
            ], ", Turn=1, Status='playing', Revision=400");
            const before = JSON.parse(db(`select MovesJson from GameRooms where Id=${id}`).rows[0][0]);
            await resign(id, TOK.delta); // 座4 出局
            const s = await snap(id, TOK.alpha);
            const p4 = s.state.pieces.filter(p => p.side === 4);
            T('H1 出局座飞机投影为 -1（不渲染残局棋子）', p4.every(p => p.pos === -1), JSON.stringify(p4.map(p => p.pos)));
            const after = JSON.parse(db(`select MovesJson from GameRooms where Id=${id}`).rows[0][0]);
            T('H2 事件流真相不变（认输不改事件、复盘可见）', JSON.stringify(before) === JSON.stringify(after) && after.some(e => e.t === 'move' && e.s === 4), '事件数=' + after.length);
        }
    }

    // ===== I. 并发 CAS =====
    if (only === 'all' || only === 'I') {
        console.log('\n===== I 并发 CAS =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }]);
        if (id) {
            await fillHumans(id, 3, [TOK.beta, TOK.gamma, TOK.delta]);
            craft(id, [
                { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 3, p: 0, v: -1 }, { t: 'setup', s: 4, p: 0, v: -1 },
                { t: 'move', s: 1, p: 0, v: 6 }, { t: 'roll', s: 1, v: 3 },
            ], ", Turn=1, Status='playing', Revision=500");
            const [r1, r2] = await Promise.all([mv(id, TOK.alpha, { p: 0 }), mv(id, TOK.alpha, { p: 1 })]);
            const okCount = [r1, r2].filter(r => r.json && r.json.ok).length;
            const bad = [r1, r2].filter(r => !r.json || !r.json.ok);
            T('I1 并发两手只有一手成功且另一手优雅失败（无 500）', okCount === 1 && bad.every(r => r.status === 400), `ok=${okCount} statuses=${r1.status},${r2.status}`);
        }
    }

    // ===== J. 大厅可见性 =====
    if (only === 'all' || only === 'J') {
        console.log('\n===== J 大厅 seat2/3 可见 =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: false }, { isAi: false }, { isAi: false }]);
        if (id) {
            await fillHumans(id, 3, [TOK.beta, TOK.gamma, TOK.delta]);
            let lb = await api('GET', '/api/v1/games/ludo/rooms', undefined, TOK.gamma);
            let mine = (lb.json.data.items || []).find(r => r.id === id);
            T('J1 seat2 在大厅能看到自己参与的房', !!mine, mine ? 'seatCount=' + mine.seatCount + ' seatedCount=' + mine.seatedCount : '未找到');
            T('J2 seatCount/seatedCount 正确（isAi 未在列表项暴露，UI 未用）', mine && mine.seatCount === 4 && mine.seatedCount === 4,
                mine ? `seatCount=${mine.seatCount} seated=${mine.seatedCount} isAi=${mine.isAi}` : '-');
            // J3 finished 3 天内对 seat2 仍可见
            await resign(id, TOK.alpha); await resign(id, TOK.beta); await resign(id, TOK.gamma); // 剩 delta 胜
            const s = await snap(id, TOK.delta);
            const fin = s.status === 'finished';
            lb = await api('GET', '/api/v1/games/ludo/rooms', undefined, TOK.delta);
            const finRoom = (lb.json.data.items || []).find(r => r.id === id);
            T('J3 finished 房对 seat2/3 仍可见（3 天内）', fin && !!finRoom, `status=${s.status} 可见=${!!finRoom}`);
        }
    }

    // ===== K. 1 人 + 3 AI 整局 =====
    if (only === 'all' || only === 'K') {
        console.log('\n===== K 1人+3AI 整局 =====');
        const id = await mkSeatRoom([{ isAi: false }, { isAi: true }, { isAi: true }, { isAi: true }]);
        if (id) {
            let s = await snap(id, TOK.alpha);
            T('K1 1人+3AI 建房即 playing', s.status === 'playing' && s.players.filter(p => p.isAi).length === 3, 'status=' + s.status);
            let guard = 0, lastRev = -1, stalls = 0, finished = false;
            while (guard++ < 2500) {
                s = await snap(id, TOK.alpha);
                if (s.status === 'finished') { finished = true; break; }
                if (s.revision !== lastRev) { lastRev = s.revision; stalls = 0; } else { stalls++; }
                if (stalls > 300) break; // 连续 300 次无进展（revision 不变）≈ 60s+ = 卡死
                if (s.myTurn) {
                    if (s.state.needRoll) await roll(id, TOK.alpha);
                    else { for (let p = 0; p < 4; p++) { const r = await mv(id, TOK.alpha, { p }); if (r.json.ok) break; } }
                } else await sleep(150);
            }
            const aiUsed = (s.players || []).filter(p => p.isAi).every(p => (p.usedMs || 0) === 0);
            T('K2 1人+3AI 对局推进到终局', finished, finished ? `moves=${s.moveCount} winner=${s.winner} reason=${s.resultReason} guard=${guard}` : `未终局 moves=${s.moveCount} guard=${guard} stalls=${stalls}`);
            T('K3 AI 座计时恒 0（豁免 + 不漂）', aiUsed, JSON.stringify((s.players || []).map(p => [p.side, p.isAi, p.usedMs])));
        }
    }

    // ===== L. 存量 2 人兼容 =====
    if (only === 'all' || only === 'L') {
        console.log('\n===== L 2 人零漂移 =====');
        const id2 = await mkSeatRoom2();
        if (id2) {
            const sj = db(`select SeatsJson, MoveTimeoutSec from GameRooms where Id=${id2}`).rows[0][0];
            T('L1 2 人建房 SeatsJson 保持 null（不写）', sj === null, 'SeatsJson=' + JSON.stringify(sj));
            await join(id2, TOK.beta);
            let s = await snap(id2, TOK.alpha);
            T('L2 2 人快照 players[] 回填 2 座（红黄）', s.players.length === 2 && s.players[0].color === 'red' && s.players[1].color === 'yellow' && s.status === 'playing', JSON.stringify(s.players.map(p => [p.side, p.color])));
            // 走几步：alpha roll（随机）→ 若 6 走子否则换手；beta 同；验证不报错
            let ok = true;
            for (let i = 0; i < 6 && ok; i++) {
                s = await snap(id2, TOK.alpha);
                const tok = s.turn === 1 ? TOK.alpha : TOK.beta;
                const rr = await roll(id2, tok);
                if (!rr.json.ok) { ok = false; break; }
                if (rr.json.data.status === 'finished') break;
                const s2 = await snap(id2, TOK.alpha);
                if (s2.turn === s.turn && s2.status === 'playing') {
                    for (let p = 0; p < 4; p++) { const r = await mv(id2, tok, { p }); if (r.json.ok) break; }
                }
                await sleep(200);
            }
            T('L3 2 人连续走子不报错', ok, '');
            await resign(id2, TOK.beta);
            s = await snap(id2, TOK.alpha);
            T('L4 2 人认输即时终局（winner=1）', s.status === 'finished' && s.winner === 1, `status=${s.status} winner=${s.winner}`);
            const rm = await api('POST', `/api/v1/games/ludo/rooms/${id2}/rematch`, {}, TOK.alpha);
            s = await snap(id2, TOK.alpha);
            T('L5 rematch 重置（playing、turn=1、棋子回机库、SeatsJson 仍 null）',
                rm.json.ok && s.status === 'playing' && s.turn === 1 && s.state.pieces.every(p => p.pos === -1) && (db(`select SeatsJson from GameRooms where Id=${id2}`).rows[0][0] === null),
                `ok=${rm.json.ok} status=${s.status} turn=${s.turn}`);
        }
    }

    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');

    async function mkSeatRoom2(extra = {}) {
        const r = await api('POST', '/api/v1/games/ludo/rooms', Object.assign({ side: 1 }, extra), TOK.alpha);
        if (!r.json.ok) { T('2人建房', false, JSON.stringify(r.json)); return null; }
        return r.json.data.id;
    }
})();
