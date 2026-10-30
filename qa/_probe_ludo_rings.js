const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const { execFileSync } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const beta = (await (await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'QA_beta', password: 'QaGames2026!', device: 'dbg' }) })).json()).data.token;
    const b = await chromium.launch({ channel: 'msedge' });
    const page = await (await b.newContext({ viewport: { width: 360, height: 640 } })).newPage();
    page.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)));
    await page.goto(BASE + '/Games/ludo');
    await page.waitForLoadState('load');
    const id = await page.evaluate(async () => {
        const r = await fetch('/api/v1/games/ludo/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 1 }) });
        const j = await r.json(); return j.ok ? j.data.id : null;
    });
    await fetch(`${BASE}/api/v1/games/ludo/rooms/${id}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: '{}' });
    // craft: roll6 未消费
    const evs = [{ t: 'roll', s: 1, v: 6 }];
    const json = JSON.stringify(evs).replace(/'/g, "''");
    const py = "import sqlite3\nc = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')\n"
        + "c.execute(\"\"\"update GameRooms set MovesJson='" + json + "', Turn=1, Status='playing', Revision=90 where Id=" + id + "\"\"\")\n"
        + "c.commit()\nc.close()";
    require('fs').writeFileSync('D:/checkin/site/qa/_tmp_craft.py', py, 'utf8');
    execFileSync('python', ['D:/checkin/site/qa/_tmp_craft.py']);
    await page.goto(BASE + '/Games/ludo/Play/' + id);
    await sleep(1500);
    const info = await page.evaluate(async id => {
        const r = await fetch('/api/v1/games/ludo/rooms/' + id, { credentials: 'same-origin' });
        const d = (await r.json()).data;
        const svg = document.querySelector('svg.gm-board');
        return {
            mySide: d.mySide, myTurn: d.myTurn, turn: d.turn, status: d.status,
            movable: d.state && d.state.movable, needRoll: d.state && d.state.needRoll,
            rings: svg ? svg.querySelectorAll('circle[stroke="#f57c00"]').length : -1,
            planes: svg ? [...svg.querySelectorAll('text')].filter(t => t.textContent === '✈').length : -1,
        };
    }, id);
    console.log(JSON.stringify(info, null, 1));
    await b.close();
})();
