// _probe_final3.js — 发版闸复验：①斗兽棋旱地跳 ②#7 限时半保存不重置 size ③网页设置页盘面/禁手控件
const BASE = 'http://127.0.0.1:5188';
const { execFileSync } = require('child_process');
function dbSet(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    execFileSync('python', ['-c', `import sqlite3; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); c.execute("""update GameRooms set MovesJson='${json}'${extra} where Id=${id}"""); c.commit(); c.close()`]);
}
(async () => {
    const login = async u => (await (await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'x' }) })).json()).data.token;
    const a = await login('QA_alpha'), b = await login('QA_beta');

    // ① 旱地两格跳：狮 (0,3)→(0,5)（中间 (0,4) 为普通格，非水域）→ 期望 400
    {
        const mk = await (await fetch(BASE + '/api/v1/games/jungle/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ side: 1 }) })).json();
        const id = mk.data.id;
        await fetch(BASE + '/api/v1/games/jungle/rooms/' + id + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b }, body: '{}' });
        dbSet(id, [{ t: 'setup', s: 1, x: 0, y: 3, v: 7 }, { t: 'setup', s: 2, x: 6, y: 0, v: 1 }], ', Turn=1, Revision=10');
        const r = await fetch(BASE + '/api/v1/games/jungle/rooms/' + id + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + a }, body: JSON.stringify({ fx: 0, fy: 3, tx: 0, ty: 5 }) });
        const j = await r.json();
        console.log('①旱地两格跳(0,3→0,5):', r.status, JSON.stringify(j.error || 'ALLOWED'),
            '→', r.status === 400 ? 'PASS 已拒' : 'FAIL 仍放行（R2 残余）');
    }
    // ② #7：PUT 仅 timeouts → size/forbidden 不应被重置
    {
        const H = { Authorization: 'Bearer ' + a, 'Content-Type': 'application/json' };
        await fetch(BASE + '/api/v1/games/gomoku/settings', { method: 'PUT', headers: H, body: JSON.stringify({ size: 13, forbidden: true, moveTimeoutSec: 30, totalTimeoutSec: 300 }) });
        await fetch(BASE + '/api/v1/games/gomoku/settings', { method: 'PUT', headers: H, body: JSON.stringify({ moveTimeoutSec: 60, totalTimeoutSec: 600 }) });
        const g = await (await fetch(BASE + '/api/v1/games/gomoku/settings', { headers: H })).json();
        const rr = g.data.rules || g.data;
        console.log('②限时半保存后 rules:', JSON.stringify(rr),
            '→', rr.size === 13 && rr.forbidden === true ? 'PASS size/forbidden 保持（#7 已修）' : 'FAIL 次生破坏仍在');
    }
    // ③ 网页设置页盘面/禁手控件
    {
        const html = await (await fetch(BASE + '/Games/Gomoku/Settings')).text();
        const hasSize = /name="size"|name="Size"|select[^>]+name="size"/i.test(html);
        const hasForbidden = /name="forbidden"|name="Forbidden"/i.test(html);
        console.log('③网页设置页: size 控件', hasSize, '| forbidden 控件', hasForbidden,
            '→', hasSize && hasForbidden ? 'PASS 双端入口对齐' : 'FAIL 缺入口');
    }
})();
