// qa_expense_group.js — 记账「合并成条目」专项（接口 / 网页 / 跨月 / 老数据 / 导出）
// 用法：node qa_expense_group.js     （QA_TOKEN 可直接注入令牌，省掉 QA 账号密码）
// 依赖：站点 127.0.0.1:5188 以 CHECKIN_LOCAL=1 启动（网页免登录 = admin/uid1）
const { execFileSync } = require('child_process');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const DB = 'D:/checkin/site/CheckinApp/data/checkin.db';
const PW = 'QaGames2026!';

const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}
function section(t) { console.log('\n===== ' + t + ' ====='); }
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// ---------- DB ----------
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

// ---------- HTTP ----------
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

const JAR = new Map();
const jarHeader = () => [...JAR].map(([k, v]) => k + '=' + v).join('; ');
function soak(res) {
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
        const kv = c.split(';')[0]; const i = kv.indexOf('=');
        if (i > 0) JAR.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
}
async function pageGet(path) {
    const r = await fetch(BASE + path, { redirect: 'manual', headers: JAR.size ? { Cookie: jarHeader() } : {} });
    soak(r);
    return { status: r.status, text: await r.text() };
}
function antiforgery(html) {
    const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)
        || html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/);
    return m ? m[1] : '';
}
async function pagePost(path, fields) {
    const g = await pageGet(path);
    const token = antiforgery(g.text);
    ok(token, path + ' 没拿到防伪令牌');
    const body = new URLSearchParams(Object.assign({ __RequestVerificationToken: token }, fields));
    const r = await fetch(BASE + path, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jarHeader() },
        body: body.toString(),
    });
    soak(r);
    return r;
}

// ---------- 主流程 ----------
(async () => {
    section('0. 准备');
    let TK = process.env.QA_TOKEN || null;
    if (!TK) {
        const lg = await api('POST', '/api/v1/auth/login', { username: 'QA_alpha', password: PW, device: 'qa-expense-group' });
        TK = lg.json && lg.json.ok ? lg.json.data.token : null;
        T('QA_alpha 取 token', !!TK, lg.json && lg.json.error);
    } else T('使用环境变量注入的令牌', true);
    if (!TK) return done();

    q(`delete from Expenses where Note like 'QAG-%'`);
    q(`delete from ExpenseGroups where Name like 'QAG-%'`);

    const mk = async (amount, type, occurDate, note) => {
        const r = await api('POST', '/api/v1/expenses', { amount, type, category: '餐饮', occurDate, note }, TK);
        ok(r.json && r.json.ok, '建账失败: ' + JSON.stringify(r.json));
        return r.json.data.id;
    };
    // 11 月两笔（同一天上下午）+ 11 月一笔别的日子；10 月两笔
    const a1 = await mk(10, 'out', '2026-11-15T08:10', 'QAG-早饭包子');
    const a2 = await mk(6, 'out', '2026-11-15T08:12', 'QAG-早饭豆浆');
    const a3 = await mk(30, 'out', '2026-11-03T19:00', 'QAG-别的日子');
    const b1 = await mk(88, 'out', '2026-10-20T10:00', 'QAG-十月超市1');
    const b2 = await mk(12, 'out', '2026-10-21T11:00', 'QAG-十月超市2');

    section('1. 建条目 + 列表聚合（当月视角）');
    const base = await api('GET', '/api/v1/expenses?month=2026-11', undefined, TK);
    const baseOut = base.json.data.summary.totalOut;

    const cg = await api('POST', '/api/v1/expenses/groups', { name: 'QAG-超市', ids: [a1, a2] }, TK);
    T('建条目成功', cg.json && cg.json.ok, JSON.stringify(cg.json));
    const gid = cg.json.data.id;

    const l1 = await api('GET', '/api/v1/expenses?month=2026-11', undefined, TK);
    const g1 = (l1.json.data.groups || []).find((g) => g.id === gid);
    T('列表里出现该条目', !!g1, JSON.stringify(l1.json.data.groups));
    T('条目当月 2 笔', g1 && g1.count === 2, g1 && String(g1.count));
    T('条目金额 = 明细求和 16', g1 && g1.totalOut === 16, g1 && String(g1.totalOut));
    T('条目时间取组内最新 08:12', g1 && g1.occurDate === '2026-11-15T08:12', g1 && g1.occurDate);
    T('明细带 groupId/groupName', (l1.json.data.items || []).filter((x) => x.groupId === gid && x.groupName === 'QAG-超市').length === 2);
    T('月度合计没被重复计（金额不变）', l1.json.data.summary.totalOut === baseOut, `${baseOut} -> ${l1.json.data.summary.totalOut}`);
    T('未分组的仍是 groupId=null', (l1.json.data.items || []).find((x) => x.id === a3).groupId === null);

    section('2. 跨月：同一条目在两个月份各显各的');
    const addOct = await api('POST', `/api/v1/expenses/groups/${gid}/items`, { ids: [b1] }, TK);
    T('把 10 月的一笔加进同一条目', addOct.json && addOct.json.ok, JSON.stringify(addOct.json));
    const nov = await api('GET', '/api/v1/expenses?month=2026-11', undefined, TK);
    const oct = await api('GET', '/api/v1/expenses?month=2026-10', undefined, TK);
    const gNov = (nov.json.data.groups || []).find((g) => g.id === gid);
    const gOct = (oct.json.data.groups || []).find((g) => g.id === gid);
    T('11 月视角：2 笔 + 其它月份 1 笔', gNov && gNov.count === 2 && gNov.otherCount === 1,
        gNov && `${gNov.count}/${gNov.otherCount}`);
    T('10 月视角：1 笔 + 其它月份 2 笔', gOct && gOct.count === 1 && gOct.otherCount === 2,
        gOct && `${gOct.count}/${gOct.otherCount}`);
    T('10 月视角金额只算当月那笔 88', gOct && gOct.totalOut === 88, gOct && String(gOct.totalOut));
    T('10 月总笔数没变（条目没吃掉别的账）', oct.json.data.summary.count === (oct.json.data.items || []).length);

    section('3. 校验与边界');
    const one = await api('POST', '/api/v1/expenses/groups', { name: 'QAG-x', ids: [a3] }, TK);
    T('只选 1 笔 → 拒绝', one.json && one.json.ok === false, one.json && one.json.error);
    const again = await api('POST', '/api/v1/expenses/groups', { name: 'QAG-y', ids: [a1, a3] }, TK);
    T('已属别的条目 → 拒绝', again.json && again.json.ok === false, again.json && again.json.error);
    const noname = await api('POST', '/api/v1/expenses/groups', { name: '  ', ids: [a3, b2] }, TK);
    T('空名字 → 拒绝', noname.json && noname.json.ok === false, noname.json && noname.json.error);
    const put = await api('PUT', '/api/v1/expenses/groups/' + gid, { name: 'QAG-超市改名' }, TK);
    T('改名成功', put.json && put.json.ok);
    const l2 = await api('GET', '/api/v1/expenses?month=2026-11', undefined, TK);
    T('列表里名字已变', ((l2.json.data.groups || []).find((g) => g.id === gid) || {}).name === 'QAG-超市改名');
    T('明细的 groupName 同步', (l2.json.data.items || []).filter((x) => x.groupId === gid).every((x) => x.groupName === 'QAG-超市改名'));

    section('4. 搜索命中组名');
    const sr = await api('GET', '/api/v1/expenses?month=2026-11&q=' + encodeURIComponent('QAG-超市改名'), undefined, TK);
    T('按组名搜到明细', sr.json.data.searching === true && (sr.json.data.items || []).length === 3, String((sr.json.data.items || []).length));
    T('搜索态不给分组（平铺）', (sr.json.data.groups || []).length === 0);

    section('5. 移出 / 解散（明细一笔都不能丢）');
    const rm = await api('POST', `/api/v1/expenses/groups/${gid}/items/remove`, { ids: [a2] }, TK);
    T('移出一笔成功', rm.json && rm.json.ok);
    T('移出后那笔退回未分组', q(`select GroupId from Expenses where Id=${a2}`)[0][0] === null);
    T('组内剩 2 笔（a1 + b1）', q(`select count(*) from Expenses where GroupId=${gid}`)[0][0] === 2);
    const del = await api('DELETE', '/api/v1/expenses/groups/' + gid, undefined, TK);
    T('解散成功', del.json && del.json.ok);
    T('解散后明细全在、只是不再归组',
        q(`select count(*) from Expenses where Id in (${a1},${b1})`)[0][0] === 2
        && q(`select count(*) from Expenses where Id in (${a1},${b1}) and GroupId is null`)[0][0] === 2);
    T('组记录已删', q(`select count(*) from ExpenseGroups where Id=${gid}`)[0][0] === 0);

    section('6. 空条目自动清理');
    const cg2 = await api('POST', '/api/v1/expenses/groups', { name: 'QAG-要删光', ids: [a3, b2] }, TK);
    const gid2 = cg2.json.data.id;
    await api('DELETE', '/api/v1/expenses/' + a3, undefined, TK);
    T('删掉一笔后组还在', q(`select count(*) from ExpenseGroups where Id=${gid2}`)[0][0] === 1);
    await api('DELETE', '/api/v1/expenses/' + b2, undefined, TK);
    T('删光后组自动消失', q(`select count(*) from ExpenseGroups where Id=${gid2}`)[0][0] === 0);

    section('7. 导出带条目信息');
    const keep = await mk(20, 'out', '2026-11-16T12:00', 'QAG-导出验证');
    const keep2 = await mk(5, 'out', '2026-11-16T12:05', 'QAG-导出验证2');
    await api('POST', '/api/v1/expenses/groups', { name: 'QAG-导出组', ids: [keep, keep2] }, TK);
    const csv = await api('GET', '/api/v1/export/expenses.csv', undefined, TK);
    const csvText = csv.json.data.content;
    T('CSV 表头有「条目」列', csvText.includes('日期时间,方向,分类,金额,备注,条目'));
    T('CSV 行带组名', csvText.includes('QAG-导出组'));
    const all = await api('GET', '/api/v1/export/all', undefined, TK);
    const allJson = all.json.data.content;
    T('全量 JSON 明细带 groupName', /"groupName":\s*"QAG-导出组"/.test(allJson));
    T('全量 JSON 有 expenseGroups 清单', /"expenseGroups"/.test(allJson));

    section('8. 网页端：组行 / 合并 / 改名 / 解散');
    // 网页用 admin（uid1），先造两笔 11 月的账
    const w1 = await pagePost('/Expenses/New', { Amount: '7', Type: 'out', Category: '餐饮', OccurDate: '2026-11-15T09:00', Note: 'QAG-网包子' });
    const w2 = await pagePost('/Expenses/New', { Amount: '3', Type: 'out', Category: '餐饮', OccurDate: '2026-11-15T09:02', Note: 'QAG-网豆浆' });
    T('网页记两笔成功', w1.status === 302 && w2.status === 302);
    const id1 = q(`select Id from Expenses where Note='QAG-网包子'`)[0][0];
    const id2 = q(`select Id from Expenses where Note='QAG-网豆浆'`)[0][0];

    const pre = await pageGet('/Expenses?m=2026-11');
    T('整理前没有条目行', !/class="exp-group"/.test(pre.text));
    T('整理前金额是两笔分开的', pre.text.includes('-¥7') && pre.text.includes('-¥3'));

    const merged = await pagePost('/Expenses?handler=Merge', {
        m: '2026-11', name: 'QAG-网早饭', 'ids[]': String(id1),
    });
    T('只选一笔合并被挡（服务端校验）', merged.status === 302);
    const afterBad = await pageGet('/Expenses?m=2026-11');
    T('单笔没建成条目', !/class="exp-group"/.test(afterBad.text));

    // 两笔一起提交（同名参数重复 = 数组）
    const g = await pageGet('/Expenses?m=2026-11');
    const token = antiforgery(g.text);
    const body = new URLSearchParams();
    body.set('__RequestVerificationToken', token);
    body.set('m', '2026-11');
    body.set('name', 'QAG-网早饭');
    body.append('ids', String(id1));
    body.append('ids', String(id2));
    const okMerge = await fetch(BASE + '/Expenses?handler=Merge', {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jarHeader() },
        body: body.toString(),
    });
    T('网页合并成功', okMerge.status === 302, 'status=' + okMerge.status);
    const gAfter = q(`select GroupId from Expenses where Id in (${id1},${id2})`);
    T('两笔已归到同一个条目', gAfter[0][0] !== null && gAfter[0][0] === gAfter[1][0], JSON.stringify(gAfter));

    const page2 = await pageGet('/Expenses?m=2026-11');
    T('页面出现条目行', /class="exp-group"/.test(page2.text));
    T('条目行显示组名', page2.text.includes('QAG-网早饭'));
    T('条目行显示「2 笔」', /2 笔/.test(page2.text));
    T('展开区含两笔明细', /exp-child/.test(page2.text) && page2.text.includes('QAG-网包子') && page2.text.includes('QAG-网豆浆'));
    T('条目行金额是合计 -¥10', page2.text.includes('-¥10'));
    T('老数据那 100 多笔没被分组', !/10月16日/.test(page2.text));   // 11 月页面本来就不该有 10 月的账

    const gidWeb = gAfter[0][0];
    const rn = await pagePost('/Expenses?handler=Rename', { m: '2026-11', groupId: String(gidWeb), name: 'QAG-网页早饭' });
    T('网页改名成功', rn.status === 302);
    const page3 = await pageGet('/Expenses?m=2026-11');
    T('页面显示新名字', page3.text.includes('QAG-网页早饭') && !page3.text.includes('QAG-网早饭'));

    const ds = await pagePost('/Expenses?handler=Dissolve', { m: '2026-11', groupId: String(gidWeb) });
    T('网页解散成功', ds.status === 302);
    T('解散后两笔都还在', q(`select count(*) from Expenses where Id in (${id1},${id2})`)[0][0] === 2);
    const page4 = await pageGet('/Expenses?m=2026-11');
    T('页面不再有条目行', !/class="exp-group"/.test(page4.text));

    section('9. 老数据兼容（10 月那批全未分组）');
    const octPage = await pageGet('/Expenses?m=2026-10');
    T('10 月页面正常渲染', octPage.status === 200);
    T('10 月没有条目行', !/class="exp-group"/.test(octPage.text));
    T('老数据仍按单笔显示', /class="row-item exp-single"/.test(octPage.text));

    section('11. 条目详情接口（全量明细，跨月）');
    const d1 = await mk(11, 'out', '2026-11-17T09:00', 'QAG-详情1');
    const d2 = await mk(22, 'out', '2026-10-02T09:00', 'QAG-详情2');
    const cgD = await api('POST', '/api/v1/expenses/groups', { name: 'QAG-详情组', ids: [d1, d2] }, TK);
    const gidD = cgD.json.data.id;
    const det = await api('GET', '/api/v1/expenses/groups/' + gidD, undefined, TK);
    T('详情返回全量 2 笔（跨月）', det.json.data.count === 2 && det.json.data.items.length === 2, JSON.stringify(det.json.data.count));
    T('详情合计 33', det.json.data.totalOut === 33, String(det.json.data.totalOut));
    T('详情时间精确到分钟', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(det.json.data.items[0].occurDate));
    const det404 = await api('GET', '/api/v1/expenses/groups/999999', undefined, TK);
    T('不存在的条目 → 报错', det404.json && det404.json.ok === false, det404.json && det404.json.error);

    section('12. AI 认条目：按条目名查询 + 合并动作');
    const mkMsg = (actions) => {
        q(`insert into AiMessages (UserId,Role,Content,ActionsJson,CreatedAt,ImageMime,CoupleChat)
           values (38,'assistant','','${actions.replace(/'/g, "''")}','2026-11-15 12:00:00','',0)`);
        return q(`select Id from AiMessages where UserId=38 order by Id desc limit 1`)[0][0];
    };
    const msgQ = mkMsg(JSON.stringify([{ type: 'query_records', module: 'expense', keyword: 'QAG-详情组', days: 365 }]));
    const rq = await api('POST', '/api/v1/ai/execute', { msgId: msgQ, actIndex: 0 }, TK);
    const qMsg = rq.json && rq.json.ok ? rq.json.data.message : '';
    T('AI 能按条目名查到', /「QAG-详情组」相关 2 笔/.test(qMsg), qMsg.slice(0, 80));
    T('查询结果带 #id（供后续合并用）', /#\d+/.test(qMsg));
    T('查询结果给出合计', /支出 ¥33/.test(qMsg), qMsg.slice(0, 80));

    const m3 = await mk(7, 'out', '2026-11-18T10:00', 'QAG-AI合并1');
    const m4 = await mk(8, 'out', '2026-11-18T10:05', 'QAG-AI合并2');
    const msgM = mkMsg(JSON.stringify([{ type: 'merge_expenses', name: 'QAG-AI组', ids: [m3, m4] }]));
    const rm2 = await api('POST', '/api/v1/ai/execute', { msgId: msgM, actIndex: 0 }, TK);
    T('AI 合并动作成功', rm2.json && rm2.json.ok, rm2.json && (rm2.json.data && rm2.json.data.message));
    T('两笔已归入同一条目', q(`select count(*) from Expenses where Id in (${m3},${m4}) and GroupId is not null`)[0][0] === 2);
    T('条目名正确', q(`select Name from ExpenseGroups where Id=(select GroupId from Expenses where Id=${m3})`)[0][0] === 'QAG-AI组');

    const msgBad = mkMsg(JSON.stringify([{ type: 'merge_expenses', name: 'QAG-坏', ids: [m3] }]));
    const rbad = await api('POST', '/api/v1/ai/execute', { msgId: msgBad, actIndex: 0 }, TK);
    T('AI 只给 1 笔 → 拒绝', rbad.json && rbad.json.ok === false, rbad.json && rbad.json.error);
    const msgDup = mkMsg(JSON.stringify([{ type: 'merge_expenses', name: 'QAG-坏2', ids: [m3, d1] }]));
    const rdup = await api('POST', '/api/v1/ai/execute', { msgId: msgDup, actIndex: 0 }, TK);
    T('AI 拿已归组的账再合并 → 拒绝', rdup.json && rdup.json.ok === false, rdup.json && rdup.json.error);

    section('13. 清理');
    for (const id of [a1, a2, a3, b1, b2, keep, keep2, id1, id2, d1, d2, m3, m4]) {
        await api('DELETE', '/api/v1/expenses/' + id, undefined, TK);
    }
    q(`delete from Expenses where Note like 'QAG-%'`);
    q(`delete from ExpenseGroups where Name like 'QAG-%'`);
    q(`delete from AiMessages where UserId=38 and Content='' and ActionsJson like '%QAG-%'`);
    T('测试数据已清空',
        q(`select count(*) from Expenses where Note like 'QAG-%'`)[0][0] === 0
        && q(`select count(*) from ExpenseGroups where Name like 'QAG-%'`)[0][0] === 0
        && q(`select count(*) from AiMessages where UserId=38 and Content='' and ActionsJson like '%QAG-%'`)[0][0] === 0);
    done();
})().catch((e) => {
    console.error('EXCEPTION', e && e.message);
    try {
        q(`delete from Expenses where Note like 'QAG-%'`);
        q(`delete from ExpenseGroups where Name like 'QAG-%'`);
        q(`delete from AiMessages where UserId=38 and Content='' and ActionsJson like '%QAG-%'`);
    } catch (_) { }
    done();
});

function done() {
    const bad = results.filter((r) => !r.ok);
    console.log(`\n合计 ${results.length} 项，通过 ${results.length - bad.length}，失败 ${bad.length}`);
    if (bad.length) { bad.forEach((r) => console.log('  ✗ ' + r.name + ' ' + r.extra)); process.exitCode = 1; }
}
