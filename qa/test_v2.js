// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// test_v2.js — 本批次新增功能专项（不跑全量，只测这次改的东西）
// 覆盖：站点改名/新图标 → 底色系扩容（每套 6 档且色差明显、可持久化）
//       → 首页「一键删除测试数据」（删完永久消失）→ 提醒中心「每日邮件提醒」（保存/预览/发送失败兜底/后台到点）
// 用法：node test_v2.js
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const QA_DIR = 'D:/projects/checkin/qa';
const results = [];
let curSec = '';

function sec(n) { curSec = n; console.log('\n===== ' + n + ' ====='); }
function T(name, cond, extra) {
    const ok = !!cond;
    results.push({ sec: curSec, name, ok, extra: String(extra || '') });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
}
function dbq(sql) {
    try { return JSON.parse(execSync(`"${PY}" "${QA_DIR}/dbq.py"`, { input: sql, encoding: 'utf8' })); }
    catch (e) { return [{ error: String(e) }]; }
}
async function login(page, user, pass) {
    await page.goto(BASE + '/Login');
    await page.fill('#Username', user);
    await page.fill('#Password', pass);
    await page.click('form button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(400);
}

(async () => {
    try { execSync(`"${PY}" "${QA_DIR}/wipe_qa.py"`, { encoding: 'utf8' }); } catch (e) { }
    // 清掉上一轮残留的邮件提醒设置（wipe_qa 只管 QA_ 用户，这里保险起见再清一次孤儿行）
    dbq("delete from MailReminderSettings where UserId not in (select Id from Users)");

    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => d.accept().catch(() => { }));   // 删除测试数据有 confirm()

    try {
        // ================= 1. 改名与图标 =================
        sec('V1 站点改名 + 新图标');
        await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
        const loginTitle = await p.title();
        T('登录页标题为「日常管理」', loginTitle.includes('日常管理'), loginTitle);
        T('登录页不再出现旧名「生活管家」', !(await p.content()).includes('生活管家'));
        const loginLogo = await p.locator('.card img[src*="icons/icon-192"]').count();
        T('登录页显示新图标', loginLogo === 1, String(loginLogo));

        const man = JSON.parse(await (await p.request.get(BASE + '/manifest.json')).text());
        T('manifest.name = 日常管理', man.name === '日常管理', man.name);
        T('manifest.short_name = 日常', man.short_name === '日常', man.short_name);
        const i192 = await p.request.get(BASE + '/icons/icon-192.png');
        const i512 = await p.request.get(BASE + '/icons/icon-512.png');
        const iSvg = await p.request.get(BASE + '/icons/icon.svg');
        T('192/512 图标可访问', i192.status() === 200 && i512.status() === 200, `${i192.status()}/${i512.status()}`);
        T('矢量源图标可访问', iSvg.status() === 200, String(iSvg.status()));
        T('512 图标体积像张真图（>20KB）', Number(i512.headers()['content-length'] || 0) > 20000,
            i512.headers()['content-length']);

        await login(p, ADMIN, PW);
        T('登录成功', !p.url().toLowerCase().includes('login'), p.url());
        const brand = (await p.locator('.topbar .brand').innerText()).trim();
        T('顶栏品牌名为「日常管理」', brand === '日常管理', brand);
        T('顶栏品牌带新图标', await p.locator('.topbar .brand img.logo').count() === 1);
        const homeTitle = await p.title();
        T('工作台标题后缀为新名', homeTitle.includes('日常管理'), homeTitle);

        // ================= 2. 底色系扩容 =================
        sec('V2 底色系（每套 6 档 + 色差明显 + 可持久化）');
        await p.goto(BASE + '/');
        await p.waitForTimeout(300);
        await p.locator('#appearanceBtn').click();
        await p.waitForTimeout(250);

        const themes = ['editorial', 'neumorphism', 'natural', 'macos', 'clay'];
        const themeNames = { editorial: '编辑杂志风', neumorphism: '新拟物派', natural: '自然有机风', macos: 'macOS 毛玻璃', clay: '粘土拟态' };
        for (const th of themes) {
            await p.locator(`.theme-card[data-theme-slug="${th}"]`).click();
            await p.waitForTimeout(220);
            const sw = await p.locator('#toneDots .swatch').count();
            const labels = await p.locator('#toneDots .swatch').evaluateAll(els => els.map(e => e.title));
            T(`${themeNames[th]} 有 6 个底色可选`, sw === 6, `${sw} 档：${labels.join('/')}`);

            // 逐个点一遍，收集 --bg 计算值，验证彼此差异（不是相近色糊成一团）
            const bgs = [];
            for (let i = 0; i < sw; i++) {
                await p.locator('#toneDots .swatch').nth(i).click();
                await p.waitForTimeout(120);
                bgs.push(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()));
            }
            const uniq = new Set(bgs).size;
            T(`${themeNames[th]} 六档底色互不相同`, uniq === 6, `${uniq}/6 distinct`);
        }

        // 新 slug 是否真的被服务端接受（旧白名单会把它打回空值）
        await p.locator('.theme-card[data-theme-slug="editorial"]').click();
        await p.waitForTimeout(200);
        const sageIdx = await p.locator('#toneDots .swatch').evaluateAll(els => els.findIndex(e => e.dataset.tone === 'sage'));
        T('editorial 新增了「鼠尾草」底色', sageIdx >= 0, 'index=' + sageIdx);
        await p.locator('#toneDots .swatch').nth(sageIdx).click();
        await p.waitForTimeout(700);   // 等 syncToServer 落库
        T('切换后 html[data-tone]=sage', await p.evaluate(() => document.documentElement.dataset.tone) === 'sage');
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(500);
        const persisted = await p.evaluate(() => ({
            tone: document.documentElement.dataset.tone,
            bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
        }));
        T('刷新后底色仍为 sage（服务端白名单已放行）', persisted.tone === 'sage', JSON.stringify(persisted));

        // 还原成默认外观，别把演示账号的偏好留成测试值
        dbq("update Users set Theme='editorial', Accent='', Tone='' where Username=ADMIN");
        await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await p.evaluate(() => { try { localStorage.removeItem('theme.tone'); localStorage.removeItem('theme.slug'); localStorage.removeItem('theme.accent'); } catch (e) { } });
        await p.reload({ waitUntil: 'domcontentloaded' });

        // ================= 3. 首页一键删除测试数据 =================
        sec('V3 首页「一键删除测试数据」');
        await p.goto(BASE + '/Admin/Users');
        await p.getByText('新建用户', { exact: false }).first().click();
        await p.waitForSelector('#appModal[open] .modal-body form', { timeout: 5000 });
        await p.waitForTimeout(300);
        await p.fill('#appModal input[name="Username"]', 'QA_V2');
        await p.fill('#appModal input[name="DisplayName"]', '新版测试');
        await p.fill('#appModal input[name="Password"]', 'Qa#2026Tmp');
        await p.selectOption('#appModal select[name="RoleId"]', '2');   // 普通用户（有 email.use / reminders.use）
        T('建号时「同时生成测试数据」默认勾选',
            await p.locator('#appModal input[type=checkbox][name="SeedSample"]').isChecked() === true);
        await p.locator('#appModal .modal-body button[type=submit]').first().click();
        await p.waitForTimeout(1200);
        const u = dbq("select Id from Users where Username='QA_V2'");
        T('QA_V2 建号成功', u.length === 1, JSON.stringify(u));
        const uid = u[0].Id;

        const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
        const p2 = await ctx2.newPage();
        const errs2 = [];
        p2.on('pageerror', e => errs2.push(e.message));
        p2.on('dialog', d => d.accept().catch(() => { }));

        await login(p2, 'QA_V2', 'Qa#2026Tmp');
        await p2.fill('input[name="OldPassword"]', 'Qa#2026Tmp');
        await p2.fill('input[name="NewPassword"]', 'Qa#2026Aa');
        await p2.fill('input[name="ConfirmPassword"]', 'Qa#2026Aa');
        await p2.locator('form button[type=submit]:has-text("设置")').click();
        await p2.waitForTimeout(900);
        await p2.goto(BASE + '/');
        await p2.waitForTimeout(400);

        T('工作台出现测试数据提示卡', await p2.locator('.sample-banner').count() === 1);
        const bannerText = await p2.locator('.sample-banner').innerText().catch(() => '');
        T('提示卡写明条数与「测试数据」', /30\s*条/.test(bannerText) && bannerText.includes('测试数据'), bannerText.replace(/\s+/g, ' ').slice(0, 60));
        T('提示卡有删除按钮', await p2.locator('.sample-banner button[type=submit]').count() === 1);

        await p2.locator('.sample-banner button[type=submit]').click();
        const gotToast = await p2.waitForSelector('.toast-ok, .msg.ok', { timeout: 6000 }).then(() => true).catch(() => false);
        T('删除有成功提示', gotToast,
            (await p2.locator('.toast-ok, .msg.ok').first().textContent().catch(() => '') || '').trim());
        await p2.waitForTimeout(600);
        T('删除后提示卡消失', await p2.locator('.sample-banner').count() === 0);
        const left = dbq(`select (select count(*) from Schedules where UserId=${uid}) s,
                                   (select count(*) from Memos where UserId=${uid}) m,
                                   (select count(*) from HabitCheckins where UserId=${uid}) hc,
                                   (select count(*) from Expenses where UserId=${uid}) e`);
        T('测试数据已清空（日程/备忘/打卡/记账均为 0）',
            left[0].s === 0 && left[0].m === 0 && left[0].hc === 0 && left[0].e === 0, JSON.stringify(left[0]));
        const flag = dbq(`select SamplePromptDismissed d from Users where Id=${uid}`);
        T('已标记 SamplePromptDismissed=1', flag[0].d === 1, JSON.stringify(flag[0]));

        await p2.reload({ waitUntil: 'domcontentloaded' });
        await p2.waitForTimeout(400);
        T('刷新后仍不出现（永久消失）', await p2.locator('.sample-banner').count() === 0);

        // 再去个人主页重新生成测试数据 —— 提示卡依然不该回来
        await p2.goto(BASE + '/Me');
        await p2.waitForTimeout(300);
        await p2.locator('button:has-text("生成测试数据")').click();
        await p2.waitForTimeout(1300);
        await p2.goto(BASE + '/');
        await p2.waitForTimeout(400);
        T('重新生成测试数据后提示卡也不回来', await p2.locator('.sample-banner').count() === 0);
        T('（此时账号里确实又有测试数据）',
            (dbq(`select count(*) c from Memos where UserId=${uid} and Title like '【测试】%'`)[0].c || 0) === 3);

        // ================= 4. 每日邮件提醒 =================
        sec('V4 提醒中心 · 每日邮件提醒');
        await p2.goto(BASE + '/Reminders');
        await p2.waitForTimeout(400);
        T('提醒页出现「每日邮件提醒」卡片', await p2.locator('#mailReminder').count() === 1);
        T('未绑定邮箱时给出去绑定的引导', await p2.locator('#mailReminder a[href="/Email/New"]').count() === 1);

        // 造一个「假 SMTP」账号：验证保存/预览/失败兜底，且绝不去打扰真实邮箱
        dbq(`insert into EmailAccounts (UserId,DisplayName,Address,Provider,ImapHost,ImapPort,SmtpHost,SmtpPort,AuthCodeEnc,LastSyncAt,LastSyncError,UidValidity,CreatedAt)
             values (${uid},'假邮箱','qa_v2@example.com','custom','127.0.0.1',1,'127.0.0.1',1,'not-a-real-cipher',NULL,'',0,'2026-10-19 00:00:00')`);
        const acc = dbq(`select Id from EmailAccounts where UserId=${uid}`);
        T('测试用邮箱账号已就位', acc.length === 1, JSON.stringify(acc));

        await p2.goto(BASE + '/Reminders');
        await p2.waitForTimeout(400);
        T('有账号后出现设置表单', await p2.locator('#mailReminder form').count() === 1);
        T('发送时间可选 24 个整点', await p2.locator('#mailReminder select[name="MailHour"] option').count() === 24);
        T('发信邮箱下拉只有一个账号', await p2.locator('#mailReminder select[name="MailAccountId"] option').count() === 1);

        await p2.locator('#mailReminder input[type=checkbox][name="MailEnabled"]').check();
        await p2.selectOption('#mailReminder select[name="MailHour"]', '9');
        await p2.fill('#mailReminder input[name="MailToAddress"]', '');
        await p2.locator('#mailReminder button:has-text("保存设置")').click();
        await p2.waitForTimeout(1200);
        T('保存成功提示', await p2.locator('.toast-ok, .msg.ok').count() > 0,
            (await p2.locator('.toast-ok, .msg.ok').first().textContent().catch(() => '') || '').trim());
        const setting = dbq(`select Enabled,Hour,AccountId,ToAddress,LastSentDate,LastError from MailReminderSettings where UserId=${uid}`);
        T('设置已落库（开启/09 点/绑定账号）',
            setting.length === 1 && setting[0].Enabled === 1 && setting[0].Hour === 9 && setting[0].AccountId === acc[0].Id,
            JSON.stringify(setting[0]));

        // 收件邮箱格式校验
        await p2.fill('#mailReminder input[name="MailToAddress"]', 'not-an-email');
        await p2.locator('#mailReminder button:has-text("保存设置")').click();
        await p2.waitForTimeout(1000);
        T('收件邮箱格式非法被拒', await p2.locator('.toast-err, .msg.error').count() > 0,
            (await p2.locator('.toast-err, .msg.error').first().textContent().catch(() => '') || '').trim());

        // 预览：应该拿到服务端生成的邮件正文
        await p2.locator('#mailReminder button:has-text("预览这封邮件")').click();
        await p2.waitForTimeout(1200);
        const pv = await p2.locator('#mailPreview').innerText().catch(() => '');
        T('预览面板展开', await p2.locator('#mailPreview').isVisible());
        T('预览含主题行（品牌名已更新）', pv.includes('主题：日常管理'), pv.split('\n')[0]);
        T('预览含打开网站链接', pv.includes('https://example.com'), pv.slice(-80).replace(/\n/g, ' '));

        // 发送测试：假 SMTP 必然失败，要求「优雅失败」而不是 500
        await p2.goto(BASE + '/Reminders');
        await p2.waitForTimeout(300);
        await p2.locator('#mailReminder button:has-text("发送测试邮件")').click();
        // Toast 只活 3.8 秒，固定 sleep 会错过；等它出现后立刻读文案
        const gotErr = await p2.waitForSelector('.toast-err, .msg.error', { timeout: 15000 }).then(() => true).catch(() => false);
        const errText = (await p2.locator('.toast-err, .msg.error').first().textContent().catch(() => '') || '').trim();
        T('发送测试失败时页面不崩（仍能拿到提醒页）', await p2.locator('#mailReminder').count() === 1, p2.url());
        T('失败原因以提示形式给出', gotErr && errText.length > 0, errText.slice(0, 70));

        // 后台定时器：把设置改成「当前整点 + 今天还没发」，等它自动尝试一次并记下失败原因
        sec('V5 后台定时器到点发送');
        const hour = Number(execSync(`"${PY}" -c "import datetime;print(datetime.datetime.now().hour)"`, { encoding: 'utf8' }).trim());
        dbq(`update MailReminderSettings set Hour=${hour}, LastSentDate=null, LastError='' where UserId=${uid}`);
        let ticked = null;
        for (let i = 0; i < 16; i++) {
            await p2.waitForTimeout(5000);
            const row = dbq(`select LastError,LastSentDate from MailReminderSettings where UserId=${uid}`);
            if (row[0] && (row[0].LastError || row[0].LastSentDate)) { ticked = row[0]; break; }
        }
        T('后台服务在整点内自动触发（失败原因已记录）', !!ticked && String(ticked.LastError || '').length > 0,
            JSON.stringify(ticked));

        // 关闭提醒，别留着每天发
        dbq(`update MailReminderSettings set Enabled=0, LastSentDate=null, LastError='' where UserId=${uid}`);
        sec('V6 无 JS 报错');
        T('管理会话无 pageerror', errs.length === 0, errs.slice(0, 3).join(' | '));
        T('新账号会话无 pageerror', errs2.length === 0, errs2.slice(0, 3).join(' | '));

        await p2.goto(BASE + '/Reminders');
        await p2.waitForTimeout(400);
        await p2.screenshot({ path: `${QA_DIR}/shot_mail.png` });
        await p2.goto(BASE + '/');
        await p2.waitForTimeout(300);

    } catch (e) {
        results.push({ sec: curSec, name: '【套件异常中断】', ok: false, extra: String(e.message || e) });
        console.log('CRASH in ' + curSec + ': ' + (e.message || e));
    }

    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    fs.writeFileSync(`${QA_DIR}/report-v2.json`, JSON.stringify({ time: new Date().toISOString(), pass, fail, results }, null, 1), 'utf8');
    console.log(`\n== 新功能专项: ${pass} PASS / ${fail} FAIL ==`);
    if (fail) results.filter(r => !r.ok).forEach(r => console.log(` [${r.sec}] ${r.name} ${r.extra}`));
    await browser.close();
    process.exit(0);
})();
