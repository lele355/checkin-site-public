// qa_expense_minute.js — 记账时间「精确到分钟」专项（网页 / API / 导出 / 老数据兼容）
// 用法：node qa_expense_minute.js
// 依赖：站点 127.0.0.1:5188 以 CHECKIN_LOCAL=1 启动（网页免登录 = admin/uid1），QA_alpha 已建号
const { execFileSync } = require('child_process');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const DB = 'D:/checkin/site/CheckinApp/data/checkin.db';
const PW = 'QaGames2026!';
const MONTH = '2026-11';

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
// SQL 走 argv 传给 python（不拼进代码串），所以不需要额外的引号转义；
// select 只读打开，其余（delete/insert）用读写模式
const q = (s) => dbSql(s, /^\s*select/i.test(s) ? 'ro' : 'rw');
const esc = (s) => String(s).replace(/'/g, "''");

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

// 网页要带 Cookie 才能过防伪校验（.AspNetCore.Antiforgery.*），所以维护一个极简 cookie jar
const JAR = new Map();
function jarHeader() {
    return [...JAR].map(([k, v]) => k + '=' + v).join('; ');
}
function soak(res) {
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of list) {
        const kv = c.split(';')[0];
        const i = kv.indexOf('=');
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
    section('0. 登录');
    // 本地跑 QA 账号密码常被改掉/锁，优先用外部注入的令牌（见 README：临时插 ApiTokens，测完删）
    let TK = process.env.QA_TOKEN || null;
    if (!TK) {
        const lg = await api('POST', '/api/v1/auth/login', { username: 'QA_alpha', password: PW, device: 'qa-expense-minute' });
        TK = lg.json && lg.json.ok ? lg.json.data.token : null;
        T('QA_alpha 取 token', !!TK, lg.json && lg.json.error);
    } else {
        T('使用环境变量注入的令牌', true);
    }
    if (!TK) return done();
    const uidAlpha = q("select Id from Users where Username='QA_alpha'")[0][0];

    // 清掉上一轮残留
    q(`delete from Expenses where Note like 'QA-mins%'`);

    // ---------------- 网页 ----------------
    section('1. 网页表单（datetime-local）');
    const newPage = await pageGet('/Expenses/New');
    T('记一笔页能打开', newPage.status === 200, 'status=' + newPage.status);
    T('输入框是 datetime-local', /type="datetime-local"/.test(newPage.text));
    T('step=60（只能选到分钟）', /step="60"/.test(newPage.text));
    const defVal = (newPage.text.match(/type="datetime-local"[^>]*value="([^"]+)"/) || [])[1]
        || (newPage.text.match(/value="([^"]+)"[^>]*type="datetime-local"/) || [])[1] || '';
    T('默认值精确到分钟且无秒', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(defVal), 'value=' + defVal);

    const post = await pagePost('/Expenses/New', {
        Amount: '12.34', Type: 'out', Category: '餐饮', OccurDate: '2026-11-15T19:30', Note: 'QA-mins-web',
    });
    T('网页保存后跳回列表', post.status === 302, 'status=' + post.status);
    const webRow = q(`select OccurDate from Expenses where Note='QA-mins-web' order by Id desc limit 1`);
    T('库里存到分钟、秒为 0', webRow.length === 1 && webRow[0][0] === '2026-11-15 19:30:00', JSON.stringify(webRow));

    const list = await pageGet('/Expenses?m=' + MONTH);
    T('列表显示「11月15日 19:30」', list.text.includes('11月15日 19:30'));
    T('列表不再出现 00:00 噪音', !list.text.includes('00:00'));

    // 老数据（只有日期）插入一条：显示时不该写 00:00
    q(`insert into Expenses (UserId,Amount,Type,Category,OccurDate,Note,CreatedAt,UpdatedAt)
       values (1,'9.9','out','餐饮','2026-11-14 00:00:00','QA-mins-legacy','2026-11-14 10:00:00','2026-11-14 10:00:00')`);
    const list2 = await pageGet('/Expenses?m=' + MONTH);
    T('老数据只显示日期（无 00:00）', list2.text.includes('11月14日') && !list2.text.includes('11月14日 00:00'));

    // 编辑页回填：datetime-local 该带 T 格式的值
    const webId = q(`select Id from Expenses where Note='QA-mins-web' order by Id desc limit 1`)[0][0];
    const editPage = await pageGet('/Expenses/Edit/' + webId);
    T('编辑页回填 2026-11-15T19:30', /value="2026-11-15T19:30"/.test(editPage.text));
    const postEdit = await pagePost('/Expenses/Edit/' + webId, {
        Id: String(webId), Amount: '12.34', Type: 'out', Category: '餐饮', OccurDate: '2026-11-14T08:05', Note: 'QA-mins-web',
    });
    T('网页编辑能保存', postEdit.status === 302, 'status=' + postEdit.status);
    const webRow2 = q(`select OccurDate from Expenses where Id=${webId}`);
    T('编辑后库里 2026-11-14 08:05:00', webRow2[0][0] === '2026-11-14 08:05:00', JSON.stringify(webRow2));

    // ---------------- API ----------------
    section('2. App 接口（/api/v1/expenses）');
    const created = [];
    const c1 = await api('POST', '/api/v1/expenses',
        { amount: 20, type: 'out', category: '餐饮', occurDate: '2026-11-15T19:30', note: 'QA-mins-api1' }, TK);
    T('接口创建成功', c1.json && c1.json.ok, JSON.stringify(c1.json));
    created.push(c1.json.data.id);

    const l1 = await api('GET', `/api/v1/expenses?month=${MONTH}`, undefined, TK);
    const it1 = (l1.json.data.items || []).find((x) => x.id === created[0]);
    T('接口回传 occurDate=2026-11-15T19:30', it1 && it1.occurDate === '2026-11-15T19:30', it1 && it1.occurDate);
    T('库里秒为 0', q(`select OccurDate from Expenses where Id=${created[0]}`)[0][0] === '2026-11-15 19:30:00');

    const u1 = await api('PUT', '/api/v1/expenses/' + created[0],
        { amount: 20, type: 'out', category: '餐饮', occurDate: '2026-11-15T07:05', note: 'QA-mins-api1' }, TK);
    T('接口改时间成功', u1.json && u1.json.ok);
    const l2 = await api('GET', `/api/v1/expenses?month=${MONTH}`, undefined, TK);
    const it2 = (l2.json.data.items || []).find((x) => x.id === created[0]);
    T('改后 occurDate=2026-11-15T07:05', it2 && it2.occurDate === '2026-11-15T07:05', it2 && it2.occurDate);

    // 只传日期 → 00:00（老口径，App 老版本仍兼容）
    const u2 = await api('PUT', '/api/v1/expenses/' + created[0],
        { amount: 20, type: 'out', category: '餐饮', occurDate: '2026-11-16', note: 'QA-mins-api1' }, TK);
    T('只给日期也能存', u2.json && u2.json.ok);
    const l3 = await api('GET', `/api/v1/expenses?month=${MONTH}`, undefined, TK);
    const it3 = (l3.json.data.items || []).find((x) => x.id === created[0]);
    T('只给日期 → 2026-11-16T00:00', it3 && it3.occurDate === '2026-11-16T00:00', it3 && it3.occurDate);

    // 不带时间 → 默认「此刻」（不再落到 00:00）
    const c2 = await api('POST', '/api/v1/expenses', { amount: 5, type: 'out', category: '其他', note: 'QA-mins-api2' }, TK);
    created.push(c2.json.data.id);
    const l4 = await api('GET', `/api/v1/expenses?month=${MONTH}`, undefined, TK);
    const it4 = (l4.json.data.items || []).find((x) => x.id === created[1]);
    const nowHm = new Date().toTimeString().slice(0, 5);
    const near = it4 && ['-1', '0', '1'].some((d) => {
        const t = new Date(Date.now() + Number(d) * 60000).toTimeString().slice(0, 5);
        return it4.occurDate.slice(11) === t;
    });
    T('不传时间 → 默认此刻（±1 分钟）', near, it4 && it4.occurDate + ' vs now ' + nowHm);
    T('默认时刻也精确到分钟（:00 秒）',
        q(`select OccurDate from Expenses where Id=${created[1]}`)[0][0].endsWith(':00'));

    // ---------------- 导出 ----------------
    section('3. 导出接口（CSV + 全量 JSON）');
    const csv = await api('GET', '/api/v1/export/expenses.csv', undefined, TK);
    const csvText = csv.json && csv.json.ok ? csv.json.data.content : '';
    T('CSV 表头是「日期时间」', csvText.includes('日期时间,方向,分类,金额,备注'));
    T('CSV 行到分钟 2026-11-16 00:00', csvText.includes('2026-11-16 00:00'));

    const all = await api('GET', '/api/v1/export/all', undefined, TK);
    const allJson = all.json && all.json.ok ? all.json.data.content : '';
    T('全量 JSON 的 occurDate 到分钟', /"occurDate"\s*:\s*"2026-11-16T00:00"/.test(allJson));
    T('全量 JSON 里没有秒级 occurDate', !/"occurDate"\s*:\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(allJson));

    // ---------------- 网页备份 ----------------
    section('3b. 网页备份（/Export?handler=Mine）');
    const backup = await pageGet('/Export?handler=Mine');
    T('备份能下载', backup.status === 200, 'status=' + backup.status);
    T('备份里的 OccurDate 到分钟', /"OccurDate":\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"/.test(backup.text));
    T('备份里没有秒级 OccurDate', !/"OccurDate":\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(backup.text));

    // ---------------- 收尾 ----------------
    section('4. 清理');
    for (const id of created) await api('DELETE', '/api/v1/expenses/' + id, undefined, TK);
    q(`delete from Expenses where Note like 'QA-mins%'`);
    T('测试数据已清空', q(`select count(*) from Expenses where Note like 'QA-mins%'`)[0][0] === 0);
    done();
})().catch((e) => {
    console.error('EXCEPTION', e && e.message);
    try { q(`delete from Expenses where Note like 'QA-mins%'`); } catch (_) { }
    done();
});

function done() {
    const bad = results.filter((r) => !r.ok);
    console.log(`\n合计 ${results.length} 项，通过 ${results.length - bad.length}，失败 ${bad.length}`);
    if (bad.length) { bad.forEach((r) => console.log('  ✗ ' + r.name + ' ' + r.extra)); process.exitCode = 1; }
}
