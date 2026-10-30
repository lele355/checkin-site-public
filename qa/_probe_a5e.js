const BASE = 'http://127.0.0.1:5188';
async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 'a5e' }) }); return (await r.json()).data.token; }
async function api(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, json: j }; }
(async () => {
    const alpha = await loginApi('QA_alpha');
    const beta = await loginApi('QA_beta');
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
        const d = m.json && m.json.data;
        console.log(`move (${fx},${fy})→(${tx},${ty}): http=${m.status} ok=${m.json && m.json.ok} status=${d && d.status} winner=${JSON.stringify(d && d.winner)} type=${typeof (d && d.winner)} reason=${d && d.resultReason}`);
        if (d && d.status === 'finished') { fin = d; break; }
    }
    if (!fin) { const s = await api('GET', `/api/v1/games/xiangqi/rooms/${id}`, undefined, alpha); fin = s.json.data; }
    console.log('FINAL:', JSON.stringify({ status: fin.status, winner: fin.winner, tw: typeof fin.winner, reason: fin.resultReason }));
    console.log('断言:', fin.status === 'finished', fin.winner === 3, /repeat/i.test(fin.resultReason || ''));
})();
