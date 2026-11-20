// qa_expense_range.js — 记账时间范围筛选 + 自定义导出（模块/范围）专项
// 用法：QA_TOKEN=ck1_xxx node qa_expense_range.js
// 依赖：站点 127.0.0.1:5188 以 CHECKIN_LOCAL=1 启动
const { execFileSync } = require('child_process');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const DB = 'D:/checkin/site/CheckinApp/data/checkin.db';

const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}
function section(t) { console.log('\n===== ' + t + ' ====='); }
function ok(cond, msg) { if (!cond) throw new Error(msg); }

function dbSql(sql, mode = 'ro') {
    const py = `
import sqlite3, json, sys
conn = sqlite3.connect(r'file:${DB}?mode=${mode}', uri=True)
cur = conn.cursor()
cur.execute(sys.argv[1])
rows = cur.fetchall() if cur.description else []
conn.commit()
print(json.dumps(rows, ensure_ascii=False))
`;
    const out = execFileSync('python', ['-c', py, sql], { encoding: 'utf8' });
    return JSON.parse(out.trim() || '[]');
}
const q = (s) => dbSql(s, /^\s*select/i.test(s) ? 'ro' : 'rw');

async function api(method, path, body, token) {
    const r = await fetch(BASE + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' },
            token ? { Authorization: 'Bearer ' + token } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch (_) { }
    return { status: r.status, json };
}

(async () => {
    section('0. 准备');
    const TK = process.env.QA_TOKEN || null;
    if (!TK) { console.error('缺 QA_TOKEN'); return done(); }
    q(`delete from Expenses where Note like 'QAR-%'`);
    q(`delete from ExpenseGroups where Name like 'QAR-%'`);

    const mk = async (amount, occurDate, note) => {
        const r = await api('POST', '/api/v1/expenses', { amount, type: 'out', category: '餐饮', occurDate, note }, TK);
        ok(r.json && r.json.ok, '建账失败: ' + JSON.stringify(r.json));
        return r.json.data.id;
    };
    const o1 = await mk(30, '2026-10-20T12:00', 'QAR-十月一笔');   // 范围外
    const n1 = await mk(10, '2026-11-01T08:00', 'QAR-十一月头');
    const n2 = await mk(20, '2026-11-15T19:30', 'QAR-十一月中');
    const mkMemo = async (title) => {
        const r = await api('POST', '/api/v1/memos', { title, content: 'x' }, TK);
        ok(r.json && r.json.ok, '建备忘失败: ' + JSON.stringify(r.json));
        return r.json.data.id;
    };
    const memo1 = await mkMemo('QAR-今天的备忘');

    section('1. 记账时间范围（含首尾两天）');
    const nov = await api('GET', '/api/v1/expenses?from=2026-11-01&to=2026-11-30', undefined, TK);
    T('11 月范围 → 2 笔', nov.json.data.items.length === 2, String(nov.json.data.items.length));
    T('返回带 from/to 让 App 确认', nov.json.data.from === '2026-11-01' && nov.json.data.to === '2026-11-30',
        `${nov.json.data.from}/${nov.json.data.to}`);
    T('汇总跟着范围走', nov.json.data.summary.count === 2 && nov.json.data.summary.totalOut === 30,
        JSON.stringify(nov.json.data.summary));

    const oneDay = await api('GET', '/api/v1/expenses?from=2026-11-15&to=2026-11-15', undefined, TK);
    T('只取 11-15 当天 → 1 笔（含尾）', oneDay.json.data.items.length === 1 && oneDay.json.data.items[0].note === 'QAR-十一月中',
        String(oneDay.json.data.items.length));

    const oct = await api('GET', '/api/v1/expenses?from=2026-10-01&to=2026-10-31', undefined, TK);
    T('10 月范围 → 1 笔', oct.json.data.items.length === 1, String(oct.json.data.items.length));

    const wide = await api('GET', '/api/v1/expenses?from=2026-10-01&to=2026-11-30', undefined, TK);
    T('跨月范围 → 3 笔', wide.json.data.items.length === 3, String(wide.json.data.items.length));

    section('2. 范围模式下的条目（当期视角）');
    const grp = await api('POST', '/api/v1/expenses/groups', { name: 'QAR-条目', ids: [o1, n2] }, TK);
    const gid = grp.json.data.id;
    const novG = await api('GET', '/api/v1/expenses?from=2026-11-01&to=2026-11-30', undefined, TK);
    const g = (novG.json.data.groups || []).find((x) => x.id === gid);
    T('范围内的条目：1 笔', !!g && g.count === 1, g && String(g.count));
    T('范围外还有 1 笔（otherCount）', !!g && g.otherCount === 1, g && String(g.otherCount));
    T('金额只算范围内那笔', !!g && g.totalOut === 20, g && String(g.totalOut));

    section('3. 自定义导出：按模块');
    const expOnly = await api('GET', '/api/v1/export/all?modules=expenses', undefined, TK);
    const eo = JSON.parse(expOnly.json.data.content);
    T('只导记账 → schedules 是空', eo.schedules == null, String(eo.schedules));
    T('只导记账 → memos 是空', eo.memos == null);
    T('只导记账 → expenses 有 3 笔', eo.expenses.length === 3, String(eo.expenses.length));
    T('条目定义跟着走（不丢）', Array.isArray(eo.expenseGroups) && eo.expenseGroups.some((x) => x.Name === 'QAR-条目'),
        JSON.stringify((eo.expenseGroups || []).map((x) => x.Name)));
    T('scope 写清楚导了什么', eo.scope.modules === 'expenses' && eo.scope.from === '',
        JSON.stringify(eo.scope));
    T('明细带 groupName', eo.expenses.some((x) => x.groupName === 'QAR-条目'));

    const memOnly = await api('GET', '/api/v1/export/all?modules=memos', undefined, TK);
    const mo = JSON.parse(memOnly.json.data.content);
    T('只导备忘 → expenses 是空', mo.expenses == null);
    T('只导备忘 → 不带条目定义', mo.expenseGroups == null);
    T('备忘在内', (mo.memos || []).some((x) => x.Title === 'QAR-今天的备忘'),
        JSON.stringify((mo.memos || []).map((x) => x.Title)));

    section('4. 自定义导出：按时间范围（条目定义不能被切掉）');
    const rangeExp = await api('GET', '/api/v1/export/all?modules=expenses&from=2026-11-01&to=2026-11-30', undefined, TK);
    const re = JSON.parse(rangeExp.json.data.content);
    T('范围内只有 2 笔', re.expenses.length === 2, String(re.expenses.length));
    T('范围内那笔在（正向断言，防假通过）', re.expenses.some((x) => x.Note === 'QAR-十一月中'));
    T('范围外那笔没被导出', !re.expenses.some((x) => x.Note === 'QAR-十月一笔'));
    T('条目定义仍在（范围外那笔的组没丢）',
        Array.isArray(re.expenseGroups) && re.expenseGroups.some((x) => x.Name === 'QAR-条目'),
        JSON.stringify((re.expenseGroups || []).map((x) => x.Name)));
    const grpDef = re.expenseGroups.find((x) => x.Name === 'QAR-条目');
    T('组定义给出 count=1 / total=2', grpDef && grpDef.count === 1 && grpDef.total === 2, JSON.stringify(grpDef));
    T('明细的 groupName 还在', re.expenses.some((x) => x.groupName === 'QAR-条目'));

    const rangeMemo = await api('GET', `/api/v1/export/all?modules=memos,board&from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, undefined, TK);
    const rm = JSON.parse(rangeMemo.json.data.content);
    T('今天建的备忘落在今天范围内（UTC→本地换算）', (rm.memos || []).some((x) => x.Title === 'QAR-今天的备忘'),
        JSON.stringify((rm.memos || []).map((x) => x.Title)));

    section('5. 老口径回归：不传参数 = 全量');
    const all = await api('GET', '/api/v1/export/all', undefined, TK);
    const ao = JSON.parse(all.json.data.content);
    T('全量导出仍有 expenses', Array.isArray(ao.expenses) && ao.expenses.length === 3, String((ao.expenses || []).length));
    T('全量导出仍有 expenseGroups', Array.isArray(ao.expenseGroups));
    T('全量 scope.modules=all', ao.scope.modules === 'all', JSON.stringify(ao.scope));
    const monthMode = await api('GET', '/api/v1/expenses?month=2026-11', undefined, TK);
    T('month 模式不受影响（2 笔）', monthMode.json.data.items.length === 2, String(monthMode.json.data.items.length));
    T('month 模式 from/to 为空', monthMode.json.data.from === '' && monthMode.json.data.to === '');

    section('6. 清理');
    for (const id of [o1, n1, n2]) await api('DELETE', '/api/v1/expenses/' + id, undefined, TK);
    await api('DELETE', '/api/v1/memos/' + memo1, undefined, TK);
    q(`delete from Expenses where Note like 'QAR-%'`);
    q(`delete from ExpenseGroups where Name like 'QAR-%'`);
    q(`delete from Memos where Title like 'QAR-%'`);
    T('测试数据已清空',
        q(`select count(*) from Expenses where Note like 'QAR-%'`)[0][0] === 0
        && q(`select count(*) from ExpenseGroups where Name like 'QAR-%'`)[0][0] === 0
        && q(`select count(*) from Memos where Title like 'QAR-%'`)[0][0] === 0);
    done();
})().catch((e) => {
    console.error('EXCEPTION', e && e.message);
    try {
        q(`delete from Expenses where Note like 'QAR-%'`);
        q(`delete from ExpenseGroups where Name like 'QAR-%'`);
        q(`delete from Memos where Title like 'QAR-%'`);
    } catch (_) { }
    done();
});

function done() {
    const bad = results.filter((r) => !r.ok);
    console.log(`\n合计 ${results.length} 项，通过 ${results.length - bad.length}，失败 ${bad.length}`);
    if (bad.length) { bad.forEach((r) => console.log('  ✗ ' + r.name + ' ' + r.extra)); process.exitCode = 1; }
}
