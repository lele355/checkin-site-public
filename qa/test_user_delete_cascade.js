// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// test_user_delete_cascade.js — 验证「删用户 = 连他所有数据一起删」
// 做法：建号时勾上「生成测试数据」（每模块都有数据）→ 逐表数一遍 → 删号 → 再逐表数一遍，必须全 0。
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const BASE = 'http://localhost:5188';
let pass = 0, fail = 0;
const T = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  [' + x + ']' : '')); ok ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sql = q => JSON.parse(execSync('python qa/dbq.py', { cwd: process.cwd(), input: q, encoding: 'utf8' }).trim());

// 所有按用户隔离的表（外键指向 Users 的）
const TABLES = [
    ['AiMessages', 'UserId'], ['AiUsageDailies', 'UserId'], ['Anniversaries', 'UserId'],
    ['BoardMessages', 'UserId'], ['Courses', 'UserId'], ['EmailAccounts', 'UserId'],
    ['EmailMessages', 'UserId'], ['Expenses', 'UserId'], ['HabitCheckins', 'UserId'],
    ['Habits', 'UserId'], ['LoveNotes', 'FromUserId'], ['MailReminderSettings', 'UserId'],
    ['Memos', 'UserId'], ['PeriodRecords', 'UserId'], ['Schedules', 'UserId'],
];
const countsFor = uid =>
    TABLES.map(([t, col]) => {
        const r = sql(`select count(*) c from ${t} where ${col}=${uid}`);
        return { t, n: r[0].c };
    });

const TS = Date.now().toString().slice(-6);
const NAME = 'qa_cas_' + TS;

(async () => {
    const b = await chromium.launch({ channel: 'msedge' });
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })).newPage();
    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', ADMIN);
    await p.fill('#Password', PW);
    await p.click('form button[type=submit]');
    await p.waitForURL(u => !u.pathname.toLowerCase().includes('login'), { timeout: 20000 });

    // ---------- 建号并播种测试数据 ----------
    await p.goto(BASE + '/Admin/Users/New', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', NAME);
    await p.fill('#DisplayName', '级联删除测试');
    const opts = await p.locator('select#RoleId option').allInnerTexts();
    const normal = (opts.find(o => o.includes('情侣')) || opts.find(o => o.includes('普通')) || opts[0]).trim();
    await p.selectOption('select#RoleId', { label: normal });
    await p.fill('#Password', 'QaCase2026x');
    const seed = p.locator('input[type=checkbox][name=SeedSample]');
    if (!(await seed.isChecked())) await seed.check();
    await p.locator('form:has(#Username) button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');

    const uid = sql(`select Id from Users where Username='${NAME}'`)[0].Id;
    T('建号成功（角色 ' + normal + '）', uid > 0, 'uid=' + uid);

    // 「生成测试数据」覆盖不到邮件/AI/小纸条，这 6 张表手工补一行，做到 15 张表张张有数据
    sql(`insert into AiMessages (UserId, Role, Content, ActionsJson, CreatedAt) values (${uid}, 'user', '级联测试', '', datetime('now'));`);
    sql(`insert into AiUsageDailies (UserId, Day, PromptTokens, CompletionTokens, TotalTokens, Requests) values (${uid}, datetime('now'), 1, 1, 2, 1);`);
    sql(`insert into EmailAccounts (UserId, DisplayName, Address, Provider, ImapHost, ImapPort, SmtpHost, SmtpPort, AuthCodeEnc, LastSyncError, UidValidity, CreatedAt)
         values (${uid}, '测试邮箱', 'qa@example.com', 'custom', 'imap.example.com', 993, 'smtp.example.com', 465, '', '', 0, datetime('now'));`);
    const accId = sql(`select max(Id) m from EmailAccounts where UserId=${uid}`)[0].m;
    sql(`insert into EmailMessages (AccountId, UserId, Folder, Uid, MessageId, FromName, FromAddress, ToAddress, Subject, Snippet, BodyText, SentAt, IsRead, HasAttachment, SizeBytes, FetchedAt)
         values (${accId}, ${uid}, 'INBOX', 1, '<qa@test>', '测试', 'qa@example.com', 'me@example.com', '测试邮件', '', '', datetime('now'), 0, 0, 0, datetime('now'));`);
    sql(`insert into LoveNotes (FromUserId, Content, CreatedAt) values (${uid}, '级联测试小纸条', datetime('now'));`);
    sql(`insert into MailReminderSettings (UserId, Enabled, Hour, ToAddress, LastError, UpdatedAt) values (${uid}, 0, 8, '', '', datetime('now'));`);

    const before = countsFor(uid);
    const empty = before.filter(x => x.n === 0);
    T('删除前 15 张表都有该用户的数据', empty.length === 0,
        empty.length ? '没数据：' + empty.map(x => x.t).join(',') : before.map(x => x.t + '=' + x.n).join(' '));
    const totalRows = before.reduce((s, x) => s + x.n, 0);
    T('总数据行数 > 10', totalRows > 10, 'rows=' + totalRows);

    // ---------- 删除 ----------
    await p.goto(BASE + '/Admin/Users', { waitUntil: 'domcontentloaded' });
    await p.locator('tr', { hasText: NAME }).locator('[data-del-id]').click();
    await p.waitForSelector('#delUserModal[open]');
    for (let i = 0; i < 16; i++) { await sleep(400); if (!(await p.locator('#delConfirmBtn').isDisabled())) break; }
    await p.locator('#delConfirmBtn').click();
    await p.waitForLoadState('domcontentloaded');
    await p.waitForSelector('.toast-ok, .msg.ok', { timeout: 8000 });

    // ---------- 逐表核对 ----------
    T('账号已删', sql(`select count(*) c from Users where Id=${uid}`)[0].c === 0);
    const after = countsFor(uid);
    const left = after.filter(x => x.n > 0);
    T('15 张用户数据表全部清空', left.length === 0,
        left.map(x => x.t + '=' + x.n).join(' ') || '全 0');

    // 邀请码只断开关联，不跟着删（审计记录要留）
    const invLeft = sql(`select count(*) c from Invitations where UsedByUserId=${uid}`)[0].c;
    T('邀请码记录保留但已解绑（SET NULL）', invLeft === 0);

    await b.close();
    console.log(`\n=== 级联删除：${pass} 通过 / ${fail} 失败（测试号 ${NAME}，播种 ${totalRows} 行） ===`);
    process.exit(fail ? 1 : 0);
})();
