const BASE = 'http://127.0.0.1:5188';
const fs = require('fs');
const { execFileSync } = require('child_process');
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'p2' }) }); return (await r.json()).data.token; }
async function api(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, json: j }; }
function jungleSetup() {
    const ip = [
        [0, 0, 7, 2], [6, 0, 6, 2], [1, 1, 3, 2], [5, 1, 2, 2], [0, 2, 1, 2], [2, 2, 5, 2], [4, 2, 4, 2], [6, 2, 8, 2],
        [6, 8, 7, 1], [0, 8, 6, 1], [5, 7, 3, 1], [1, 7, 2, 1], [6, 6, 1, 1], [4, 6, 5, 1], [2, 6, 4, 1], [0, 6, 8, 1],
    ];
    return ip.map(([x, y, v, s]) => ({ t: 'setup', s, x, y, v }));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const alpha = await loginApi('QA_alpha');
    const beta = await loginApi('QA_beta');
    // A5d 重探：AI 房 + 蓝狮(3,7) → 红穴(3,8)
    const r = await api('POST', '/api/v1/games/jungle/rooms', { side: 1, opponent: 'ai', aiLevel: 2 }, alpha);
    const id = r.json.data.id;
    const setup = jungleSetup().map(e => { if (e.s === 2 && e.v === 7) { e.x = 3; e.y = 7; } return e; });
    const json = JSON.stringify(setup).replace(/'/g, "''");
    const py = "import sqlite3\nc = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')\n"
        + "c.execute(\"\"\"update GameRooms set MovesJson='" + json + "', Turn=2, Status='playing', Revision=10 where Id=" + id + "\"\"\")\n"
        + "c.commit()\nc.close()";
    fs.writeFileSync('D:/checkin/site/qa/_tmp_craft.py', py, 'utf8');
    execFileSync('python', ['D:/checkin/site/qa/_tmp_craft.py']);
    for (let i = 0; i < 8; i++) {
        await sleep(900);
        const s = await api('GET', `/api/v1/games/jungle/rooms/${id}`, undefined, alpha);
        const d = s.json.data;
        const last = (d.moves || []).slice(-1)[0];
        console.log(`t+${i + 1}: status=${d.status} turn=${d.turn} rev=${d.revision} last=${JSON.stringify(last)}`);
        if (d.status === 'finished') { console.log('终局:', d.winner, d.resultReason); break; }
    }

    // A5e 类型探针
    const rx = await api('POST', '/api/v1/games/xiangqi/rooms', { side: 1 }, alpha);
    const idx = rx.json.data.id;
    await api('POST', `/api/v1/games/xiangqi/rooms/${idx}/join`, {}, beta);
    const seq = [[0, 9, 0, 8], [0, 0, 0, 1], [0, 8, 0, 9], [0, 1, 0, 0], [0, 9, 0, 8], [0, 0, 0, 1], [0, 8, 0, 9], [0, 1, 0, 0]];
    let fin = null, k = 0;
    for (const [fx, fy, tx, ty] of seq) {
        const tok = k++ % 2 === 0 ? alpha : beta;
        const m = await api('POST', `/api/v1/games/xiangqi/rooms/${idx}/move`, { fx, fy, tx, ty }, tok);
        if (m.json && m.json.data && m.json.data.status === 'finished') { fin = m.json.data; break; }
    }
    if (!fin) fin = (await api('GET', `/api/v1/games/xiangqi/rooms/${idx}`, undefined, alpha)).json.data;
    console.log('A5e typeof winner:', typeof fin.winner, 'value:', fin.winner, '| reason:', fin.resultReason, '| status:', fin.status);
})();
