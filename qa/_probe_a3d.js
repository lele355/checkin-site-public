const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const fs = require('fs');
(async () => {
    const b = await chromium.launch({ channel: 'msedge' });
    const page = await (await b.newContext()).newPage();
    await page.goto(BASE + '/Games/gomoku');
    await page.waitForLoadState('load');
    const id = await page.evaluate(async () => {
        const r = await fetch('/api/v1/games/gomoku/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1, opponent: 'ai', aiLevel: 2 }) });
        const j = await r.json(); return j.data.id;
    });
    const evs = [
        { t: 'move', s: 1, x: 5, y: 9 }, { t: 'move', s: 1, x: 6, y: 9 }, { t: 'move', s: 1, x: 7, y: 9 }, { t: 'move', s: 1, x: 8, y: 9 },
        { t: 'move', s: 1, x: 9, y: 4 }, { t: 'move', s: 1, x: 9, y: 5 }, { t: 'move', s: 1, x: 9, y: 6 }, { t: 'move', s: 1, x: 9, y: 7 }, { t: 'move', s: 1, x: 9, y: 8 },
        { t: 'move', s: 2, x: 0, y: 0 }, { t: 'move', s: 2, x: 1, y: 1 }];
    const json = JSON.stringify(evs).replace(/'/g, "''");
    const { execFileSync } = require('child_process');
    const py = "import sqlite3\n"
        + "c = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')\n"
        + "c.execute(\"\"\"update GameRooms set MovesJson='" + json + "', Turn=1, Status='playing', Revision=10 where Id=" + id + "\"\"\")\n"
        + "c.commit()\nc.close()";
    fs.writeFileSync('D:/checkin/site/qa/_tmp_craft.py', py, 'utf8');
    execFileSync('python', ['D:/checkin/site/qa/_tmp_craft.py']);
    const res = await page.evaluate(async id => {
        const r = await fetch('/api/v1/games/gomoku/rooms/' + id + '/move', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 9, y: 9 }) });
        return { status: r.status, body: await r.text() };
    }, id);
    console.log('成五+长连同手响应:', res.status, res.body.slice(0, 220));
    await b.close();
})();
