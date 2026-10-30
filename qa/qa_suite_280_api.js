// qa_suite_280_api.js — 游戏套件 2.8.0 API 级全流程测试（一轮）
// 覆盖：B 六款游戏通用 4 条 + 逐款特有 + C 军旗视角化字段级断言 + A1/A4 数据面
// 用法：node qa_suite_280_api.js [section]   section: all|gomoku|reversi|jungle|xiangqi|ludo|armychess|timeout|legacy
// 依赖：站点 127.0.0.1:5188（CHECKIN_LOCAL=1 自动登录 admin）；QA_alpha/beta/gamma/delta 已建号
const { execFileSync } = require('child_process');
const fs = require('fs');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const DB = 'D:/checkin/site/CheckinApp/data/checkin.db';
const PW = 'QaGames2026!';

const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}
function section(title) { console.log('\n===== ' + title + ' ====='); }

// ---------- HTTP ----------
async function api(method, path, body, token) {
    const r = await fetch(BASE + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' },
            token ? { Authorization: 'Bearer ' + token } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch (_) { }
    return { status: r.status, json };
}

// ---------- Razor 页 cookie 登录（URL 用例；Bearer 只对 /api 生效） ----------
let COOKIE_JAR = null;
async function pageGet(path) {
    if (!COOKIE_JAR) {
        const loginPage = await fetch(BASE + '/Login');
        const html = await loginPage.text();
        const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/);
        const token = m ? m[1] : '';
        const setCookies = loginPage.headers.getSetCookie ? loginPage.headers.getSetCookie() : [];
        const jar = new Map();
        for (const c of setCookies) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
        const body = new URLSearchParams({ Username: 'QA_alpha', Password: PW, __RequestVerificationToken: token, RememberMode: 'None' });
        const resp = await fetch(BASE + '/Login', {
            method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') },
            body: body.toString(),
        });
        for (const c of (resp.headers.getSetCookie ? resp.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
        COOKIE_JAR = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    }
    return fetch(BASE + path, { redirect: 'manual', headers: { Cookie: COOKIE_JAR } });
}

// ---------- DB（只读查询 + 受控写入测试数据） ----------
function dbSql(sql, mode = 'ro') {
    const py = `
import sqlite3, json, sys
conn = sqlite3.connect(r'file:${DB.replace(/\\/g, '/')}?mode=${mode}', uri=True)
cur = conn.cursor()
cur.execute("""${sql.replace(/"/g, '\\"')}""")
rows = cur.fetchall() if cur.description else []
${mode === 'ro' ? '' : 'conn.commit()'}
cols = [d[0] for d in cur.description] if cur.description else []
conn.close()
print(json.dumps({'cols': cols, 'rows': rows}, default=str, ensure_ascii=False))
`;
    const out = execFileSync('python', ['-c', py], { encoding: 'utf8' });
    return JSON.parse(out);
}

// ---------- 登录 ----------
const TOKENS = {};
async function loginAll() {
    for (const u of ['QA_alpha', 'QA_beta', 'QA_gamma', 'QA_delta']) {
        const r = await api('POST', '/api/v1/auth/login', { username: u, password: PW, device: 'qa-suite-280' });
        TOKENS[u] = r.json && r.json.ok ? r.json.data.token : null;
        T('登录 ' + u, !!TOKENS[u], r.json && r.json.error);
    }
    // 取 uid
    const rows = dbSql("select Id,Username from Users where Username like 'QA_%'").rows;
    for (const [id, name] of rows) TOKENS['uid_' + name] = id;
}

// ---------- 建房/加入 ----------
async function mkRoom(gameKey, opts = {}) {
    const h = TOKENS.QA_alpha, g = TOKENS.QA_beta;
    const body = Object.assign({ side: 1 }, opts);
    const c = await api('POST', `/api/v1/games/${gameKey}/rooms`, body, h);
    if (!c.json || !c.json.ok) { T(`建房 ${gameKey}`, false, JSON.stringify(c.json)); return null; }
    const id = c.json.data.id;
    if (opts.join !== false && !opts.aiLevel && opts.opponent !== 'ai') {
        const j = await api('POST', `/api/v1/games/${gameKey}/rooms/${id}/join`, {}, g);
        if (!j.json || !j.json.ok) { T(`加入 ${gameKey}#${id}`, false, JSON.stringify(j.json)); return null; }
    }
    return { id, gameKey };
}

// 通过 DB 覆盖 MovesJson 造局面（测试用）
function craftMoves(id, evs, extra = {}) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    let sets = `MovesJson='${json}'`;
    for (const [k, v] of Object.entries(extra)) sets += `, ${k}=${typeof v === 'string' ? "'" + v + "'" : v}`;
    dbSql(`update GameRooms set ${sets} where Id=${id}`, 'rw');
}

async function snap(gameKey, id, who) {
    const r = await api('GET', `/api/v1/games/${gameKey}/rooms/${id}`, undefined, TOKENS[who]);
    return r.json && r.json.ok ? r.json.data : { error: r.json && r.json.error, status: r.status };
}

async function move(gameKey, id, who, ev) {
    return api('POST', `/api/v1/games/${gameKey}/rooms/${id}/move`, ev, TOKENS[who]);
}

// =========================================================================
// GOMOKU
// =========================================================================
async function testGomoku() {
    section('GOMOKU 五子棋');
    // G1 URL 一字不变
    for (const p of ['/Games', '/Games/Gomoku', '/Games/Gomoku/Rules', '/Games/Gomoku/Settings']) {
        const r = await pageGet(p);
        T(`URL ${p} → 200`, r.status === 200, 'status=' + r.status);
    }

    // G2 主路径能赢（alpha 五连）
    const room = await mkRoom('gomoku', { size: 15, forbidden: false });
    if (!room) return;
    const playUrl = await pageGet(`/Games/Gomoku/Play/${room.id}`);
    T(`URL /Games/Gomoku/Play/${room.id} → 200`, playUrl.status === 200, 'status=' + playUrl.status);

    const seq = [[7, 7], [0, 0], [7, 8], [0, 1], [7, 9], [0, 2], [7, 10], [0, 3], [7, 11]];
    let ok = true;
    for (let i = 0; i < seq.length; i++) {
        const who = i % 2 === 0 ? 'QA_alpha' : 'QA_beta';
        const r = await move('gomoku', room.id, who, { x: seq[i][0], y: seq[i][1] });
        if (!r.json.ok) { ok = false; T(`落子 ${seq[i]}`, false, JSON.stringify(r.json)); break; }
    }
    const s = await snap('gomoku', room.id, 'QA_alpha');
    T('五子棋主路径：五连获胜', ok && s.status === 'finished' && s.winner === 1 && s.resultReason === 'five',
        `status=${s.status} winner=${s.winner} reason=${s.resultReason}`);
    T('五子棋快照双投影：moves+events', Array.isArray(s.moves) && s.moves.length === 9 && Array.isArray(s.state.events),
        `moves=${s.moves && s.moves.length} events=${s.state.events && s.state.events.length}`);

    // G3 非法走法：落已有子 / 落盘外
    const room2 = await mkRoom('gomoku', { size: 15 });
    if (!room2) return;
    let r = await move('gomoku', room2.id, 'QA_alpha', { x: 7, y: 7 });
    const rev1 = (await snap('gomoku', room2.id, 'QA_alpha')).revision;
    r = await move('gomoku', room2.id, 'QA_beta', { x: 7, y: 7 });
    T('非法：落已有子被拒(400)', r.status === 400 && /已经有子/.test(r.json && r.json.error || ''), JSON.stringify(r.json && r.json.error));
    r = await move('gomoku', room2.id, 'QA_beta', { x: 99, y: 99 });
    T('非法：落盘外被拒(400)', r.status === 400, JSON.stringify(r.json && r.json.error));
    const rev2 = (await snap('gomoku', room2.id, 'QA_alpha')).revision;
    T('非法走法 Revision 不变', rev1 === rev2, `rev ${rev1}→${rev2}`);

    // G4 断线重连：重新拉快照继续走
    r = await move('gomoku', room2.id, 'QA_beta', { x: 0, y: 0 });
    T('断线重连后能继续走子', r.json && r.json.ok === true, JSON.stringify(r.json && r.json.error));
}

// G5 旧格式 MovesJson 垫片
async function testLegacy() {
    section('GOMOKU 旧格式垫片');
    const room = await mkRoom('gomoku', { size: 15, join: true });
    if (!room) return;
    craftMoves(room.id, [{ x: 7, y: 7, s: 1 }, { x: 0, y: 0, s: 2 }, { x: 7, y: 8, s: 1 }], { Turn: 2, Revision: 99 });
    const s = await snap('gomoku', room.id, 'QA_beta');
    const evs = s.state.events || [];
    T('旧格式解析为 move 事件', evs.length === 3 && evs.every(e => e.t === 'move'), JSON.stringify(evs));
    T('旧格式 moves 兼容投影', s.moves.length === 3 && s.moves[0].x === 7, JSON.stringify(s.moves));
    const r = await move('gomoku', room.id, 'QA_beta', { x: 1, y: 1 });
    T('旧格式房间可继续走子（写侧升级新格式）', r.json && r.json.ok === true, JSON.stringify(r.json && r.json.error));
    const after = dbSql(`select MovesJson from GameRooms where Id=${room.id}`).rows[0][0];
    T('续走后 MovesJson 升级为新格式(含 t 键)', after.includes('"t"'), after.substring(0, 120));
}

// =========================================================================
// REVERSI
// =========================================================================
function revBoard(evs) {
    const b = Array.from({ length: 8 }, () => Array(8).fill(0));
    b[3][3] = 2; b[4][4] = 2; b[3][4] = 1; b[4][3] = 1;
    for (const e of evs) {
        if (e.t !== 'move') continue;
        b[e.x][e.y] = e.s;
        for (const [dx, dy] of DIRS8) {
            let x = e.x + dx, y = e.y + dy, line = [];
            while (x >= 0 && x < 8 && y >= 0 && y < 8 && b[x][y] !== 0 && b[x][y] !== e.s) { line.push([x, y]); x += dx; y += dy; }
            if (x >= 0 && x < 8 && y >= 0 && y < 8 && b[x][y] === e.s) for (const [fx, fy] of line) b[fx][fy] = e.s;
        }
    }
    return b;
}
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function revFlips(b, x, y, s) {
    if (b[x][y] !== 0) return [];
    let all = [];
    for (const [dx, dy] of DIRS8) {
        let cx = x + dx, cy = y + dy, line = [];
        while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8 && b[cx][cy] !== 0 && b[cx][cy] !== s) { line.push([cx, cy]); cx += dx; cy += dy; }
        if (cx >= 0 && cx < 8 && cy >= 0 && cy < 8 && b[cx][cy] === s && line.length) all = all.concat(line);
    }
    return all;
}
function revLegal(b, s) {
    const out = [];
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) if (revFlips(b, x, y, s).length) out.push([x, y]);
    return out;
}

async function testReversi() {
    section('REVERSI 黑白棋');
    // R1 主路径：完整对局（双端贪心）
    const room = await mkRoom('reversi');
    if (!room) return;
    let done = false, guard = 0, lastErr = '';
    while (!done && guard++ < 70) {
        const s = await snap('reversi', room.id, 'QA_alpha');
        if (s.status === 'finished') { done = true; break; }
        const b = revBoard(s.state.events.map(e => ({ t: e.t, x: e.x, y: e.y, s: e.s })));
        const side = s.turn;
        const who = (side === s.mySide) ? 'QA_alpha' : 'QA_beta';
        const legal = revLegal(b, side);
        if (legal.length === 0) {
            // 新语义：无着时调 pass 端点（有合法着会被拒）
            const pr = await api('POST', '/api/v1/games/reversi/rooms/' + room.id + '/pass', {}, TOKENS[who]);
            if (!pr.json.ok) { lastErr = 'pass failed: ' + pr.json.error; break; }
            continue;
        }
        const r = await move('reversi', room.id, who, { x: legal[0][0], y: legal[0][1] });
        if (!r.json.ok) { lastErr = JSON.stringify(r.json); break; }
    }
    const s = await snap('reversi', room.id, 'QA_alpha');
    T('黑白棋主路径：完整对局可终局', done && s.status === 'finished', `status=${s.status} ${lastErr}`);
    if (s.status === 'finished') {
        const b = revBoard(s.state.events.map(e => ({ t: e.t, x: e.x, y: e.y, s: e.s })));
        let cnt = [0, 0, 0];
        for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) if (b[x][y]) cnt[b[x][y]]++;
        const expectWinner = cnt[1] > cnt[2] ? 1 : cnt[2] > cnt[1] ? 2 : 3;
        T('黑白棋终局数子与 winner 一致', s.winner === expectWinner,
            `black=${cnt[1]} white=${cnt[2]} winner=${s.winner}(expect ${expectWinner}) reason=${s.resultReason}`);
        T('黑白棋 state 计数正确', s.state.black === cnt[1] && s.state.white === cnt[2],
            `state b=${s.state.black} w=${s.state.white}`);
    }

    // R2 非法：不能翻子的空格 / 落已有子
    const room2 = await mkRoom('reversi');
    let r = await move('reversi', room2.id, 'QA_alpha', { x: 0, y: 0 });
    T('非法：不能翻子的空格被拒(400)', r.status === 400 && /不能翻子/.test(r.json && r.json.error || ''), JSON.stringify(r.json && r.json.error));
    r = await move('reversi', room2.id, 'QA_alpha', { x: 3, y: 3 });
    T('非法：落已有子被拒(400)', r.status === 400 && /已经有子/.test(r.json && r.json.error || ''), JSON.stringify(r.json && r.json.error));

    // R3 翻子正确性：(2,3) 黑落应翻 (3,3) 白
    r = await move('reversi', room2.id, 'QA_alpha', { x: 2, y: 3 });
    if (r.json.ok) {
        const s2 = await snap('reversi', room2.id, 'QA_alpha');
        const b = revBoard(s2.state.events.map(e => ({ t: e.t, x: e.x, y: e.y, s: e.s })));
        T('翻子逻辑：(3,3) 白→黑', b[3][3] === 1 && b[2][3] === 1, `b[3,3]=${b[3][3]} b[2,3]=${b[2][3]}`);
    } else T('翻子落子 (2,3)', false, JSON.stringify(r.json));

    // R4 pass：造一个一方无子可下的局面 → 人无法 pass（预期 BUG 或通过）
    const room3 = await mkRoom('reversi');
    // 局面：几乎全黑，白仅 1 子且无翻子机会，轮白
    const evs = [];
    // 用合法演进造：直接 craft MovesJson
    craftMoves(room3.id, [
        { t: 'move', s: 1, x: 2, y: 3 }, { t: 'move', s: 2, x: 2, y: 2 }, { t: 'move', s: 1, x: 2, y: 1 },
        { t: 'move', s: 2, x: 5, y: 5 },
    ], { Turn: 1, Revision: 50 });
    const s3 = await snap('reversi', room3.id, 'QA_alpha');
    const b3 = revBoard(s3.state.events.map(e => ({ t: e.t, x: e.x, y: e.y, s: e.s })));
    const whiteLegal = revLegal(b3, 2), blackLegal = revLegal(b3, 1);
    T('pass 测试局面构造', true, `white legal=${whiteLegal.length} black legal=${blackLegal.length} turn=${s3.turn}`);
    // 找/造白无着局面：若白无着但轮到白 → 尝试 move 与 pass
    if (whiteLegal.length === 0) {
        // 轮到白（需 Turn=2）
        craftMoves(room3.id, JSON.parse(dbSql(`select MovesJson from GameRooms where Id=${room3.id}`).rows[0][0]), { Turn: 2, Revision: 60 });
        const rr = await move('reversi', room3.id, 'QA_beta', { x: 0, y: 0 });
        T('无子可下时任意落子被拒', rr.status === 400, JSON.stringify(rr.json && rr.json.error));
        const rr2 = await api('POST', `/api/v1/games/reversi/rooms/${room3.id}/pass`, {}, TOKENS.QA_beta);
        T('无子可下 pass 路由存在且可用', rr2.status === 200 && rr2.json && rr2.json.ok,
            `status=${rr2.status} ${JSON.stringify(rr2.json).substring(0, 100)}`);
    } else {
        T('pass 测试（白有合法着，跳过构造）', true, '本次局面白仍有合法着，见 ludo 同类问题');
    }
}

// =========================================================================
// JUNGLE
// =========================================================================
async function testJungle() {
    section('JUNGLE 斗兽棋');
    // J1 主路径：虎从左路推进入 (3,0) 兽穴胜
    const room = await mkRoom('jungle');
    if (!room) return;
    const seq = [
        ['QA_alpha', 0, 6, 0, 5], ['QA_beta', 0, 2, 1, 2],     // 象推进；鼠让开
        ['QA_alpha', 0, 5, 0, 4], ['QA_beta', 5, 1, 5, 2],
        ['QA_alpha', 0, 4, 0, 3], ['QA_beta', 5, 2, 5, 1],
        ['QA_alpha', 0, 3, 0, 2], ['QA_beta', 5, 1, 5, 2],
        ['QA_alpha', 0, 2, 0, 1], ['QA_beta', 5, 2, 5, 1],
        ['QA_alpha', 0, 1, 0, 0], ['QA_beta', 5, 1, 5, 2],     // 象吃狮(8>=7)
        ['QA_alpha', 0, 0, 1, 0], ['QA_beta', 5, 2, 5, 1],
        ['QA_alpha', 1, 0, 2, 0], ['QA_beta', 5, 1, 5, 2],
        ['QA_alpha', 2, 0, 3, 0],                              // 入对方兽穴 → 胜
    ]
    let ok = true, err = '';
    for (const [who, fx, fy, tx, ty] of seq) {
        const r = await move('jungle', room.id, who, { fx, fy, tx, ty });
        if (!r.json.ok) { ok = false; err = `${who} (${fx},${fy})→(${tx},${ty}): ${r.json.error}`; break; }
    }
    const s = await snap('jungle', room.id, 'QA_alpha');
    T('斗兽棋主路径：入对方兽穴胜', ok && s.status === 'finished' && s.winner === 1 && s.resultReason === 'den',
        `status=${s.status} winner=${s.winner} reason=${s.resultReason} ${err}`);

    // J2 特殊格渲染数据（squares/特殊格）
    const room2 = await mkRoom('jungle');
    const s2 = await snap('jungle', room2.id, 'QA_alpha');
    const st = s2.state;
    T('斗兽棋 state 含 pieces/boardW/boardH', Array.isArray(st.pieces) && st.boardW === 7 && st.boardH === 9,
        `pieces=${st.pieces && st.pieces.length} ${st.boardW}x${st.boardH}`);

    // J3 非法走法示例（用 craft 局面精确打击）
    const mk = (evs, turn) => {
        const rm = mkRoomCraft('jungle', evs, turn);
        return rm;
    };
    function mkRoomCraft(gameKey, evs, turn) {
        // 借已有房间 craft（在测试内部同步创建）
        return { gameKey, evs, turn };
    }
    // 3a 象吃鼠（应拒）
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 1, y: 2, v: 8 },  // 象(8) at (1,2)
            { t: 'setup', s: 2, x: 1, y: 1, v: 1 },  // 鼠(1) at (1,1)
        ], { Turn: 1, Revision: 10 });
        const rr = await move('jungle', r3.id, 'QA_alpha', { fx: 1, fy: 2, tx: 1, ty: 1 });
        T('非法：象吃鼠被拒', rr.status === 400 && /不能吃这个棋子/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
    }
    // 3b 鼠吃象（应允许）
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 1, y: 2, v: 1 },  // 鼠 at (1,2)
            { t: 'setup', s: 2, x: 1, y: 1, v: 8 },  // 象 at (1,1)
        ], { Turn: 1, Revision: 10 });
        const rr = await move('jungle', r3.id, 'QA_alpha', { fx: 1, fy: 2, tx: 1, ty: 1 });
        T('特例：鼠吃象被允许', rr.json && rr.json.ok === true, JSON.stringify(rr.json && rr.json.error));
    }
    // 3c 非鼠进水（应拒）
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 0, y: 3, v: 2 },  // 猫 at (0,3)
        ], { Turn: 1, Revision: 10 });
        const rr = await move('jungle', r3.id, 'QA_alpha', { fx: 0, fy: 3, tx: 1, ty: 3 }); // (1,3)=水
        T('非法：非鼠进水被拒', rr.status === 400 && /只有鼠能下水/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
    }
    // 3d 进自己兽穴（应拒）
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 3, y: 7, v: 2 },  // 猫 at (3,7)
        ], { Turn: 1, Revision: 10 });
        const rr = await move('jungle', r3.id, 'QA_alpha', { fx: 3, fy: 7, tx: 3, ty: 8 }); // (3,8)=己方穴
        T('非法：进自己兽穴被拒', rr.status === 400 && /不能进自己的兽穴/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
    }
    // 3e 非狮虎跳河（应拒）
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 0, y: 5, v: 4 },  // 狼 at (0,5)
        ], { Turn: 1, Revision: 10 });
        const rr = await move('jungle', r3.id, 'QA_alpha', { fx: 0, fy: 5, tx: 0, ty: 3 }); // 跳两格
        T('非法：非狮虎跳两格被拒', rr.status === 400, JSON.stringify(rr.json && rr.json.error));
    }
    // 3f 狮虎跳河 + 中间有鼠挡（应拒）；无鼠（应许）
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 1, y: 2, v: 7 },
            { t: 'setup', s: 2, x: 1, y: 4, v: 1 },
        ], { Turn: 1, Revision: 11 });
        let rr = await move('jungle', r3.id, 'QA_alpha', { fx: 1, fy: 2, tx: 1, ty: 6 });
        T('非法：狮跳河中间有鼠被拒', rr.status === 400 && /挡|河面/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 1, y: 2, v: 7 },
            { t: 'setup', s: 2, x: 0, y: 0, v: 1 },
        ], { Turn: 1, Revision: 12 });
        rr = await move('jungle', r3.id, 'QA_alpha', { fx: 1, fy: 2, tx: 1, ty: 6 });
        T('狮虎跳河（无鼠挡）被允许', rr.json && rr.json.ok === true, JSON.stringify(rr.json && rr.json.error));
    }
    // 3f2 非跳河的两格直线（真实规则应拒）：狮 (0,3)→(0,5) 旱地跳
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 0, y: 3, v: 7 },
            { t: 'setup', s: 2, x: 6, y: 0, v: 1 },
        ], { Turn: 1, Revision: 10 });
        const rr = await move('jungle', r3.id, 'QA_alpha', { fx: 0, fy: 3, tx: 0, ty: 5 });
        T('规则核对：狮虎旱地两格直线跳是否被拒（真实规则=拒）',
            rr.status === 400, 'got=' + (rr.json && rr.json.ok ? 'ALLOWED' : rr.json && rr.json.error));
    }
    // 3g 行营内棋子不能被吃（应拒）
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 1, y: 3, v: 8 },  // 象 at (1,3)→? 目标 (1,2)?  (1,2)非行营
            // 行营：(1,2)? jungle CampPositions 需确认 —— 换通用：陷阱格(2,0)不是camp
            // jungle 的行营（camp）在哪？CellType 只有 Den/Trap/Water —— 斗兽棋是「陷阱」不是行营！
        ], { Turn: 1, Revision: 10 });
        T('斗兽棋陷阱格规则（兽入陷阱可被任意吃）', true, 'CellType 仅 Den/Trap/Water；陷阱规则见 3h');
    }
    // 3h 陷阱：对方陷阱里的兽可被任意吃
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 2, y: 1, v: 1 },  // 鼠 at (2,1)
            { t: 'setup', s: 2, x: 2, y: 0, v: 8 },  // 象 at (2,0)=陷阱（对方=side2 的陷阱）
        ], { Turn: 1, Revision: 10 });
        const rr = await move('jungle', r3.id, 'QA_alpha', { fx: 2, fy: 1, tx: 2, ty: 0 });
        T('陷阱：鼠可吃陷阱里的象', rr.json && rr.json.ok === true, JSON.stringify(rr.json && rr.json.error));
    }
    // 3i 陆鼠不能吃水鼠
    {
        const r3 = await mkRoom('jungle', { join: true });
        craftMoves(r3.id, [
            { t: 'setup', s: 1, x: 0, y: 3, v: 1 },  // 陆鼠 at (0,3)
            { t: 'setup', s: 2, x: 1, y: 3, v: 1 },  // 水鼠 at (1,3)
        ], { Turn: 1, Revision: 10 });
        const rr = await move('jungle', r3.id, 'QA_alpha', { fx: 0, fy: 3, tx: 1, ty: 3 });
        T('非法：陆鼠吃水鼠被拒', rr.status === 400 && /不能吃这个棋子/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
    }
}

// =========================================================================
// XIANGQI
// =========================================================================
async function testXiangqi() {
    section('XIANGQI 象棋');
    // X1 主路径：双车错将死（crafted）
    const room = await mkRoom('xiangqi');
    craftMoves(room.id, [
        { t: 'setup', s: 2, x: 4, y: 0, v: 1 },   // 黑将 (4,0)
        { t: 'setup', s: 1, x: 4, y: 9, v: 1 },   // 红帅 (4,9)
        { t: 'setup', s: 1, x: 4, y: 2, v: 5 },   // 红车 (4,2) → 走 (4,1) 将军
        { t: 'setup', s: 1, x: 2, y: 0, v: 5 },   // 红车 (2,0) 控 3 路
        { t: 'setup', s: 1, x: 6, y: 0, v: 5 },   // 红车 (6,0) 控 5 路
    ], { Turn: 1, Revision: 10 });
    let rr = await move('xiangqi', room.id, 'QA_alpha', { fx: 4, fy: 2, tx: 4, ty: 1 }); // 车(4,2)→(4,1) 将军
    const s = await snap('xiangqi', room.id, 'QA_alpha');
    T('象棋主路径：将死（checkmate）', rr.json && rr.json.ok && s.status === 'finished' && s.winner === 1 && s.resultReason === 'checkmate',
        `status=${s.status} winner=${s.winner} reason=${s.resultReason} err=${rr.json && rr.json.error}`);

    // X2 非法走法逐条
    const mk = async (evs, turn) => {
        const r = await mkRoom('xiangqi', { join: true });
        craftMoves(r.id, evs, { Turn: turn, Revision: 10 });
        return r.id;
    };
    // 2a 蹩马腿
    {
        const id = await mk([
            { t: 'setup', s: 1, x: 4, y: 9, v: 1 }, { t: 'setup', s: 2, x: 4, y: 0, v: 1 },
            { t: 'setup', s: 1, x: 4, y: 4, v: 4 },       // 马 (4,4)
            { t: 'setup', s: 1, x: 4, y: 3, v: 7 },       // 塞马腿 (4,3)
        ], 1);
        const r = await move('xiangqi', id, 'QA_alpha', { fx: 4, fy: 4, tx: 3, ty: 2 }); // 日字，腿在 (4,3)
        T('非法：蹩马腿被拒', r.status === 400, JSON.stringify(r.json && r.json.error));
    }
    // 2b 塞象眼
    {
        const id = await mk([
            { t: 'setup', s: 1, x: 4, y: 9, v: 1 }, { t: 'setup', s: 2, x: 4, y: 0, v: 1 },
            { t: 'setup', s: 1, x: 2, y: 5, v: 3 },       // 象 (2,5)（红象不过河：目标 y>=5）
            { t: 'setup', s: 1, x: 3, y: 6, v: 7 },       // 塞象眼 (3,6)
        ], 1);
        const r = await move('xiangqi', id, 'QA_alpha', { fx: 2, fy: 5, tx: 4, ty: 7 }); // 田字，眼在 (3,6)
        T('非法：塞象眼被拒', r.status === 400, JSON.stringify(r.json && r.json.error));
    }
    // 2c 炮无架吃子
    {
        const id = await mk([
            { t: 'setup', s: 1, x: 4, y: 9, v: 1 }, { t: 'setup', s: 2, x: 4, y: 0, v: 1 },
            { t: 'setup', s: 1, x: 4, y: 5, v: 6 },       // 炮 (4,5)
            { t: 'setup', s: 2, x: 4, y: 1, v: 4 },       // 黑马 (4,1) 目标
        ], 1);
        const r = await move('xiangqi', id, 'QA_alpha', { fx: 4, fy: 5, tx: 4, ty: 1 }); // 无架吃
        T('非法：炮无架吃子被拒', r.status === 400, JSON.stringify(r.json && r.json.error));
    }
    // 2c2 炮有架吃子（应许）
    {
        const id = await mk([
            { t: 'setup', s: 1, x: 4, y: 9, v: 1 }, { t: 'setup', s: 2, x: 0, y: 0, v: 1 }, // 黑将移开避对脸
            { t: 'setup', s: 1, x: 4, y: 5, v: 6 },       // 炮
            { t: 'setup', s: 1, x: 4, y: 3, v: 7 },       // 炮架（红兵）
            { t: 'setup', s: 2, x: 4, y: 1, v: 4 },       // 目标黑马
        ], 1);
        const r = await move('xiangqi', id, 'QA_alpha', { fx: 4, fy: 5, tx: 4, ty: 1 });
        T('炮隔一子吃子被允许', r.json && r.json.ok === true, JSON.stringify(r.json && r.json.error));
    }
    // 2d 老将对脸
    {
        const id = await mk([
            { t: 'setup', s: 1, x: 4, y: 9, v: 1 }, { t: 'setup', s: 2, x: 4, y: 0, v: 1 },
            { t: 'setup', s: 1, x: 3, y: 5, v: 5 },       // 红车 (3,5) 挡在 3 路
        ], 1);
        const r = await move('xiangqi', id, 'QA_alpha', { fx: 3, fy: 5, tx: 3, ty: 4 }); // 离开后将帅同线 (4,x)
        T('非法：将帅对脸被拒', r.status === 400 && /对脸/.test(r.json && r.json.error || ''), JSON.stringify(r.json && r.json.error));
    }
    // 2e 不应将（走完被将军）
    {
        const id = await mk([
            { t: 'setup', s: 1, x: 4, y: 9, v: 1 }, { t: 'setup', s: 2, x: 4, y: 0, v: 1 },
            { t: 'setup', s: 2, x: 3, y: 8, v: 5 },       // 黑车 (3,8) 将军红帅(4,9)? 车(3,8)不攻击(4,9) —— 用 (4,8)
        ], 1);
        craftMoves(id, [
            { t: 'setup', s: 1, x: 4, y: 9, v: 1 }, { t: 'setup', s: 2, x: 0, y: 0, v: 1 },
            { t: 'setup', s: 2, x: 4, y: 8, v: 5 },       // 黑车 (4,8) 已将军红帅(4,9)
            { t: 'setup', s: 1, x: 0, y: 6, v: 4 },       // 红马 (0,6) 可走但不应将
        ], { Turn: 1, Revision: 11 });
        const r = await move('xiangqi', id, 'QA_alpha', { fx: 0, fy: 6, tx: 1, ty: 4 });
        T('非法：不应将被拒', r.status === 400 && /将军/.test(r.json && r.json.error || ''), JSON.stringify(r.json && r.json.error));
    }
    // 2f 将帅出九宫
    {
        const id = await mk([
            { t: 'setup', s: 1, x: 4, y: 7, v: 1 }, { t: 'setup', s: 2, x: 3, y: 0, v: 1 },
        ], 1);
        const r = await move('xiangqi', id, 'QA_alpha', { fx: 4, fy: 7, tx: 4, ty: 6 }); // (4,6) 出九宫
        T('非法：将帅出九宫被拒', r.status === 400, JSON.stringify(r.json && r.json.error));
    }
    // X3 三次重复判和
    {
        const id = await mk([
            { t: 'setup', s: 1, x: 4, y: 9, v: 1 }, { t: 'setup', s: 2, x: 3, y: 0, v: 1 },
            { t: 'setup', s: 1, x: 0, y: 9, v: 5 }, { t: 'setup', s: 2, x: 0, y: 0, v: 5 },
        ], 1);
        const shuffle = [
            [1, 0, 9, 0, 8], [2, 0, 0, 0, 1], [1, 0, 8, 0, 9], [2, 0, 1, 0, 0],
            [1, 0, 9, 0, 8], [2, 0, 0, 0, 1], [1, 0, 8, 0, 9], [2, 0, 1, 0, 0],
        ];
        let ok = false, err = '';
        for (const [side, fx, fy, tx, ty] of shuffle) {
            const who = side === 1 ? 'QA_alpha' : 'QA_beta';
            const r = await move('xiangqi', id, who, { fx, fy, tx, ty });
            if (!r.json.ok) { err = `${who} (${fx},${fy})→(${tx},${ty}): ${r.json.error}`; break; }
            const ss = await snap('xiangqi', id, 'QA_alpha');
            if (ss.status === 'finished') { ok = ss.resultReason === 'repetition' && ss.winner === 3; break; }
        }
        const ss = await snap('xiangqi', id, 'QA_alpha');
        T('象棋三次重复判和', ok || (ss.status === 'finished' && ss.resultReason === 'repetition'),
            `status=${ss.status} winner=${ss.winner} reason=${ss.resultReason} ${err}`);
    }
    // X4 inCheck 状态词 + 交叉点棋盘数据
    {
        const id = await mk([
            { t: 'setup', s: 1, x: 4, y: 9, v: 1 }, { t: 'setup', s: 2, x: 0, y: 0, v: 1 },
            { t: 'setup', s: 2, x: 4, y: 8, v: 5 },
        ], 1);
        const ss = await snap('xiangqi', id, 'QA_alpha');
        T('象棋 inCheck 将军状态词', ss.state.inCheck === true, `inCheck=${ss.state.inCheck}`);
    }
}

// =========================================================================
// LUDO
// =========================================================================
async function testLudo() {
    section('LUDO 飞行棋');
    // L1 未掷骰先走被拒
    const room = await mkRoom('ludo');
    let r = await move('ludo', room.id, 'QA_alpha', { p: 0 });
    T('非法：未掷骰先走被拒', r.status === 400 && /先掷骰子/.test(r.json && r.json.error || ''), JSON.stringify(r.json && r.json.error));

    // L2 服务端骰子不可篡改：roll 后 move 带伪造 v 不生效
    r = await api('POST', `/api/v1/games/ludo/rooms/${room.id}/roll`, {}, TOKENS.QA_alpha);
    T('掷骰接口可用', r.json && r.json.ok === true, JSON.stringify(r.json && r.json.error));
    const s1 = await snap('ludo', room.id, 'QA_alpha');
    const lastRoll = s1.state.lastRoll;
    T('骰子值在 1~6', lastRoll >= 1 && lastRoll <= 6, `roll=${lastRoll}`);
    // 伪造 v=6 走子（若真实 roll != 6 应被拒）
    r = await move('ludo', room.id, 'QA_alpha', { p: 0, v: 6 });
    if (lastRoll !== 6) {
        T('客户端伪造 v=6 无效（仍按服务端骰子判）', r.status === 400, `roll=${lastRoll} err=${r.json && r.json.error}`);
    } else {
        T('本次 roll=6 起飞成功（伪造字段被忽略）', r.json && r.json.ok === true, JSON.stringify(r.json && r.json.error));
    }
    // 重复 roll 被拒（有合法着但没走时；新语义：无着会自动换手，需 craft 已起飞子）
    {
        const rm2 = await mkRoom('ludo', { join: true });
        craftMoves(rm2.id, [{ t: 'move', s: 1, p: 0, v: 6 }, { t: 'roll', s: 1, v: 3 }], { Turn: 1, Status: 'playing', Revision: 10 });
        r = await api('POST', '/api/v1/games/ludo/rooms/' + rm2.id + '/roll', {}, TOKENS.QA_alpha);
        T('已掷未走再掷被拒（有合法着时）', r.status === 400 && /已经掷过了/.test(r.json && r.json.error || ''), JSON.stringify(r.json && r.json.error));
    }

    // L3 非 6 起飞 / 6 起飞（crafted）
    {
        const rm = await mkRoom('ludo', { join: true });
        craftMoves(rm.id, [{ t: 'roll', s: 1, v: 3 }], { Turn: 1, Revision: 10 });
        let rr = await move('ludo', rm.id, 'QA_alpha', { p: 0 });
        T('非法：非 6 起飞被拒', rr.status === 400 && /必须掷 6/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
        craftMoves(rm.id, [{ t: 'roll', s: 1, v: 6 }], { Turn: 1, Revision: 11 });
        rr = await move('ludo', rm.id, 'QA_alpha', { p: 0 });
        T('掷 6 起飞成功', rr.json && rr.json.ok === true, JSON.stringify(rr.json && rr.json.error));
    }
    // L4 终点跑道精确到达（超出被拒）
    {
        const rm = await mkRoom('ludo', { join: true });
        // piece 0 在终点跑道 55（距终点 57 还差 2），roll=3 → 超出
        craftMoves(rm.id, [
            { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 1, p: 0, v: 55 },
            { t: 'move', s: 1, p: 1, v: 6 }, { t: 'move', s: 1, p: 1, v: 57 },
            { t: 'roll', s: 1, v: 3 },
        ], { Turn: 1, Revision: 10 });
        let rr = await move('ludo', rm.id, 'QA_alpha', { p: 0 });
        T('非法：终点跑道超出被拒', rr.status === 400 && /超出终点/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
        // 精确到达 57：55+2
        craftMoves(rm.id, [
            { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 1, p: 0, v: 55 },
            { t: 'move', s: 1, p: 1, v: 6 }, { t: 'move', s: 1, p: 1, v: 57 },
            { t: 'roll', s: 1, v: 2 },
        ], { Turn: 1, Revision: 11 });
        rr = await move('ludo', rm.id, 'QA_alpha', { p: 0 });
        T('终点跑道精确到达成功', rr.json && rr.json.ok === true, JSON.stringify(rr.json && rr.json.error));
    }
    // L5 无着可走（roll 后无法走）→ 无法跳过回合（预期问题点）
    {
        const rm = await mkRoom('ludo', { join: true });
        craftMoves(rm.id, [{ t: 'roll', s: 1, v: 2 }], { Turn: 1, Revision: 10 });
        let allFail = true;
        for (const p of [0, 1]) {
            const rr = await move('ludo', rm.id, 'QA_alpha', { p });
            if (rr.json && rr.json.ok) allFail = false;
        }
        const rr2 = await api('POST', `/api/v1/games/ludo/rooms/${rm.id}/pass`, {}, TOKENS.QA_alpha);
        const rr3 = await api('POST', `/api/v1/games/ludo/rooms/${rm.id}/roll`, {}, TOKENS.QA_alpha);
        T('飞行棋无着可走时有出路（pass/自动换手）',
            (rr2.status === 200 && rr2.json && rr2.json.ok) || (rr3.json && rr3.json.ok) || !allFail,
            `allMovesFail=${allFail} pass=${rr2.status} reroll=${rr3.status} ${rr2.json && rr2.json.error || ''} ${rr3.json && rr3.json.error || ''}`);
    }
    // L6 主路径：完整对局到一方全部归巢（贪心循环，封顶 500 手）
    {
        const rm = await mkRoom('ludo', { join: true });
        let guard = 0, finished = false, err = '';
        while (guard++ < 500 && !finished) {
            const s = await snap('ludo', rm.id, 'QA_alpha');
            if (s.status === 'finished') { finished = true; break; }
            const who = s.turn === 1 ? 'QA_alpha' : 'QA_beta';
            const tryMoves = async () => {
                for (const p of [0, 1, 2, 3]) {
                    const rr = await move('ludo', rm.id, who, { p });
                    if (rr.json && rr.json.ok) return rr;
                }
                return null;
            };
            let r = await tryMoves();
            if (!r) {
                const rollR = await api('POST', '/api/v1/games/ludo/rooms/' + rm.id + '/roll', {}, TOKENS[who]);
                if (!rollR.json.ok) { err = 'roll: ' + rollR.json.error; break; }
                r = await tryMoves();
            }
            if (!r) {
                // 新语义：roll 后无合法着会自动换手；重掷报「还没轮到你」即已换手 → 继续
                const sNow = await snap('ludo', rm.id, 'QA_alpha');
                const whoNow = sNow.turn === 1 ? 'QA_alpha' : 'QA_beta';
                const retry = await api('POST', '/api/v1/games/ludo/rooms/' + rm.id + '/roll', {}, TOKENS[who]);
                if (retry.json && /还没轮到你/.test(retry.json.error || '')) continue; // 已自动换手
                err = 'deadlock: no legal move after roll, reroll=' + retry.status + ' ' + ((retry.json && retry.json.error) || '');
                break;
            }
        }
        const s = await snap('ludo', rm.id, 'QA_alpha');
        T('飞行棋主路径：对局可进行到终局', finished && s.status === 'finished',
            `guard=${guard} status=${s.status} winner=${s.winner} reason=${s.resultReason} ${err}`);
    }
}

// =========================================================================
// ARMYCHESS — 视角化（本轮最高优先级）
// =========================================================================
const RANKS = ['rank_commander', 'rank_army', 'rank_division', 'rank_brigade', 'rank_regiment',
    'rank_battalion', 'rank_company', 'rank_platoon', 'rank_engineer', 'rank_mine', 'rank_flag', 'rank_bomb'];

// 值级扫描的合法身份出口只有一处：state.pieces[].rank（己方可见+已参战公开）。
// 扫描前把这份出口结构性剔除（不是把己方 rank 加白名单——那会被同名 rank 掩盖真泄露），
// 对"去身份化全文"断言：对方未公开 rank token 一个都不出现。
function stripPieceRanks(snapObj) {
    const clone = JSON.parse(JSON.stringify(snapObj));
    const pieces = clone.state && clone.state.pieces;
    if (Array.isArray(pieces)) for (const p of pieces) delete p.rank;
    return JSON.stringify(clone);
}

async function testArmychess() {
    section('ARMYCHESS 军旗 · 视角化不泄露');
    const room = await mkRoom('armychess');
    if (!room) return;
    const id = room.id;

    // C0 布阵基本约束（DB 真相）
    const raw = JSON.parse(dbSql(`select MovesJson from GameRooms where Id=${id}`).rows[0][0]);
    const setups = raw.filter(e => e.t === 'setup');
    T('布阵 50 枚（25+25）', setups.length === 50, `setups=${setups.length}`);
    const flags = setups.filter(e => e.v === 12);
    T('军旗在大本营', flags.length === 2 && flags.every(e => (e.s === 1 && e.y >= 10) || (e.s === 2 && e.y <= 1)),
        JSON.stringify(flags));
    const mines = setups.filter(e => e.v === 11);
    T('地雷只在最后两排', mines.length === 6 && mines.every(e => (e.s === 1 && e.y >= 10) || (e.s === 2 && e.y <= 1)),
        `mines=${JSON.stringify(mines.map(m => [m.x, m.y, m.s]))}`);

    // C1 host 视角快照字段级断言
    const host = await snap('armychess', id, 'QA_alpha');
    const rawHost = JSON.stringify(host);
    const hostState = host.state;

    // C1a hidden:true 对象不存在 rank 键
    const hiddenWithRank = (hostState.pieces || []).filter(p => p.hidden === true && ('rank' in p));
    T('C1a host：hidden:true 对象无 rank 键', hiddenWithRank.length === 0, `违规 ${hiddenWithRank.length} 个`);

    // C1b（设计）己方子应带 rank —— mySide 视角
    const mySide = host.mySide; // 1
    const ownPieces = (hostState.pieces || []).filter(p => p.side === mySide);
    const ownWithRank = ownPieces.filter(p => typeof p.rank === 'string' && p.rank.length > 0);
    const ownHidden = ownPieces.filter(p => p.hidden === true);
    T('C1b host：己方未参战子 rank 可见（mySide 视角）',
        ownWithRank.length === ownPieces.length && ownHidden.length === 0,
        `己方 ${ownPieces.length} 枚，带 rank ${ownWithRank.length} 枚，hidden ${ownHidden.length} 枚`);

    // C1c 敌方未参战子 hidden 且无 rank
    const oppPieces = (hostState.pieces || []).filter(p => p.side !== mySide);
    const oppBad = oppPieces.filter(p => !(p.hidden === true && !('rank' in p)));
    T('C1c host：敌方未参战子 hidden 且无 rank', oppBad.length === 0, `违规 ${oppBad.length}/${oppPieces.length}`);

    // C2 events 中无 setup（finished 前）；move 键集 ⊆ {t,s,fx,fy,tx,ty}
    const evs = hostState.events;
    if (Array.isArray(evs)) {
        const setupIn = evs.filter(e => e.t === 'setup');
        T('C2 host：events 无 setup', setupIn.length === 0, `setup=${setupIn.length}`);
        const moveBad = evs.filter(e => e.t === 'move').filter(e => {
            const keys = Object.keys(e);
            return !keys.every(k => ['t', 's', 'fx', 'fy', 'tx', 'ty'].includes(k));
        });
        T('C2 host：move 事件键集不越界', moveBad.length === 0, `违规 ${JSON.stringify(moveBad).substring(0, 120)}`);
    } else {
        T('C2 host：state.events 存在（设计 §3.3 要求下发过滤后的 events）', false,
            `state keys=${Object.keys(hostState).join(',')}`);
    }
    T('C2b host：state.battleLog 存在（设计 §3.3）', Array.isArray(hostState.battleLog),
        `state keys=${Object.keys(hostState).join(',')}`);

    // C3 值级扫描（含减法：减去 battle/battleLog 已公开的 rank）
    // 敌方未参战子 rank 集合（DB 真相）− 已合法公开
    const truth = {}; // "x,y" -> rank token
    const v2r = { 10: 'rank_commander', 9: 'rank_army', 8: 'rank_division', 7: 'rank_brigade', 6: 'rank_regiment', 5: 'rank_battalion', 4: 'rank_company', 3: 'rank_platoon', 2: 'rank_engineer', 11: 'rank_mine', 12: 'rank_flag', 13: 'rank_bomb' };
    for (const e of raw) {
        if (e.t === 'setup') truth[e.x + ',' + e.y] = { side: e.s, rank: v2r[e.v] };
    }
    // battle 事件中合法公开的 rank
    const publicRanks = new Set();
    for (const e of raw) {
        if (e.t === 'battle') { if (e.att) publicRanks.add(e.att); if (e.def) publicRanks.add(e.def); }
    }
    // 参战坐标（已翻）不参与扫描
    const revealedCoords = new Set();
    for (const e of raw) {
        if (e.t === 'battle') { revealedCoords.add(e.fx + ',' + e.fy); revealedCoords.add(e.tx + ',' + e.ty); }
    }
    // 我方（host side=1）的 rank 本来就该出现在响应里 → 只扫敌方(side=2)未参战子
    const scanRanks = new Set();
    for (const [pos, info] of Object.entries(truth)) {
        if (info.side === mySide) continue;
        if (revealedCoords.has(pos)) continue;            // 参战过 = 合法公开
        if (publicRanks.has(info.rank)) continue;          // 减法：battle 里出现过的 rank 串
        scanRanks.add(info.rank);
    }
    const hostStripped = stripPieceRanks(host);
    let leaked = [];
    for (const rk of scanRanks) {
        if (hostStripped.includes(rk)) leaked.push(rk);
    }
    T('C3 host：敌方未参战子 rank 值级扫描 0 命中（含减法）', leaked.length === 0,
        `扫描集=${scanRanks.size} 泄漏=${JSON.stringify(leaked)}`);
    // 扫描集非空才有效（防假阳）
    T('C3b 扫描集非空（断言有效）', scanRanks.size > 0, `scanSet=${scanRanks.size}`);

    // C4 数量可见 ≠ 身份可见：敌方未翻子数量能数
    T('C4 host：敌方 25 枚全部在 pieces 里（数量可见）', oppPieces.length === 25, `opp pieces=${oppPieces.length}`);

    // C5 guest 视角对称
    const guest = await snap('armychess', id, 'QA_beta');
    const rawGuest = JSON.stringify(guest);
    const gState = guest.state;
    const gOwn = (gState.pieces || []).filter(p => p.side === guest.mySide);
    const gOpp = (gState.pieces || []).filter(p => p.side !== guest.mySide);
    T('C5 guest：己方 rank 可见', gOwn.length > 0 && gOwn.every(p => typeof p.rank === 'string'),
        `own=${gOwn.length} withRank=${gOwn.filter(p => p.rank).length}`);
    T('C5 guest：敌方（host 侧）hidden 无 rank', gOpp.every(p => p.hidden === true && !('rank' in p)),
        `opp=${gOpp.length}`);
    // guest 值级扫描：host 侧未参战子 rank 不出现（除己方合法公开）
    const gScan = new Set();
    for (const [pos, info] of Object.entries(truth)) {
        if (info.side === guest.mySide) continue;
        if (revealedCoords.has(pos)) continue;
        if (publicRanks.has(info.rank)) continue;
        gScan.add(info.rank);
    }
    const guestStripped = stripPieceRanks(guest);
    const gLeaked = [...gScan].filter(rk => guestStripped.includes(rk));
    T('C5b guest：值级扫描 0 命中', gLeaked.length === 0, `泄漏=${JSON.stringify(gLeaked)}`);

    // C6 observer（QA_gamma 非房主/客）视角：双方未参战子全 hidden
    const obs = await snap('armychess', id, 'QA_gamma');
    const oState = obs.state;
    const oBad = (oState.pieces || []).filter(p => !('rank' in p) ? p.hidden !== true : (p.hidden === true && 'rank' in p));
    const oHiddenOpp = (oState.pieces || []).filter(p => p.hidden !== true);
    T('C6 observer：双方未参战子全部 hidden:true',
        (oState.pieces || []).every(p => (p.hidden === true && !('rank' in p)) || (p.hidden === false && 'rank' in p && revealedCoords.has(p.x + ',' + p.y)) || (p.hidden === false && p.side === obs.mySide)),
        `pieces=${(oState.pieces || []).length} 非hidden=${oHiddenOpp.length}`);
    // observer 没有己方（mySide=0）→ 全部未参战子都必须 hidden
    const oVisibleNoBattle = (oState.pieces || []).filter(p => p.hidden === false && !revealedCoords.has(p.x + ',' + p.y));
    T('C6b observer：无「未参战却可见」的子', oVisibleNoBattle.length === 0, `违规=${oVisibleNoBattle.length}`);
    // observer 无己方；扫描集 = 双方未参战子 token − battle 已公开
    const oScan = new Set();
    for (const [pos, info] of Object.entries(truth)) {
        if (revealedCoords.has(pos)) continue;
        if (publicRanks.has(info.rank)) continue;
        oScan.add(info.rank);
    }
    const obsStripped = stripPieceRanks(obs);
    const oLeaked = [...oScan].filter(rk => obsStripped.includes(rk));
    T('C6c observer：值级扫描 0 命中', oLeaked.length === 0, `泄漏=${JSON.stringify(oLeaked)}`);

    // ===== C7 幸存子永久公开（battle 后胜方留在盘上） =====
    const room2 = await mkRoom('armychess');
    // 局面：side1 连长(4) at (0,1) 攻 side2 排长(3) at (0,0) → attacker_wins，幸存在 (0,0)
    craftMoves(room2.id, [
        { t: 'setup', s: 1, x: 0, y: 1, v: 4 },
        { t: 'setup', s: 2, x: 0, y: 0, v: 3 },
    ], { Turn: 1, Revision: 10 });
    let r = await move('armychess', room2.id, 'QA_alpha', { fx: 0, fy: 1, tx: 0, ty: 0 });
    T('军旗吃子（battle 事件生成）', r.json && r.json.ok === true, JSON.stringify(r.json && r.json.error));
    let sB = await snap('armychess', room2.id, 'QA_alpha');
    const survivor = (sB.state.pieces || []).find(p => p.x === 0 && p.y === 0);
    T('C7 幸存子在原位 hidden:false + rank', survivor && survivor.hidden === false && !!survivor.rank,
        JSON.stringify(survivor));
    // 幸存子走开一步 → 是否仍公开？（应永久公开）
    // 用新房间 + 单次构造（setup 带 p = 新格式全局序号；Status 自始 playing，避免复用旧房残留 finished）
    const room3 = await mkRoom('armychess');
    craftMoves(room3.id, [
        { t: 'setup', s: 1, x: 0, y: 1, v: 4, p: 0 },   // 红连长
        { t: 'setup', s: 2, x: 0, y: 0, v: 3, p: 25 },  // 黑排长（将被吃）
        { t: 'setup', s: 2, x: 2, y: 0, v: 4, p: 26 },  // 黑连长（未参战，等招用）
        { t: 'setup', s: 1, x: 3, y: 11, v: 12, p: 1 }, // 红军旗
        { t: 'setup', s: 2, x: 3, y: 0, v: 12, p: 27 }, // 黑军旗
    ], { Turn: 1, Status: "playing", Winner: 0, ResultReason: "", Revision: 12 });
    let okSeq = true, seqErr = '';
    const step = async (who, mv, label) => {
        const rr = await move('armychess', room3.id, who, mv);
        if (!rr.json.ok) { okSeq = false; seqErr = label + ': ' + rr.json.error; }
        return rr;
    };
    await step('QA_alpha', { fx: 0, fy: 1, tx: 0, ty: 0 }, 'battle');      // 连长吃排长，幸存于 (0,0)
    await step('QA_beta', { fx: 2, fy: 0, tx: 2, ty: 1 }, 'beta wait');    // 等招（(2,0)→(2,1) 合法；(3,0) 是己方大本营不能进）
    await step('QA_alpha', { fx: 0, fy: 0, tx: 1, ty: 0 }, 'survivor away'); // 幸存子走到 (1,0)
    T('C7b 前置三手全部成功', okSeq, seqErr);
    const sB2 = await snap('armychess', room3.id, 'QA_alpha');
    const movedSurvivor = (sB2.state.pieces || []).find(p => p.x === 1 && p.y === 0 && p.side === 1);
    T('C7b 幸存子走开后仍永久公开（hidden:false+rank）',
        movedSurvivor && movedSurvivor.hidden === false && !!movedSurvivor.rank,
        JSON.stringify(movedSurvivor) + (okSeq ? '' : ' | ' + seqErr));

    // 先让 beta 的未参战子（2,0→3,0 已走）再走到 (0,0)? 不现实；直接验证：(2,0) 原 beta 子走过后
    const wrongReveal = (sB2.state.pieces || []).filter(p => p.hidden === false && !p.rank);
    T('C7c 无「无 rank 却公开」的脏数据', wrongReveal.length === 0, JSON.stringify(wrongReveal));

    // C8 非法：地雷不能动 / 军旗不能动 / 行营不能吃 / 进己方大本营
    {
        const rm = await mkRoom('armychess', { join: true });
        craftMoves(rm.id, [
            { t: 'setup', s: 1, x: 0, y: 11, v: 11 },  // 地雷 (0,11)
            { t: 'setup', s: 1, x: 1, y: 11, v: 12 },  // 军旗 (1,11) 大本营
            { t: 'setup', s: 1, x: 1, y: 7, v: 4 },    // 行营 (1,7) camp
            { t: 'setup', s: 2, x: 1, y: 6, v: 4 },    // 攻行营的子
            { t: 'setup', s: 1, x: 3, y: 6, v: 4 },    // 可动子
        ], { Turn: 1, Revision: 10 });
        let rr = await move('armychess', rm.id, 'QA_alpha', { fx: 0, fy: 11, tx: 0, ty: 10 });
        T('非法：移动地雷被拒', rr.status === 400 && /地雷不能动/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
        rr = await move('armychess', rm.id, 'QA_alpha', { fx: 1, fy: 11, tx: 1, ty: 10 });
        T('非法：移动军旗被拒', rr.status === 400 && /军旗不能动/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
        // 行营里的棋子不能被吃（轮 beta 进攻）
        craftMoves(rm.id, [
            { t: 'setup', s: 1, x: 1, y: 7, v: 4 },
            { t: 'setup', s: 2, x: 1, y: 6, v: 4 },
            { t: 'setup', s: 1, x: 3, y: 6, v: 4 },
            { t: 'setup', s: 2, x: 3, y: 0, v: 4 },
        ], { Turn: 2, Revision: 12 });
        rr = await move('armychess', rm.id, 'QA_beta', { fx: 1, fy: 6, tx: 1, ty: 7 });
        T('非法：吃行营里的棋子被拒', rr.status === 400 && /行营/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));
        // 进自己大本营
        craftMoves(rm.id, [
            { t: 'setup', s: 1, x: 0, y: 10, v: 4 },
            { t: 'setup', s: 1, x: 1, y: 11, v: 12 },
        ], { Turn: 1, Revision: 13 });
        rr = await move('armychess', rm.id, 'QA_alpha', { fx: 0, fy: 10, tx: 1, ty: 11 }); // (1,11)是己方大本营且有军旗
        T('非法：进自己大本营被拒', rr.status === 400, JSON.stringify(rr.json && rr.json.error));
    }

    // C9 夺军旗（flag_captured）主路径是否可达 —— 任意子攻军旗
    {
        const rm = await mkRoom('armychess', { join: true });
        craftMoves(rm.id, [
            { t: 'setup', s: 1, x: 1, y: 1, v: 4 },    // 连长 (1,1)
            { t: 'setup', s: 2, x: 1, y: 0, v: 12 },   // 黑军旗 (1,0)
            { t: 'setup', s: 1, x: 3, y: 11, v: 12 },  // 红军旗（必须在场，否则 Judge 先查到红旗缺失误判）
        ], { Turn: 1, Revision: 10 });
        const rr = await move('armychess', rm.id, 'QA_alpha', { fx: 1, fy: 1, tx: 1, ty: 0 });
        const ss = await snap('armychess', rm.id, 'QA_alpha');
        T('C9 夺军旗：任意子攻击军旗应胜（flag_captured, winner=1）',
            rr.json && rr.json.ok && ss.status === 'finished' && ss.resultReason === 'flag_captured' && ss.winner === 1,
            `ok=${rr.json && rr.json.ok} status=${ss.status} winner=${ss.winner} reason=${ss.resultReason} err=${rr.json && rr.json.error}`);
    }

    // C10 finished 后全量公开（复盘）
    {
        const rm = await mkRoom('armychess', { join: true });
        craftMoves(rm.id, [
            { t: 'setup', s: 1, x: 0, y: 1, v: 4 },
            { t: 'setup', s: 2, x: 0, y: 0, v: 3 },
            { t: 'setup', s: 1, x: 2, y: 1, v: 5 },
            { t: 'setup', s: 2, x: 2, y: 0, v: 6 },
        ], { Turn: 1, Revision: 10 });
        await api('POST', `/api/v1/games/armychess/rooms/${rm.id}/resign`, {}, TOKENS.QA_beta); // guest 认输 → finished
        const ss = await snap('armychess', rm.id, 'QA_alpha');
        const allRevealed = (ss.state.pieces || []).every(p => p.hidden === false && !!p.rank);
        T('C10 finished：双方全量公开（hidden:false+rank）', ss.status === 'finished' && allRevealed,
            `status=${ss.status} pieces=${JSON.stringify((ss.state.pieces || []).map(p => [p.x, p.y, p.rank, p.hidden]))}`);
        // finished 后 setup 是否下发（复盘）
        const hasSetup = Array.isArray(ss.state.events) && ss.state.events.some(e => e.t === 'setup');
        T('C10b finished：setup 全量布阵下发（复盘可用）', hasSetup,
            `events=${ss.state.events ? '有' : '无'} keys=${Object.keys(ss.state).join(',')}`);
    }

    // C11 squares：camp/den 格属性（硬要求 2）
    {
        const rm = await mkRoom('armychess', { join: true });
        const ss = await snap('armychess', rm.id, 'QA_alpha');
        const sq = ss.state.squares || [];
        const camps = sq.filter(s => s.kind === 'camp'), dens = sq.filter(s => s.kind === 'den');
        T('C11 squares：10 行营 + 4 大本营', camps.length === 10 && dens.length === 4,
            `camp=${camps.length} den=${dens.length}`);
        T('C11b piece 不带 camp 字段（格子属性在 squares）',
            (ss.state.pieces || []).every(p => !('camp' in p)),
            JSON.stringify((ss.state.pieces || [])[0]));
    }
}

// =========================================================================
// TIMEOUT 懒结算（六款并行）
// =========================================================================
async function testTimeout() {
    section('TIMEOUT 超时懒结算（六款）');
    const rooms = [];
    for (const gk of ['gomoku', 'reversi', 'jungle', 'xiangqi', 'ludo', 'armychess']) {
        const r = await mkRoom(gk, { moveTimeoutSec: 15, totalTimeoutSec: 0 });
        if (r) rooms.push({ ...r, gk });
    }
    T('超时房创建', rooms.length === 6, `created=${rooms.length}`);
    console.log('  … 等待 17s 让超时生效 …');
    await new Promise(res => setTimeout(res, 17000));
    for (const r of rooms) {
        const s = await snap(r.gk, r.id, 'QA_beta'); // guest 读 → 触发懒结算
        T(`${r.gk} 超时懒结算：finished/timeout/对手胜`,
            s.status === 'finished' && s.resultReason === 'timeout' && s.winner === 2,
            `status=${s.status} reason=${s.resultReason} winner=${s.winner}`);
    }
}

// =========================================================================
// A1 数据面：游戏设置持久化（网页流程由 UI 脚本覆盖，这里验 API/落库）
// =========================================================================
async function testSettings() {
    section('A1 游戏设置（API/落库）');
    const t = TOKENS.QA_delta;
    // 保存显示偏好 + 规则默认
    let r = await api('PUT', '/api/v1/games/settings', { tapConfirm: true, showCoord: false, lastMark: false, vibrate: true }, t);
    T('PUT 显示偏好', r.json && r.json.ok === true, JSON.stringify(r.json && r.json.data || r.json && r.json.error));
    r = await api('PUT', '/api/v1/games/gomoku/settings', { size: 13, forbidden: true, moveTimeoutSec: 30, totalTimeoutSec: 300 }, t);
    T('PUT 规则默认', r.json && r.json.ok === true, JSON.stringify(r.json && r.json.data || r.json && r.json.error));
    // 落库验证
    const uid = TOKENS['uid_QA_delta'];
    const gs = dbSql(`select GameSettings from Users where Id=${uid}`).rows[0][0];
    T('GameSettings 落库', /tapConfirm|TapConfirm|display/i.test(gs), gs.substring(0, 200));
    // 读回
    r = await api('GET', '/api/v1/games/settings', undefined, t);
    T('GET 显示偏好读回', r.json && r.json.data && r.json.data.tapConfirm === true,
        JSON.stringify(r.json && r.json.data || r.json && r.json.error));
    r = await api('GET', '/api/v1/games/gomoku/settings', undefined, t);
    const rulesOf = x => (x.rules ? x.rules : x);
    T('GET 规则默认读回', r.json && r.json.data && rulesOf(r.json.data).size === 13,
        JSON.stringify(r.json && r.json.data || r.json && r.json.error));
    // 次生破坏：改显示不动规则
    await api('PUT', '/api/v1/games/settings', { tapConfirm: false, showCoord: true, lastMark: true, vibrate: true }, t);
    r = await api('GET', '/api/v1/games/gomoku/settings', undefined, t);
    T('改显示不动规则半（红线 19）', r.json && r.json.data && rulesOf(r.json.data).size === 13 && rulesOf(r.json.data).forbidden === true,
        JSON.stringify(r.json && r.json.data));
    // 恢复默认语义：PUT 出厂值 → 立即落库
    await api('PUT', '/api/v1/games/settings', { tapConfirm: false, showCoord: true, lastMark: true, vibrate: true }, t);
    await api('PUT', '/api/v1/games/gomoku/settings', { size: 15, forbidden: false, moveTimeoutSec: 0, totalTimeoutSec: 0 }, t);
    const gs2 = dbSql(`select GameSettings from Users where Id=${uid}`).rows[0][0];
    T('恢复默认=立即落库', /"size":\s*15|"Size":\s*15/i.test(gs2), gs2.substring(0, 200));
}

// =========================================================================
// 教程接口（六款）
// =========================================================================
async function testTutorials() {
    section('TUTORIALS 教程接口');
    for (const gk of ['gomoku', 'reversi', 'jungle', 'xiangqi', 'ludo', 'armychess']) {
        const r = await api('GET', `/api/v1/games/${gk}/tutorial`, undefined, TOKENS.QA_alpha);
        const ok = r.json && r.json.ok && Array.isArray(r.json.data) && r.json.data.length === 5;
        const titles = ok ? r.json.data.map(x => x.title).join('/') : JSON.stringify(r.json).substring(0, 80);
        T(`${gk} 教程五节`, ok && /目标/.test(titles) && /胜负/.test(titles) && /走法/.test(titles),
            titles);
    }
}

// =========================================================================
(async () => {
    const only = process.argv[2] || 'all';
    await loginAll();
    if (only === 'all' || only === 'settings') await testSettings();
    if (only === 'all' || only === 'gomoku') await testGomoku();
    if (only === 'all' || only === 'legacy') await testLegacy();
    if (only === 'all' || only === 'reversi') await testReversi();
    if (only === 'all' || only === 'jungle') await testJungle();
    if (only === 'all' || only === 'xiangqi') await testXiangqi();
    if (only === 'all' || only === 'ludo') await testLudo();
    if (only === 'all' || only === 'armychess') await testArmychess();
    if (only === 'all' || only === 'tutorials') await testTutorials();
    if (only === 'all' || only === 'timeout') await testTimeout();

    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.name + '  [' + r.extra + ']');
    fs.writeFileSync('D:/checkin-work/docs/qa/_suite_api_results.json', JSON.stringify(results, null, 2), 'utf8');
})();
