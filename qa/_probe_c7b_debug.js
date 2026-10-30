// _probe_c7b_debug.js — C7b 场景逐手 dump：battle 结果 / Judge 终局原因
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
    // 与 qa_suite C7b 完全一致的构造（含 p 字段试两版：无 p / 带 p）
    const evs = [
        { t: 'setup', s: 1, x: 0, y: 1, v: 4 }, { t: 'setup', s: 2, x: 0, y: 0, v: 3 },
        { t: 'setup', s: 2, x: 2, y: 0, v: 4 },
        { t: 'setup', s: 1, x: 3, y: 11, v: 12 }, { t: 'setup', s: 2, x: 3, y: 0, v: 12 },
    ];
    dbSet(id, evs, ', Turn=1, Revision=12');
    const mv = async (who, body) => {
        const r = await fetch(BASE + '/api/v1/games/armychess/rooms/' + id + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (who === 'a' ? a : b) }, body: JSON.stringify(body) });
        const j = await r.json();
        return { status: r.status, ok: j.ok, err: j.error, snap: j.data };
    };
    const snap = async () => (await (await fetch(BASE + '/api/v1/games/armychess/rooms/' + id, { headers: { Authorization: 'Bearer ' + a } })).json()).data;

    let r = await mv('a', { fx: 0, fy: 1, tx: 0, ty: 0 });
    console.log('m1 battle:', r.status, r.ok, r.err || '');
    if (r.snap) console.log('   status=', r.snap.status, 'winner=', r.snap.winner, 'reason=', r.snap.resultReason);
    let s = await snap();
    console.log('   after m1: status=', s.status, 'winner=', s.winner, 'reason=', s.resultReason, 'rev=', s.revision);
    // dump MovesJson
    const row = JSON.parse(JSON.parse(execSync2(id)));
    console.log('   events:', JSON.stringify(row.filter(e => e.t !== 'setup').map(e => ({ t: e.t, s: e.s, fx: e.fx, fy: e.fy, tx: e.tx, ty: e.ty, att: e.att, def: e.def, result: e.result }))));
    console.log('   pieces:', JSON.stringify((s.state.pieces || []).map(p => [p.x, p.y, p.side, p.rank || '-', p.hidden])));

    r = await mv('b', { fx: 2, fy: 0, tx: 2, ty: 1 });
    console.log('m2 beta wait:', r.status, r.ok, r.err || '');
    s = await snap();
    console.log('   after m2: status=', s.status, 'winner=', s.winner, 'reason=', s.resultReason);

    r = await mv('a', { fx: 0, fy: 0, tx: 1, ty: 0 });
    console.log('m3 survivor away:', r.status, r.ok, r.err || '');
    s = await snap();
    console.log('   after m3: status=', s.status, 'winner=', s.winner, 'reason=', s.resultReason);
    console.log('   pieces:', JSON.stringify((s.state.pieces || []).map(p => [p.x, p.y, p.side, p.rank || '-', p.hidden])));

    function execSync2(id) {
        return execFileSync('python', ['-c', `import sqlite3,json; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); print(json.dumps(c.execute("select MovesJson from GameRooms where Id=${id}").fetchone()[0]))`], { encoding: 'utf8' });
    }
})();
