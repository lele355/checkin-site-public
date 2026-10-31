// qa_reversi_size_288.js — 黑白棋可变盘面专项（2.8.8 站主需求：黑白棋新增可设置盘面大小）
// 覆盖：设置读写归一化 / 建房快照 / state.size 下发 / 初始四子居中 / 非法 size 兜底
// 依赖：站点 127.0.0.1:5188；QA_alpha/beta 已建号（口令 QaGames2026!）
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok });
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

(async () => {
    // ---------- 登录 ----------
    const login = await api('POST', '/api/v1/auth/login', { username: 'QA_alpha', password: 'QaGames2026!', device: 'rvsize288' });
    const tok = login.json && login.json.ok ? login.json.data.token : null;
    T('API 登录', !!tok);
    const loginB = await api('POST', '/api/v1/auth/login', { username: 'QA_beta', password: 'QaGames2026!', device: 'rvsize288b' });
    const tokB = loginB.json && loginB.json.ok ? loginB.json.data.token : null;
    T('API 登录 beta', !!tokB);

    // ---------- [S] 设置读写 + 归一化 ----------
    let g = await api('GET', '/api/v1/games/reversi/settings', undefined, tok);
    T('GET reversi settings 形状含 size', g.json && g.json.data && g.json.data.rules && 'size' in g.json.data.rules, JSON.stringify(g.json && g.json.data && g.json.data.rules));
    T('sizeOptions = 6/8/10/12', JSON.stringify(g.json && g.json.data && g.json.data.sizeOptions) === '[6,8,10,12]', JSON.stringify(g.json && g.json.data && g.json.data.sizeOptions));

    let p = await api('PUT', '/api/v1/games/reversi/settings', { size: 6, moveTimeoutSec: 0, totalTimeoutSec: 0 }, tok);
    T('PUT size=6 落库', p.json && p.json.data && p.json.data.size === 6, JSON.stringify(p.json && p.json.data));
    p = await api('PUT', '/api/v1/games/reversi/settings', { size: 999, moveTimeoutSec: 0, totalTimeoutSec: 0 }, tok);
    T('非法 size=999 兜底回 8（白名单制）', p.json && p.json.data && p.json.data.size === 8, JSON.stringify(p.json && p.json.data));
    p = await api('PUT', '/api/v1/games/reversi/settings', { size: 13, moveTimeoutSec: 0, totalTimeoutSec: 0 }, tok);
    T('五子棋档 13 泄漏不生效（回 8）', p.json && p.json.data && p.json.data.size === 8, JSON.stringify(p.json && p.json.data));
    p = await api('PUT', '/api/v1/games/reversi/settings', { size: 10, moveTimeoutSec: 0, totalTimeoutSec: 0 }, tok);
    T('PUT size=10 落库', p.json && p.json.data && p.json.data.size === 10);

    // gomoku 设置不受污染（红线 19 各配独立 DTO）
    g = await api('GET', '/api/v1/games/gomoku/settings', undefined, tok);
    T('gomoku size 仍是 13/15/19 档', [13, 15, 19].includes(g.json.data.rules.size), 'size=' + g.json.data.rules.size);

    // ---------- [R] 建房快照 + state.size 下发 ----------
    const c = await api('POST', '/api/v1/games/reversi/rooms', { side: 1, size: 10, opponent: 'ai', aiLevel: 1 }, tok);
    T('建房 size=10', c.json && c.json.ok, JSON.stringify(c.json && c.json.data && c.json.data.id));
    const id = c.json.data.id;
    const room = await api('GET', '/api/v1/games/reversi/rooms/' + id, undefined, tok);
    T('房间快照 size=10', room.json.data.size === 10, 'size=' + room.json.data.size);
    T('state.size 下发 = 10', room.json.data.state && room.json.data.state.size === 10, 'state.size=' + (room.json.data.state && room.json.data.state.size));
    T('初始黑白 2:2', room.json.data.state.black === 2 && room.json.data.state.white === 2, room.json.data.state.black + ':' + room.json.data.state.white);

    // 落子合法性（10×10：中心 (4,4) 已占应拒；(3,4) 夹白翻子合法）
    // 注意顺序：先验完 4656 再建 6×6 —— 「一人一 waiting 房」清扫会把上一间 waiting 清掉
    const mv = await api('POST', '/api/v1/games/reversi/rooms/' + id + '/move', { x: 4, y: 4 }, tok);
    T('10×10 落 (4,4) 中心已占被拒', !mv.json.ok, JSON.stringify(mv.json));
    const mv2 = await api('POST', '/api/v1/games/reversi/rooms/' + id + '/move', { x: 3, y: 4 }, tok);
    T('10×10 落 (3,4) 合法翻子（夹 (4,4) 白）', mv2.json.ok, JSON.stringify(mv2.json.data && mv2.json.data.state && mv2.json.data.state.black) + ':' + (mv2.json.data && mv2.json.data.state && mv2.json.data.state.white));

    // 6×6 建房
    const c6 = await api('POST', '/api/v1/games/reversi/rooms', { side: 1, size: 6 }, tok);
    const room6 = await api('GET', '/api/v1/games/reversi/rooms/' + c6.json.data.id, undefined, tok);
    T('6×6 建房 state.size=6', room6.json.data.state.size === 6, 'size=' + room6.json.data.state.size);

    // ---------- 汇总 ----------
    const pass = results.filter(r => r.ok).length;
    console.log(`\n===== qa_reversi_size_288: ${pass} 通过 / ${results.length - pass} 失败 =====`);
    process.exit(pass === results.length ? 0 : 1);
})();
