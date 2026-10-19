// test_register.js — 邀请制注册专项（一次性邀请码 → 填对即注册成功，注册完直接能登录）
// 覆盖：注册页形态/蜜罐/错码/太快提交 → 正确邀请码注册成功 → 立刻能登录
//       → 邀请码不可复用 → 小时配额生效
// 用法（需要服务端以较高配额启动，否则功能用例会先被限流打掉）：
//   Security__RegisterPerHour=12 dotnet run --no-launch-profile --urls 'http://*:5188'
//   NODE_PATH=... node test_register.js
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

const STAMP = Date.now().toString().slice(-6);
const UNAME = 'QA_Reg_' + STAMP;
const PW = 'Test1234';

async function login(page, user, pass) {
    await page.goto(BASE + '/Login');
    await page.fill('#Username', user);
    await page.fill('#Password', pass);
    await page.click('form button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(300);
}

async function openRegister(page, code, uname, homepage = '') {
    await page.goto(BASE + '/Register');
    if (code) await page.fill('#Code', code);
    await page.fill('#Username', uname);
    await page.fill('#Password', PW);
    await page.fill('#Password2', PW);
    if (homepage) await page.fill('#Homepage', homepage);
}

async function submit(page) {
    await page.click('form button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(250);
}

async function errText(page) {
    const el = page.locator('.msg.error');
    return (await el.count()) ? (await el.first().innerText()).trim() : '';
}

(async () => {
    try { execSync(`"${PY}" "${QA_DIR}/wipe_qa.py"`, { encoding: 'utf8' }); } catch (e) { }
    dbq("delete from Invitations where Note = 'QA_TEST'");

    const browser = await chromium.launch({ channel: 'msedge' });
    const errs = [];

    // ---------- 管理端：生成两个邀请码 ----------
    const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const ap = await adminCtx.newPage();
    ap.on('pageerror', e => errs.push('admin:' + e.message));
    ap.on('dialog', d => d.accept().catch(() => { }));

    sec('R1 管理端生成一次性邀请码');
    await login(ap, ADMIN_USER, ADMIN_PASS);
    T('管理员登录成功', !ap.url().includes('/Login'), ap.url());
    await ap.goto(BASE + '/Admin/Invitations');
    T('邀请码页可访问', (await ap.locator('.invite-form').count()) === 1);
    await ap.fill('#Count', '2');
    await ap.fill('#Days', '7');
    await ap.fill('#Note', 'QA_TEST');
    await ap.click('.invite-form button[type=submit]');
    await ap.waitForLoadState('networkidle').catch(() => { });
    await ap.waitForTimeout(300);

    const codeEls = await ap.locator('.invite-new code').allInnerTexts();
    T('生成了 2 个邀请码', codeEls.length === 2, codeEls.join(','));
    const CODE1 = (codeEls[0] || '').trim();
    const CODE2 = (codeEls[1] || '').trim();
    T('邀请码形如 XXXX-XXXX-XXXX', /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(CODE1), CODE1);
    T('页面上没有「注册链接」这种东西', !(await ap.content()).includes('注册链接'));

    const listRows = await ap.locator('table.table tbody tr').count();
    T('列表里能看到刚生成的码', listRows >= 2, 'rows=' + listRows);

    // ---------- 匿名访客 ----------
    const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const g = await guestCtx.newPage();
    g.on('pageerror', e => errs.push('guest:' + e.message));

    sec('R2 注册页基础形态');
    await g.goto(BASE + '/Register');
    T('匿名可访问注册页', !g.url().includes('/Login'), g.url());
    T('标题含「注册」', (await g.title()).includes('注册'));
    T('有邀请码输入框', (await g.locator('#Code').count()) === 1);
    T('邀请码标了「必填」', (await g.locator('label[for=Code]').innerText()).includes('必填'));
    T('邀请码 input 带 required', (await g.getAttribute('#Code', 'required')) !== null);

    const hpBox = await g.locator('#Homepage').boundingBox();
    T('蜜罐字段被挪到可视区外', !!hpBox && hpBox.x < -1000, JSON.stringify(hpBox));
    T('蜜罐对读屏隐藏', (await g.getAttribute('#Homepage', 'aria-hidden')) === 'true');
    T('表单带一次性令牌', ((await g.inputValue('#FormToken')) || '').length >= 16);
    T('表单带加密时间戳', ((await g.inputValue('#FormStamp')) || '').length >= 16);

    sec('R3 邀请码格式不对');
    await openRegister(g, 'BADCODE', 'QA_Reg_bad');
    await g.waitForTimeout(3300);
    await submit(g);
    T('提示格式错误', (await errText(g)).includes('格式不对'), await errText(g));

    sec('R4 邀请码格式对但不存在');
    await openRegister(g, 'ACDE-FGHJ-KLMN', 'QA_Reg_noex');
    await g.waitForTimeout(3300);
    await submit(g);
    T('提示无效/已用/过期', /无效|已使用|已过期/.test(await errText(g)), await errText(g));

    sec('R5 蜜罐命中（脚本特征）');
    await openRegister(g, CODE1, 'QA_Reg_bot', 'http://spam.example');
    await g.waitForTimeout(3300);
    await submit(g);
    T('蜜罐提交被拒', (await errText(g)).includes('请求无效'), await errText(g));
    const botRows = dbq(`select count(*) c from Users where Username = 'QA_Reg_bot'`);
    T('蜜罐账号没落库', botRows[0] && botRows[0].c === 0, JSON.stringify(botRows));

    sec('R6 秒交卷（填写时长不足）');
    await openRegister(g, CODE1, 'QA_Reg_fast');
    await submit(g);   // 不等 3 秒
    T('提示提交太快', (await errText(g)).includes('太快'), await errText(g));

    sec('R7 填对邀请码 = 注册成功');
    await openRegister(g, CODE1, UNAME);
    await g.waitForTimeout(3400);
    await submit(g);
    const pageText = await g.content();
    T('显示注册成功', pageText.includes('注册成功'), await errText(g) || g.url());
    T('不再有「等待审核」这一步', !pageText.includes('等待管理员审核'));

    const uRows = dbq(`select Id, RegisterIp, RoleId from Users where Username = '${UNAME}'`);
    T('账号已落库', uRows.length === 1 && uRows[0].Id > 0, JSON.stringify(uRows));
    T('记录了注册 IP', uRows[0] && String(uRows[0].RegisterIp).length > 0, uRows[0] && uRows[0].RegisterIp);

    const invRows = dbq(`select UsedAt, UsedByUserId from Invitations where Code = '${CODE1.replace(/-/g, '')}'`);
    T('邀请码已标记使用', invRows[0] && invRows[0].UsedAt !== null, JSON.stringify(invRows));

    sec('R8 注册完立刻能登录');
    await login(g, UNAME, PW);
    T('直接进入站内（无需审核）', !g.url().includes('/Login'), g.url());
    T('工作台渲染正常', (await g.locator('.card').count()) > 0);

    sec('R9 邀请码不能复用');
    const reuseCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const r = await reuseCtx.newPage();
    await openRegister(r, CODE1, UNAME + '_2');
    await r.waitForTimeout(3300);
    await submit(r);
    T('复用被拒', /无效|已使用|已过期/.test(await errText(r)), await errText(r));
    const dupRows = dbq(`select count(*) c from Users where Username = '${UNAME}_2'`);
    T('复用没建出账号', dupRows[0] && dupRows[0].c === 0, JSON.stringify(dupRows));

    sec('R10 小时配额生效');
    const limitCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const l = await limitCtx.newPage();
    let blocked = '';
    for (let i = 0; i < 20; i++) {
        await openRegister(l, CODE2, 'QA_Reg_spam_' + i);
        await l.waitForTimeout(3100);
        await submit(l);
        const t = await errText(l);
        if (t.includes('最多提交')) { blocked = t; break; }
    }
    T('连续提交后被配额拦下', !!blocked, blocked);

    sec('R11 无前端异常');
    T('没有 pageerror', errs.length === 0, errs.join(' | '));

    await browser.close();
    const pass = results.filter(x => x.ok).length;
    console.log('\n===== 汇总 ' + pass + '/' + results.length + ' =====');
    results.filter(x => !x.ok).forEach(f => console.log('FAILED [' + f.sec + '] ' + f.name + ' :: ' + f.extra));
    process.exit(results.some(x => !x.ok) ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
