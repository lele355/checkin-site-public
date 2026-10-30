// _verify_deploy_err.js — 布阵链错误路径：违规阵 400 文案可读
const BASE = 'http://127.0.0.1:5188';
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'de' }) }); return (await r.json()).data.token; }
async function api(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, json: j }; }
function validLayout(overrides) {
    const spec = [['rank_commander', 1], ['rank_army', 1], ['rank_division', 2], ['rank_brigade', 2], ['rank_regiment', 2], ['rank_battalion', 2], ['rank_company', 3], ['rank_platoon', 3], ['rank_engineer', 3], ['rank_mine', 3], ['rank_bomb', 2], ['rank_flag', 1]];
    const pieces = [];
    const used = new Set();
    const camps = new Set(['1,7', '3,7', '2,8', '1,9', '3,9']);
    function put(rank, x, y) { pieces.push({ x, y, rank }); used.add(x + ',' + y); }
    put('rank_flag', 1, 11);
    put('rank_mine', 0, 10); put('rank_mine', 4, 10); put('rank_mine', 2, 11);
    put('rank_bomb', 0, 7); put('rank_bomb', 4, 7);
    const pool = [];
    for (const [rank, n] of spec) {
        if (rank === 'rank_flag' || rank === 'rank_mine' || rank === 'rank_bomb') continue;
        for (let i = 0; i < n; i++) pool.push(rank);
    }
    for (let y = 6; y <= 11 && pool.length; y++) for (let x = 0; x <= 4 && pool.length; x++) {
        if (camps.has(x + ',' + y) || used.has(x + ',' + y)) continue;
        put(pool.shift(), x, y);
    }
    if (overrides) for (const o of overrides) {
        const idx = pieces.findIndex(p => p.rank === o.from);
        if (idx >= 0) pieces[idx] = { x: o.x, y: o.y, rank: o.rank || o.from };
    }
    return pieces;
}
(async () => {
    const alpha = await loginApi('QA_alpha');
    const beta = await loginApi('QA_beta');
    const cases = [
        ['炸弹放最前排（y=6）', validLayout([{ from: 'rank_bomb', x: 2, y: 6 }]), /炸弹/],
        ['地雷出最后两排（y=9）', validLayout([{ from: 'rank_mine', x: 0, y: 9 }]), /地雷/],
        ['缺一子（24 枚）', validLayout().slice(0, 24), /25|不完整|配比/],
        ['一格两子', (() => { const l = validLayout(); l[1] = { x: l[0].x, y: l[0].y, rank: l[1].rank }; return l; })(), /一格/],
    ];
    for (const [name, layout, msgRe] of cases) {
        const rc = await api('POST', '/api/v1/games/armychess/rooms', { side: 1, mode: 'open' }, alpha);
        const id = rc.json.data.id;
        await api('POST', `/api/v1/games/armychess/rooms/${id}/join`, {}, beta);
        const d = await api('POST', `/api/v1/games/armychess/rooms/${id}/deploy`, { pieces: layout }, alpha);
        const err = (d.json && d.json.error) || '';
        T(`布阵错误路径：${name} → 400 且文案可读`, d.status === 400 && err.length > 0 && msgRe.test(err), `err="${err}"`);
    }
    // 合法对照：完整合法阵受理
    const rc = await api('POST', '/api/v1/games/armychess/rooms', { side: 1, mode: 'open' }, alpha);
    const id = rc.json.data.id;
    await api('POST', `/api/v1/games/armychess/rooms/${id}/join`, {}, beta);
    const d = await api('POST', `/api/v1/games/armychess/rooms/${id}/deploy`, { pieces: validLayout() }, alpha);
    T('对照：合法 25 枚阵受理', d.json && d.json.ok === true, `err=${d.json && d.json.error}`);
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
