const BASE = 'http://127.0.0.1:5188';
const { execFileSync } = require('child_process');
function dbSet(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    execFileSync('python', ['-c', `import sqlite3; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); c.execute("""update GameRooms set MovesJson='${json}'${extra} where Id=${id}"""); c.commit(); c.close()`]);
}
(async () => {
    const login = async u => { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'x' }) }); return (await r.json()).data.token; };
    const a = await login('QA_alpha'), b = await login('QA_beta');
    const mk = async (gk) => {
        const r = await fetch(BASE + `/api/v1/games/${gk}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ side: 1 }) });
        const id = (await r.json()).data.id;
        await fetch(BASE + `/api/v1/games/${gk}/rooms/${id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b }, body: '{}' });
        return id;
    };
    const snap = async (gk, id, tok) => (await (await fetch(BASE + `/api/v1/games/${gk}/rooms/${id}`, { headers: { Authorization: 'Bearer ' + tok } })).json()).data;
    const mv = async (gk, id, tok, body) => {
        const r = await fetch(BASE + `/api/v1/games/${gk}/rooms/${id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
        return { status: r.status, json: await r.json() };
    };

    // C12 clean: 幸存子离开旧战场格后，未参战子再进该格 —— 断言不被误公开
    const id1 = await mk('armychess');
    dbSet(id1, [
        { t: 'setup', s: 1, x: 0, y: 1, v: 4 },   // 红连长
        { t: 'setup', s: 2, x: 0, y: 0, v: 3 },   // 黑排长（将被吃）
        { t: 'setup', s: 2, x: 0, y: 2, v: 2 },   // 黑工兵（未参战，将进 (0,0)）
        { t: 'setup', s: 1, x: 3, y: 11, v: 12 },
        { t: 'setup', s: 2, x: 3, y: 0, v: 12 },
    ], ', Turn=1, Revision=10');
    let r = await mv('armychess', id1, a, { fx: 0, fy: 1, tx: 0, ty: 0 }); // battle at (0,0)
    console.log('m1 battle:', r.status, r.json && r.json.error || 'ok');
    r = await mv('armychess', id1, b, { fx: 0, fy: 2, tx: 0, ty: 1 });     // engineer → (0,1)
    console.log('m2 engineer:', r.status, r.json && r.json.error || 'ok');
    r = await mv('armychess', id1, a, { fx: 0, fy: 0, tx: 1, ty: 0 });     // survivor → (1,0)（对方大本营格，规则允许）
    console.log('m3 survivor away:', r.status, r.json && r.json.error || 'ok');
    r = await mv('armychess', id1, b, { fx: 0, fy: 1, tx: 0, ty: 0 });     // engineer → old battle square (0,0)
    console.log('m4 engineer onto battle square:', r.status, r.json && r.json.error || 'ok');
    const s1 = await snap('armychess', id1, a);
    for (const p of (s1.state.pieces || [])) console.log('  piece', JSON.stringify(p));
    const at00 = (s1.state.pieces || []).find(p => p.x === 0 && p.y === 0);
    const at10 = (s1.state.pieces || []).find(p => p.x === 1 && p.y === 0);
    const noLeak = at00 && at00.hidden === true && !('rank' in at00);
    console.log('C12 未参战工兵进旧战场格保持暗子:', noLeak ? 'PASS' : 'FAIL 泄露 ' + JSON.stringify(at00));
    const survivorPublic = at10 && at10.hidden === false && at10.rank === 'rank_company';
    console.log('C7b 复验 幸存子在新位置永久公开:', survivorPublic ? 'PASS' : 'FAIL ' + JSON.stringify(at10));

    // 教程文案里的数量
    const tut = (await (await fetch(BASE + '/api/v1/games/armychess/tutorial', { headers: { Authorization: 'Bearer ' + a } })).json()).data;
    const text = JSON.stringify(tut);
    const m = text.match(/\d+\s*枚/g) || text.match(/25|23/g) || [];
    console.log('军旗教程中的数量词:', m.slice(0, 10).join(','), '| 全文含「25」:', text.includes('25'), '含「23」:', text.includes('23'));
})();
