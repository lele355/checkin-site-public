// _verify_282.js — 2.8.2 P0 复验：Size 13/19 读写往返 + 旧格式兼容 + 分发健全性
const BASE = 'http://127.0.0.1:5188';
const fs = require('fs');
const { execFileSync } = require('child_process');
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'v282' }) }); return (await r.json()).data.token; }
async function api(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, json: j, raw: j ? null : await r.text().catch(() => '') }; }
function craftDb(id, evs, extra) {
    const json = JSON.stringify(evs).replace(/'/g, "''");
    const py = "import sqlite3\nc = sqlite3.connect(r'D:/checkin/site/CheckinApp/data/checkin.db')\n"
        + "c.execute(\"\"\"update GameRooms set MovesJson='" + json + "'" + (extra || '') + " where Id=" + id + "\"\"\")\n"
        + "c.commit()\nc.close()";
    fs.writeFileSync('D:/checkin/site/qa/_tmp_craft.py', py, 'utf8');
    execFileSync('python', ['D:/checkin/site/qa/_tmp_craft.py']);
}
(async () => {
    const alpha = await loginApi('QA_alpha');
    const beta = await loginApi('QA_beta');

    // ===== 1. Size 读写往返（13 / 15 / 19） =====
    for (const size of [13, 15, 19]) {
        const r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size }, alpha);
        const id = r.json.data.id;
        const s = (await api('GET', `/api/v1/games/gomoku/rooms/${id}`, undefined, alpha)).json.data;
        const stateSize = s.state && s.state.size;
        T(`Size=${size} 读写往返（dto.size + state.size + JSON int）`,
            s.size === size && stateSize === size,
            `dto.size=${s.size} state.size=${stateSize} typeof=${typeof s.size}`);
    }
    // 15 默认（不传 size）
    {
        const r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1 }, alpha);
        const id = r.json.data.id;
        const s = (await api('GET', `/api/v1/games/gomoku/rooms/${id}`, undefined, alpha)).json.data;
        T('Size 缺省 = 15（默认多态回落正确）', s.size === 15, `size=${s.size}`);
    }

    // ===== 2. Size 生效于规则（13/19 边界坐标） =====
    {
        // 13 路：(12,12) 合法、(13,13) 越界拒
        const r13 = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size: 13 }, alpha);
        const id13 = r13.json.data.id;
        await api('POST', `/api/v1/games/gomoku/rooms/${id13}/join`, {}, beta);
        const m1 = await api('POST', `/api/v1/games/gomoku/rooms/${id13}/move`, { x: 12, y: 12 }, alpha);
        const m2 = await api('POST', `/api/v1/games/gomoku/rooms/${id13}/move`, { x: 13, y: 13 }, beta);
        T('13 路：(12,12) 受理 / (13,13) 拒（size 真生效）',
            m1.json && m1.json.ok === true && m2.json && m2.json.ok === false,
            `12,12=${m1.json && m1.json.ok} 13,13 err=${m2.json && m2.json.error}`);
        // 19 路：(18,18) 合法
        const r19 = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size: 19 }, alpha);
        const id19 = r19.json.data.id;
        await api('POST', `/api/v1/games/gomoku/rooms/${id19}/join`, {}, beta);
        const m3 = await api('POST', `/api/v1/games/gomoku/rooms/${id19}/move`, { x: 18, y: 18 }, alpha);
        T('19 路：(18,18) 受理（size 真生效）', m3.json && m3.json.ok === true, `ok=${m3.json && m3.json.ok} err=${m3.json && m3.json.error}`);
    }

    // ===== 3. 大厅列表 size 字段（App 消费面） =====
    {
        const r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size: 13 }, alpha);
        const id = r.json.data.id;
        const lb = (await api('GET', '/api/v1/games/gomoku/rooms', undefined, alpha)).json.data;
        const item = (lb.items || []).find(x => x.id === id);
        T('大厅行 size=13（GameLobbyItemDto 消费面）', item && item.size === 13, `item.size=${item && item.size}`);
    }

    // ===== 4. 旧格式兼容（legacy MovesJson [{x,y,s}] 房间） =====
    {
        const r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size: 15 }, alpha);
        const id = r.json.data.id;
        await api('POST', `/api/v1/games/gomoku/rooms/${id}/join`, {}, beta);
        // 写入旧格式 moves（无 t 字段的 {x,y,s}）
        craftDb(id, [{ x: 7, y: 7, s: 1 }, { x: 0, y: 0, s: 2 }], ', Revision=10');
        const s = (await api('GET', `/api/v1/games/gomoku/rooms/${id}`, undefined, alpha)).json.data;
        const movesOk = Array.isArray(s.moves) && s.moves.length === 2 && s.moves[0].x === 7 && s.moves[0].y === 7;
        T('旧格式 moves 房间可读（x,y,s 兼容投影）', movesOk, JSON.stringify(s.moves));
        // 旧格式房继续走子（写侧升级新格式）
        const m = await api('POST', `/api/v1/games/gomoku/rooms/${id}/move`, { x: 8, y: 8 }, alpha);
        T('旧格式房可继续走子（写侧升级）', m.json && m.json.ok === true, `ok=${m.json && m.json.ok} err=${m.json && m.json.error}`);
    }

    // ===== 5. 快照 JSON 形状（App DTO 对齐） =====
    {
        const r = await api('POST', '/api/v1/games/gomoku/rooms', { side: 1, size: 19 }, alpha);
        const id = r.json.data.id;
        const raw = await (await fetch(`${BASE}/api/v1/games/gomoku/rooms/${id}`, { headers: { Authorization: 'Bearer ' + alpha } })).text();
        const j = JSON.parse(raw);
        const d = j.data;
        const shapeOk = typeof d.size === 'number' && typeof d.state.size === 'number'
            && typeof d.mySide === 'number' && Array.isArray(d.moves)
            && (d.lastMove === null || (typeof d.lastMove.x === 'number' && typeof d.lastMove.y === 'number'));
        T('快照 JSON 形状与 App DTO 对齐（size=number 等）', shapeOk,
            `size=${typeof d.size} state.size=${typeof d.state.size} lastMove=${JSON.stringify(d.lastMove)}`);
    }

    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
