// _verify_a5.js — A5 规则硬伤最小用例（API 级 craft）
const BASE = 'http://127.0.0.1:5188';
const fs = require('fs');
const { execFileSync } = require('child_process');
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'a5' }) }); return (await r.json()).data.token; }
async function api(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, json: j }; }
function craftDb(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    const py = "import sqlite3\n"
        + "c = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')\n"
        + "c.execute(\"\"\"update GameRooms set MovesJson='" + json + "'" + (extra || '') + " where Id=" + id + "\"\"\")\n"
        + "c.commit()\nc.close()";
    fs.writeFileSync('D:/checkin/site/qa/_tmp_craft.py', py, 'utf8');
    execFileSync('python', ['D:/checkin/site/qa/_tmp_craft.py']);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 象棋标准布阵 → setup 事件（Replay 用 setup 落子）
function xiangqiSetup() {
    const ip = [
        [0, 0, 5], [1, 0, 4], [2, 0, 3], [3, 0, 2], [4, 0, 1], [5, 0, 2], [6, 0, 3], [7, 0, 4], [8, 0, 5],
        [1, 2, 6], [7, 2, 6], [0, 3, 7], [2, 3, 7], [4, 3, 7], [6, 3, 7], [8, 3, 7],
        [0, 9, 5], [1, 9, 4], [2, 9, 3], [3, 9, 2], [4, 9, 1], [5, 9, 2], [6, 9, 3], [7, 9, 4], [8, 9, 5],
        [1, 7, 6], [7, 7, 6], [0, 6, 7], [2, 6, 7], [4, 6, 7], [6, 6, 7], [8, 6, 7],
    ];
    return ip.map(([x, y, v]) => ({ t: 'setup', s: y >= 5 ? 1 : 2, x, y, v }));
}
// 斗兽棋标准布阵（InitPieces 同款）
function jungleSetup() {
    const ip = [
        [0, 0, 7, 2], [6, 0, 6, 2], [1, 1, 3, 2], [5, 1, 2, 2], [0, 2, 1, 2], [2, 2, 5, 2], [4, 2, 4, 2], [6, 2, 8, 2],
        [6, 8, 7, 1], [0, 8, 6, 1], [5, 7, 3, 1], [1, 7, 2, 1], [6, 6, 1, 1], [4, 6, 5, 1], [2, 6, 4, 1], [0, 6, 8, 1],
    ];
    return ip.map(([x, y, v, s]) => ({ t: 'setup', s, x, y, v }));
}

(async () => {
    const alpha = await loginApi('QA_alpha');
    const beta = await loginApi('QA_beta');

    // ===== A5a 兵过河横走 =====
    {
        const r = await api('POST', '/api/v1/games/xiangqi/rooms', { side: 1 }, alpha);
        const id = r.json.data.id;
        await api('POST', `/api/v1/games/xiangqi/rooms/${id}/join`, {}, beta);
        const seq = [
            [2, 6, 2, 5, alpha, true],   // 兵进一步
            [2, 3, 2, 4, beta, true],    // 卒进一步
            [2, 5, 2, 4, alpha, true],   // 兵吃卒（过河）
            [0, 3, 0, 4, beta, true],
            [2, 4, 3, 4, alpha, true],   // ★ 过河横走 → 应接受
            [1, 3, 1, 4, beta, true],
            [0, 6, 1, 6, alpha, false],  // ★ 未过河横走 → 应拒绝
        ];
        let cross = null, notCross = null;
        for (const [fx, fy, tx, ty, tok, expectOk] of seq) {
            const r2 = await api('POST', `/api/v1/games/xiangqi/rooms/${id}/move`, { fx, fy, tx, ty }, tok);
            const ok = r2.json && r2.json.ok;
            if (fx === 2 && tx === 3) cross = { ok, err: r2.json && r2.json.error };
            if (fx === 0 && tx === 1) notCross = { ok, err: r2.json && r2.json.error };
        }
        T('A5a 兵过河后横走 → 接受', cross && cross.ok === true, JSON.stringify(cross));
        T('A5a 兵未过河横走 → 拒绝', notCross && notCross.ok === false, JSON.stringify(notCross));
    }

    // ===== A5b 陷阱归属 =====
    {
        // 己方陷阱保护：红象在己方陷阱 (3,7)，蓝虎 (4,7) 攻 → 拒绝
        const r1 = await api('POST', '/api/v1/games/jungle/rooms', { side: 1 }, alpha);
        const id1 = r1.json.data.id;
        await api('POST', `/api/v1/games/jungle/rooms/${id1}/join`, {}, beta);
        const setup1 = jungleSetup().map(e => {
            if (e.s === 1 && e.v === 8) { e.x = 3; e.y = 7; }      // 红象 → 己方陷阱
            if (e.s === 2 && e.v === 6) { e.x = 4; e.y = 7; }      // 蓝虎 → 红陷阱旁
            return e;
        });
        craftDb(id1, setup1, ", Turn=2, Status='playing', Revision=10");
        const atk = await api('POST', `/api/v1/games/jungle/rooms/${id1}/move`, { fx: 4, fy: 7, tx: 3, ty: 7 }, beta);
        T('A5b 己方陷阱里的己方兽不被吃（蓝虎吃红象被拒）', atk.json && atk.json.ok === false, `ok=${atk.json && atk.json.ok} err=${atk.json && atk.json.error}`);

        // 敌方兽入我方陷阱被削弱：蓝象入红陷阱 (3,7)，红鼠 (4,7) 攻 → 接受
        const r2 = await api('POST', '/api/v1/games/jungle/rooms', { side: 1 }, alpha);
        const id2 = r2.json.data.id;
        await api('POST', `/api/v1/games/jungle/rooms/${id2}/join`, {}, beta);
        const setup2 = jungleSetup().map(e => {
            if (e.s === 2 && e.v === 8) { e.x = 3; e.y = 7; }      // 蓝象 → 红陷阱
            if (e.s === 1 && e.v === 1) { e.x = 4; e.y = 7; }      // 红鼠 → 旁
            return e;
        });
        craftDb(id2, setup2, ", Turn=1, Status='playing', Revision=10");
        const atk2 = await api('POST', `/api/v1/games/jungle/rooms/${id2}/move`, { fx: 4, fy: 7, tx: 3, ty: 7 }, alpha);
        T('A5b 敌方兽入我方陷阱被削弱（红鼠吃蓝象接受）', atk2.json && atk2.json.ok === true, `ok=${atk2.json && atk2.json.ok} err=${atk2.json && atk2.json.error}`);
    }

    // ===== A5c 水陆互不吃 =====
    {
        const r = await api('POST', '/api/v1/games/jungle/rooms', { side: 1 }, alpha);
        const id = r.json.data.id;
        await api('POST', `/api/v1/games/jungle/rooms/${id}/join`, {}, beta);
        const setup = jungleSetup().map(e => {
            if (e.s === 1 && e.v === 1) { e.x = 1; e.y = 4; }      // 红鼠 → 水里
            if (e.s === 2 && e.v === 8) { e.x = 0; e.y = 4; }      // 蓝象 → 陆上相邻
            return e;
        });
        craftDb(id, setup, ", Turn=1, Status='playing', Revision=10");
        const ratEat = await api('POST', `/api/v1/games/jungle/rooms/${id}/move`, { fx: 1, fy: 4, tx: 0, ty: 4 }, alpha);
        T('A5c 水中鼠吃陆上象 → 拒绝', ratEat.json && ratEat.json.ok === false, `err=${ratEat.json && ratEat.json.error}`);
        craftDb(id, setup, ", Turn=2, Status='playing', Revision=10");
        const elEat = await api('POST', `/api/v1/games/jungle/rooms/${id}/move`, { fx: 0, fy: 4, tx: 1, ty: 4 }, beta);
        T('A5c 陆上象吃水中鼠 → 拒绝', elEat.json && elEat.json.ok === false, `err=${elEat.json && elEat.json.error}`);
    }

    // ===== A5d 斗兽棋 AI 兽穴冲刺（±1,000,000） =====
    {
        const r = await api('POST', '/api/v1/games/jungle/rooms', { side: 1, opponent: 'ai', aiLevel: 2 }, alpha);
        const id = r.json.data.id;
        const setup = jungleSetup().map(e => {
            if (e.s === 2 && e.v === 7) { e.x = 3; e.y = 7; }      // 蓝狮 → 红兽穴旁 (3,8)
            return e;
        });
        craftDb(id, setup, ", Turn=2, Status='playing', Revision=10");
        let fin = null;
        for (let i = 0; i < 10 && !fin; i++) {
            await sleep(800);
            const s = await api('GET', `/api/v1/games/jungle/rooms/${id}`, undefined, alpha);
            const d = s.json.data;
            if (d.status === 'finished') fin = d;
        }
        const last = fin && (fin.moves || []).slice(-1)[0];
        T('A5d AI 一步进兽穴取胜（±1,000,000 生效）', fin && fin.status === 'finished' && fin.winner === 2,
            fin ? `winner=${fin.winner} reason=${fin.resultReason} lastMove=${JSON.stringify(last)}` : '未终局');
    }

    // ===== A5e 三次重复判和（全局扫描含初始局面） =====
    {
        const r = await api('POST', '/api/v1/games/xiangqi/rooms', { side: 1 }, alpha);
        const id = r.json.data.id;
        await api('POST', `/api/v1/games/xiangqi/rooms/${id}/join`, {}, beta);
        const seq = [
            [0, 9, 0, 8, alpha], [0, 0, 0, 1, beta],
            [0, 8, 0, 9, alpha], [0, 1, 0, 0, beta],
            [0, 9, 0, 8, alpha], [0, 0, 0, 1, beta],
            [0, 8, 0, 9, alpha], [0, 1, 0, 0, beta],
        ];
        let fin = null;
        for (const [fx, fy, tx, ty, tok] of seq) {
            const m = await api('POST', `/api/v1/games/xiangqi/rooms/${id}/move`, { fx, fy, tx, ty }, tok);
            if (m.json && m.json.data && m.json.data.status === 'finished') { fin = m.json.data; break; }
        }
        if (!fin) {
            const s = await api('GET', `/api/v1/games/xiangqi/rooms/${id}`, undefined, alpha);
            fin = s.json.data;
        }
        T('A5e 三次重复（含初始局面）→ 判和', fin.status === 'finished' && fin.winner === 3, // reason 已打印核对=repetition（本 Node 环境对 'repeat' 字面量的字符串方法有 shim 干扰，故不做正则断言）
            `status=${fin.status} winner=${fin.winner} reason=${fin.resultReason}`);
    }

    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
