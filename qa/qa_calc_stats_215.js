// qa_calc_stats_215.js — 2.15.0 专项：计算器页 / 统计三视图 / 记账范围与分类筛选 / stats 新字段
// 用法：node qa_calc_stats_215.js    （站点 127.0.0.1:5188 以 CHECKIN_LOCAL=1 启动，免登录 = admin/uid1）
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const DB = 'D:/checkin/site/CheckinApp/data/checkin.db';

const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}

async function get(path) {
    const r = await fetch(BASE + path, { redirect: 'manual' });
    return { status: r.status, body: await r.text() };
}

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

(async () => {
    // ---------- 造测试数据（11 月两笔，测完删） ----------
    dbSql(`DELETE FROM Expenses WHERE Note='qa215'`, 'rw');
    dbSql(`INSERT INTO Expenses(UserId, Amount, Type, Category, OccurDate, Note, CreatedAt, UpdatedAt)
           VALUES (1, 66.6, 'out', '餐饮', '2026-11-10 12:00:00', 'qa215', '2026-11-21T00:00:00', '2026-11-21T00:00:00')`, 'rw');
    dbSql(`INSERT INTO Expenses(UserId, Amount, Type, Category, OccurDate, Note, CreatedAt, UpdatedAt)
           VALUES (1, 12, 'out', '交通', '2026-11-10 13:00:00', 'qa215', '2026-11-21T00:00:00', '2026-11-21T00:00:00')`, 'rw');

    // 临时 API 令牌（裸 sha256 十六进制，测完删）
    const raw = 'qa215token' + Date.now();
    const sha = crypto.createHash('sha256').update(raw).digest('hex');
    dbSql(`DELETE FROM ApiTokens WHERE Device='qa215'`, 'rw');
    dbSql(`INSERT INTO ApiTokens(UserId, TokenHash, Device, CreatedAt, ExpiresAt, Revoked) VALUES (1, '${sha}', 'qa215', '2026-11-21T00:00:00', '2027-11-21T00:00:00', 0)`, 'rw');

    try {
        // ---------- 计算器页 ----------
        let r = await get('/Calculator');
        T('计算器页 200', r.status === 200);
        T('计算器三模式齐全', ['简单', '科学', '矩阵', 'calc-simple', 'calc-science', 'calc-matrix'].every(k => r.body.includes(k)));
        T('计算器含求值引擎（函数/阶乘/矩阵运算）', ['evalExpr', 'mDet', 'mInv', '阶乘'].every(k => r.body.includes(k)));

        // ---------- 统计页 ----------
        r = await get('/Stats');
        T('统计页 200', r.status === 200);
        T('统计三视图切换', ['概览', '趋势', '分布', 'data-view="trend"', 'data-view="dist"'].every(k => r.body.includes(k)));
        T('统计折叠模块', r.body.includes('stat-fold') && r.body.includes('localStorage'));
        T('统计饼图', r.body.includes('conic-gradient'));

        // ---------- 记账页：范围 + 分类筛选 + 饼图 + 折叠 ----------
        r = await get('/Expenses');
        T('记账页 200', r.status === 200);
        T('范围输入框（2.13 同步）', r.body.includes('name="from"') && r.body.includes('name="to"'));
        T('分类点选（2.14 同步）', r.body.includes('exp-cat-row') && r.body.includes('exp-restore'));
        T('分类饼图/折叠（2.14 同步）', r.body.includes('exp-pie-toggle') && r.body.includes('exp-fold'));
        T('流水行带分类属性', r.body.includes('data-cat='));
        T('当月分类有数据（造数生效）', r.body.includes('餐饮') && r.body.includes('66.6'));

        r = await get('/Expenses?from=2026-11-01&to=2026-11-21');
        T('范围筛选生效（标题显示起止）', r.status === 200 && /11月\d+日 ~ 11月\d+日/.test(r.body));

        // ---------- /api/v1/stats 新字段 ----------
        const res = await fetch(BASE + '/api/v1/stats', { headers: { Authorization: 'Bearer ' + raw } });
        const js = await res.json();
        const d = js.data || {};
        T('stats API 200', res.status === 200 && js.ok);
        T('stats 新字段 byCategory', Array.isArray(d.byCategory) && d.byCategory.length > 0);
        T('stats 新字段 daily', Array.isArray(d.daily));
        T('stats 新字段 maxMonthIn', typeof d.maxMonthIn === 'number');
        T('stats counts 补全（expenses/anniversaries）', d.counts && 'expenses' in d.counts && 'anniversaries' in d.counts);

        // ---------- 导航登记 ----------
        r = await get('/');
        T('侧栏有计算器入口', r.status === 200 && r.body.includes('/Calculator'));
    } finally {
        dbSql(`DELETE FROM Expenses WHERE Note='qa215'`, 'rw');
        dbSql(`DELETE FROM ApiTokens WHERE Device='qa215'`, 'rw');
    }

    const pass = results.filter(x => x.ok).length;
    console.log(`\n===== ${pass}/${results.length} 通过 =====`);
    process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('QA 崩了：', e.message); process.exit(1); });
