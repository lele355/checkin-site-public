// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// test_nav_ai.js — 本轮两件事的专项测试
//   ① 侧栏：分组折叠（记忆）+ 自定义隐藏/恢复（跟账号走）+ 隐藏不影响权限
//   ② AI：每日 token 用量显示 + 超额拦截（默认 1 亿）
// 用法：NODE_PATH=... node test_nav_ai.js
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const BASE = 'http://localhost:5188';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const QA_DIR = 'D:/projects/checkin/qa';
const ADMIN_USER = ADMIN;
const ADMIN_PASS = PW;

const results = [];
let curSec = '';
function sec(n) { curSec = n; console.log('\n===== ' + n + ' ====='); }
function T(name, cond, extra) {
    const ok = !!cond;
    results.push({ sec: curSec, name, ok, extra: String(extra ?? '') });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : ''));
}
function dbq(sql) {
    try { return JSON.parse(execSync(`"${PY}" "${QA_DIR}/dbq.py"`, { input: sql, encoding: 'utf8' })); }
    catch (e) { return [{ error: String(e) }]; }
}
const todayUtc = new Date().toISOString().slice(0, 10);

async function login(page, user, pass) {
    await page.goto(BASE + '/Login');
    await page.fill('#Username', user);
    await page.fill('#Password', pass);
    await page.click('form button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(300);
}

(async () => {
    // 清掉上一轮可能残留的 AI 用量与侧栏偏好
    const uidRows = dbq(`select Id from Users where Username = '${ADMIN_USER}'`);
    const uid = uidRows[0] && uidRows[0].Id;
    dbq(`delete from AiUsageDailies where UserId = ${uid}`);
    dbq(`update Users set NavHidden = '' where Id = ${uid}`);

    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => d.accept().catch(() => { }));

    await login(p, ADMIN_USER, ADMIN_PASS);
    T('登录成功', !p.url().includes('/Login'), p.url());

    // ---------------- 侧栏 ----------------
    sec('N1 侧栏分组结构');
    const groups = await p.locator('.sidebar .nav-group').allInnerTexts();
    T('有 4 个分组标题', groups.length === 4, groups.join('/'));
    T('分组名是 常用/生活/工具/管理', ['常用', '生活', '工具', '管理'].every(g => groups.some(t => t.includes(g))), groups.join('/'));
    T('每个分组都有可折叠列表', (await p.locator('.sidebar .nav-list').count()) === 4);
    T('侧栏底部有「自定义侧栏」入口', (await p.locator('.sidebar .nav-customize').count()) === 1);

    sec('N2 折叠分组并记忆');
    const lifeHead = p.locator('.sidebar .nav-group[data-group="生活"]');
    const lifeList = p.locator('.sidebar .nav-list[data-group="生活"]');
    await lifeHead.click();
    T('点一下折叠', (await lifeList.getAttribute('class')).includes('folded'));
    T('箭头状态同步', (await lifeHead.getAttribute('aria-expanded')) === 'false');
    await p.reload();
    await p.waitForTimeout(300);
    T('刷新后仍保持折叠', (await p.locator('.sidebar .nav-list[data-group="生活"]').getAttribute('class')).includes('folded'));
    await p.locator('.sidebar .nav-group[data-group="生活"]').click();
    T('再点一下展开', !(await p.locator('.sidebar .nav-list[data-group="生活"]').getAttribute('class')).includes('folded'));

    sec('N3 自定义隐藏「邮件」');
    await p.locator('.sidebar .nav-customize').click();
    await p.waitForTimeout(300);
    T('弹窗打开', await p.locator('#navCustomizeModal').evaluate(d => d.open));
    const emailBox = p.locator('#navCustomizeModal input[type=checkbox][name=visible][value=email]');
    T('勾选清单里有「邮件」且默认勾上', await emailBox.isChecked());
    await emailBox.uncheck();
    await p.locator('#navCustomizeModal button[type=submit]').click();
    await p.waitForLoadState('networkidle').catch(() => { });
    await p.waitForTimeout(400);
    T('保存后侧栏不再有「邮件」', (await p.locator('.sidebar a[href="/Email"]').count()) === 0);
    const navDb = dbq(`select NavHidden from Users where Id = ${uid}`);
    T('隐藏项已写库', String(navDb[0] && navDb[0].NavHidden).includes('email'), JSON.stringify(navDb));

    sec('N4 隐藏不影响权限（直接输网址照常打开）');
    await p.goto(BASE + '/Email');
    T('/Email 仍可访问', (await p.url()).includes('/Email'), p.url());
    T('页面正常渲染（不是登录页/无权限页）', !(await p.content()).includes('页面出了点小状况') && (await p.locator('h2').count()) > 0, await p.locator('h2').first().innerText().catch(() => ''));

    sec('N5 重新勾回「邮件」');
    await p.goto(BASE + '/');
    await p.locator('.sidebar .nav-customize').click();
    await p.waitForTimeout(300);
    await p.locator('#navCustomizeModal input[type=checkbox][name=visible][value=email]').check();
    await p.locator('#navCustomizeModal button[type=submit]').click();
    await p.waitForLoadState('networkidle').catch(() => { });
    await p.waitForTimeout(400);
    T('侧栏恢复显示「邮件」', (await p.locator('.sidebar a[href="/Email"]').count()) === 1);
    const navDb2 = dbq(`select NavHidden from Users where Id = ${uid}`);
    T('库里的隐藏清单已清空', String((navDb2[0] || {}).NavHidden || '') === '', JSON.stringify(navDb2));

    // ---------------- AI token ----------------
    sec('A1 AI 页显示今日用量与上限');
    await p.goto(BASE + '/Ai');
    const aiText = await p.locator('.card').first().innerText();
    T('显示「今日已用」', aiText.includes('今日已用'), aiText.split('\n').slice(-2).join(' '));
    T('上限是 1 亿', /100[,，]?000[,，]?000/.test(aiText), aiText.split('\n').slice(-2).join(' '));

    sec('A2 超额后被拦（不发请求）');
    dbq(`delete from AiUsageDailies where UserId = ${uid}`);
    dbq(`insert into AiUsageDailies (UserId, Day, PromptTokens, CompletionTokens, TotalTokens, Requests) values (${uid}, '${todayUtc} 00:00:00', 0, 0, 100000000, 1)`);
    await p.reload();
    await p.waitForTimeout(300);
    const aiText2 = await p.locator('.card').first().innerText();
    T('页面读到今日已用 100,000,000', /100[,，]?000[,，]?000/.test(aiText2), aiText2.split('\n').slice(-2).join(' '));

    await p.fill('#aiForm textarea[name=text]', '测试一下超额提示');
    await p.click('#aiSend');
    await p.waitForLoadState('networkidle').catch(() => { });
    await p.waitForTimeout(400);
    await p.waitForSelector('.msg.error, .toast-err', { timeout: 6000 }).catch(() => { });
    const errMsg = await p.locator('.msg.error, .toast-err').first().innerText().catch(() => '');
    T('提示 token 额度已用完', errMsg.includes('token') && errMsg.includes('额度'), errMsg);

    sec('A3 用量回落后恢复正常');
    dbq(`update AiUsageDailies set TotalTokens = 12345 where UserId = ${uid}`);
    await p.reload();
    await p.waitForTimeout(300);
    const aiText3 = await p.locator('.card').first().innerText();
    T('显示 12,345', /12[,，]?345/.test(aiText3), aiText3.split('\n').slice(-2).join(' '));

    sec('A4 无前端异常');
    T('没有 pageerror', errs.length === 0, errs.join(' | '));

    // 收尾：清掉测试写入的用量
    dbq(`delete from AiUsageDailies where UserId = ${uid}`);
    await browser.close();

    const pass = results.filter(x => x.ok).length;
    console.log('\n===== 汇总 ' + pass + '/' + results.length + ' =====');
    results.filter(x => !x.ok).forEach(f => console.log('FAILED [' + f.sec + '] ' + f.name + ' :: ' + f.extra));
    process.exit(results.some(x => !x.ok) ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
