// _probe_ai2.js — 诊断暗棋 AI 为何不出着
const BASE = 'http://127.0.0.1:5188';
async function api(method, path, body, token) {
    const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch (_) { }
    return { status: r.status, json };
}
(async () => {
    const t = (await api('POST', '/api/v1/auth/login', { username: 'QA_alpha', password: 'QaGames2026!', device: 'probe' })).json.data.token;
    const c = await api('POST', '/api/v1/games/armychess/rooms', { side: 1, mode: 'dark', opponent: 'ai', aiLevel: 2 }, t);
    const id = c.json.data.id;
    let ss = (await api('GET', `/api/v1/games/armychess/rooms/${id}`, undefined, t)).json;
    console.log('snap1:', ss.ok, 'status=', ss.data && ss.data.status, 'turn=', ss.data && ss.data.turn, 'err=', ss.error);
    // 找一步人手
    const st = ss.data.state;
    const occ = new Set(st.pieces.map(p => p.x + ',' + p.y));
    const gaps = new Set(['1,5|1,6', '3,5|3,6', '1,6|1,5', '3,6|3,5']);
    let mv = null;
    for (const p of st.pieces) {
        if (p.side !== ss.data.mySide || p.rank === 'rank_flag' || p.rank === 'rank_mine') continue;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = p.x + dx, ny = p.y + dy;
            if (nx < 0 || nx > 4 || ny < 0 || ny > 11) continue;
            if (gaps.has(p.x + ',' + p.y + '|' + nx + ',' + ny)) continue;
            if (occ.has(nx + ',' + ny)) continue;
            mv = { fx: p.x, fy: p.y, tx: nx, ty: ny };
            break;
        }
        if (mv) break;
    }
    console.log('human move:', JSON.stringify(mv));
    const mr = await api('POST', `/api/v1/games/armychess/rooms/${id}/move`, mv, t);
    console.log('move resp:', mr.status, JSON.stringify(mr.json && mr.json.error), 'ok=', mr.json && mr.json.ok);
    for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 700));
        ss = (await api('GET', `/api/v1/games/armychess/rooms/${id}`, undefined, t)).json;
        const evs = (ss.data && ss.data.state && ss.data.state.events) || [];
        console.log(`poll${i}: ok=${ss.ok} err=${JSON.stringify(ss.error)} turn=${ss.data && ss.data.turn} rev=${ss.data && ss.data.revision} events=${evs.length} ev2=${evs.filter(e => e.s === 2).length}`);
        if (evs.some(e => e.s === 2 && (e.t === 'move' || e.t === 'battle'))) break;
    }
})();
