// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// qa_email.js — M7 邮件模块专项测试（绑定/加密/收件箱/阅读/同步容错/越权/级联删除）
// 用法: NODE_PATH=... node qa_email.js   → 输出 report-email.json + console 明细
// 基建约定同 qa_full.js：playwright 用系统 Edge；toast 断言用 hasText 防竞态；
// .msg 横幅被 modal.js 转 Toast；直接 goto URL 不走弹窗（modal.js 只拦链接点击）。
const QA = require('./_env');
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const QA_DIR = 'D:/projects/checkin/qa';
const OUT = 'D:/projects/checkin/_shots';
const TAG = 'MAILQ';                      // 标记词（防撞演示数据）
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

async function login(page, user, pass) {
    await page.goto(BASE + '/Login');
    await page.fill('#Username', user);
    await page.fill('#Password', pass);
    await page.click('#loginForm button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(300);
}

// 等 toast 出现并返回其文本（hasText 断言防文本竞态）
async function toastText(page, timeout = 8000) {
    const t = page.locator('.toast').first();
    await t.waitFor({ state: 'visible', timeout }).catch(() => {});
    return (await t.textContent().catch(() => '')) || '';
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => d.accept().catch(() => {}));   // 删除表单有 confirm()

    try {
        // ================= S1 绑定账号：平台预设 + 授权码加密 =================
        sec('S1 绑定账号（预设自动填充 + 授权码加密）');
        await login(page, QA.USER, QA.PASS);
        T('admin 登录成功', !page.url().includes('Login'), page.url());

        await page.goto(BASE + '/Email/New');
        await page.waitForLoadState('networkidle');
        // 平台预设自动填充：选 163 → imap.163.com / 993 / smtp.163.com
        await page.selectOption('#providerSel', '163');
        await page.waitForTimeout(150);
        const imapH = await page.inputValue('#imapHost');
        const imapP = await page.inputValue('#imapPort');
        const smtpH = await page.inputValue('#smtpHost');
        T('选 163 自动填充 IMAP 服务器', imapH === 'imap.163.com', imapH);
        T('选 163 自动填充端口', imapP === '993' && smtpH === 'smtp.163.com', `imapP=${imapP} smtpH=${smtpH}`);

        await page.fill('input[name="DisplayName"]', TAG + '-账号一');
        await page.fill('input[name="Address"]', 'qa1@example.com');
        await page.fill('input[name="AuthCode"]', 'SECRET-CODE-123');
        await page.locator('button:has-text("保存")').click();   // 不能用裸 button[type=submit]（会命中侧栏退出表单）
        await page.waitForTimeout(900);
        T('绑定后跳转账号列表', page.url().includes('/Email/Accounts'), page.url().replace(BASE, ''));

        let acc1 = dbq(`select * from EmailAccounts where DisplayName='${TAG}-账号一'`);
        T('账号一落库', acc1.length === 1 && acc1[0].Provider === '163' && acc1[0].ImapHost === 'imap.163.com', JSON.stringify(acc1[0] || {}));
        const enc1 = acc1.length ? acc1[0].AuthCodeEnc : '';
        T('授权码密文存储（不含明文）', enc1.length > 20 && enc1 !== 'SECRET-CODE-123' && !enc1.includes('SECRET-CODE'), `enc=${enc1.slice(0, 24)}…`);
        const id1 = acc1[0].Id;

        // ================= S2 编辑：授权码留空 = 不修改 =================
        sec('S2 编辑账号（授权码留空不改）');
        await page.goto(BASE + '/Email/Edit/' + id1);
        await page.waitForLoadState('networkidle');
        const ph = await page.getAttribute('input[name="AuthCode"]', 'placeholder');
        T('授权码框提示留空不修改', (ph || '').includes('留空'), ph);
        await page.fill('input[name="DisplayName"]', TAG + '-账号一改');
        await page.fill('input[name="AuthCode"]', '');   // 留空
        await page.locator('button:has-text("保存")').click();
        await page.waitForTimeout(900);
        let acc1b = dbq(`select DisplayName,AuthCodeEnc from EmailAccounts where Id=${id1}`);
        T('改名落库', acc1b[0].DisplayName === TAG + '-账号一改', acc1b[0].DisplayName);
        T('留空后授权码密文不变', acc1b[0].AuthCodeEnc === enc1);

        // ================= S3 账号二 + 同步容错 =================
        sec('S3 同步容错（无效服务器不崩）');
        await page.goto(BASE + '/Email/New');
        await page.waitForLoadState('networkidle');
        await page.fill('input[name="DisplayName"]', TAG + '-账号二');
        await page.fill('input[name="Address"]', 'qa2@example.com');
        await page.selectOption('#providerSel', 'custom');
        await page.fill('input[name="AuthCode"]', 'SECRET-CODE-456');
        await page.fill('input[name="ImapHost"]', 'imap.invalid.test');
        await page.fill('input[name="ImapPort"]', '993');
        await page.locator('button:has-text("保存")').click();
        await page.waitForTimeout(900);
        let acc2 = dbq(`select * from EmailAccounts where DisplayName='${TAG}-账号二'`);
        T('账号二（custom）落库', acc2.length === 1 && acc2[0].ImapHost === 'imap.invalid.test', JSON.stringify({ p: acc2[0] && acc2[0].Provider, h: acc2[0] && acc2[0].ImapHost }));
        const id2 = acc2[0].Id;

        // 点账号二的「同步」按钮（form 带 hidden id）→ DNS 快速失败，页面不崩
        await page.goto(BASE + '/Email/Accounts');
        await page.waitForLoadState('networkidle');
        const syncBtn2 = page.locator(`form:has(input[name="id"][value="${id2}"]) button:has-text("同步")`).first();
        await syncBtn2.click();
        await page.waitForTimeout(3000);   // DNS 失败通常 <2s；服务端 15s 超时兜底
        await page.waitForLoadState('networkidle').catch(() => {});
        T('同步失败后页面存活', page.url().includes('/Email/Accounts'), page.url().replace(BASE, ''));
        let acc2b = dbq(`select LastSyncError from EmailAccounts where Id=${id2}`);
        T('LastSyncError 落库非空', (acc2b[0].LastSyncError || '').length > 0, (acc2b[0].LastSyncError || '').slice(0, 40));
        const errShown = await page.locator(`.row-item:has-text("${TAG}-账号二")`).textContent();
        T('账号列表展示同步错误', /网络不通|无响应|授权码不正确|连接失败|解密失败/.test(errShown || ''), (errShown || '').replace(/\s+/g, ' ').slice(0, 80));

        // ================= S4 seed 信件 + 收件箱 UI =================
        sec('S4 收件箱（列表/未读/搜索/筛选/附件）');
        // seed 3 封：账号一 2 封（1 未读 1 已读），账号二 1 封（未读+附件）
        dbq(`insert into EmailMessages (AccountId,UserId,Folder,Uid,MessageId,FromName,FromAddress,ToAddress,Subject,Snippet,BodyText,SentAt,IsRead,HasAttachment,SizeBytes,FetchedAt) values (${id1},(select Id from Users where Username=ADMIN),'INBOX',101,'<m101@qa>','张三','zhangsan@example.com','qa1@example.com','${TAG}-季度报告','这是季度报告的摘要文字…','季度报告正文：本季度完成 3 个项目，营收增长 12%。','2026-10-18 10:00:00',0,0,2048,'2026-10-18 10:05:00')`);
        dbq(`insert into EmailMessages (AccountId,UserId,Folder,Uid,MessageId,FromName,FromAddress,ToAddress,Subject,Snippet,BodyText,SentAt,IsRead,HasAttachment,SizeBytes,FetchedAt) values (${id1},(select Id from Users where Username=ADMIN),'INBOX',102,'<m102@qa>','李四','lisi@example.com','qa1@example.com','${TAG}-会议纪要','周一会议的要点摘要…','会议纪要正文：下周一 10 点例会。','2026-10-17 15:30:00',1,0,1024,'2026-10-17 15:35:00')`);
        dbq(`insert into EmailMessages (AccountId,UserId,Folder,Uid,MessageId,FromName,FromAddress,ToAddress,Subject,Snippet,BodyText,SentAt,IsRead,HasAttachment,SizeBytes,FetchedAt) values (${id2},(select Id from Users where Username=ADMIN),'INBOX',201,'<m201@qa>','王五','wangwu@example.com','qa2@example.com','${TAG}-发票附件','发票已开具，见附件。','发票正文：金额 ¥300。','2026-10-16 09:00:00',0,1,5120,'2026-10-16 09:05:00')`);
        const seeds = dbq(`select count(*) c from EmailMessages where Subject like '${TAG}%'`);
        T('seed 3 封信落库', seeds[0].c === 3, 'c=' + seeds[0].c);

        await page.goto(BASE + '/Email');
        await page.waitForLoadState('networkidle');
        const rows = await page.locator('.mail-row').count();
        const unread = await page.locator('.mail-row.unread').count();
        const read = await page.locator('.mail-row.read').count();
        T('收件箱 3 行', rows === 3, 'rows=' + rows);
        T('未读 2 / 已读 1 样式', unread === 2 && read === 1, `unread=${unread} read=${read}`);
        const hint = await page.locator('.hint').first().textContent();
        T('未读计数提示', /2/.test(hint || ''), (hint || '').replace(/\s+/g, ' ').slice(0, 60));
        const attRow = await page.locator('.mail-row:has(span[title="带附件"])').count();   // Icons.Svg 不带 lucide 类名，用包裹 span 定位
        T('附件行显示回形针图标', attRow === 1, 'attRows=' + attRow);

        // 搜索过滤（纯前端）：搜主题词 → 1 行；搜不存在 → 空态
        await page.fill('#mailSearch', '季度报告');
        await page.waitForTimeout(250);
        const vis1 = await page.locator('.mail-row:visible').count();
        T('搜索「季度报告」只剩 1 行', vis1 === 1, 'vis=' + vis1);
        await page.fill('#mailSearch', 'zzzzz不存在');
        await page.waitForTimeout(250);
        T('无匹配显示空态', await page.locator('#mailEmpty').isVisible());
        await page.fill('#mailSearch', '');
        await page.waitForTimeout(250);

        // 账号筛选：账号一 → 2 行
        await page.selectOption('#mailAccountFilter', String(id1));
        await page.waitForTimeout(250);
        const vis2 = await page.locator('.mail-row:visible').count();
        T('按账号一筛选剩 2 行', vis2 === 2, 'vis=' + vis2);
        await page.selectOption('#mailAccountFilter', '');
        await page.waitForTimeout(250);

        // ================= S5 阅读页（标已读/正文/标未读） =================
        sec('S5 阅读页（打开标已读 + 标记未读）');
        await page.locator(`.mail-row:has-text("${TAG}-季度报告")`).first().click();
        await page.waitForLoadState('networkidle');
        T('进入阅读页', /\/Email\/Read\/\d+/.test(page.url()), page.url().replace(BASE, ''));
        const bodyTxt = await page.locator('.mail-body').textContent();
        T('正文展示（缓存直读）', (bodyTxt || '').includes('季度报告正文'), (bodyTxt || '').slice(0, 40));
        const metaTxt = await page.locator('.mail-meta').textContent();
        T('信头展示发件人/账号', (metaTxt || '').includes('张三') && (metaTxt || '').includes(TAG + '-账号一改'), (metaTxt || '').replace(/\s+/g, ' ').slice(0, 60));
        let m1 = dbq(`select IsRead from EmailMessages where Subject='${TAG}-季度报告'`);
        T('打开即标已读落库', m1[0].IsRead === 1, 'IsRead=' + m1[0].IsRead);

        await page.locator('button:has-text("标记未读")').click();
        await page.waitForTimeout(900);
        T('标记未读后回收件箱', page.url().includes('/Email') && !page.url().includes('Read'), page.url().replace(BASE, ''));
        m1 = dbq(`select IsRead from EmailMessages where Subject='${TAG}-季度报告'`);
        T('标记未读落库', m1[0].IsRead === 0, 'IsRead=' + m1[0].IsRead);
        const unread2 = await page.locator('.mail-row.unread').count();
        T('未读数恢复 2', unread2 === 2, 'unread=' + unread2);

        // ================= S6 越权与数据隔离 =================
        sec('S6 越权（读他人信/账号 404）');
        // 造假用户 QA_EVIL 及其账号、信（不登录，只测围栏）
        dbq(`insert into Users (Username,PasswordHash,DisplayName,RoleId,Theme,Accent,IsActive,CreatedAt) values ('QA_EVIL','x','邪恶用户',2,'editorial','',1,'2026-10-18 08:00:00')`);
        const evilU = dbq("select Id from Users where Username='QA_EVIL'")[0].Id;
        dbq(`insert into EmailAccounts (UserId,DisplayName,Address,Provider,ImapHost,ImapPort,SmtpHost,SmtpPort,AuthCodeEnc,LastSyncError,UidValidity,CreatedAt) values (${evilU},'QA_EVIL账号','evil@example.com','custom','imap.invalid.test',993,'',465,'enc','',0,'2026-10-18 08:00:00')`);
        const evilAcc = dbq(`select Id from EmailAccounts where UserId=${evilU}`)[0].Id;
        dbq(`insert into EmailMessages (AccountId,UserId,Folder,Uid,MessageId,FromName,FromAddress,ToAddress,Subject,Snippet,BodyText,SentAt,IsRead,HasAttachment,SizeBytes,FetchedAt) values (${evilAcc},${evilU},'INBOX',1,'<e1@qa>','黑客','h@evil.com','evil@example.com','${TAG}-他人密信','x','秘密','2026-10-18 08:00:00',0,0,100,'2026-10-18 08:00:00')`);
        const evilMsg = dbq(`select Id from EmailMessages where AccountId=${evilAcc}`)[0].Id;

        const r1 = await ctx.request.get(BASE + '/Email/Read/' + evilMsg, { maxRedirects: 0 }).catch(() => null);
        T('admin 读 QA_EVIL 信 → 404', r1 && r1.status() === 404, r1 && r1.status());
        const r2 = await ctx.request.get(BASE + '/Email/Edit/' + evilAcc, { maxRedirects: 0 }).catch(() => null);
        T('admin 打开 QA_EVIL 账号 → 404', r2 && r2.status() === 404, r2 && r2.status());
        const r3 = await ctx.request.post(BASE + '/Email/Read/' + evilMsg + '?handler=Unread', {
            form: { id: evilMsg }, maxRedirects: 0
        }).catch(() => null);
        T('admin POST 篡改他人信被拒(4xx)', r3 && r3.status() >= 400 && r3.status() < 500, r3 && r3.status());
        // 收件箱不显示他人数据
        await page.goto(BASE + '/Email');
        await page.waitForLoadState('networkidle');
        const seesEvil = await page.getByText(TAG + '-他人密信').count();
        T('收件箱不见他人信', seesEvil === 0, 'seesEvil=' + seesEvil);

        // ================= S7 删除账号级联 =================
        sec('S7 删除账号（缓存信件级联）');
        await page.goto(BASE + '/Email/Edit/' + id2);
        await page.waitForLoadState('networkidle');
        await page.locator('button:has-text("删除此账号")').click();
        await page.waitForTimeout(900);
        T('删除后回账号列表', page.url().includes('/Email/Accounts'), page.url().replace(BASE, ''));
        T('账号二删除落库', dbq(`select Id from EmailAccounts where Id=${id2}`).length === 0);
        T('缓存信件级联删除', dbq(`select Id from EmailMessages where AccountId=${id2}`).length === 0);

        // ================= S8 弹窗冒烟（modal.js 拦 /New 链接） =================
        sec('S8 绑定入口弹窗冒烟');
        await page.locator('a:has-text("绑定新邮箱")').first().click();
        await page.waitForSelector('#appModal[open] .modal-body form', { timeout: 5000 });
        T('点「绑定新邮箱」弹出表单弹窗', await page.locator('#appModal[open] input[name="Address"]').count() === 1);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        // ================= S9 截图目检（PC + 手机） =================
        sec('S9 截图目检');
        // PC
        await page.goto(BASE + '/Email');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/mail-inbox-pc.png`, fullPage: true });
        const readId = dbq(`select Id from EmailMessages where Subject='${TAG}-会议纪要'`)[0].Id;
        await page.goto(BASE + '/Email/Read/' + readId);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/mail-read-pc.png`, fullPage: true });
        await page.goto(BASE + '/Email/Accounts');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/mail-accounts-pc.png`, fullPage: true });
        await page.goto(BASE + '/Email/New');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/mail-new-pc.png`, fullPage: true });

        // 手机 390
        const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const pM = await ctxM.newPage();
        pM.on('dialog', d => d.accept().catch(() => {}));
        await login(pM, QA.USER, QA.PASS);
        await pM.goto(BASE + '/Email');
        await pM.waitForLoadState('networkidle');
        await pM.waitForTimeout(300);
        await pM.screenshot({ path: `${OUT}/mail-inbox-m.png`, fullPage: true });
        await pM.goto(BASE + '/Email/Read/' + readId);
        await pM.waitForLoadState('networkidle');
        await pM.waitForTimeout(300);
        await pM.screenshot({ path: `${OUT}/mail-read-m.png`, fullPage: true });
        await pM.goto(BASE + '/Email/Accounts');
        await pM.waitForLoadState('networkidle');
        await pM.waitForTimeout(300);
        await pM.screenshot({ path: `${OUT}/mail-accounts-m.png`, fullPage: true });
        await ctxM.close();
        T('截图完成 7 张', fs.existsSync(`${OUT}/mail-inbox-pc.png`) && fs.existsSync(`${OUT}/mail-accounts-m.png`));

        T('全程无页面 JS 错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

        // 清理：admin 的测试账号 + QA_EVIL（注意 dbq 的 sqlite3 不开外键，须按 信→账号→用户 顺序手删）
        dbq(`delete from EmailMessages where UserId=${evilU}`);
        dbq(`delete from EmailAccounts where UserId=${evilU}`);
        dbq(`delete from Users where Username='QA_EVIL'`);
        dbq(`delete from EmailMessages where AccountId in (select Id from EmailAccounts where DisplayName like '${TAG}%')`);
        dbq(`delete from EmailAccounts where DisplayName like '${TAG}%'`);
        const leftAcc = dbq(`select count(*) c from EmailAccounts where DisplayName like '${TAG}%'`);
        T('测试数据清理干净', leftAcc[0].c === 0, 'left=' + leftAcc[0].c);
    } catch (e) {
        T('脚本异常', false, String(e).split('\n')[0]);
    }

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    fs.writeFileSync(`${QA_DIR}/report-email.json`, JSON.stringify({ pass, fail, results }, null, 2));
    console.log(`\n===== 邮件模块专项: ${pass} PASS / ${fail} FAIL =====`);
    process.exit(fail ? 1 : 0);
})();
