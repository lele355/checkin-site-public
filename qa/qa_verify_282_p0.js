// qa_verify_282_p0.js — 2.8.2 P0 复验（QA 独立脚本，不改产品源码）
// 覆盖 Bug#2 读写/建房/设置持久化 + 旧扁平兼容 + 建房路径 setter 副作用实测
const { execFileSync } = require('child_process');

const BASE = 'http://127.0.0.1:5188';
const DB = 'D:/checkin/site/CheckinApp/data/checkin.db';
const PW = 'QaGames2026!';

const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}

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

async function login(u) {
    const r = await api('POST', '/api/v1/auth/login', { username: u, password: PW, device: 'qa-verify-282' });
    return r.json && r.json.ok ? r.json.data.token : null;
}

function settingsOf(uid) {
    return dbSql(`select GameSettings from Users where Id=${uid}`).rows[0][0];
}

(async () => {
    const tokA = await login('QA_alpha');
    T('登录 QA_alpha', !!tokA);
    const uidA = dbSql("select Id from Users where Username='QA_alpha'").rows[0][0];

    // ---------------- A. 设置写读往返（设置页持久化等价） ----------------
    console.log('\n===== A. 设置保存/重读（读侧） =====');
    let r = await api('PUT', '/api/v1/games/gomoku/settings', { size: 13, forbidden: true, moveTimeoutSec: 0, totalTimeoutSec: 0 }, tokA);
    T('PUT gomoku settings size=13', r.json && r.json.ok && r.json.data.size === 13, `resp=${JSON.stringify(r.json && r.json.data)}`);

    r = await api('GET', '/api/v1/games/gomoku/settings', undefined, tokA);
    T('GET gomoku settings size=13', r.json && r.json.ok && r.json.data.rules.size === 13, `rules=${JSON.stringify(r.json && r.json.data.rules)}`);
    T('GET gomoku settings forbidden=true', r.json && r.json.ok && r.json.data.rules.forbidden === true, '');

    // 再存一次 19，模拟「改盘面大小 → 保存 → 重新 Load」
    r = await api('PUT', '/api/v1/games/gomoku/settings', { size: 19, forbidden: false, moveTimeoutSec: 0, totalTimeoutSec: 0 }, tokA);
    r = await api('GET', '/api/v1/games/gomoku/settings', undefined, tokA);
    T('改 19 后重读仍 19', r.json && r.json.ok && r.json.data.rules.size === 19, `size=${r.json && r.json.data.rules.size}`);

    // 回到 13 供后续建房用
    await api('PUT', '/api/v1/games/gomoku/settings', { size: 13, forbidden: true, moveTimeoutSec: 0, totalTimeoutSec: 0 }, tokA);
    const raw = settingsOf(uidA);
    T('DB 存量含嵌套 Games.gomoku', raw.includes('"Games"') && raw.includes('gomoku'), `raw=${raw.slice(0, 220)}`);

    // ---------------- B. 建房实际生效 ----------------
    console.log('\n===== B. 建房 size 实测 =====');
    // B1: 请求显式 size=13（App PvP 建房路径：只传 size+forbidden，不传限时）
    r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size: 13, forbidden: true }, tokA);
    const id13 = r.json && r.json.ok ? r.json.data.id : null;
    T('B1 建房 size=13 返回 size=13', r.json && r.json.ok && r.json.data.size === 13, `resp=${JSON.stringify(r.json && r.json.data)}`);
    if (id13) {
        const row = dbSql(`select Size, Forbidden, MoveTimeoutSec, GameKey from GameRooms where Id=${id13}`).rows[0];
        T('B1 GameRooms 落库 Size=13', row[0] == 13, `db row=${JSON.stringify(row)}`);
        T('B1 GameRooms 落库 Forbidden=1', row[1] == 1 || row[1] === true, `db row=${JSON.stringify(row)}`);
    }

    // B2: size=19
    r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size: 19 }, tokA);
    const id19 = r.json && r.json.ok ? r.json.data.id : null;
    T('B2 建房 size=19 返回 size=19', r.json && r.json.ok && r.json.data.size === 19, `resp size=${r.json && r.json.data.size}`);
    if (id19) {
        const row = dbSql(`select Size from GameRooms where Id=${id19}`).rows[0];
        T('B2 GameRooms 落库 Size=19', row[0] == 19, `db Size=${row[0]}`);
    }

    // B3: size=13 且带 moveTimeoutSec（请求带限时，走 GamesApi setter 路径）
    r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size: 13, forbidden: true, moveTimeoutSec: 30, totalTimeoutSec: 600 }, tokA);
    const id13t = r.json && r.json.ok ? r.json.data.id : null;
    T('B3 建房 size=13+限时 返回 size=13', r.json && r.json.ok && r.json.data.size === 13, `resp=${JSON.stringify(r.json && r.json.data)}`);
    if (id13t) {
        const row = dbSql(`select Size, Forbidden, MoveTimeoutSec from GameRooms where Id=${id13t}`).rows[0];
        T('B3 GameRooms 落库 Size=13（带限时）', row[0] == 13, `db row=${JSON.stringify(row)}`);
    }

    // B4: AI 建房不传 size（App「人机对战」路径：只传 opponent=ai，靠用户存的设置）
    r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, opponent: 'ai', aiLevel: 2 }, tokA);
    const idai = r.json && r.json.ok ? r.json.data.id : null;
    T('B4 AI建房(不传size) 用存量 size=13', r.json && r.json.ok && r.json.data.size === 13, `resp=${JSON.stringify(r.json && r.json.data)}`);
    if (idai) {
        const row = dbSql(`select Size, Forbidden, AiLevel from GameRooms where Id=${idai}`).rows[0];
        T('B4 GameRooms 落库 Size=13（AI）', row[0] == 13, `db row=${JSON.stringify(row)}`);
    }

    // B5: AI 建房显式传 size=13
    r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size: 13, opponent: 'ai', aiLevel: 2 }, tokA);
    T('B5 AI建房(显式size=13) 返回 13', r.json && r.json.ok && r.json.data.size === 13, `resp size=${r.json && r.json.data.size}`);
    if (r.json && r.json.ok) {
        const row = dbSql(`select Size from GameRooms where Id=${r.json.data.id}`).rows[0];
        T('B5 GameRooms 落库 Size=13（AI显式）', row[0] == 13, `db Size=${row[0]}`);
    }

    // ---------------- C. 旧扁平格式（DB 直接垫旧数据） ----------------
    console.log('\n===== C. 旧扁平格式存量兼容 =====');
    const flat = JSON.stringify({ Size: 13, Forbidden: true, TapConfirm: true, ShowCoord: false, LastMark: true, Vibrate: true, MoveTimeoutSec: 30, TotalTimeoutSec: 600 }).replace(/'/g, "''");
    dbSql(`update Users set GameSettings='${flat}' where Id=${uidA}`, 'rw');
    r = await api('GET', '/api/v1/games/gomoku/settings', undefined, tokA);
    T('C1 旧扁平读出 size=13', r.json && r.json.ok && r.json.data.rules.size === 13, `rules=${JSON.stringify(r.json && r.json.data.rules)}`);
    T('C1 旧扁平读出 forbidden=true', r.json && r.json.ok && r.json.data.rules.forbidden === true, '');
    T('C1 旧扁平读出 moveTimeout=30', r.json && r.json.ok && r.json.data.rules.moveTimeoutSec === 30, '');

    r = await api('GET', '/api/v1/games/settings', undefined, tokA);
    T('C1 旧扁平读出 tapConfirm=true', r.json && r.json.ok && r.json.data.tapConfirm === true, `display=${JSON.stringify(r.json && r.json.data)}`);

    // 再保存（PUT）→ 重新 GET → 仍 13/true（往返不丢）
    r = await api('PUT', '/api/v1/games/gomoku/settings', { size: 13, forbidden: true, moveTimeoutSec: 30, totalTimeoutSec: 600 }, tokA);
    r = await api('GET', '/api/v1/games/gomoku/settings', undefined, tokA);
    T('C2 旧数据保存后重读 size 仍 13', r.json && r.json.ok && r.json.data.rules.size === 13, `size=${r.json && r.json.data.rules.size}`);
    const raw2 = settingsOf(uidA);
    T('C2 保存后写的是新嵌套格式(含 Games/Display)', raw2.includes('"Games"') && raw2.includes('"Display"'), `raw=${raw2.slice(0, 200)}`);
    T('C2 无 $type 判别符', !raw2.includes('$type'), '');

    // ---------------- D. 非五子棋限时设置持久化（Store→Load 不丢） ----------------
    console.log('\n===== D. 其它游戏限时设置持久化 =====');
    // 网页 GameSettings 页保存路径是 Apply(TimeoutDto, gameKey)；用 DB 直写模拟已存
    // 服务端对非 gomoku 的写入口在 Pages/Games/GameSettings.cshtml.cs（cookie 页），
    // 这里先用 DB 垫一份「用户已把 jungle 限时存成 30」，再看任意一次 Load/Store 会不会丢。
    const nested = JSON.stringify({
        Display: { TapConfirm: false, ShowCoord: true, LastMark: true, Vibrate: true },
        Games: {
            gomoku: { Size: 13, Forbidden: true, MoveTimeoutSec: 0, TotalTimeoutSec: 0 },
            jungle: { MoveTimeoutSec: 30, TotalTimeoutSec: 600 },
            reversi: { MoveTimeoutSec: 15, TotalTimeoutSec: 300 },
        },
    }).replace(/'/g, "''");
    dbSql(`update Users set GameSettings='${nested}' where Id=${uidA}`, 'rw');
    // 触发一次「读改写」：保存 gomoku 设置（不动 jungle）
    await api('PUT', '/api/v1/games/gomoku/settings', { size: 13, forbidden: true, moveTimeoutSec: 0, totalTimeoutSec: 0 }, tokA);
    const raw3 = settingsOf(uidA);
    T('D1 保存 gomoku 后 jungle 限时仍在', raw3.includes('jungle') && raw3.includes('30'), `raw=${raw3.slice(0, 300)}`);
    T('D1 保存 gomoku 后 reversi 限时仍在', raw3.includes('reversi'), `raw=${raw3.slice(0, 300)}`);

    // ---------------- 汇总 ----------------
    const pass = results.filter(x => x.ok).length, fail = results.length - pass;
    console.log(`\n总计: PASS=${pass} FAIL=${fail}`);
    for (const f of results.filter(x => !x.ok)) console.log('  FAIL -> ' + f.name + '  ' + f.extra);
    process.exit(fail ? 1 : 0);
})();
