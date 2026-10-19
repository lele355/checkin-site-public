// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// test_user_delete.js — 用户管理「删除用户」：5 秒确认、防自删、级联清数据
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const BASE = 'http://localhost:5188';
let pass = 0, fail = 0;
const T = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  [' + x + ']' : '')); ok ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sql = q => JSON.parse(execSync('python qa/dbq.py', { cwd: process.cwd(), input: q, encoding: 'utf8' }).trim());

const TS = Date.now().toString().slice(-6);
const TARGET = 'qa_del_' + TS;

(async () => {
    // ---------- 造一个待删用户 + 一条日程，用来验证级联 ----------
    sql(`insert into Users (Username, DisplayName, PasswordHash, RoleId, IsActive, CreatedAt, MustChangePassword, SamplePromptDismissed, Signature, Email, Theme, Tone, Accent, DashboardLayout, NavHidden, RegisterIp)
         select '${TARGET}', '待删测试', PasswordHash, (select Id from Roles order by Id limit 1), 1, datetime('now'), 0, 0, '', '', '', '', '', '', '', ''
         from Users where Username=ADMIN;`);
    const uid = sql(`select Id from Users where Username='${TARGET}'`)[0].Id;
    sql(`insert into Schedules (UserId, Title, Description, StartAt, AllDay, CreatedAt, UpdatedAt)
         values (${uid}, '删号测试日程', '', datetime('now'), 0, datetime('now'), datetime('now'));`);
    T('准备测试用户 + 1 条日程', uid > 0 && sql(`select count(*) c from Schedules where UserId=${uid}`)[0].c === 1, 'uid=' + uid);

    const b = await chromium.launch({ channel: 'msedge' });
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));

    // ---------- 登录 ----------
    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', ADMIN);
    let okLogin = false;
    for (const pw of [PW, PW]) {
        await p.fill('#Password', pw);
        await p.click('form button[type=submit]');
        await sleep(1200);
        if (!p.url().toLowerCase().includes('login')) { okLogin = true; break; }
    }
    T('登录成功', okLogin, p.url());

    // ---------- 列表 ----------
    await p.goto(BASE + '/Admin/Users', { waitUntil: 'domcontentloaded' });
    const rowCount = await p.locator('table.table tbody tr').count();
    const delCount = await p.locator('[data-del-id]').count();
    T('每行都有删除按钮（自己那行除外）', delCount === rowCount - 1, `行=${rowCount} 删除按钮=${delCount}`);
    T('自己那行没有删除按钮', await p.locator('tr:has-text("（你）") [data-del-id]').count() === 0);

    // ---------- 打开弹窗：倒计时 ----------
    await p.locator(`[data-del-id="${uid}"]`).click();
    await p.waitForSelector('#delUserModal[open]', { timeout: 5000 });
    T('弹窗列出要删的账号', (await p.locator('#delUserLabel').innerText()).includes(TARGET));
    T('确认按钮初始禁用', await p.locator('#delConfirmBtn').isDisabled());
    T('按钮带 5 秒倒计时文案', /确认删除（5）/.test(await p.locator('#delConfirmBtn').innerText()));
    await sleep(2200);
    T('2 秒后仍禁用', await p.locator('#delConfirmBtn').isDisabled(), await p.locator('#delConfirmBtn').innerText());

    // ---------- 取消：不删 ----------
    await p.locator('#delUserModal .form-actions .btn.secondary').click();
    await sleep(400);
    T('取消后弹窗关闭', !(await p.locator('#delUserModal[open]').count()));
    T('取消后用户还在', sql(`select count(*) c from Users where Id=${uid}`)[0].c === 1);

    // ---------- 再开：等满 5 秒真删 ----------
    await p.locator(`[data-del-id="${uid}"]`).click();
    await p.waitForSelector('#delUserModal[open]', { timeout: 5000 });
    let enabled = false;
    for (let i = 0; i < 20; i++) {
        await sleep(500);
        if (!(await p.locator('#delConfirmBtn').isDisabled())) { enabled = true; break; }
    }
    T('等满 5 秒后确认按钮可用', enabled, await p.locator('#delConfirmBtn').innerText());
    T('可用后文案不再带秒数', (await p.locator('#delConfirmBtn').innerText()).trim() === '确认删除');

    await p.locator('#delConfirmBtn').click();
    await p.waitForLoadState('domcontentloaded');
    await p.waitForSelector('.toast-ok, .msg.ok', { timeout: 6000 });
    const body = await p.locator('body').innerText();
    T('删除成功有提示', body.includes('已删除'), body.replace(/\s+/g, ' ').slice(0, 60));
    const tableText = await p.locator('table.table tbody').innerText();
    T('列表里不再有该用户', !tableText.includes(TARGET));
    T('数据库里用户已删除', sql(`select count(*) c from Users where Id=${uid}`)[0].c === 0);
    T('其日程被级联删除', sql(`select count(*) c from Schedules where UserId=${uid}`)[0].c === 0);

    // ---------- 服务端兜底：不能删自己（绕过界面直接 POST） ----------
    const selfId = sql(`select Id from Users where Username=ADMIN`)[0].Id;
    await p.goto(BASE + '/Admin/Users', { waitUntil: 'domcontentloaded' });
    await p.evaluate(async (args) => {
        const token = document.querySelector('#delUserForm input[name=__RequestVerificationToken]').value;
        const fd = new URLSearchParams();
        fd.set('id', String(args.id));
        fd.set('__RequestVerificationToken', token);
        const r = await fetch('/Admin/Users?handler=Delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: fd.toString()
        });
        document.open(); document.write(await r.text()); document.close();
    }, { id: selfId });
    await sleep(800);
    const body2 = await p.locator('body').innerText();
    T('直接 POST 删自己被拒', body2.includes('不能删除自己'), body2.replace(/\s+/g, ' ').slice(0, 50));
    T('admin 账号仍在', sql(`select count(*) c from Users where Username=ADMIN`)[0].c === 1);

    T('无 JS 运行时错误', errs.length === 0, errs.slice(0, 2).join(' | '));

    await b.close();
    sql(`delete from Schedules where UserId=${uid};`);   // 兜底清理
    console.log(`\n=== 删除用户：${pass} 通过 / ${fail} 失败 ===`);
    process.exit(fail ? 1 : 0);
})();
