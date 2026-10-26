// test_me.js — 个人主页 + 测试数据 专项验收
// 覆盖：顶栏/底栏入口 → 名片与数据概览 → 资料编辑（含邮箱校验）→ 建号自动播种测试数据
//       → 一键清除 / 再生成（幂等）→ 在个人主页改密码后用新密码登录
// 用法：node test_me.js   （前置：站点跑在 5188，已执行 wipe_qa.py）
const QA = require('./_env');
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
// 读「我的数据」格子 → { 日程: 3, ... }
async function readStats(page) {
    return await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('.me-stat').forEach(a => {
            const l = a.querySelector('.me-stat-label');
            const n = a.querySelector('.me-stat-num');
            if (l && n) out[l.textContent.trim()] = parseInt(n.textContent.trim(), 10);
        });
        return out;
    });
}
async function sampleCount(page) {
    const t = await page.locator('.me-sample .chip').first().textContent().catch(() => '');
    const m = (t || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
}

(async () => {
    // 开跑先清场：上轮残留的 QA_ME 会让建号/登录断言全歪
    try { execSync(`"${PY}" "${QA_DIR}/wipe_qa.py"`, { encoding: 'utf8' }); } catch (e) { }
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctxL = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const ctxU = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pL = await ctxL.newPage(), pU = await ctxU.newPage();
    const errs = [];
    for (const p of [pL, pU]) {
        p.on('pageerror', e => errs.push(e.message));
        p.on('dialog', d => d.accept().catch(() => { }));   // 清除测试数据有 confirm()
    }

    try {
        // ---------- 1. 管理员视角：入口与名片 ----------
        sec('M1 入口与名片');
        await login(pL, QA.USER, QA.PASS);
        T('admin 登录成功', !pL.url().toLowerCase().includes('login'), pL.url());

        const chipHref = await pL.locator('.user-chip').first().getAttribute('href');
        T('顶栏用户名是指向 /Me 的链接', chipHref === '/Me', String(chipHref));
        await pL.locator('.user-chip').first().click();
        await pL.waitForLoadState('networkidle').catch(() => { });
        await pL.waitForTimeout(400);
        T('点用户名进入个人主页', pL.url().endsWith('/Me'), pL.url());

        T('名片头像渲染', await pL.locator('.me-avatar').count() === 1);
        const meName = (await pL.locator('.me-name').textContent() || '').trim();
        T('名片显示昵称', meName.length > 0, meName);
        T('名片显示角色 chip', await pL.locator('.me-hero .chip').count() === 1);
        T('侧栏底部有「我的」入口（底栏已移除）',
            await pL.locator('.sidebar-foot a[href="/Me"]').count() === 1);

        const stats = await readStats(pL);
        T('我的数据格子渲染 ≥ 8 个', Object.keys(stats).length >= 8, JSON.stringify(stats));
        T('管理员有经期格子（情侣角色才有的权限）', stats['经期'] !== undefined, JSON.stringify(stats));
        T('登录名只读（不可改）', await pL.locator('.me-grid input[disabled]').count() >= 1);

        // ---------- 2. 资料编辑 ----------
        sec('M2 资料编辑');
        const emailInput = pL.locator('input[name="Email"]');
        const signInput = pL.locator('textarea[name="Signature"]');
        await emailInput.fill('not-an-email');
        await pL.locator('form[action*="Profile"], form[action*="handler=Profile"]').first()
            .locator('button[type=submit]').click();
        await pL.waitForTimeout(900);
        T('邮箱格式非法被拒', await pL.locator('.toast-err, .msg.error').count() > 0,
            (await pL.locator('.toast-err, .msg.error').first().textContent().catch(() => '') || '').trim());

        // admin 是演示账号：测完把邮箱/签名还原成空，别把演示数据搞脏
        await pL.goto(BASE + '/Me');
        await pL.waitForTimeout(300);
        const oldSign = await pL.locator('textarea[name="Signature"]').inputValue();
        const oldMail = await pL.locator('input[name="Email"]').inputValue();
        T('资料区块当前值为空（演示账号初始状态）', oldSign === '' && oldMail === '', `mail=${oldMail} sign=${oldSign}`);

        // ---------- 3. 新建账号自动播种测试数据 ----------
        sec('M3 建号自动播种（默认勾选）');
        await pL.goto(BASE + '/Admin/Users');
        await pL.getByText('新建用户', { exact: false }).first().click();
        await pL.waitForSelector('#appModal[open] .modal-body form', { timeout: 5000 });
        await pL.waitForTimeout(300);
        const seedChecked = await pL.locator('#appModal input[type=checkbox][name="SeedSample"]').isChecked();
        T('「同时生成测试数据」默认勾选', seedChecked === true);
        await pL.fill('#appModal input[name="Username"]', 'QA_ME');
        await pL.fill('#appModal input[name="DisplayName"]', '主页测试');
        await pL.fill('#appModal input[name="Password"]', 'Qa#2026Tmp');
        await pL.selectOption('#appModal select[name="RoleId"]', '2');   // 普通用户（无经期）
        await pL.locator('#appModal .modal-body button[type=submit]').first().click();
        await pL.waitForTimeout(1200);

        const u = dbq("select Id,RoleId,Email,Signature from Users where Username='QA_ME'");
        T('QA_ME 建号落库', u.length === 1 && u[0].RoleId === 2, JSON.stringify(u));
        const uid = u[0].Id;
        const seeded = dbq(`select
            (select count(*) from Schedules where UserId=${uid}) s,
            (select count(*) from Memos where UserId=${uid}) m,
            (select count(*) from Habits where UserId=${uid}) h,
            (select count(*) from HabitCheckins where UserId=${uid}) hc,
            (select count(*) from Courses where UserId=${uid}) c,
            (select count(*) from Anniversaries where UserId=${uid}) a,
            (select count(*) from Expenses where UserId=${uid}) e,
            (select count(*) from BoardMessages where UserId=${uid}) b`);
        T('建号即播种：日程/备忘/习惯/课程/纪念日/记账/留言 各 3 条',
            seeded.length === 1 && seeded[0].s === 3 && seeded[0].m === 3 && seeded[0].h === 3
            && seeded[0].c === 3 && seeded[0].a === 3 && seeded[0].e === 3 && seeded[0].b === 3,
            JSON.stringify(seeded[0]));
        T('习惯各打卡 3 天（共 9 条）', seeded[0].hc === 9, String(seeded[0].hc));
        const mark = dbq(`select count(*) c from Memos where UserId=${uid} and Title like '【测试】%'`);
        T('测试数据带「【测试】」前缀', mark[0].c === 3, JSON.stringify(mark));
        const noPeriod = dbq(`select count(*) c from PeriodRecords where UserId=${uid}`);
        T('无经期权限的账号不播种经期记录', noPeriod[0].c === 0, String(noPeriod[0].c));

        // ---------- 4. 新用户视角：数据概览与资料编辑 ----------
        sec('M4 新用户个人主页');
        await login(pU, 'QA_ME', 'Qa#2026Tmp');
        T('首登被强制改密', pU.url().toLowerCase().includes('changepassword'), pU.url());
        await pU.fill('input[name="OldPassword"]', 'Qa#2026Tmp');
        await pU.fill('input[name="NewPassword"]', 'Qa#2026Aa');
        await pU.fill('input[name="ConfirmPassword"]', 'Qa#2026Aa');
        await pU.locator('form button[type=submit]:has-text("设置")').click();
        await pU.waitForTimeout(900);
        T('改密后进入工作台', !pU.url().toLowerCase().includes('changepassword'), pU.url());

        await pU.goto(BASE + '/Me');
        await pU.waitForTimeout(400);
        const st2 = await readStats(pU);
        T('数据概览与落库一致', st2['日程'] === 3 && st2['备忘'] === 3 && st2['打卡'] === 9
            && st2['课程'] === 3 && st2['纪念日'] === 3 && st2['记账'] === 3 && st2['留言'] === 3,
            JSON.stringify(st2));
        T('普通用户看不到经期格子', st2['经期'] === undefined, JSON.stringify(st2));

        const sc0 = await sampleCount(pU);
        T('测试数据条数 = 30', sc0 === 30, String(sc0));

        await pU.fill('input[name="Email"]', 'qa_me@example.com');
        await pU.fill('textarea[name="Signature"]', '这是主页测试签名 🐾');
        await pU.locator('form[action*="Profile"], form[action*="handler=Profile"]').first()
            .locator('button[type=submit]').click();
        await pU.waitForTimeout(900);
        T('保存资料提示成功', await pU.locator('.toast-ok, .msg.ok').count() > 0,
            (await pU.locator('.toast-ok, .msg.ok').first().textContent().catch(() => '') || '').trim());
        const after = dbq(`select Email,Signature,DisplayName from Users where Id=${uid}`);
        T('资料落库（邮箱/签名）',
            after[0].Email === 'qa_me@example.com' && after[0].Signature.startsWith('这是主页测试签名'),
            JSON.stringify(after[0]));
        const shownSign = (await pU.locator('.me-sign').first().textContent() || '').trim();
        T('名片立刻反映新签名', shownSign.includes('这是主页测试签名'), shownSign);

        // ---------- 5. 清除 / 再生成 ----------
        sec('M5 测试数据清除与再生成');
        await pU.locator('button:has-text("清除测试数据")').click();
        await pU.waitForTimeout(1200);
        const left = dbq(`select
            (select count(*) from Schedules where UserId=${uid}) s,
            (select count(*) from Memos where UserId=${uid}) m,
            (select count(*) from Habits where UserId=${uid}) h,
            (select count(*) from HabitCheckins where UserId=${uid}) hc,
            (select count(*) from Courses where UserId=${uid}) c`);
        T('一键清除：日程/备忘/习惯/打卡/课程全为 0',
            left[0].s === 0 && left[0].m === 0 && left[0].h === 0 && left[0].hc === 0 && left[0].c === 0,
            JSON.stringify(left[0]));
        T('清除后条数显示 0', (await sampleCount(pU)) === 0, String(await sampleCount(pU)));
        const keptUser = dbq(`select Email,Signature from Users where Id=${uid}`);
        T('清除测试数据不动用户资料', keptUser[0].Email === 'qa_me@example.com', JSON.stringify(keptUser[0]));

        await pU.locator('button:has-text("生成测试数据")').click();
        await pU.waitForTimeout(1200);
        T('再生成后条数回到 30', (await sampleCount(pU)) === 30, String(await sampleCount(pU)));
        await pU.locator('button:has-text("生成测试数据")').click();
        await pU.waitForTimeout(1200);
        T('重复生成幂等（仍是 30，不叠加）', (await sampleCount(pU)) === 30, String(await sampleCount(pU)));

        // ---------- 6. 个人主页改密码 ----------
        sec('M6 个人主页改密码');
        await pU.fill('input[name="OldPassword"]', 'wrong-old');
        await pU.fill('input[name="NewPassword"]', 'Qa#2026Bb');
        await pU.fill('input[name="ConfirmPassword"]', 'Qa#2026Bb');
        await pU.locator('form[action*="Password"], form[action*="handler=Password"]').first()
            .locator('button[type=submit]').click();
        await pU.waitForTimeout(900);
        T('旧密码错误被拒', await pU.locator('.toast-err, .msg.error').count() > 0);

        await pU.fill('input[name="OldPassword"]', 'Qa#2026Aa');
        await pU.fill('input[name="NewPassword"]', 'Qa#2026Bb');
        await pU.fill('input[name="ConfirmPassword"]', 'Qa#2026Bb');
        await pU.locator('form[action*="Password"], form[action*="handler=Password"]').first()
            .locator('button[type=submit]').click();
        await pU.waitForTimeout(900);
        T('改密成功提示', await pU.locator('.toast-ok, .msg.ok').count() > 0,
            (await pU.locator('.toast-ok, .msg.ok').first().textContent().catch(() => '') || '').trim());

        await pU.locator('button:has-text("退出")').first().click();
        await pU.waitForTimeout(800);
        await login(pU, 'QA_ME', 'Qa#2026Aa');
        T('旧密码已失效', pU.url().toLowerCase().includes('login'), pU.url());
        await login(pU, 'QA_ME', 'Qa#2026Bb');
        T('新密码可登录', !pU.url().toLowerCase().includes('login'), pU.url());

        // ---------- 7. 手机端 ----------
        sec('M7 手机端');
        const mob = await ctxU.newPage();
        await mob.setViewportSize({ width: 390, height: 844 });
        await mob.goto(BASE + '/Me');
        await mob.waitForTimeout(500);
        T('手机底栏已移除', await mob.locator('.bottombar').count() === 0);
        // 抽屉里「我的」要在，且点得到（吸底条不该被列表顶出视口）
        await mob.click('.hamburger');
        await mob.waitForTimeout(450);
        const footInView = await mob.evaluate(() => {
            const f = document.querySelector('.sidebar-foot a[href="/Me"]');
            if (!f) return false;
            const b = f.getBoundingClientRect();
            return b.width > 0 && b.bottom <= window.innerHeight + 1;
        });
        T('抽屉里「我的」可见（吸底）', footInView);
        const ovf = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        T('手机无横向溢出', ovf <= 1, String(ovf));
        const statCols = await mob.evaluate(() =>
            getComputedStyle(document.querySelector('.me-stats')).gridTemplateColumns.split(' ').length);
        T('手机数据格子两列', statCols === 2, String(statCols));
        await mob.screenshot({ path: `${QA_DIR}/shot_me_mobile.png`, fullPage: true, reducedMotion: 'reduce' });
        await mob.close();

        await pL.setViewportSize({ width: 1280, height: 900 });
        await pL.goto(BASE + '/Me');
        await pL.waitForTimeout(400);
        await pL.screenshot({ path: `${QA_DIR}/shot_me_desktop.png`, fullPage: true, reducedMotion: 'reduce' });

        sec('M8 无 JS 报错');
        T('全程无 pageerror', errs.length === 0, errs.slice(0, 3).join(' | '));

    } catch (e) {
        results.push({ sec: curSec, name: '【套件异常中断】', ok: false, extra: String(e.message || e) });
        console.log('CRASH in ' + curSec + ': ' + (e.message || e));
    }

    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    fs.writeFileSync(`${QA_DIR}/report-me.json`, JSON.stringify({ time: new Date().toISOString(), pass, fail, results }, null, 1), 'utf8');
    console.log(`\n== 个人主页专项: ${pass} PASS / ${fail} FAIL ==`);
    if (fail) results.filter(r => !r.ok).forEach(r => console.log(` [${r.sec}] ${r.name} ${r.extra}`));
    await browser.close();
    process.exit(0);
})();
