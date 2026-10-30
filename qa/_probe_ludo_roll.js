const BASE = 'http://127.0.0.1:5188';
const { execFileSync } = require('child_process');
(async () => {
    const login = async u => (await (await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'x' }) })).json()).data.token;
    const a = await login('QA_alpha'), b = await login('QA_beta');
    const mk = await (await fetch(BASE + '/api/v1/games/ludo/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ side: 1 }) })).json();
    const id = mk.data.id;
    await fetch(BASE + '/api/v1/games/ludo/rooms/' + id + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b }, body: '{}' });
    const evs = [{ t: 'roll', s: 1, v: 2 }, { t: 'pass', s: 1 }, { t: 'roll', s: 2, v: 2 }, { t: 'pass', s: 2 }];
    const json = JSON.stringify(evs).replace(/'/g, "''");
    execFileSync('python', ['-c', `import sqlite3; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); c.execute("""update GameRooms set MovesJson='${json}', Turn=1, Status='playing', Revision=10 where Id=${id}"""); c.commit(); c.close()`]);
    const r = await fetch(BASE + '/api/v1/games/ludo/rooms/' + id + '/roll', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: '{}' });
    const j = await r.json();
    console.log('A 第二次掷骰:', r.status, JSON.stringify(j.error || (j.data && 'ok')));
    console.log('→', /已经掷过了/.test(j.error || '') ? 'BUG 复现：pass 未消耗骰点，下回合重掷被拒' : ('未复现：' + JSON.stringify(j).substring(0, 120)));
})();
