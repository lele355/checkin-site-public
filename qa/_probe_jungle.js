const BASE = 'http://127.0.0.1:5188';
const { execFileSync } = require('child_process');
function dbSet(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    const sql = `update GameRooms set MovesJson='${json}'${extra} where Id=${id}`;
    execFileSync('python', ['-c', `import sqlite3; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); c.execute("""${sql}"""); c.commit(); c.close()`]);
}
(async () => {
    const login = async u => { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'x' }) }); return (await r.json()).data.token; };
    const a = await login('QA_alpha'), b = await login('QA_beta');
    const mk = await fetch(BASE + '/api/v1/games/jungle/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ side: 1 }) });
    const id = (await mk.json()).data.id;
    await fetch(BASE + '/api/v1/games/jungle/rooms/' + id + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b }, body: '{}' });

    // Case 1: elephant(8) at (0,1) attacks lion(7) at (0,0) — expect OK
    dbSet(id, [{ t: 'setup', s: 1, x: 0, y: 1, v: 8 }, { t: 'setup', s: 2, x: 0, y: 0, v: 7 }, { t: 'setup', s: 2, x: 6, y: 0, v: 1 }], ', Turn=1, Revision=10');
    let r = await fetch(BASE + '/api/v1/games/jungle/rooms/' + id + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ fx: 0, fy: 1, tx: 0, ty: 0 }) });
    console.log('elephant(8) vs lion(7):', r.status, (await r.text()).substring(0, 200));

    // Case 2: rat(1) attacks elephant(8) — expect OK (鼠吃象)
    dbSet(id, [{ t: 'setup', s: 1, x: 0, y: 1, v: 1 }, { t: 'setup', s: 2, x: 0, y: 0, v: 8 }, { t: 'setup', s: 2, x: 6, y: 0, v: 1 }], ', Turn=1, Revision=20');
    r = await fetch(BASE + '/api/v1/games/jungle/rooms/' + id + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ fx: 0, fy: 1, tx: 0, ty: 0 }) });
    console.log('rat(1) vs elephant(8):', r.status, (await r.text()).substring(0, 200));

    // Case 3: wolf(4) attacks lion(7) — expect 400 (小吃大)
    dbSet(id, [{ t: 'setup', s: 1, x: 0, y: 1, v: 4 }, { t: 'setup', s: 2, x: 0, y: 0, v: 7 }, { t: 'setup', s: 2, x: 6, y: 0, v: 1 }], ', Turn=1, Revision=30');
    r = await fetch(BASE + '/api/v1/games/jungle/rooms/' + id + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ fx: 0, fy: 1, tx: 0, ty: 0 }) });
    console.log('wolf(4) vs lion(7):', r.status, (await r.text()).substring(0, 200));

    // Case 4: elephant(8) vs rat(1) — expect 400 (象不能吃鼠)
    dbSet(id, [{ t: 'setup', s: 1, x: 0, y: 1, v: 8 }, { t: 'setup', s: 2, x: 0, y: 0, v: 1 }, { t: 'setup', s: 2, x: 6, y: 0, v: 1 }], ', Turn=1, Revision=40');
    r = await fetch(BASE + '/api/v1/games/jungle/rooms/' + id + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ fx: 0, fy: 1, tx: 0, ty: 0 }) });
    console.log('elephant(8) vs rat(1):', r.status, (await r.text()).substring(0, 200));
})();
