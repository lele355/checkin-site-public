// _verify_b_api.js — 批次 B API 复验：B1 铁路图 / 布阵状态机 / B2 暗棋
const BASE = 'http://127.0.0.1:5188';
const fs = require('fs');
const { execFileSync } = require('child_process');
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'b1' }) }); return (await r.json()).data.token; }
async function api(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, json: j }; }
function craftDb(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    const py = "import sqlite3\nc = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')\n"
        + "c.execute(\"\"\"update GameRooms set MovesJson='" + json + "'" + (extra || '') + " where Id=" + id + "\"\"\")\n"
        + "c.commit()\nc.close()";
    fs.writeFileSync('D:/checkin/site/qa/_tmp_craft.py', py, 'utf8');
    execFileSync('python', ['D:/checkin/site/qa/_tmp_craft.py']);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 25 枚合法自摆阵生成器（side1：y≥6，避 5 行营，旗在大本营，雷 y≥10，弹 y≠6）
function validLayout(overrides, side) {
    const spec = [['rank_commander', 1], ['rank_army', 1], ['rank_division', 2], ['rank_brigade', 2], ['rank_regiment', 2], ['rank_battalion', 2], ['rank_company', 3], ['rank_platoon', 3], ['rank_engineer', 3], ['rank_mine', 3], ['rank_bomb', 2], ['rank_flag', 1]];
    const pieces = [];
    const used = new Set();
    const camps = new Set(['1,7', '3,7', '2,8', '1,9', '3,9']);
    function put(rank, x, y) { pieces.push({ x, y, rank }); used.add(x + ',' + y); }
    put('rank_flag', 1, 11);
    put('rank_mine', 0, 10); put('rank_mine', 4, 10); put('rank_mine', 2, 11);
    put('rank_bomb', 0, 7); put('rank_bomb', 4, 7);
    const pool = [];
    for (const [rank, n] of spec) {
        if (rank === 'rank_flag' || rank === 'rank_mine' || rank === 'rank_bomb') continue;
        for (let i = 0; i < n; i++) pool.push(rank);
    }
    for (let y = 6; y <= 11 && pool.length; y++) for (let x = 0; x <= 4 && pool.length; x++) {
        if (camps.has(x + ',' + y) || used.has(x + ',' + y)) continue;
        put(pool.shift(), x, y);
    }
    if (overrides) for (const o of overrides) {
        const idx = pieces.findIndex(p => p.rank === o.from);
        if (idx >= 0) pieces[idx] = { x: o.x, y: o.y, rank: o.rank || o.from };
    }
    if (side === 2) for (const p of pieces) { p.x = 4 - p.x; p.y = 11 - p.y; }
    return pieces;
}

// setup 事件（crafted 用，v=rank 值）
const VAL = { rank_commander: 10, rank_army: 9, rank_division: 8, rank_brigade: 7, rank_regiment: 6, rank_battalion: 5, rank_company: 4, rank_platoon: 3, rank_engineer: 2, rank_mine: 11, rank_bomb: 13, rank_flag: 12 };
function setupEvs(list) { let p = 0; return list.map(([s, x, y, rank]) => ({ t: 'setup', s, x, y, v: VAL[rank], p: p++ })); }

(async () => {
    const alpha = await loginApi('QA_alpha');
    const beta = await loginApi('QA_beta');

    async function mkRoom(mode, extra) {
        const r = await api('POST', '/api/v1/games/armychess/rooms', Object.assign({ side: 1, mode }, extra || {}), alpha);
        const id = r.json && r.json.ok ? r.json.data.id : null;
        if (!id) { T('建房 mode=' + mode, false, JSON.stringify(r.json && (r.json.error || r.json.data))); return null; }
        return id;
    }

    // ================= 1｜铁路图（crafted 走子） =================
    console.log('\n===== B1 铁路图 =====');
    {
        // 房 A：直行滑行 / 非工兵不拐弯 / 非工兵不可达
        const id = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id) {
            craftDb(id, setupEvs([[1, 0, 1, 'rank_regiment']]), ", Turn=1, Status='playing', Mode='open', Revision=10");
            const t1 = await api('POST', `/api/v1/games/armychess/rooms/${id}/move`, { fx: 0, fy: 1, tx: 0, ty: 5 }, alpha);
            T('铁路直线滑行 (0,1)→(0,5) 受理', t1.json && t1.json.ok === true, `ok=${t1.json && t1.json.ok} err=${t1.json && t1.json.error}`);
        }
        const id2 = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id2) {
            craftDb(id2, setupEvs([[1, 0, 1, 'rank_regiment']]), ", Turn=1, Status='playing', Mode='open', Revision=10");
            const t2 = await api('POST', `/api/v1/games/armychess/rooms/${id2}/move`, { fx: 0, fy: 1, tx: 4, ty: 5 }, alpha);
            T('非工兵铁路不拐弯 (0,1)→(4,5) 拒', t2.json && t2.json.ok === false, `err=${t2.json && t2.json.error}`);
            const t5 = await api('POST', `/api/v1/games/armychess/rooms/${id2}/move`, { fx: 0, fy: 1, tx: 2, ty: 5 }, alpha);
            T('非工兵不可达 (0,1)→(2,5) 拒', t5.json && t5.json.ok === false, `err=${t5.json && t5.json.error}`);
        }
        // 房 B：工兵 BFS 转弯 + 绕行
        const id3 = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id3) {
            craftDb(id3, setupEvs([[1, 2, 5, 'rank_engineer']]), ", Turn=1, Status='playing', Mode='open', Revision=10");
            const t3 = await api('POST', `/api/v1/games/armychess/rooms/${id3}/move`, { fx: 2, fy: 5, tx: 0, ty: 1 }, alpha);
            T('工兵铁路 BFS 转弯 (2,5)→(0,1) 受理', t3.json && t3.json.ok === true, `ok=${t3.json && t3.json.ok} err=${t3.json && t3.json.error}`);
        }
        const id4 = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id4) {
            craftDb(id4, setupEvs([[1, 0, 5, 'rank_engineer']]), ", Turn=1, Status='playing', Mode='open', Revision=10");
            const t4 = await api('POST', `/api/v1/games/armychess/rooms/${id4}/move`, { fx: 0, fy: 5, tx: 0, ty: 1 }, alpha);
            T('工兵绕行 (0,5)→(0,1) 受理', t4.json && t4.json.ok === true, `ok=${t4.json && t4.json.ok}`);
        }
        // 房 C：山界缺口
        const id5 = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id5) {
            craftDb(id5, setupEvs([[1, 1, 5, 'rank_company']]), ", Turn=1, Status='playing', Mode='open', Revision=10");
            const t6 = await api('POST', `/api/v1/games/armychess/rooms/${id5}/move`, { fx: 1, fy: 5, tx: 1, ty: 6 }, alpha);
            T('山界缺口 (1,5)→(1,6) 拒（公路铁路皆断）', t6.json && t6.json.ok === false, `err=${t6.json && t6.json.error}`);
        }
        // 房 D：大本营进入 + 冻结
        const id6 = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id6) {
            craftDb(id6, setupEvs([[1, 1, 1, 'rank_regiment']]), ", Turn=1, Status='playing', Mode='open', Revision=10");
            const t7 = await api('POST', `/api/v1/games/armychess/rooms/${id6}/move`, { fx: 1, fy: 1, tx: 1, ty: 0 }, alpha);
            T('进敌方空大本营受理', t7.json && t7.json.ok === true, `ok=${t7.json && t7.json.ok} err=${t7.json && t7.json.error}`);
        }
        const id7 = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id7) {
            craftDb(id7, setupEvs([[1, 1, 0, 'rank_regiment']]), ", Turn=1, Status='playing', Mode='open', Revision=10"); // 团长在大本营内
            const t8 = await api('POST', `/api/v1/games/armychess/rooms/${id7}/move`, { fx: 1, fy: 0, tx: 1, ty: 1 }, alpha);
            T('大本营内子永久冻结（移出拒）', t8.json && t8.json.ok === false, `err=${t8.json && t8.json.error}`);
        }
        // 房 E：铁路中途有子 + 行营敌子不可吃
        const id8 = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id8) {
            craftDb(id8, setupEvs([[1, 0, 1, 'rank_regiment'], [2, 0, 3, 'rank_company']]), ", Turn=1, Status='playing', Mode='open', Revision=10");
            const t9 = await api('POST', `/api/v1/games/armychess/rooms/${id8}/move`, { fx: 0, fy: 1, tx: 0, ty: 5 }, alpha);
            T('铁路中途有子 (0,1)→(0,5) 拒', t9.json && t9.json.ok === false, `err=${t9.json && t9.json.error}`);
        }
        const id9 = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id9) {
            craftDb(id9, setupEvs([[1, 0, 1, 'rank_regiment'], [2, 1, 2, 'rank_company']]), ", Turn=1, Status='playing', Mode='open', Revision=10");
            const t10 = await api('POST', `/api/v1/games/armychess/rooms/${id9}/move`, { fx: 0, fy: 1, tx: 1, ty: 2 }, alpha);
            T('行营敌子不可吃拒', t10.json && t10.json.ok === false, `err=${t10.json && t10.json.error}`);
        }
        // 附加：公路→铁路交界换轨（先公路步上铁路节点）
        const id10 = await mkRoom('open', { opponent: 'ai', aiLevel: 2 });
        if (id10) {
            craftDb(id10, setupEvs([[1, 1, 4, 'rank_regiment']]), ", Turn=1, Status='playing', Mode='open', Revision=10");
            const tx = await api('POST', `/api/v1/games/armychess/rooms/${id10}/move`, { fx: 1, fy: 4, tx: 2, ty: 5 }, alpha);
            T('附加 公路步上铁路节点 (1,4)→(2,5) 受理', tx.json && tx.json.ok === true, `ok=${tx.json && tx.json.ok} err=${tx.json && tx.json.error}`);
        }
    }

    // ================= 2｜布阵状态机 =================
    console.log('\n===== B1 布阵状态机 =====');
    {
        // 1 明棋建房 → setup；AI 侧即时随机布
        const r1 = await api('POST', '/api/v1/games/armychess/rooms', { side: 1, mode: 'open', opponent: 'ai', aiLevel: 2 }, alpha);
        const id1 = r1.json.data.id;
        const s1 = (await api('GET', `/api/v1/games/armychess/rooms/${id1}`, undefined, alpha)).json.data;
        T('明棋建房 → setup 状态 + mode=open', s1.status === 'setup' && s1.state.mode === 'open', `status=${s1.status} mode=${s1.mode}`);
        T('AI 侧即时随机布（deployDone=[false,true]）', s1.state.deployDone[0] === false && s1.state.deployDone[1] === true, JSON.stringify(s1.state.deployDone));
        const aiPieces = (s1.state.pieces || []).filter(p => p.side === 2);
        T('己方未布时对方 rank 不下发（全 hidden 无 rank）', aiPieces.length === 25 && aiPieces.every(p => p.hidden === true && !('rank' in p)), JSON.stringify(aiPieces[0]));
        // 3 随机布阵 → playing
        await api('POST', `/api/v1/games/armychess/rooms/${id1}/deploy`, { random: true }, alpha);
        const s2 = (await api('GET', `/api/v1/games/armychess/rooms/${id1}`, undefined, alpha)).json.data;
        T('随机布阵 → playing turn=1', s2.status === 'playing' && s2.turn === 1, `status=${s2.status} turn=${s2.turn}`);
        // 4 单方 deploy 仍 setup + 重复 deploy 拒
        const r2 = await api('POST', '/api/v1/games/armychess/rooms', { side: 1, mode: 'open' }, alpha);
        const id2 = r2.json.data.id;
        await api('POST', `/api/v1/games/armychess/rooms/${id2}/join`, {}, beta);
        const s3 = (await api('GET', `/api/v1/games/armychess/rooms/${id2}`, undefined, alpha)).json.data;
        T('双方入座 → setup 待布', s3.status === 'setup', `status=${s3.status}`);
        await api('POST', `/api/v1/games/armychess/rooms/${id2}/deploy`, { random: true }, alpha);
        const s4 = (await api('GET', `/api/v1/games/armychess/rooms/${id2}`, undefined, alpha)).json.data;
        T('单方 deploy 仍 setup（deployDone=[true,false]）', s4.status === 'setup' && s4.state.deployDone[0] === true && s4.state.deployDone[1] === false, `status=${s4.status} done=${JSON.stringify(s4.state.deployDone)}`);
        const dup = await api('POST', `/api/v1/games/armychess/rooms/${id2}/deploy`, { random: true }, alpha);
        T('重复 deploy 拒', dup.json && dup.json.ok === false, `err=${dup.json && dup.json.error}`);
        // 5 合法自摆阵受理 → 双方齐 → playing turn=1
        const depRes = await api('POST', `/api/v1/games/armychess/rooms/${id2}/deploy`, { pieces: validLayout(null, 2) }, beta);
        console.log('beta deploy resp:', depRes.status, JSON.stringify(depRes.json && (depRes.json.error || depRes.json.data && depRes.json.data.status)));
        const s5 = (await api('GET', `/api/v1/games/armychess/rooms/${id2}`, undefined, alpha)).json.data;
        T('合法自摆阵受理 → 双方齐 → playing turn=1', s5.status === 'playing' && s5.turn === 1, `status=${s5.status} turn=${s5.turn}`);
        // 布阵约束（各构造一个违规 layout）
        const cases = [
            ['军旗不在大本营', validLayout([{ from: 'rank_flag', x: 0, y: 11 }])],
            ['地雷出最后两排', validLayout([{ from: 'rank_mine', x: 0, y: 9 }])],
            ['炸弹放前线排', validLayout([{ from: 'rank_bomb', x: 2, y: 6 }])],
            ['行营有子', validLayout([{ from: 'rank_company', x: 1, y: 7 }])],
        ];
        for (const [name, layout] of cases) {
            const rc = await api('POST', '/api/v1/games/armychess/rooms', { side: 1, mode: 'open' }, alpha);
            const idc = rc.json.data.id;
            await api('POST', `/api/v1/games/armychess/rooms/${idc}/join`, {}, beta);
            const d = await api('POST', `/api/v1/games/armychess/rooms/${idc}/deploy`, { pieces: layout }, alpha);
            T(`布阵约束：${name} → 拒`, d.json && d.json.ok === false, `err=${d.json && d.json.error}`);
        }
    }

    // ================= 4｜暗棋 =================
    console.log('\n===== B2 暗棋 =====');
    {
        const r = await api('POST', '/api/v1/games/armychess/rooms', { side: 1 }, alpha); // 默认 dark
        const id = r.json.data.id;
        await api('POST', `/api/v1/games/armychess/rooms/${id}/join`, {}, beta);
        const sA = (await api('GET', `/api/v1/games/armychess/rooms/${id}`, undefined, alpha)).json.data;
        T('暗棋房直接 playing（无 setup）、mode=dark', sA.status === 'playing' && sA.state.mode === 'dark' && (sA.state.events || []).every(e => e.t !== 'setup'), `status=${sA.status} mode=${sA.mode}`);
        const mine = (sA.state.pieces || []).filter(p => p.side === sA.mySide);
        const opp = (sA.state.pieces || []).filter(p => p.side !== sA.mySide);
        T('视角化：己方 25 枚全亮有 rank', mine.length === 25 && mine.every(p => p.hidden === false && 'rank' in p), JSON.stringify(mine[0]));
        T('视角化：对方 25 枚 hidden 无 rank 键', opp.length === 25 && opp.every(p => p.hidden === true && !('rank' in p)), JSON.stringify(opp[0]));
        // 换身份再拉一次（beta 视角）
        const sB = (await api('GET', `/api/v1/games/armychess/rooms/${id}`, undefined, beta)).json.data;
        const oppB = (sB.state.pieces || []).filter(p => p.side !== sB.mySide);
        T('视角化：换 beta 会话 → alpha 侧 25 枚 hidden 无 rank（视角正确）', sB.mySide === 2 && oppB.length === 25 && oppB.every(p => p.hidden === true && !('rank' in p)), `mySide=${sB.mySide} opp0=${JSON.stringify(oppB[0])}`);
        // 军旗在大本营、无行营子
        const flag = mine.find(p => p.rank === 'rank_flag');
        const camps = new Set(['1,7', '3,7', '2,8', '1,9', '3,9', '1,2', '3,2', '2,3', '1,4', '3,4']);
        T('军旗在大本营', !!flag && (flag.y === 11) && (flag.x === 1 || flag.x === 3), JSON.stringify(flag));
        T('无行营子', mine.every(p => !camps.has(p.x + ',' + p.y)) && opp.every(p => !camps.has(p.x + ',' + p.y)), '');
        // 司令阵亡亮旗：红司令吃蓝司令（同归）→ 蓝旗对红永久可见
        const setup = [
            { t: 'setup', s: 1, x: 4, y: 3, v: 10, p: 0 },   // 红司令
            { t: 'setup', s: 1, x: 0, y: 10, v: 12, p: 1 },  // 红旗
            { t: 'setup', s: 2, x: 3, y: 3, v: 10, p: 25 },  // 蓝司令
            { t: 'setup', s: 2, x: 1, y: 0, v: 12, p: 26 },  // 蓝旗
        ];
        craftDb(id, setup, ", Status='playing', Revision=10");
        await api('POST', `/api/v1/games/armychess/rooms/${id}/move`, { fx: 4, fy: 3, tx: 3, ty: 3 }, alpha);
        const sC = (await api('GET', `/api/v1/games/armychess/rooms/${id}`, undefined, alpha)).json.data;
        const flag2 = (sC.state.pieces || []).find(p => p.side === 2 && p.rank === 'rank_flag');
        T('司令阵亡亮旗：蓝旗对红方永久可见（hidden=false+rank）', !!flag2 && flag2.hidden === false, JSON.stringify(flag2));
    }

    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
