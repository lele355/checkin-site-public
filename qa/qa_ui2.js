// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// qa_ui2.js — UI/交互专项测试（滚动保持 / 弹窗焦点 / 日历小卡片 / 表单布局增强）
// 用法: NODE_PATH=... node qa_ui2.js   → 输出 report-ui2.json + console 明细 + _shots 截图
// 基建约定同 qa_full.js / qa_email.js：playwright 用系统 Edge；toast 断言用 hasText 防竞态；
// 直接 goto URL 不走弹窗（modal.js 只拦链接点击）；button[type=submit] 裸选择器会命中侧栏退出表单。
// dbq 铁律：Python sqlite3 一次只执行一条语句——多条必须拆开逐条执行（dbqMulti）。
const QA = require('./_env');
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const QA_DIR = 'D:/projects/checkin/qa';
const OUT = 'D:/projects/checkin/_shots';
const TAG = 'UIQ';                       // 标记词（防撞演示数据）
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
// 多语句：按「;\n」拆开逐条执行（sqlite3 一次只收一条）
function dbqMulti(sql) {
    return sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean).map(dbq);
}
function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function login(page, user, pass) {
    await page.goto(BASE + '/Login');
    await page.fill('#Username', user);
    await page.fill('#Password', pass);
    await page.click('#loginForm button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(300);
}

// 滚动位置：布局把滚动放在 main.content 内部容器（window.scrollY 恒 0），必须量对元素
async function scrollY(page) {
    return await page.evaluate(() => {
        const m = document.querySelector('main.content');
        return m && m.scrollHeight > m.clientHeight + 5 ? m.scrollTop : window.scrollY;
    });
}
async function modalOpen(page) { return await page.evaluate(() => { const d = document.getElementById('appModal'); return !!(d && d.open); }); }

(async () => {
    fs.mkdirSync(OUT, { recursive: true });

    // ---- 造数：28 个习惯 + 今天的 2 条日程（先清残留，再单条多值插入） ----
    const uid = dbq(`select Id from Users where Username=ADMIN`)[0].Id;
    const K = todayKey();
    dbqMulti(`delete from HabitCheckins where UserId=${uid} and HabitId in (select Id from Habits where Name like '${TAG}-%');\n` +
        `delete from Habits where UserId=${uid} and Name like '${TAG}-%';\n` +
        `delete from Schedules where UserId=${uid} and Title like '${TAG}-%';`);
    let habVals = [];
    for (let i = 1; i <= 28; i++) {
        habVals.push(`(${uid}, '${TAG}-习惯${String(i).padStart(2, '0')}', '🌱', '${K} 08:00:00')`);
    }
    dbq(`insert into Habits (UserId, Name, Icon, CreatedAt) values ${habVals.join(',')}`);
    dbq(`insert into Schedules (UserId, Title, Description, StartAt, EndAt, AllDay, CreatedAt, UpdatedAt) values ` +
        `(${uid}, '${TAG}-日程A', '上午的会', '${K} 09:00:00', NULL, 0, '${K} 08:00:00', '${K} 08:00:00'), ` +
        `(${uid}, '${TAG}-日程B', '下午的课', '${K} 14:30:00', NULL, 0, '${K} 08:00:00', '${K} 08:00:00')`);
    const seeded = dbq(`select Id,Name from Habits where UserId=${uid} and Name like '${TAG}-%' order by Id`);
    T('造数成功（28 习惯）', seeded.length === 28, 'n=' + seeded.length);
    const H1 = seeded[seeded.length - 1].Id;   // S1 打卡用（列表最深处，滚到底才能点）
    const H2 = seeded[seeded.length - 2].Id;   // S2 改名用
    const H3 = seeded[2].Id;                   // S7 打卡用

    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => d.accept().catch(() => { }));   // 删除表单有 confirm()

    try {
        await login(page, QA.USER, QA.PASS);
        T('admin 登录成功', !page.url().includes('Login'), page.url());

        // ================= S1 普通表单 PRG 后滚动保持（打卡） =================
        sec('S1 普通表单 PRG 后滚动保持（习惯打卡）');
        await page.goto(BASE + '/Habits?view=list');
        await page.waitForSelector('.row-item');
        const docH = await page.evaluate(() => {
            const m = document.querySelector('main.content');
            return m ? m.scrollHeight : document.body.scrollHeight;
        });
        T('列表足够长可滚动', docH > 1800, 'scrollHeight=' + docH);

        const btn1 = page.locator(`form:has(input[name="id"][value="${H1}"]) button:has-text("打卡")`);
        await btn1.evaluate(el => el.scrollIntoView({ block: 'center' }));   // 强制滚到可见区（scrollIntoViewIfNeeded 对首屏元素不滚动）
        await page.waitForTimeout(300);
        const y0 = await scrollY(page);
        T('滚动到了页面深处', y0 > 300, 'scrollY=' + y0);
        await page.evaluate(() => { window.__qaMark = 1; });
        await btn1.click();
        await page.waitForTimeout(800);
        T('打卡免刷新提交（标记还在=无整页刷新）', await page.evaluate(() => window.__qaMark === 1));
        const y1 = await scrollY(page);
        T('打卡后滚动位置保持', Math.abs(y1 - y0) < 300, `y0=${y0} y1=${y1}`);
        T('打卡状态已翻转（出现今日已打卡）',
            await page.locator(`form:has(input[name="id"][value="${H1}"]) button:has-text("今日已打卡")`).count() === 1);
        T('连续天数就地翻新（首次打卡走普通样式）',
            await page.locator(`.row-item:has(input[name="id"][value="${H1}"]) .hs-plain`).isVisible());

        // ================= S2 弹窗保存后滚动保持 =================
        sec('S2 弹窗保存后滚动保持');
        const link2 = page.locator(`a[href="/Habits/Edit/${H2}"]`);
        await link2.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
        const y2 = await scrollY(page);
        await link2.click();
        await page.waitForTimeout(600);
        T('编辑弹窗打开', await modalOpen(page));
        T('弹窗带入目标记录', (await page.getAttribute('#appModal input[name="Id"]', 'value')) === String(H2));
        await page.fill('#appModal input[name="Name"]', TAG + '-习惯改名');
        await page.locator('#appModal button:has-text("保存")').click();
        await page.waitForLoadState('networkidle').catch(() => { });
        await page.waitForTimeout(700);
        const y3 = await scrollY(page);
        T('弹窗保存刷新后滚动位置保持', y3 > 100 && Math.abs(y3 - y2) < 300, `y2=${y2} y3=${y3}`);
        const ren = dbq(`select Name from Habits where Id=${H2}`);
        T('改名落库', ren.length === 1 && ren[0].Name === TAG + '-习惯改名', JSON.stringify(ren[0] || {}));

        // ================= S3 手机端弹窗不自动聚焦 =================
        sec('S3 手机端弹窗不自动聚焦（不弹小键盘）');
        const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const mp = await mctx.newPage();
        mp.on('dialog', d => d.accept().catch(() => { }));
        await login(mp, QA.USER, QA.PASS);
        await mp.goto(BASE + '/Habits?view=list');
        await mp.waitForSelector('.row-item');
        await mp.locator('a[href^="/Habits/Edit/"]').first().click();
        await mp.waitForTimeout(600);
        T('手机端编辑弹窗打开', await modalOpen(mp));
        const mae = await mp.evaluate(() => {
            const a = document.activeElement;
            return { tag: a ? a.tagName : '', isField: !!(a && a.matches && a.matches('input,textarea,select')) };
        });
        T('弹窗打开后焦点不在输入框', !mae.isField, 'activeElement=' + mae.tag);
        await mp.locator('#appModal .modal-close').click();
        await mp.waitForTimeout(300);

        // ================= S4 桌面端弹窗保留自动聚焦 =================
        sec('S4 桌面端弹窗保留自动聚焦');
        await page.goto(BASE + '/Habits?view=list');
        await page.waitForSelector('.row-item');
        await page.locator('a[href^="/Habits/Edit/"]').first().click();
        await page.waitForTimeout(600);
        const dae = await page.evaluate(() => {
            const a = document.activeElement;
            return { tag: a ? a.tagName : '', name: a && a.name ? a.name : '' };
        });
        T('桌面弹窗自动聚焦第一个输入框', dae.tag === 'INPUT' && dae.name === 'Name', JSON.stringify(dae));
        await page.locator('#appModal .modal-close').click();
        await page.waitForTimeout(300);

        // ================= S5 日历照片式：点日期 → 下方显示当日日程 =================
        sec('S5 日历照片式：点日期下方显示当日日程 + 明显翻月/滑动翻月');

        // 造数：day2 放 1 条日程，day1 留空（新建预填路径）
        const monthRows = dbq(`select StartAt from Schedules where UserId=${uid} and StartAt like '${K.slice(0, 7)}-%'`);
        const used = new Set(monthRows.map(r => String(r.StartAt).slice(0, 10)));
        let day1 = null, day2 = null;
        for (let d = 1; d <= 28; d++) {
            const key = K.slice(0, 8) + String(d).padStart(2, '0');
            if (key === K || used.has(key)) continue;
            if (!day2) day2 = key;
            else if (!day1) { day1 = key; break; }
        }
        dbq(`insert into Schedules (UserId, Title, Description, StartAt, EndAt, AllDay, CreatedAt, UpdatedAt) values (${uid}, '${TAG}-日程C', '单条测试', '${day2} 10:00:00', NULL, 0, '${K} 08:00:00', '${K} 08:00:00')`);
        T('造数：单条日期与空日期就绪', !!day1 && !!day2, 'day2=' + day2 + ' day1=' + day1);
        await page.goto(BASE + '/Schedule?view=calendar');
        await page.waitForSelector('.cal-cell');

        // —— 头部：‹ 年月 › 一组明显的大按钮 + 浮动「今」——
        const ymText = (await page.locator('#calYm').textContent()).trim();
        T('年月显示在合并控件里', /\d{4} 年 \d{1,2} 月/.test(ymText), ymText);
        T('翻月按钮 ‹ › 可见', await page.locator('#calPrev').isVisible() && await page.locator('#calNext').isVisible());
        const btnBox = await page.locator('#calNext').boundingBox();
        T('翻月按钮够大（≥36px）', !!btnBox && btnBox.width >= 36 && btnBox.height >= 36, JSON.stringify(btnBox));
        T('浮动「今」按钮常显', await page.locator('#calToday').isVisible());
        T('旧的气泡组件已移除', await page.locator('.cal-peek, .cal-pop').count() === 0);

        const cell = page.locator(`.cal-cell[data-date="${K}"]`);

        // —— 第一次点日期：选中 + 下方直接显示当日日程 ——
        await cell.locator('.cal-day').click();
        await page.waitForTimeout(400);
        T('日期格选中高亮', await cell.evaluate(el => el.classList.contains('sel')));
        T('日历下方出现当日日程区', await page.locator('#calAgenda .agenda-list').count() === 1);
        const agText = await page.locator('#calAgenda').textContent();
        T('日程区带日期抬头（月 日 · 周几）', /月.+日/.test(agText) && agText.includes('·'), agText.slice(0, 24));
        T('列出当日两条日程', await page.locator('#calAgenda .agenda-item').count() === 2);
        T('日程条带时间与标题', agText.includes('09:00') && agText.includes(TAG + '-日程A') && agText.includes('14:30') && agText.includes(TAG + '-日程B'), agText.slice(0, 60));
        T('日程区带新建入口', await page.locator('#calAgenda a[href^="/Schedule/New"]').count() === 1);

        // 点日程行 → 编辑弹窗；关弹窗后下方列表还在
        await page.locator('#calAgenda .agenda-item:has-text("' + TAG + '-日程A")').click();
        await page.waitForTimeout(700);
        T('点日程行进编辑弹窗', await modalOpen(page) && (await page.locator('#appModal .modal-title').textContent()).includes('编辑'), await page.locator('#appModal .modal-title').textContent());
        T('编辑表单带入标题', (await page.inputValue('#appModal input[name="Title"]')) === TAG + '-日程A');
        await page.locator('#appModal .modal-close').click();
        await page.waitForTimeout(400);
        T('关弹窗后下方列表还在', await page.locator('#calAgenda .agenda-item').count() === 2);

        // —— 单条日期：点行进编辑 ——
        await page.locator(`.cal-cell[data-date="${day2}"] .cal-day`).click();
        await page.waitForTimeout(300);
        T('单条日期下方列出一条', await page.locator('#calAgenda .agenda-item').count() === 1);
        await page.locator('#calAgenda .agenda-item').click();
        await page.waitForTimeout(700);
        T('点单条进编辑弹窗', await modalOpen(page) && (await page.inputValue('#appModal input[name="Title"]')) === TAG + '-日程C');
        await page.locator('#appModal .modal-close').click();
        await page.waitForTimeout(400);

        // —— 空日期：空态 + 「+ 新建」预填日期 ——
        await page.locator(`.cal-cell[data-date="${day1}"] .cal-day`).click();
        await page.waitForTimeout(300);
        const et = await page.locator('#calAgenda').textContent();
        T('空日期显示空态', et.includes('这天没安排'), et.slice(0, 40));
        await page.locator('#calAgenda a[href^="/Schedule/New"]').click();
        await page.waitForTimeout(700);
        const act = await page.getAttribute('#appModal form', 'action');
        T('「+ 新建」进新建弹窗', await modalOpen(page) && act.includes('/Schedule/New'), act);
        const sv = await page.inputValue('#appModal input[name="StartAt"]');
        T('新建表单预填所点日期', sv.startsWith(day1), 'StartAt=' + sv);
        await page.locator('#appModal .modal-close').click();
        await page.waitForTimeout(400);

        // —— 头部导航：翻月 / 浮动「今」/ 点年月 ——
        await page.locator('#calNext').click();
        await page.waitForTimeout(300);
        const ym2 = (await page.locator('#calYm').textContent()).trim();
        T('翻月后年月已更新', ym2 !== ymText, ym2);
        await page.locator('#calToday').click();
        await page.waitForTimeout(300);
        T('浮动「今」回到当月', (await page.locator('#calYm').textContent()).trim() === ymText);
        T('回到今天后今天格选中', await page.locator(`.cal-cell[data-date="${K}"]`).evaluate(el => el.classList.contains('sel')));
        await page.locator('#calNext').click();
        await page.waitForTimeout(300);
        await page.locator('#calYm').click();
        await page.waitForTimeout(300);
        T('点年月文字也回今天', (await page.locator('#calYm').textContent()).trim() === ymText);

        // —— 手势翻月（合成 touch 事件）——
        const swipe = async (p, dir) => p.evaluate((dir) => {
            const el = document.getElementById('calBody');
            const mk = (type, x, y) => {
                const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
                el.dispatchEvent(new TouchEvent(type, {
                    touches: type === 'touchend' ? [] : [t],
                    changedTouches: [t], bubbles: true
                }));
            };
            mk('touchstart', dir > 0 ? 300 : 100, 200);
            mk('touchend', dir > 0 ? 180 : 220, 205);
        }, dir);
        await swipe(page, 1);
        await page.waitForTimeout(300);
        T('左滑手势翻到下月', (await page.locator('#calYm').textContent()).trim() !== ymText);
        await swipe(page, -1);
        await page.waitForTimeout(300);
        T('右滑手势翻回本月', (await page.locator('#calYm').textContent()).trim() === ymText);

        // 截图：选中日期 + 下方日程
        await cell.locator('.cal-day').click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: OUT + '/ui2_pc_cal_agenda.png', fullPage: false });

        // ================= S6 表单布局增强 =================
        // ================= S6 表单布局增强 =================
        sec('S6 表单布局增强（并排字段 + 动作条）');
        await page.goto(BASE + '/Expenses');
        await page.waitForSelector('a[href="/Expenses/New"]');
        await page.locator('a[href="/Expenses/New"]').click();
        await page.waitForTimeout(600);
        T('记账弹窗打开', await modalOpen(page));
        const rowCnt = await page.locator('#appModal .modal-body .field-row').count();
        T('短字段自动成组并排', rowCnt >= 1, 'field-row=' + rowCnt);
        const maxInRow = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('#appModal .field-row')].map(r => r.querySelectorAll('.field').length)));
        T('成组行内含 ≥2 字段', maxInRow >= 2, 'max=' + maxInRow);
        T('动作条带 form-actions 类', await page.locator('#appModal .form-actions').count() === 1);
        const abt = await page.evaluate(() => getComputedStyle(document.querySelector('#appModal .form-actions')).borderTopWidth);
        T('动作条有分隔线', abt === '1px', 'borderTop=' + abt);
        await page.screenshot({ path: OUT + '/ui2_pc_expenses_modal.png' });
        await page.locator('#appModal .modal-close').click();
        await page.waitForTimeout(300);

        await page.goto(BASE + '/Schedule?view=list');
        await page.waitForSelector('a[href="/Schedule/New"]');
        await page.locator('a[href="/Schedule/New"]').click();
        await page.waitForTimeout(600);
        const dtRow = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('#appModal .field-row')];
            for (const r of rows) {
                if (r.querySelectorAll('input[type="datetime-local"]').length === 2) return true;
            }
            return false;
        });
        T('开始/结束时间并排成对', dtRow);
        const swBg = await page.evaluate(() => {
            const f = document.querySelector('#appModal .field:has(input.switch)');
            return f ? getComputedStyle(f).backgroundColor : 'none';
        });
        T('开关字段为整行设置项样式', swBg !== 'none' && swBg !== 'rgba(0, 0, 0, 0)', swBg);
        await page.screenshot({ path: OUT + '/ui2_pc_schedule_modal.png' });
        await page.locator('#appModal .modal-close').click();
        await page.waitForTimeout(300);

        await page.goto(BASE + '/Habits?view=list');
        await page.waitForSelector('a[href="/Habits/New"]');
        await page.locator('a[href="/Habits/New"]').click();
        await page.waitForTimeout(600);
        const habRow = await page.evaluate(() => {
            const r = document.querySelector('#appModal .field-row');
            return r ? r.querySelectorAll('.field').length : 0;
        });
        T('习惯表单名称/图标手动并排', habRow === 2, 'fields=' + habRow);
        await page.locator('#appModal .modal-close').click();
        await page.waitForTimeout(300);

        // 整页渲染同样增强（非弹窗兜底路径）
        await page.goto(BASE + '/Expenses/New');
        await page.waitForLoadState('networkidle');
        const fpRow = await page.locator('main .field-row').count();
        const fpAct = await page.locator('main .form-actions').count();
        T('整页表单同样并排成组', fpRow >= 1, 'field-row=' + fpRow);
        T('整页动作条同样标准化', fpAct === 1, 'form-actions=' + fpAct);

        // ================= S7 免刷新打卡：滚动与视图记忆都不动 =================
        sec('S7 免刷新打卡：滚动位置与视图记忆保持');
        await page.goto(BASE + '/Habits?view=list');
        await page.waitForSelector('.row-item');
        await page.evaluate(() => { window.__qaMark = 7; localStorage.setItem('view:habits', 'grid'); });
        const btn3 = page.locator(`form:has(input[name="id"][value="${H3}"]) button:has-text("打卡")`);
        await btn3.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
        const y6 = await scrollY(page);
        await btn3.click();
        await page.waitForTimeout(900);
        const y7 = await scrollY(page);
        T('打卡免刷新（标记还在、URL 未变）', await page.evaluate(() => window.__qaMark === 7) && page.url().includes('view=list'), page.url().replace(BASE, ''));
        T('滚动位置保持', y7 > 100 && Math.abs(y7 - y6) < 300, `y6=${y6} y7=${y7}`);
        T('打卡状态已翻转', await page.locator(`form:has(input[name="id"][value="${H3}"]) button:has-text("今日已打卡")`).count() === 1);
        console.log('  (info) S7 最终 URL: ' + page.url().replace(BASE, ''));
        await page.evaluate(() => localStorage.setItem('view:habits', 'list'));   // 还原记忆

        // ================= S8 手机端日历（照片式）截图目检 =================
        sec('S8 手机端日历照片式 + 手势翻月');
        await mp.goto(BASE + '/Schedule?view=calendar');
        await mp.waitForSelector('.cal-cell');
        await mp.locator(`.cal-cell[data-date="${K}"] .cal-day`).tap();
        await mp.waitForTimeout(500);
        T('手机端下方显示当日日程', await mp.locator('#calAgenda .agenda-item').count() === 2);
        T('手机端无气泡浮层', await mp.locator('.cal-peek, .cal-pop').count() === 0);
        const mFab = await mp.locator('#calToday').boundingBox();
        T('手机端「今」按钮可见够大', !!mFab && mFab.width >= 36, JSON.stringify(mFab));
        await mp.screenshot({ path: OUT + '/ui2_mobile_cal_agenda.png' });
        await swipe(mp, 1);
        await mp.waitForTimeout(300);
        T('手机端左滑手势翻月', (await mp.locator('#calYm').textContent()).trim() !== ymText);
        await swipe(mp, -1);
        await mp.waitForTimeout(300);
        T('手机端右滑手势翻回', (await mp.locator('#calYm').textContent()).trim() === ymText);

        await mp.goto(BASE + '/Expenses');
        await mp.waitForSelector('a[href="/Expenses/New"]');
        await mp.locator('a[href="/Expenses/New"]').click();
        await mp.waitForTimeout(600);
        await mp.screenshot({ path: OUT + '/ui2_mobile_expenses_modal.png' });
        await mp.locator('#appModal .modal-close').click();
        await mp.waitForTimeout(300);

        await mp.goto(BASE + '/Habits?view=list');
        await mp.waitForSelector('a[href^="/Habits/Edit/"]');
        await mp.locator('a[href^="/Habits/Edit/"]').first().click();
        await mp.waitForTimeout(600);
        await mp.screenshot({ path: OUT + '/ui2_mobile_edit_modal.png' });
        await mp.locator('#appModal .modal-close').click();

        // ================= S9 无刷新页面切换（导航 / 视图切换） =================
        sec('S9 无刷新页面切换（fetch 换主区 + pushState）');
        await page.goto(BASE + '/Habits?view=list');
        await page.waitForSelector('.row-item');
        await page.evaluate(() => { window.__qaMark = 9; localStorage.setItem('view:schedule', 'list'); });
        await page.locator('.sidebar .nav-item[href="/Schedule"]').click();
        await page.waitForTimeout(900);
        T('侧栏导航后整页未刷新（标记还在）', await page.evaluate(() => window.__qaMark === 9));
        T('地址栏已切到日程页', page.url().includes('/Schedule'), page.url().replace(BASE, ''));
        T('主区换成日程内容', await page.locator('a[href="/Schedule/New"]').count() >= 1);
        T('侧栏高亮同步到日程', await page.locator('.sidebar .nav-item[href="/Schedule"]').evaluate(el => el.classList.contains('active')));
        T('页面标题同步', (await page.title()).includes('日程'), await page.title());

        // 视图切换也不刷新（项目切换）
        await page.locator('.view-switch .vs-btn[data-view="calendar"]').click();
        await page.waitForTimeout(900);
        T('切视图未整页刷新', await page.evaluate(() => window.__qaMark === 9));
        T('视图切到日历（日历格出现）', await page.locator('.cal-cell').count() > 0);
        await page.locator('.view-switch .vs-btn[data-view="list"]').click();
        await page.waitForTimeout(900);
        T('切回列表未整页刷新', await page.evaluate(() => window.__qaMark === 9));
        T('视图切回列表（选中态同步）', await page.locator('.view-switch .vs-btn[data-view="list"]').evaluate(el => el.classList.contains('on')));

        // 浏览器后退：回到上一个历史条目（视图切换也各占一条历史），全程免刷新
        await page.goBack();
        await page.waitForTimeout(900);
        T('后退也走无刷新换主区', await page.evaluate(() => window.__qaMark === 9));
        T('后退回到上一个视图（日历）', page.url().includes('view=calendar') && await page.locator('.cal-cell').count() > 0, page.url().replace(BASE, ''));
        await page.goBack();
        await page.waitForTimeout(700);
        await page.goBack();
        await page.waitForTimeout(900);
        T('再后退两步回到打卡页', page.url().includes('/Habits'), page.url().replace(BASE, ''));
        T('全程无刷新（标记还在）', await page.evaluate(() => window.__qaMark === 9));

        // ================= S10 页面无 JS 错误 =================
        sec('S10 页面健康');
        T('全程无页面 JS 错误', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
    } catch (e) {
        T('脚本异常', false, e.message);
    }

    // ---- 清理造数（逐条执行） ----
    dbqMulti(`delete from HabitCheckins where UserId=${uid} and HabitId in (select Id from Habits where Name like '${TAG}-%');\n` +
        `delete from Habits where UserId=${uid} and Name like '${TAG}-%';\n` +
        `delete from Schedules where UserId=${uid} and Title like '${TAG}-%';`);
    const left = dbq(`select count(*) as n from Habits where Name like '${TAG}-%'`);
    console.log('清理后 UIQ 残留: ' + JSON.stringify(left));

    await browser.close();
    const fails = results.filter(r => !r.ok);
    fs.writeFileSync(QA_DIR + '/report-ui2.json', JSON.stringify({ total: results.length, pass: results.length - fails.length, fail: fails.length, results }, null, 2));
    console.log('\n===== 汇总: ' + (results.length - fails.length) + '/' + results.length + ' 通过 =====');
    if (fails.length) { console.log('失败项:'); fails.forEach(f => console.log('  [' + f.sec + '] ' + f.name + '  ' + f.extra)); }
    process.exit(fails.length ? 1 : 0);
})();
