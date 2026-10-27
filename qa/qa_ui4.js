// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// qa_ui4.js — 本批专项：工作台自定义（排序/显隐/快捷置顶）+ 备忘快捷置顶 + 手机端尺寸收紧
// 用法: NODE_PATH=... node qa_ui4.js   → 输出 report-ui4.json + console 明细 + _shots 截图
// 约定同 qa_ui2.js：playwright 用系统 Edge；toast 断言用 hasText 防竞态；dbq 一次一条语句；
// 测试尾声把工作台布局恢复默认、清掉 UIQ4 测试数据。
const QA = require('./_env');
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const QA_DIR = 'D:/projects/checkin/qa';
const OUT = 'D:/projects/checkin/_shots';
const TAG = 'UIQ4';
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
function dbqMulti(sql) {
    return sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean).map(dbq);
}
async function login(page, user, pass) {
    await page.goto(BASE + '/Login');
    await page.fill('#Username', user);
    await page.fill('#Password', pass);
    await page.click('#loginForm button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(300);
}
// 工作台网格里的卡片顺序
async function gridOrder(page) {
    return await page.$$eval('#dashGrid [data-card]', els => els.map(e => e.dataset.card));
}
async function toastOk(page, text) {
    return await page.locator('.toast-ok', { hasText: text }).first().isVisible().catch(() => false);
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });

    const uid = dbq(`select Id from Users where Username=ADMIN`)[0].Id;

    // ---- 造数：2 张备忘（先清残留）+ 工作台布局回默认 ----
    dbqMulti(`delete from Memos where UserId=${uid} and Title like '${TAG}-%';`);
    dbq(`update Users set DashboardLayout='' where Id=${uid}`);
    dbq(`insert into Memos (UserId, Title, Content, Pinned, CreatedAt, UpdatedAt) values ` +
        `(${uid}, '${TAG}-备忘X', '置顶测试用', 0, datetime('now'), datetime('now')), ` +
        `(${uid}, '${TAG}-备忘Y', '另一张', 0, datetime('now'), datetime('now'))`);
    T('造数成功（2 张备忘）', dbq(`select Id from Memos where UserId=${uid} and Title like '${TAG}-%'`).length === 2);

    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => d.accept().catch(() => { }));

    try {
        await login(page, QA.USER, QA.PASS);
        T('admin 登录成功', !page.url().includes('Login'), page.url());

        // ================= S1 工作台快捷置顶（即点即存） =================
        sec('S1 工作台卡片快捷置顶');
        await page.goto(BASE + '/');
        await page.waitForSelector('#dashGrid [data-card]');
        const pins = await page.locator('#dashGrid .card-pin').count();
        T('每张卡片带快捷置顶按钮', pins >= 8, 'pins=' + pins);
        T('布局数据脚本就绪', await page.locator('#dashData').count() === 1);

        await page.locator('#dashGrid [data-card="schedule"] .card-pin').click();
        await page.waitForTimeout(600);
        let ord = await gridOrder(page);
        T('置顶后排到最前', ord[0] === 'schedule', ord.slice(0, 3).join(','));
        T('图钉进入高亮态', await page.locator('.card-pin[data-pin="schedule"]').evaluate(el => el.classList.contains('on')));
        T('保存提示出现', await toastOk(page, '布局已保存'));

        await page.locator('#dashGrid [data-card="memo"] .card-pin').click();
        await page.waitForTimeout(600);
        ord = await gridOrder(page);
        T('第二张置顶排更前', ord[0] === 'memo' && ord[1] === 'schedule', ord.slice(0, 3).join(','));

        await page.reload();
        await page.waitForSelector('#dashGrid [data-card]');
        ord = await gridOrder(page);
        T('刷新后置顶仍在（已持久化）', ord[0] === 'memo' && ord[1] === 'schedule', ord.slice(0, 3).join(','));

        await page.locator('#dashGrid [data-card="memo"] .card-pin').click();
        await page.waitForTimeout(600);
        ord = await gridOrder(page);
        T('取消置顶落回普通区', ord[0] === 'schedule' && ord[1] === 'memo', ord.slice(0, 3).join(','));

        // ================= S2 自定义面板（显隐 + 排序） =================
        sec('S2 自定义面板：显隐与排序');
        await page.locator('#dashCustomBtn').click();
        await page.waitForSelector('#dashCustom:not([hidden])');
        const panelText = await page.locator('#dashCustom').textContent();
        T('面板分三区', panelText.includes('置顶区') && panelText.includes('普通区') && panelText.includes('已隐藏'));
        const rows = await page.locator('#dashCustomList .dash-row').count();
        T('每张卡片一行', rows === await page.locator('#dashGrid [data-card]').count(), `rows=${rows}`);
        await page.screenshot({ path: OUT + '/ui4_pc_dash_panel.png', fullPage: false });

        // 隐藏「建设进展」
        await page.locator('#dashCustomList .dash-row:has-text("建设进展") input[type=checkbox]').uncheck();
        await page.waitForTimeout(300);
        T('隐藏后卡片即刻消失（预览）', await page.locator('#dashGrid [data-card="build"]').evaluate(el => getComputedStyle(el).display === 'none'));
        T('隐藏行进「已隐藏」区', (await page.locator('#dashCustomList .dash-sec:has(.dash-sec-title:has-text("已隐藏"))').textContent()).includes('建设进展'));

        // 普通区把「今日打卡」上移一位（只与前一位换，hello 本来就在它前面）
        const habitsBefore = (await gridOrder(page)).indexOf('habits');
        await page.locator('#dashCustomList .dash-sec:has(.dash-sec-title:has-text("普通区")) .dash-row:has-text("今日打卡") .dash-move[title="上移"]').click();
        await page.waitForTimeout(300);
        const ord2 = await gridOrder(page);
        T('↑ 上移即时改变卡片顺序', ord2.indexOf('habits') === habitsBefore - 1, `before=${habitsBefore} after=${ord2.indexOf('habits')}`);
        const habitsAfter = ord2.indexOf('habits');

        await page.locator('#dashSave').click();
        await page.waitForTimeout(600);
        T('保存提示出现', await toastOk(page, '布局已保存'));

        await page.reload();
        await page.waitForSelector('#dashGrid [data-card]');
        T('刷新后隐藏仍在', await page.locator('#dashGrid [data-card="build"]').evaluate(el => getComputedStyle(el).display === 'none'));
        const ord3 = await gridOrder(page);
        T('刷新后排序仍在', ord3.indexOf('habits') === habitsAfter, `habits=${ord3.indexOf('habits')} expect=${habitsAfter}`);
        T('刷新后置顶仍在', ord3[0] === 'schedule', ord3.slice(0, 3).join(','));

        // 恢复默认
        await page.locator('#dashCustomBtn').click();
        await page.waitForSelector('#dashCustom:not([hidden])');
        await page.locator('#dashReset').click();
        await page.waitForTimeout(300);
        await page.locator('#dashSave').click();
        await page.waitForTimeout(600);
        await page.reload();
        await page.waitForSelector('#dashGrid [data-card]');
        const ord4 = await gridOrder(page);
        T('恢复默认后回到原始顺序', ord4[0] === 'hello', ord4.slice(0, 3).join(','));
        T('恢复默认后卡片全部显示', await page.locator('#dashGrid [data-card="build"]').evaluate(el => getComputedStyle(el).display !== 'none'));

        // ================= S3 备忘列表快捷置顶 =================
        sec('S3 备忘列表快捷置顶');
        await page.goto(BASE + '/Memo?view=list');
        await page.waitForSelector('.memo-row');
        const row = page.locator('.memo-row:has-text("' + TAG + '-备忘X")');
        T('备忘行带快捷置顶按钮', await row.locator('.pin-btn').count() === 1);
        await page.evaluate(() => { window.__qaMark = 3; });
        await row.locator('.pin-btn').click();
        await page.waitForTimeout(700);
        T('置顶免刷新（标记还在=无整页刷新）', await page.evaluate(() => window.__qaMark === 3));
        T('点图钉置顶落库', dbq(`select Pinned from Memos where UserId=${uid} and Title='${TAG}-备忘X'`)[0].Pinned == 1);
        T('图钉进入高亮态', await page.locator('.memo-row:has-text("' + TAG + '-备忘X") .pin-btn').evaluate(el => el.classList.contains('on')));
        T('置顶后滑到列表顶部（FLIP）', await page.evaluate((tag) => {
            const rows = document.querySelectorAll('#memoRows .memo-row');
            return rows.length > 0 && rows[0].textContent.includes(tag + '-备忘X');
        }, TAG));
        await page.locator('.memo-row:has-text("' + TAG + '-备忘X") .pin-btn').click();
        await page.waitForTimeout(700);
        T('再点取消置顶落库', dbq(`select Pinned from Memos where UserId=${uid} and Title='${TAG}-备忘X'`)[0].Pinned == 0);

        // ================= S4 手机端尺寸收紧 =================
        sec('S4 手机端尺寸收紧（375×812）');
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(BASE + '/');
        await page.waitForSelector('#dashGrid [data-card]');
        const rootFs = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
        T('手机端根字号收紧到 14px', rootFs === '14px', rootFs);
        const cardPad = await page.locator('#dashGrid .card').first().evaluate(el => getComputedStyle(el).padding);
        T('卡片内边距收紧到 11px', cardPad === '11px', cardPad);
        const btnH = await page.locator('.btn').first().evaluate(el => getComputedStyle(el).minHeight);
        T('按钮高度收至 34px（仍可点）', btnH === '34px', btnH);
        await page.screenshot({ path: OUT + '/ui4_phone_home.png', fullPage: true });

        await page.goto(BASE + '/Schedule?view=calendar');
        await page.waitForSelector('.cal-cell');
        const t = new Date();
        const K = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
        await page.locator(`.cal-cell[data-date="${K}"] .cal-day`).click();
        await page.waitForTimeout(400);
        T('手机端点日期下方出当日日程区', await page.locator('#calAgenda .agenda-list').count() === 1);
        await page.screenshot({ path: OUT + '/ui4_phone_cal_agenda.png', fullPage: false });

        await page.goto(BASE + '/Memo?view=list');
        await page.waitForSelector('.memo-row');
        await page.screenshot({ path: OUT + '/ui4_phone_memo.png', fullPage: false });

        await page.goto(BASE + '/Habits?view=list');
        await page.waitForSelector('.row-item, .empty');
        await page.screenshot({ path: OUT + '/ui4_phone_habits.png', fullPage: false });

        // ================= S5 健康 =================
        sec('S5 页面健康');
        T('全程无页面 JS 错误', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
    } catch (e) {
        T('脚本异常', false, String(e).slice(0, 300));
    } finally {
        // ---- 清理：测试备忘 + 工作台布局回默认 ----
        dbq(`delete from Memos where UserId=${uid} and Title like '${TAG}-%'`);
        await page.setViewportSize({ width: 1280, height: 860 });
        await page.goto(BASE + '/');
        await page.waitForSelector('#dashGrid [data-card]');
        await page.locator('#dashCustomBtn').click();
        await page.waitForSelector('#dashCustom:not([hidden])');
        await page.locator('#dashReset').click();
        await page.waitForTimeout(200);
        await page.locator('#dashSave').click();
        await page.waitForTimeout(500);
        await browser.close();

        const pass = results.filter(r => r.ok).length;
        fs.writeFileSync(QA_DIR + '/report-ui4.json', JSON.stringify({ pass, total: results.length, results }, null, 2));
        console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`);
        if (pass !== results.length) process.exitCode = 1;
    }
})();
