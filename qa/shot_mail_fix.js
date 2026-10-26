// shot_mail_fix.js — 手机端阅读页标题竖排修复的截图复验（一次性）
const QA = require('./_env');
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const BASE = 'http://localhost:5188';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const QA_DIR = 'D:/projects/checkin/qa';
const OUT = 'D:/projects/checkin/_shots';

function dbq(sql) {
    try { return JSON.parse(execSync(`"${PY}" "${QA_DIR}/dbq.py"`, { input: sql, encoding: 'utf8' })); }
    catch (e) { return [{ error: String(e) }]; }
}

(async () => {
    // seed：admin 一个账号 + 一封长标题信（复现竖排问题的标题）
    dbq(`insert into EmailAccounts (UserId,DisplayName,Address,Provider,ImapHost,ImapPort,SmtpHost,SmtpPort,AuthCodeEnc,LastSyncError,UidValidity,CreatedAt) values (1,'FIX-账号','fix@example.com','custom','imap.invalid.test',993,'',465,'enc','',0,'2026-10-18 08:00:00')`);
    const acc = dbq(`select Id from EmailAccounts where DisplayName='FIX-账号'`)[0].Id;
    dbq(`insert into EmailMessages (AccountId,UserId,Folder,Uid,MessageId,FromName,FromAddress,ToAddress,Subject,Snippet,BodyText,SentAt,IsRead,HasAttachment,SizeBytes,FetchedAt) values (${acc},1,'INBOX',1,'<f1@qa>','张三','z@e.com','fix@example.com','MAILQ-季度报告与年度总结','x','正文内容示例。','2026-10-18 10:00:00',0,0,100,'2026-10-18 10:05:00')`);
    const msg = dbq(`select Id from EmailMessages where AccountId=${acc}`)[0].Id;

    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/Login');
    await page.fill('#Username', QA.USER);
    await page.fill('#Password', QA.PASS);
    await page.click('#loginForm button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.goto(BASE + '/Email/Read/' + msg);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/mail-read-m-fix.png`, fullPage: true });

    // 清理（信→账号）
    dbq(`delete from EmailMessages where AccountId=${acc}`);
    dbq(`delete from EmailAccounts where Id=${acc}`);
    console.log('shot done: mail-read-m-fix.png');
    await browser.close();
})();
