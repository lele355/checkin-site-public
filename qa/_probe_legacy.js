const BASE = 'http://127.0.0.1:5188';
const fs = require('fs');
const { execFileSync } = require('child_process');
(async () => {
    const a = (await (await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'QA_alpha', password: 'QaGames2026!', device: 'lg' }) })).json()).data.token;
    const b = (await (await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'QA_beta', password: 'QaGames2026!', device: 'lg' }) })).json()).data.token;
    const r = await fetch(BASE + '/api/v1/games/gomoku/rooms', { method: 'POST', headers: { Authorization: 'Bearer ' + a, 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1, size: 15 }) });
    const id = (await r.json()).data.id;
    await fetch(`${BASE}/api/v1/games/gomoku/rooms/${id}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + b, 'Content-Type': 'application/json' }, body: '{}' });
    const legacy = '[{"x":7,"y":7,"s":1},{"x":0,"y":0,"s":2}]';
    const py = "import sqlite3\nc = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')\n"
        + "c.execute(\"\"\"update GameRooms set MovesJson='" + legacy.replace(/'/g, "''") + "', Revision=10 where Id=" + id + "\"\"\")\n"
        + "c.commit()\nc.close()";
    fs.writeFileSync('D:/checkin/site/qa/_tmp_craft.py', py, 'utf8');
    execFileSync('python', ['D:/checkin/site/qa/_tmp_craft.py']);
    // 直读 DB 确认落库
    const chk = execFileSync('python', ['-c', "import sqlite3; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); print(c.execute('select MovesJson from GameRooms where Id=" + id + "').fetchone()[0])"], { encoding: 'utf8' });
    console.log('DB MovesJson:', chk.trim());
    const s = (await (await fetch(BASE + '/api/v1/games/gomoku/rooms/' + id, { headers: { Authorization: 'Bearer ' + a } })).json()).data;
    console.log('快照 moves:', JSON.stringify(s.moves), '| moveCount:', s.moveCount, '| lastMove:', JSON.stringify(s.lastMove));
})();
