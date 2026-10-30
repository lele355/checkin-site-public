const BASE = 'http://127.0.0.1:5188';
const fs = require('fs');
const { execFileSync } = require('child_process');
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'p1b' }) }); return (await r.json()).data.token; }
async function api(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, json: j }; }
function jungleSetup() {
    const ip = [
        [0, 0, 7, 2], [6, 0, 6, 2], [1, 1, 3, 2], [5, 1, 2, 2], [0, 2, 1, 2], [2, 2, 5, 2], [4, 2, 4, 2], [6, 2, 8, 2],
        [6, 8, 7, 1], [0, 8, 6, 1], [5, 7, 3, 1], [1, 7, 2, 1], [6, 6, 1, 1], [4, 6, 5, 1], [2, 6, 4, 1], [0, 6, 8, 1],
    ];
    return ip.map(([x, y, v, s]) => ({ t: 'setup', s, x, y, v }));
}
(async () => {
    const alpha = await loginApi('QA_alpha');
    const r = await api('POST', '/api/v1/games/jungle/rooms', { side: 1, opponent: 'ai', aiLevel: 2 }, alpha);
    const id = r.json.data.id;
    const setup = jungleSetup().map(e => {
        if (e.s === 1 && e.v === 7) { e.x = 3; e.y = 1; }
        return e;
    });
    // 校验 craft 后的关键格：(3,1) 应有红狮 v=7；(3,0) 应为空
    const at31 = setup.find(e => e.x === 3 && e.y === 1);
    const at30 = setup.find(e => e.x === 3 && e.y === 0);
    console.log('craft 校验: (3,1)=', JSON.stringify(at31), ' (3,0)=', JSON.stringify(at30 || null));
    const json = JSON.stringify(setup).replace(/'/g, "''");
    const py = "import sqlite3\nc = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')\n"
        + "c.execute(\"\"\"update GameRooms set MovesJson='" + json + "', Turn=1, Status='playing', Revision=10 where Id=" + id + "\"\"\")\n"
        + "c.commit()\nc.close()";
    fs.writeFileSync('D:/checkin/site/qa/_tmp_craft.py', py, 'utf8');
    execFileSync('python', ['D:/checkin/site/qa/_tmp_craft.py']);
    const mv = await api('POST', `/api/v1/games/jungle/rooms/${id}/move`, { fx: 3, fy: 1, tx: 3, ty: 0 }, alpha);
    console.log('move resp:', mv.status, JSON.stringify(mv.json && (mv.json.error || { status: mv.json.data.status, winner: mv.json.data.winner, reason: mv.json.data.resultReason })));
})();
