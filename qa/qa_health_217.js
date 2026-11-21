// qa_health_217.js — 健康模块专项：绑定全流程 / 幂等 / 解绑级联 / webhook 鉴权 / 日汇总
// 用法：node qa_health_217.js
// 依赖：站点 127.0.0.1:5188（CHECKIN_LOCAL=1）+ mock bridge 127.0.0.1:8766（MI_HEALTH_MOCK=1）
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';

const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}

async function get(path) {
    const r = await fetch(BASE + path, { redirect: 'manual' });
    return { status: r.status, body: await r.text() };
}
async function post(path, headers) {
    const r = await fetch(BASE + path, { method: 'POST', headers: headers || {} });
    return { status: r.status, body: await r.text() };
}
async function del(path) {
    const r = await fetch(BASE + path, { method: 'DELETE' });
    return { status: r.status, body: await r.text() };
}

(async () => {
    // ---------- 绑定全流程（mock bridge：发起即成功 + 即采数） ----------
    let r = await post('/api/v1/health/bindings/qr');
    T('QR 发起 200', r.status === 200);
    const qr = JSON.parse(r.body).data || {};
    T('QR 返回 id/qrPng/bindingId', qr.id > 0 && typeof qr.qrPng === 'string' && qr.qrPng.length > 100 && !!qr.bindingId);

    r = await get(`/api/v1/health/bindings/${qr.id}/status`);
    T('绑定状态 active（mock 即刻）', r.status === 200 && JSON.parse(r.body).data.status === 'active');

    // ---------- 绑定即采数：日汇总已就绪 ----------
    // 首拉已转后台（绑定秒亮灯）—— 先手动同步沉淀，再取基线；只看本绑定，别混旧数据
    await post('/api/v1/health/sync');
    r = await get(`/api/v1/health/daily?from=2026-11-15&to=2026-11-30&binding=${qr.id}`);
    const daily = JSON.parse(r.body).data || {};
    T('日汇总有数据（绑定即采数）', Array.isArray(daily.items) && daily.items.length > 0,
        'rows=' + (daily.items || []).length);
    T('日汇总字段齐全', daily.items[0] && ['steps', 'sleepMinutes', 'hrAvg', 'bindingName', 'date'].every(k => k in daily.items[0]));

    // ---------- 幂等：重复同步 0 翻倍 ----------
    const before = (daily.items || []).length;
    await post('/api/v1/health/sync');
    r = await get(`/api/v1/health/daily?from=2026-11-15&to=2026-11-30&binding=${qr.id}`);
    const after = (JSON.parse(r.body).data.items || []).length;
    T('同步幂等（行数不变）', before === after, `before=${before} after=${after}`);
    const stepsBefore = daily.items.reduce((s, x) => s + x.steps, 0);
    const stepsAfter = JSON.parse(r.body).data.items.reduce((s, x) => s + x.steps, 0);
    T('同步幂等（步数不翻倍）', stepsBefore === stepsAfter, `${stepsBefore} vs ${stepsAfter}`);

    // ---------- 绑定列表与过滤 ----------
    r = await get('/api/v1/health/bindings');
    const bl = JSON.parse(r.body).data.items || [];
    T('绑定列表含新绑定', bl.some(b => b.id === qr.id && b.status === 'active'));
    r = await get(`/api/v1/health/daily?from=2026-11-15&to=2026-11-30&binding=${qr.id}`);
    const only = JSON.parse(r.body).data.items || [];
    T('按绑定过滤不越界', only.every(x => x.bindingId === qr.id));

    // ---------- webhook 通道 ----------
    r = await post('/api/v1/health/bridge-notify', { 'X-Mi-Health-Token': 'wrong' });
    T('webhook 错 token 401', r.status === 401);
    r = await post('/api/v1/health/bridge-notify', { 'X-Mi-Health-Token': 'qa-local-webhook' });
    T('webhook 正 token 200', r.status === 200);

    // ---------- 解绑级联 ----------
    r = await del(`/api/v1/health/bindings/${qr.id}`);
    T('解绑 200', r.status === 200);
    r = await get('/api/v1/health/bindings');
    T('解绑后列表消失', !(JSON.parse(r.body).data.items || []).some(b => b.id === qr.id));
    r = await get(`/api/v1/health/daily?from=2026-11-15&to=2026-11-30&binding=${qr.id}`);
    T('解绑级联清日汇总', (JSON.parse(r.body).data.items || []).length === 0);

    // ---------- 2.19：体重手填 + 小时曲线端点 ----------
    r = await post('/api/v1/health/weight', { 'Content-Type': 'application/json' });
    // Api.exec POST with body —— 这里直接 fetch 带 body
    r = await fetch(BASE + '/api/v1/health/weight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: '2026-11-21', weightKg: 66.6 }),
    });
    T('体重手填 200', r.status === 200);
    r = await get('/api/v1/health/weight?from=2026-11-01&to=2026-11-30');
    const wt = JSON.parse(r.body).data.items || [];
    T('体重序列含手填', wt.some(x => x.date === '2026-11-21' && Math.abs(x.weightKg - 66.6) < 0.01 && x.manual));
    r = await fetch(BASE + '/api/v1/health/weight', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: '2026-11-21', weightKg: 999 }),
    });
    T('体重越界拒绝', r.status === 400);

    r = await get('/api/v1/health/hourly?date=2026-11-21');
    T('小时曲线端点 200', r.status === 200 && Array.isArray(JSON.parse(r.body).data.items));

    // ---------- 网页入口 ----------
    r = await get('/Health');
    T('网页健康页 200', r.status === 200);
    T('网页含绑定/今日模块', ['绑定', '今日', '手动同步'].every(k => r.body.includes(k)));

    const pass = results.filter(x => x.ok).length;
    console.log(`\n===== ${pass}/${results.length} 通过 =====`);
    process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('QA 崩了：', e.message); process.exit(1); });
