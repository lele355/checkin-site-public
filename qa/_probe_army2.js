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

    // ===== C12 误公开泄露：未参战子走到旧战场格 =====
    const id1 = await mk('armychess');
    // (0,1)连长4 攻 (0,0)排长3 → attacker_wins 幸存在 (0,0)
    // (2,0) 有一枚未参战的 rank_engineer(2)（side2）—— 稍后让它走到 (0,0)
    dbSet(id1, [
        { t: 'setup', s: 1, x: 0, y: 1, v: 4 },
        { t: 'setup', s: 2, x: 0, y: 0, v: 3 },
        { t: 'setup', s: 2, x: 2, y: 0, v: 2 },   // 未参战工兵
        { t: 'setup', s: 1, x: 4, y: 11, v: 12 }, // 双方军旗补上（避免误触发夺旗）
        { t: 'setup', s: 2, x: 4, y: 0, v: 12 },
    ], ', Turn=1, Revision=10');
    let r = await mv('armychess', id1, a, { fx: 0, fy: 1, tx: 0, ty: 0 }); // 战斗
    r = await mv('armychess', id1, b, { fx: 2, fy: 0, tx: 1, ty: 0 });     // 未参战子走向战场格
    r = await mv('armychess', id1, a, { fx: 0, fy: 0, tx: 0, ty: 1 });    // 幸存子先走开
    r = await mv('armychess', id1, b, { fx: 1, fy: 0, tx: 0, ty: 0 });    // 未参战工兵进旧战场格 (0,0)
    const s1 = await snap('armychess', id1, a);
    const at00 = (s1.state.pieces || []).find(p => p.x === 0 && p.y === 0);
    const leakOK = at00 && at00.hidden === true && !('rank' in at00);
    console.log('C12 未参战子进旧战场格应保持暗子:', leakOK ? 'PASS' : 'FAIL (泄露)', JSON.stringify(at00));

    // ===== C9b 夺军旗正解：双方旗都在，攻击方吃旗 =====
    const id2 = await mk('armychess');
    dbSet(id2, [
        { t: 'setup', s: 1, x: 1, y: 1, v: 4 },    // 红连长
        { t: 'setup', s: 2, x: 1, y: 0, v: 12 },   // 黑军旗（大本营）
        { t: 'setup', s: 1, x: 4, y: 11, v: 12 },  // 红军旗
    ], ', Turn=1, Revision=10');
    r = await mv('armychess', id2, a, { fx: 1, fy: 1, tx: 1, ty: 0 });
    const s2 = await snap('armychess', id2, a);
    console.log('C9b 连长(4)攻军旗(12): move=' + r.status + ' ' + JSON.stringify(r.json && r.json.error || r.json && 'ok'));
    console.log('   status=' + s2.status + ' winner=' + s2.winner + ' reason=' + s2.resultReason);
    console.log('   →', (s2.status === 'finished' && s2.resultReason === 'flag_captured' && s2.winner === 1) ? 'PASS 夺军旗可达' : 'FAIL 夺军旗不可达/判错（军旗战斗无敌?）');

    // 军旗被任意子攻击的战斗结果（看 battle 语义）：工兵(2)攻旗(12)
    const id3 = await mk('armychess');
    dbSet(id3, [
        { t: 'setup', s: 1, x: 1, y: 1, v: 2 },
        { t: 'setup', s: 2, x: 1, y: 0, v: 12 },
        { t: 'setup', s: 1, x: 4, y: 11, v: 12 },
        { t: 'setup', s: 2, x: 4, y: 0, v: 12 },
    ], ', Turn=1, Revision=10');
    r = await mv('armychess', id3, a, { fx: 1, fy: 1, tx: 1, ty: 0 });
    const s3 = await snap('armychess', id3, a);
    console.log('C9c 工兵(2)攻军旗(12): status=' + s3.status + ' reason=' + s3.resultReason + ' piece@(1,0)=' + JSON.stringify((s3.state.pieces || []).find(p => p.x === 1 && p.y === 0)));

    // ===== 布阵计数 + 教程文案 =====
    const id4 = await mk('armychess');
    const { execFileSync: ex } = require('child_process');
    const row = JSON.parse(ex('python', ['-c', `import sqlite3,json; c=sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db'); print(json.dumps(c.execute("select MovesJson from GameRooms where Id=${id4}").fetchone()[0]))`], { encoding: 'utf8' }));
    const evs = JSON.parse(row);
    const bySide = {};
    for (const e of evs) if (e.t === 'setup') bySide[e.s] = (bySide[e.s] || 0) + 1;
    console.log('布阵计数:', JSON.stringify(bySide), '(设计=25/方)');
})();
