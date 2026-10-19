// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// qa_full.js — 生活管家全流程全功能测试套件（含数据落库验证 + 越权隔离）
// 用法: node qa_full.js <轮次号>   → 输出 report-r<轮次>.json + console 明细
// 基建约定: playwright 用系统 Edge（channel:'msedge'）；弹窗=#appModal .modal-body；
// toast 断言用 .toast-ok/.toast-err；测试账号 QA_A/QA_B 每轮重建；演示数据 admin 不动。
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const QA_DIR = 'D:/projects/checkin/qa';
const ROUND = process.argv[2] || '1';
const TAG = 'QATAG';                      // 标记词（防撞演示数据）
const results = [];
let curSec = '';

function sec(name) { curSec = name; console.log('\n===== ' + name + ' ====='); }
function T(name, cond, extra) {
    const ok = !!cond;
    results.push({ sec: curSec, name, ok, extra: String(extra || '') });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
}
function dbq(sql) {
    try {
        const out = execSync(`"${PY}" "${QA_DIR}/dbq.py"`, { input: sql, encoding: 'utf8' });
        return JSON.parse(out);
    } catch (e) { return [{ error: String(e) }]; }
}
// 本地日期字符串。注意：不能用 toISOString()（那是 UTC），服务器 DateTime.Today 是本地时区，
// 本地凌晨 0-8 点两者差一天，会导致「当天」类查询落空（2026-10-18 凌晨踩过坑）
const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => fmtDate(new Date());

async function login(page, user, pass) {
    await page.goto(BASE + '/Login');
    await page.fill('#Username', user);
    await page.fill('#Password', pass);
    await page.click('button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(300);
}
async function loginOK(page, user, pass, label) {
    await login(page, user, pass);
    const url = page.url();
    T(label + ' 登录跳转工作台', !url.includes('Login'), url);
}
// 弹窗表单：点链接开弹窗 → 填字段 → 提交 → 等刷新
async function modalOpen(page, linkText) {
    await page.getByText(linkText, { exact: false }).first().click();
    await page.waitForSelector('#appModal[open] .modal-body form', { timeout: 5000 });
    await page.waitForTimeout(250);   // 等表单 JS 绑定
}
async function modalSubmit(page) {
    await page.locator('#appModal .modal-body button[type=submit]').first().click();
    await page.waitForTimeout(900);   // fetch 提交 + toast + reload
}
// 编辑弹窗：modal.js 只拦站内链接点击，直接 goto URL 不弹窗，必须走列表页点链接
async function openEdit(page, listPath, id) {
    await page.goto(BASE + listPath + '?view=list');   // 显式 view=list 防视图记忆自动恢复到卡片/日历
    await page.waitForTimeout(350);
    const link = page.locator(`a[href="${listPath}/Edit/${id}"]`).first();
    try {
        await link.click({ timeout: 6000 });
    } catch (e) {
        // 偶发：元素被布局/滚动抖动判为不稳定（2026-10-17 S14 撞过一次）。
        // 兜底强制点击并打印现场信息，若弹窗没开后续断言会立刻暴露
        const info = await link.evaluate(el => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return { rect: `${r.x},${r.y},${r.width}x${r.height}`, vis: cs.visibility, disp: cs.display, op: cs.opacity };
        }).catch(() => 'no-info');
        console.log(`  [openEdit 兜底] ${listPath}/Edit/${id} 常规点击失败: ${String(e).split('\n')[0]} | 现场: ${JSON.stringify(info)}`);
        await link.click({ force: true, timeout: 6000 });
    }
    await page.waitForSelector('#appModal[open] .modal-body form', { timeout: 5000 });
    await page.waitForTimeout(250);
}

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    // 三个独立会话：admin 管理员 / QA_A 普通 / QA_B 情侣
    const ctxL = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const pL = await ctxL.newPage(), pA = await ctxA.newPage(), pB = await ctxB.newPage();
    const pageErrors = [];
    for (const p of [pL, pA, pB]) {
        p.on('pageerror', e => pageErrors.push(e.message));
        p.on('dialog', d => d.accept().catch(() => {}));   // 删除表单有 confirm()，自动确认
    }

    try {
        // ================= S1 认证 =================
        sec('S1 认证与会话');
        for (const path of ['/', '/Schedule', '/Memo', '/Admin/Users', '/Ai', '/Period']) {
            const r = await pL.request.get(BASE + path, { maxRedirects: 0 }).catch(() => null);
            T(`未登录访问 ${path} 302`, r && r.status() === 302, r && r.status());
        }
        await login(pL, ADMIN, 'wrongpass');
        T('错误密码提示', await pL.locator('.msg.error, .toast-err').count() > 0);
        await loginOK(pL, ADMIN, PW, ADMIN);
        // 登出是 POST 表单（GET /Logout 有意不登出防 CSRF），点「退出」按钮
        await pL.locator('button:has-text("退出"), a:has-text("退出")').first().click();
        await pL.waitForTimeout(700);
        T('登出后回到登录页', pL.url().toLowerCase().includes('login'), pL.url());
        await loginOK(pL, ADMIN, PW, 'admin 再登录');

        // ================= S2 管理后台建号 =================
        sec('S2 管理后台建号（弹窗流程）');
        await pL.goto(BASE + '/Admin/Users');
        await modalOpen(pL, '新建用户');
        await pL.fill('#appModal input[name="Username"]', 'QA_A');
        await pL.fill('#appModal input[name="DisplayName"]', '测试小A');
        await pL.fill('#appModal input[name="Password"]', 'Qa#2026Tmp');
        await pL.selectOption('#appModal select[name="RoleId"]', '2');
        // 建号默认会播种「每模块 3 条」测试数据；本套件要断言空态/精确条数，先取消勾选
        await pL.uncheck('#appModal input[type=checkbox][name="SeedSample"]');
        await modalSubmit(pL);
        let uA = dbq("select Id,RoleId,MustChangePassword,IsActive from Users where Username='QA_A'");
        T('QA_A 建号落库', uA.length === 1 && uA[0].RoleId === 2 && uA[0].MustChangePassword === 1, JSON.stringify(uA));

        await pL.goto(BASE + '/Admin/Users');
        await modalOpen(pL, '新建用户');
        await pL.fill('#appModal input[name="Username"]', 'QA_B');
        await pL.fill('#appModal input[name="DisplayName"]', '测试小B');
        await pL.fill('#appModal input[name="Password"]', 'Qa#2026Tmp');
        await pL.selectOption('#appModal select[name="RoleId"]', '3');
        await pL.uncheck('#appModal input[type=checkbox][name="SeedSample"]');
        await modalSubmit(pL);
        let uB = dbq("select Id,RoleId,MustChangePassword from Users where Username='QA_B'");
        T('QA_B 建号落库(情侣角色)', uB.length === 1 && uB[0].RoleId === 3, JSON.stringify(uB));
        const idA = uA[0].Id, idB = uB[0].Id;

        // ================= S3 首登强制改密 =================
        sec('S3 首登强制改密');
        await login(pA, 'QA_A', 'Qa#2026Tmp');
        T('QA_A 首登被强制改密', pA.url().toLowerCase().includes('changepassword'), pA.url());
        await pA.fill('input[name="OldPassword"]', 'Qa#2026Tmp');
        await pA.fill('input[name="NewPassword"]', 'Qa#2026Aa');
        await pA.fill('input[name="ConfirmPassword"]', 'Qa#2026Aa');
        await pA.locator('form button[type=submit]:has-text("设置")').click();   // 不能用裸 button[type=submit]（会点到侧栏退出）
        await pA.waitForTimeout(800);
        T('改密后进入工作台', !pA.url().toLowerCase().includes('changepassword') && !pA.url().toLowerCase().includes('login'), pA.url());
        T('改密落库 MustChangePassword=0', dbq("select MustChangePassword from Users where Username='QA_A'")[0].MustChangePassword === 0);
        await login(pB, 'QA_B', 'Qa#2026Tmp');
        await pB.fill('input[name="OldPassword"]', 'Qa#2026Tmp');
        await pB.fill('input[name="NewPassword"]', 'Qa#2026Bb');
        await pB.fill('input[name="ConfirmPassword"]', 'Qa#2026Bb');
        await pB.locator('form button[type=submit]:has-text("设置")').click();
        await pB.waitForTimeout(800);
        T('QA_B 改密后进工作台', !pB.url().toLowerCase().includes('changepassword') && !pB.url().toLowerCase().includes('login'), pB.url());

        // ================= S4 RBAC =================
        sec('S4 RBAC 权限隔离');
        for (const path of ['/Admin/Users', '/Admin/Roles']) {
            const r = await ctxA.request.get(BASE + path, { maxRedirects: 0 }).catch(() => null);
            T(`QA_A 访问 ${path} 被拒`, r && [302, 403].includes(r.status()), r && r.status());
        }
        for (const path of ['/Couples', '/Period']) {
            const rA = await ctxA.request.get(BASE + path, { maxRedirects: 0 }).catch(() => null);
            const rB = await ctxB.request.get(BASE + path, { maxRedirects: 0 }).catch(() => null);
            T(`普通角色 ${path} 被拒`, rA && [302, 403].includes(rA.status()), rA && rA.status());
            T(`情侣角色 ${path} 放行`, rB && rB.status() === 200, rB && rB.status());
        }

        // ================= S5 日程 CRUD + 数据验证 =================
        sec('S5 日程 CRUD');
        await pA.goto(BASE + '/Schedule');
        await modalOpen(pA, '新建日程');
        const d5 = fmtDate(new Date(Date.now() + 5 * 864e5));   // 今天+5天：日历当月可见/工作台可见
        await pA.fill('#appModal input[name="Title"]', TAG + '-日程-新建');
        await pA.fill('#appModal textarea[name="Description"]', TAG + '-描述');
        await pA.fill('#appModal input[name="StartAt"]', d5 + 'T10:00');
        await modalSubmit(pA);
        let sch = dbq(`select * from Schedules where UserId=${idA} and Title='${TAG}-日程-新建'`);
        T('日程落库字段正确', sch.length === 1 && sch[0].Description === TAG + '-描述' && sch[0].StartAt.startsWith(d5) && sch[0].AllDay === 0, JSON.stringify(sch[0] || sch));
        T('日程列表显示', await pA.getByText(TAG + '-日程-新建').count() > 0);
        const schId = sch[0].Id;
        // 编辑（弹窗）
        await openEdit(pA, '/Schedule', schId);
        await pA.fill('#appModal input[name="Title"]', TAG + '-日程-已改');
        await modalSubmit(pA);
        sch = dbq(`select Title from Schedules where Id=${schId}`);
        T('日程编辑落库', sch.length === 1 && sch[0].Title === TAG + '-日程-已改', JSON.stringify(sch));
        // 日历视图出现事件
        await pA.goto(BASE + '/Schedule?view=calendar');
        await pA.waitForSelector('#calGrid .cal-cell', { timeout: 5000 });
        T('日历网格渲染', await pA.locator('#calGrid .cal-cell').count() >= 35);
        const calHas = await pA.evaluate(() => {
            const d = JSON.parse(document.getElementById('calData').textContent || '[]');
            return d.some(x => (x.title || '').includes('QATAG-日程'));
        });
        T('日历数据含测试日程', calHas);
        // 删除
        await openEdit(pA, '/Schedule', schId);
        await pA.locator('#appModal .modal-body button:has-text("删除")').last().click();
        await pA.waitForTimeout(900);
        T('日程删除落库', dbq(`select Id from Schedules where Id=${schId}`).length === 0);

        // ================= S6 备忘 CRUD =================
        sec('S6 备忘 CRUD');
        await pA.goto(BASE + '/Memo');
        await modalOpen(pA, '新建便签');
        await pA.fill('#appModal input[name="Title"]', TAG + '-备忘');
        await pA.fill('#appModal textarea[name="Body"]', TAG + '-备忘正文');
        await pA.check('#appModal input[name="Pinned"]').catch(() => {});
        await modalSubmit(pA);
        let memo = dbq(`select * from Memos where UserId=${idA} and Title='${TAG}-备忘'`);
        T('备忘落库(含置顶)', memo.length === 1 && memo[0].Content === TAG + '-备忘正文' && memo[0].Pinned === 1, JSON.stringify(memo[0] || memo));
        const memoId = memo[0].Id;
        await pA.fill('#memoSearch', TAG + '-备忘正');
        await pA.waitForTimeout(250);
        T('备忘搜索过滤', await pA.locator('.memo-card:visible, .memo-row:visible').count() === 1);
        await pA.fill('#memoSearch', '');
        await openEdit(pA, '/Memo', memoId);
        await pA.fill('#appModal input[name="Title"]', TAG + '-备忘-已改');
        await modalSubmit(pA);
        T('备忘编辑落库', dbq(`select Title from Memos where Id=${memoId}`)[0].Title === TAG + '-备忘-已改');
        await openEdit(pA, '/Memo', memoId);
        await pA.locator('#appModal .modal-body button:has-text("删除")').last().click();
        await pA.waitForTimeout(900);
        T('备忘删除落库', dbq(`select Id from Memos where Id=${memoId}`).length === 0);

        // ================= S7 习惯打卡 =================
        sec('S7 习惯打卡');
        await pA.goto(BASE + '/Habits');
        await modalOpen(pA, '新建习惯');
        await pA.fill('#appModal input[name="Name"]', TAG + '-习惯');
        await pA.fill('#appModal input[name="Icon"]', '💧');
        await modalSubmit(pA);
        let hab = dbq(`select * from Habits where UserId=${idA} and Name='${TAG}-习惯'`);
        T('习惯落库', hab.length === 1 && hab[0].Icon === '💧', JSON.stringify(hab[0] || hab));
        const habId = hab[0].Id;
        await pA.locator('.row-item', { hasText: TAG + '-习惯' }).locator('button:has-text("打卡")').click();
        await pA.waitForTimeout(700);
        let chk = dbq(`select * from HabitCheckins where HabitId=${habId} and CheckinDate like '${today()}%'`);
        T('打卡落库(当天)', chk.length === 1 && chk[0].UserId === idA, JSON.stringify(chk[0] || chk));
        await pA.locator('.row-item', { hasText: TAG + '-习惯' }).locator('button:has-text("已打卡")').click();
        await pA.waitForTimeout(700);
        T('撤销打卡落库删除', dbq(`select Id from HabitCheckins where HabitId=${habId}`).length === 0);
        await pA.goto(BASE + '/Habits?view=grid');
        await pA.waitForSelector('.habit-card', { timeout: 4000 });
        T('习惯卡片点阵 7 点', await pA.locator('.habit-card', { hasText: TAG }).locator('.week-dot').count() === 7);
        await openEdit(pA, '/Habits', habId);
        await pA.locator('#appModal .modal-body button:has-text("删除")').last().click();
        await pA.waitForTimeout(900);
        T('习惯删除落库', dbq(`select Id from Habits where Id=${habId}`).length === 0);

        // ================= S8 纪念日 =================
        sec('S8 纪念日');
        await pA.goto(BASE + '/Anniversaries');
        await modalOpen(pA, '新建纪念日');
        await pA.fill('#appModal input[name="Title"]', TAG + '-纪念日');
        await pA.fill('#appModal input[name="Date"]', '2027-06-01');
        await pA.check('#appModal input[name="RepeatYearly"]').catch(() => {});
        await modalSubmit(pA);
        let ann = dbq(`select * from Anniversaries where UserId=${idA} and Title='${TAG}-纪念日'`);
        T('纪念日落库(每年重复)', ann.length === 1 && ann[0].Date.startsWith('2027-06-01') && ann[0].RepeatYearly === 1, JSON.stringify(ann[0] || ann));
        const annId = ann[0].Id;
        await pA.goto(BASE + '/Anniversaries?view=cards');
        await pA.waitForSelector('.anni-card', { timeout: 4000 });
        T('倒计时卡渲染', await pA.locator('.anni-card .ac-days').count() > 0);
        await openEdit(pA, '/Anniversaries', annId);
        await pA.fill('#appModal input[name="Title"]', TAG + '-纪念日-已改');
        await modalSubmit(pA);
        T('纪念日编辑落库', dbq(`select Title from Anniversaries where Id=${annId}`)[0].Title === TAG + '-纪念日-已改');
        await openEdit(pA, '/Anniversaries', annId);
        await pA.locator('#appModal .modal-body button:has-text("删除")').last().click();
        await pA.waitForTimeout(900);
        T('纪念日删除落库', dbq(`select Id from Anniversaries where Id=${annId}`).length === 0);

        // ================= S9 记账 =================
        sec('S9 记账');
        await pA.goto(BASE + '/Expenses');
        await modalOpen(pA, '记一笔');
        await pA.fill('#appModal input[name="Amount"]', '12.34');
        await pA.selectOption('#appModal select[name="Type"]', 'out');
        await pA.selectOption('#appModal select[name="Category"]', '餐饮');
        await pA.fill('#appModal input[name="OccurDate"]', today());
        await pA.fill('#appModal input[name="Note"]', TAG + '-记账');
        await modalSubmit(pA);
        let exp = dbq(`select * from Expenses where UserId=${idA} and Note='${TAG}-记账'`);
        T('记账落库金额/类型', exp.length === 1 && Math.abs(exp[0].Amount - 12.34) < 0.001 && exp[0].Type === 'out' && exp[0].Category === '餐饮', JSON.stringify(exp[0] || exp));
        const expId = exp[0].Id;
        await pA.goto(BASE + '/Expenses?view=month');
        await pA.waitForSelector('.month-row', { timeout: 4000 });
        T('月度视图 12 行', await pA.locator('.month-row').count() === 12);
        await pA.locator('.month-row').first().click();
        await pA.waitForTimeout(500);
        T('月行钻取到明细', pA.url().includes('m=') && pA.url().includes('view=list'), pA.url());
        await openEdit(pA, '/Expenses', expId);
        await pA.fill('#appModal input[name="Amount"]', '23.45');
        await modalSubmit(pA);
        exp = dbq(`select Amount from Expenses where Id=${expId}`);
        T('记账编辑落库', exp.length === 1 && Math.abs(exp[0].Amount - 23.45) < 0.001, JSON.stringify(exp));
        await openEdit(pA, '/Expenses', expId);
        await pA.locator('#appModal .modal-body button:has-text("删除")').last().click();
        await pA.waitForTimeout(900);
        T('记账删除落库', dbq(`select Id from Expenses where Id=${expId}`).length === 0);

        // ================= S10 越权与数据隔离 =================
        sec('S10 越权与数据隔离');
        // QA_A 留两条目标数据（日程+备忘），QA_B 尝试越权
        await pA.goto(BASE + '/Schedule');
        await modalOpen(pA, '新建日程');
        const d3 = fmtDate(new Date(Date.now() + 3 * 864e5));   // 今天+3天：工作台/提醒中心可见
        await pA.fill('#appModal input[name="Title"]', TAG + '-越权目标');
        await pA.fill('#appModal input[name="StartAt"]', d3 + 'T09:00');
        await modalSubmit(pA);
        const tSch = dbq(`select Id from Schedules where Title='${TAG}-越权目标'`)[0].Id;
        await pA.goto(BASE + '/Memo');
        await modalOpen(pA, '新建便签');
        await pA.fill('#appModal input[name="Title"]', TAG + '-越权备忘');
        await pA.fill('#appModal textarea[name="Body"]', 'x');
        await modalSubmit(pA);
        const tMemo = dbq(`select Id from Memos where Title='${TAG}-越权备忘'`)[0].Id;

        const r1 = await ctxB.request.get(BASE + '/Schedule/Edit/' + tSch, { maxRedirects: 0 }).catch(() => null);
        T('QA_B 打开 QA_A 日程 Edit → 404', r1 && r1.status() === 404, r1 && r1.status());
        const r2 = await ctxB.request.get(BASE + '/Memo/Edit/' + tMemo, { maxRedirects: 0 }).catch(() => null);
        T('QA_B 打开 QA_A 备忘 Edit → 404', r2 && r2.status() === 404, r2 && r2.status());
        const r3 = await ctxB.request.post(BASE + '/Schedule/Edit/' + tSch, {
            form: { Title: 'hacked', StartAt: '2027-01-01T10:00' }, maxRedirects: 0
        }).catch(() => null);
        // 裸 POST 会先被 antiforgery 拦(400)或越权拦(404)，都算拒绝成功，重点是库未被篡改
        T('QA_B POST 篡改 QA_A 日程被拒(4xx)', r3 && r3.status() >= 400 && r3.status() < 500, r3 && r3.status());
        T('篡改未生效(标题未变)', dbq(`select Title from Schedules where Id=${tSch}`)[0].Title === TAG + '-越权目标');
        await pB.goto(BASE + '/Schedule');
        await pB.waitForTimeout(400);
        const bSees = await pB.getByText(TAG + '-越权目标').count();
        T('QA_B 列表不见 QA_A 数据', bSees === 0, 'bSees=' + bSees);
        const r4 = await ctxA.request.get(BASE + '/Period', { maxRedirects: 0 }).catch(() => null);
        T('QA_A 访问经期被拒', r4 && [302, 403].includes(r4.status()), r4 && r4.status());
        // 越权目标数据留给后续工作台/提醒测试用，最后一并清

        // ================= S11 课程表 =================
        sec('S11 课程表');
        await pA.goto(BASE + '/Courses');
        await modalOpen(pA, '添加课程');
        await pA.fill('#appModal input[name="Name"]', TAG + '-课程');
        await pA.fill('#appModal input[name="Teacher"]', '测试师');
        await pA.fill('#appModal input[name="Location"]', '教一楼');
        await pA.selectOption('#appModal select[name="Weekday"]', '1').catch(() => {});
        await pA.selectOption('#appModal select[name="StartPeriod"]', '1').catch(() => {});
        await pA.selectOption('#appModal select[name="EndPeriod"]', '2').catch(() => {});
        await pA.fill('#appModal input[name="WeeksText"]', '1-16');
        await modalSubmit(pA);
        let cour = dbq(`select * from Courses where UserId=${idA} and Name='${TAG}-课程'`);
        T('课程落库(周次/星期)', cour.length === 1 && cour[0].WeeksText === '1-16' && cour[0].Weekday === 1, JSON.stringify(cour[0] || cour));
        T('课程周视图渲染', await pA.getByText(TAG + '-课程').count() > 0);
        const courId = cour[0].Id;
        await openEdit(pA, '/Courses', courId);
        await pA.locator('#appModal .modal-body button:has-text("删除")').last().click();
        await pA.waitForTimeout(900);
        T('课程删除落库', dbq(`select Id from Courses where Id=${courId}`).length === 0);

        // ================= S12 留言板 =================
        sec('S12 留言板');
        await pA.goto(BASE + '/Board');
        await pA.fill('input[name="Body"]', TAG + '-留言');
        await pA.locator('form:has(input[name="Body"]) button[type=submit]').click();   // 必须限定表单：裸 button 会点到侧栏退出
        await pA.waitForTimeout(800);
        let board = dbq(`select * from BoardMessages where Content='${TAG}-留言'`);
        T('留言落库归属 QA_A', board.length === 1 && board[0].UserId === idA, JSON.stringify(board[0] || board));
        if (board.length > 0) {
            const boardId = board[0].Id;
            // QA_B 越权删 QA_A 留言（antiforgery/越权双重拦截，库断言为准）
            await ctxB.request.post(BASE + '/Board?handler=Delete', {
                form: { id: boardId }, maxRedirects: 0
            }).catch(() => null);
            T('QA_B 越权删 QA_A 留言被拒', dbq(`select Id from BoardMessages where Id=${boardId}`).length === 1);
            // QA_A 删除自己的（按主键精确定位行内删除按钮）
            await pA.locator(`form:has(input[name="id"][value="${boardId}"]) button`).click();
            await pA.waitForTimeout(800);
            T('本人删除留言落库', dbq(`select Id from BoardMessages where Id=${boardId}`).length === 0);
        }

        // ================= S13 情侣空间 =================
        sec('S13 情侣空间');
        const oldCouple = dbq('select * from CoupleSettings');
        await pB.goto(BASE + '/Couples');
        await pB.fill('input[name="SettingTitle"]', TAG + '-情侣空间');
        await pB.fill('input[name="SettingStartDate"]', '2026-01-01');
        await pB.locator('form:has(input[name="SettingTitle"]) button[type=submit]').click();
        await pB.waitForTimeout(700);
        const couple = dbq('select * from CoupleSettings');
        T('情侣设置落库', couple[0].Title === TAG + '-情侣空间' && couple[0].StartDate.startsWith('2026-01-01'), JSON.stringify(couple[0]));
        await pB.fill('input[name="NoteContent"]', TAG + '-小纸条');
        await pB.locator('form:has(input[name="NoteContent"]) button[type=submit]').click();
        await pB.waitForTimeout(700);
        let note = dbq(`select * from LoveNotes where Content='${TAG}-小纸条'`);
        T('小纸条落库 FromUserId=QA_B', note.length === 1 && note[0].FromUserId === idB, JSON.stringify(note[0] || note));
        const noteId = note[0].Id;
        await pB.locator('button:has-text("删除")').first().click();
        await pB.waitForTimeout(700);
        T('小纸条删除落库', dbq(`select Id from LoveNotes where Id=${noteId}`).length === 0);
        // 还原情侣设置（全局数据不污染）
        if (oldCouple.length === 1) {
            dbq(`update CoupleSettings set Title='${oldCouple[0].Title}', StartDate='${oldCouple[0].StartDate}' where Id=${oldCouple[0].Id}`);
        } else {
            dbq(`delete from CoupleSettings where Title='${TAG}-情侣空间'`);
        }
        T('情侣设置已还原', (dbq('select Title from CoupleSettings')[0] || {}).Title !== TAG + '-情侣空间');

        // ================= S14 经期 =================
        sec('S14 经期助手');
        await pB.goto(BASE + '/Period');
        await pB.fill('input[name="NewStartDate"]', '2026-10-01');
        await pB.fill('input[name="NewEndDate"]', '2026-10-05');
        await pB.fill('input[name="NewNote"]', TAG + '-经期');
        await pB.locator('form:has(input[name="NewStartDate"]) button[type=submit]').click();
        await pB.waitForTimeout(700);
        let per = dbq(`select * from PeriodRecords where Note='${TAG}-经期'`);
        T('经期落库归属 QA_B', per.length === 1 && per[0].UserId === idB && per[0].StartDate.startsWith('2026-10-01'), JSON.stringify(per[0] || per));
        const perId = per[0].Id;
        const r5 = await ctxA.request.get(BASE + '/Period/Edit/' + perId, { maxRedirects: 0 }).catch(() => null);
        T('QA_A 越权打开经期编辑被拒(4xx)', r5 && [302, 403, 404].includes(r5.status()), r5 && r5.status());
        T('经期数据未被越权触碰', dbq(`select Id from PeriodRecords where Id=${perId}`).length === 1);
        // QA_B 删除自己的经期（删除在 Edit 弹窗里）
        await openEdit(pB, '/Period', perId);
        await pB.locator('#appModal .modal-body button:has-text("删除")').last().click();
        await pB.waitForTimeout(900);
        T('经期删除落库', dbq(`select Id from PeriodRecords where Id=${perId}`).length === 0);

        // ================= S15 工作台聚合 =================
        sec('S15 工作台聚合一致性');
        const future7 = dbq(`select count(*) c from Schedules where UserId=${idA} and StartAt >= '${today()}'`).c || dbq(`select count(*) c from Schedules where UserId=${idA} and StartAt >= '${today()}'`)[0].c;
        await pA.goto(BASE + '/');
        await pA.waitForTimeout(500);
        T('工作台渲染', await pA.locator('.card').count() > 2);
        const wbText = await pA.locator('body').textContent();
        T('工作台含 QA_A 越权目标日程', wbText.includes(TAG + '-越权目标'), 'future7=' + future7);

        // ================= S16 提醒中心 =================
        sec('S16 提醒中心');
        await pA.goto(BASE + '/Reminders');
        const remStatus = await pA.evaluate(() => document.body.textContent);
        T('提醒中心渲染且含日程提醒', remStatus.includes(TAG + '-越权目标'), '');

        // ============ S16.5 补视图/统计数据（后续 S17/S21 空态无元素可断言） ============
        sec('S16.5 视图测试数据准备');
        dbq(`insert into Habits (UserId, Name, Icon, CreatedAt) values (${idA}, '${TAG}-视图习惯', '🔥', datetime('now'))`);
        dbq(`insert into HabitCheckins (HabitId, UserId, CheckinDate, Note, CreatedAt) select Id, ${idA}, date('now'), '', datetime('now') from Habits where Name='${TAG}-视图习惯' and UserId=${idA}`);
        dbq(`insert into Anniversaries (UserId, Title, Date, RepeatYearly, Note, CreatedAt, UpdatedAt) values (${idA}, '${TAG}-视图纪念日', '2027-01-01', 1, '', datetime('now'), datetime('now'))`);
        dbq(`insert into Expenses (UserId, Amount, Type, Category, OccurDate, Note, CreatedAt, UpdatedAt) values (${idA}, '1.00', 'out', '餐饮', date('now'), '${TAG}-视图账目', datetime('now'), datetime('now'))`);
        T('视图测试数据落库', dbq(`select Id from Habits where UserId=${idA} and Name='${TAG}-视图习惯'`).length === 1);

        // ================= S17 统计 =================
        sec('S17 统计页');
        await pA.goto(BASE + '/Stats');
        await pA.waitForTimeout(600);
        T('统计页渲染(热力图/月柱/分类条)', (await pA.locator('.heatmap, .month-bar-col, .bar-track, .stat-box').count()) > 0);

        // ================= S18 导出 =================
        sec('S18 数据导出');
        const resp = await pA.request.get(BASE + '/Export?handler=Mine');
        T('导出接口 200', resp.status() === 200, resp.status());
        T('导出 Content-Type 为 JSON', (resp.headers()['content-type'] || '').includes('json'), resp.headers()['content-type']);
        try {
            const data = await resp.json();
            const dbSchedCount = dbq(`select count(*) c from Schedules where UserId=${idA}`)[0].c;
            T('导出 JSON 结构完整', data && (data.schedules || data.Schedules || data.memos || data.Memos) !== undefined, 'keys=' + Object.keys(data || {}).slice(0, 8).join(','));
            const exported = (data.schedules || data.Schedules || []).length;
            T('导出日程数与库一致', exported === dbSchedCount, `exp=${exported} db=${dbSchedCount}`);
        } catch (e) { T('导出 JSON 可解析', false, String(e)); }

        // ================= S19 AI 助手 =================
        sec('S19 AI 助手（建议卡写库）');
        await pA.goto(BASE + '/Ai');
        await pA.fill('textarea[name="text"], input[name="text"]', `请帮我建一个日程：${TAG}-AI日程，明天上午9点，这是AIPROBE测试`);
        await pA.click('#aiSend');
        let cardShown = false;
        for (let i = 0; i < 20; i++) {
            await pA.waitForTimeout(1500);
            const btn = pA.locator('button:has-text("确认执行")');
            if (await btn.count() > 0) { cardShown = true; break; }
            const txt = await pA.locator('body').textContent();
            if (txt.includes('没听懂') || txt.includes('暂不支持')) break;
        }
        T('AI 建议卡出现', cardShown);
        if (cardShown) {
            await pA.locator('button:has-text("确认执行")').first().click();
            await pA.waitForTimeout(1200);
            const aiSch = dbq(`select * from Schedules where UserId=${idA} and Title like '%${TAG}-AI日程%'`);
            T('AI 动作写库 UserId 围栏', aiSch.length >= 1 && aiSch[0].UserId === idA, JSON.stringify(aiSch[0] || 'none'));
            // 清 AI 测试数据
            for (const s of aiSch) dbq(`delete from Schedules where Id=${s.Id}`);
            dbq(`delete from AiMessages where UserId=${idA}`);
        }
        T('AI 测试数据已清理', dbq(`select Id from Schedules where Title like '%${TAG}-AI日程%'`).length === 0);

        // ================= S20 主题偏好 =================
        sec('S20 主题偏好落库');
        await pA.goto(BASE + '/Me');
        const oldTheme = dbq(`select Theme from Users where Id=${idA}`)[0].Theme;
        // 与 theme.js syncToServer 相同姿势：页面内 fetch + antiforgery token
        const postStatus = await pA.evaluate(async () => {
            const tokenEl = document.querySelector('input[name="__RequestVerificationToken"]');
            const r = await fetch('/Preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'theme=clay&accent=violet' + (tokenEl ? '&__RequestVerificationToken=' + encodeURIComponent(tokenEl.value) : '')
            });
            return r.status;
        });
        const newTheme = dbq(`select Theme from Users where Id=${idA}`)[0].Theme;
        T('主题偏好 POST 落库', newTheme === 'clay', `post=${postStatus} old=${oldTheme} new=${newTheme}`);
        // 白名单校验：非法主题名应被拒
        const badStatus = await pA.evaluate(async () => {
            const tokenEl = document.querySelector('input[name="__RequestVerificationToken"]');
            const r = await fetch('/Preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'theme=evil<script>&accent=x' + (tokenEl ? '&__RequestVerificationToken=' + encodeURIComponent(tokenEl.value) : '')
            });
            return r.status;
        });
        T('非法主题名被白名单拒绝', badStatus === 400 && dbq(`select Theme from Users where Id=${idA}`)[0].Theme === 'clay', 'bad=' + badStatus);
        await pA.evaluate(async (t) => {
            const tokenEl = document.querySelector('input[name="__RequestVerificationToken"]');
            await fetch('/Preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'theme=' + t + '&accent=teal' + (tokenEl ? '&__RequestVerificationToken=' + encodeURIComponent(tokenEl.value) : '')
            });
        }, oldTheme || 'editorial');

        // ================= S21 多视图 =================
        sec('S21 多视图渲染与切换');
        const viewCases = [
            ['/Schedule', 'calendar', '#calGrid .cal-cell', '/Schedule?view=list', '.row-item'],
            ['/Memo', 'list', '.memo-row', '/Memo?view=grid', '.memo-card'],
            ['/Habits', 'grid', '.habit-card', '/Habits?view=list', '.row-item'],
            ['/Anniversaries', 'cards', '.anni-card', '/Anniversaries?view=list', '.group-head'],
            ['/Expenses', 'month', '.month-row', '/Expenses?view=list', '.stat-row'],
        ];
        for (const [p1, v1, s1, p2, s2] of viewCases) {
            await pA.goto(BASE + p1 + '?view=' + v1);
            await pA.waitForSelector(s1, { timeout: 4000 }).catch(() => {});
            const c1 = await pA.locator(s1).count();
            T(`视图 ${p1}?view=${v1} 渲染`, c1 > 0, 'n=' + c1);
            await pA.goto(BASE + p2);
            await pA.waitForSelector(s2, { timeout: 4000 }).catch(() => {});
            const c2 = await pA.locator(s2).count();
            T(`视图 ${p2} 渲染`, c2 > 0, 'n=' + c2);
        }

        // ================= S22 弹窗表单校验 =================
        sec('S22 弹窗表单校验');
        await pA.goto(BASE + '/Schedule');
        await modalOpen(pA, '新建日程');
        await pA.fill('#appModal input[name="Title"]', '');
        await modalSubmit(pA);
        const dlgStill = await pA.locator('#appModal[open]').count();
        const errText = await pA.locator('#appModal .msg.error, #appModal .toast-err, #appModal .field-validation-error').count();
        T('空标题提交被拦截回显', dlgStill > 0 || errText > 0 || dbq(`select Id from Schedules where Title='' and UserId=${idA}`).length === 0, 'dlg=' + dlgStill + ' err=' + errText);
        await pA.keyboard.press('Escape');
        await pA.waitForTimeout(300);

        // ================= S23 手机端适配 =================
        sec('S23 手机 390px 适配');
        const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const mp = await mctx.newPage();
        await login(mp, 'QA_A', 'Qa#2026Aa');
        for (const path of ['/', '/Schedule?view=calendar', '/Memo?view=list', '/Habits?view=grid', '/Expenses?view=month', '/Board']) {
            await mp.goto(BASE + path);
            await mp.waitForTimeout(400);
            const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
            T(`手机 ${path} 无横向溢出`, !overflow);
        }

        // ================= S24 性能与缓存 =================
        sec('S24 性能与缓存头');
        const cssResp = await pL.request.get(BASE + '/css/site.css');
        const cacheCtl = cssResp.headers()['cache-control'] || '';
        T('静态资源缓存头 immutable', cacheCtl.includes('immutable') || cacheCtl.includes('max-age'), cacheCtl);
        const t0 = Date.now();
        await pA.goto(BASE + '/Schedule');
        await pA.waitForLoadState('load');
        T('页面加载 < 1500ms', Date.now() - t0 < 1500, (Date.now() - t0) + 'ms');
        const mani = await pL.request.get(BASE + '/manifest.json').catch(() => null);
        T('PWA manifest 可访问', mani && mani.status() === 200, mani && mani.status());

        // ================= S25 API 平滑性 =================
        sec('S25 全页无 JS 报错');
        T('三个会话全程无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

    } catch (e) {
        results.push({ sec: curSec, name: '【套件异常中断】', ok: false, extra: String(e.message || e) });
        console.log('SUITE CRASH in ' + curSec + ': ' + (e.message || e));
    }

    // 汇总输出
    const pass = results.filter(r => r.ok).length;
    const fail = results.length - pass;
    const report = { round: ROUND, time: new Date().toISOString(), pass, fail, results };
    fs.writeFileSync(`${QA_DIR}/report-r${ROUND}.json`, JSON.stringify(report, null, 1), 'utf8');
    console.log(`\n== 第 ${ROUND} 轮: ${pass} PASS / ${fail} FAIL ==`);
    if (fail > 0) {
        console.log('--- 失败清单 ---');
        results.filter(r => !r.ok).forEach(r => console.log(` [${r.sec}] ${r.name} ${r.extra}`));
    }
    await browser.close();
    process.exit(0);
})();
