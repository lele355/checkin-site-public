// _probe_c7b_p.js — 同场景但 setup 带 p（新格式）验证 hidden 是否正确
const BASE = 'http://127.0.0.1:5188';
const { execFileSync } = require('child_process');
function dbSet(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    execFileSync('python', ['-c', `import sqlite3; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); c.execute("""update GameRooms set MovesJson='${json}'${extra} where Id=${id}"""); c.commit(); c.close()`]);
}
(async () => {
    const login = async u => { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'x' }) }); return (await r.json()).data.token; };
    const a = await login('QA_alpha'), b = await login('QA_beta');
    const mk = await fetch(BASE + '/api/v1/games/armychess/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ side: 1 }) });
    const id = (await mk.json()).data.id;
    await fetch(BASE + '/api/v1/games/armychess/rooms/' + id + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b }, body: '{}' });
    // 带 p 的 setup（p=全局序号，与 InitialEvents 同形）
    const evs = [
        { t: 'setup', s: 1, x: 0, y: 1, v: 4, p: 0 }, { t: 'setup', s: 2, x: 0, y: 0, v: 3, p: 25 },
        { t: 'setup', s: 2, x: 2, y: 0, v: 4, p: 26 },
        { t: 'setup', s: 1, x: 3, y: 11, v: 12, p: 1 }, { t: 'setup', s: 2, x: 3, y: 0, v: 12, p: 27 },
    ];
    dbSet(id, evs, ', Turn=1, Revision=12');
    const mv = async (who, body) => {
        const r = await fetch(BASE + '/api/v1/games/armychess/rooms/' + id + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (who === 'a' ? a : b) }, body: JSON.stringify(body) });
        const j = await r.json();
        return { status: r.status, ok: j.ok, err: j.error };
    };
    const snap = async () => (await (await fetch(BASE + '/api/v1/games/armychess/rooms/' + id, { headers: { Authorization: 'Bearer ' + a } })).json()).data;
    let s = await snap();
    console.log('初态(host 视角) pieces:', JSON.stringify((s.state.pieces || []).map(p => [p.x, p.y, p.side, p.rank || '-', p.hidden])));
    let r = await mv('a', { fx: 0, fy: 1, tx: 0, ty: 0 });
    console.log('m1 battle:', r.status, r.ok, r.err || '');
    s = await snap();
    console.log('m1 后 pieces:', JSON.stringify((s.state.pieces || []).map(p => [p.x, p.y, p.side, p.rank || '-', p.hidden])));
    r = await mv('b', { fx: 2, fy: 0, tx: 2, ty: 1 });
    console.log('m2 beta:', r.status, r.ok, r.err || '');
    r = await mv('a', { fx: 0, fy: 0, tx: 1, ty: 0 });
    console.log('m3 survivor away:', r.status, r.ok, r.err || '');
    s = await snap();
    console.log('m3 后 pieces:', JSON.stringify((s.state.pieces || []).map(p => [p.x, p.y, p.side, p.rank || '-', p.hidden])));
    const surv = (s.state.pieces || []).find(p => p.x === 1 && p.y === 0);
    console.log('C7b 断言（幸存子走开后仍公开）:', surv && surv.hidden === false && !!surv.rank ? 'PASS' : 'FAIL', JSON.stringify(surv));
    const eng = (s.state.pieces || []).find(p => p.x === 2 && p.y === 1);
    console.log('C12 断言（未参战 beta 子保持暗）:', eng && eng.hidden === true && !('rank' in eng) ? 'PASS' : 'FAIL 泄露', JSON.stringify(eng));
})();
