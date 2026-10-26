// 2.3.7 两个新功能验证：① AI 发送等待 UI（本地回显 + 分段文案 + 秒数）
//                          ② 快捷切换账号（登录页本机账号簿 + 顶栏切换入口）
// 用法：export QA_PASS='本地密码'; NODE_PATH=... node qa_237.js
const QA = require('./_env');
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const OUT = 'D:/checkin/work/releases/qa-237';
const results = [];
function check(name, ok, extra = '') {
    results.push({ name, ok, extra });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${extra}]` : ''));
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());

    // ================= ① AI 发送等待 UI =================
    await page.goto(BASE + '/Login');
    await page.waitForLoadState('domcontentloaded');
    await page.fill('#Username', QA.USER);
    await page.fill('#Password', QA.PASS);
    await page.check('input[name="RememberMode"][value="autologin"]');
    await page.click('#loginForm button[type="submit"]');
    await page.waitForURL(u => !u.toString().includes('/Login'), { timeout: 15000 });

    await page.goto(BASE + '/Ai');
    await page.waitForLoadState('domcontentloaded');

    // 不真的等后端 40 秒：在捕获阶段拦掉表单默认提交（导航），
    // 但事件仍会继续传到 form 自己的监听器 → 我们的回显逻辑照常跑，DOM 留在原地可查。
    await page.evaluate(() => {
        document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
    });

    const before = await page.locator('.ai-row.me').count();
    await page.fill('#aiForm textarea', '现在几点');
    await page.click('#aiSend');
    await page.waitForTimeout(300);

    const echo = page.locator('.ai-row.me').last();
    check('发送瞬间画出「我发的那条」', await echo.count() > 0);
    check('回显内容正确', await echo.locator('.ai-bubble').innerText().then(t => t.includes('现在几点')));
    check('回显带「已发出」标记', await echo.locator('.ai-sent-tag').count() === 1);

    const waitRow = page.locator('.ai-wait');
    check('出现等待状态行', await waitRow.count() >= 1);
    check('等待行有转圈', await waitRow.locator('.ai-spin').count() >= 1);
    const t0 = await waitRow.locator('.ai-wait-text').last().innerText();
    check('首段文案正确', /已发送，正在等 AI 回应/.test(t0), t0.trim());
    check('秒数从 0s 起算', /0s|1s/.test(await waitRow.locator('.ai-wait-sec').last().innerText()));

    await page.waitForTimeout(1200);
    const t1 = await waitRow.locator('.ai-wait-sec').last().innerText();
    check('秒数在走', /^[1-9]\d*s$/.test(t1.trim()), t1.trim());

    check('发送按钮进入转圈禁用态', (await page.locator('#aiSend.is-loading').count()) === 1
        && await page.locator('#aiSend').isDisabled());
    check('输入框已清空', (await page.inputValue('#aiForm textarea')) === '');

    await page.screenshot({ path: `${OUT}/ai-wait.png`, fullPage: false });

    // 连点不该再触发第二次提交
    let submits = 0;
    page.on('request', r => { if (r.url().includes('handler=Send')) submits++; });
    await page.click('#aiSend', { force: true }).catch(() => { });
    await page.waitForTimeout(400);
    check('发送中再点不会重复提交', submits === 0, 'send 请求数=' + submits);

    // ================= ② 快捷切换账号 =================
    // 顶栏「切换」入口
    await page.goto(BASE + '/Index');
    await page.waitForLoadState('domcontentloaded');
    check('顶栏有「切换」按钮', await page.locator('.topbar form.switch-form button').count() === 1);
    const switchLabel = await page.locator('.topbar form.switch-form button').innerText();
    check('切换按钮文案', /切换/.test(switchLabel), switchLabel.trim());

    // 账号簿已在 localStorage 建好（布局页同步脚本 + 登录页提交写入）
    const book = await page.evaluate(() => localStorage.getItem('checkin_accounts'));
    check('已写入本机账号簿', !!book, String(book || '').slice(0, 80));
    const arr = JSON.parse(book || '[]');
    check('账号簿记录了当前账号', arr.some(a => a.u === QA.USER));
    check('账号簿带昵称', arr.some(a => a.u === QA.USER && a.n));

    // 点「切换」→ 落到登录页，且本机账号区块可见
    await page.click('.topbar form.switch-form button');
    await page.waitForURL(u => u.toString().includes('/Login'), { timeout: 15000 });
    await page.waitForTimeout(500);
    check('切换后回到登录页', page.url().includes('/Login'));
    check('带 pick=1 参数', page.url().includes('pick=1'), page.url());
    check('本机账号区块可见', await page.locator('#acctBlock').isVisible());
    const rows = await page.locator('.acct-row').count();
    check('本机账号至少一行', rows >= 1, rows + ' 行');
    const name0 = await page.locator('.acct-row').first().innerText();
    check('账号行显示昵称与登录名', /admin|@/.test(name0), name0.replace(/\n/g, ' | '));
    await page.screenshot({ path: `${OUT}/login-accounts.png`, fullPage: true });

    // 点一行直接用存的密码登进去
    await page.locator('.acct-row').first().click();
    await page.waitForURL(u => !u.toString().includes('/Login'), { timeout: 20000 });
    check('点本机账号可直接登录', !page.url().includes('/Login'), page.url().replace(BASE, ''));

    // 本次登录后账号簿仍然只有一条（没有重复插入）
    const book2 = JSON.parse(await page.evaluate(() => localStorage.getItem('checkin_accounts')) || '[]');
    const dup = book2.filter(a => a.u === QA.USER).length;
    check('账号簿不重复', dup === 1, 'admin 条数=' + dup);

    // 移除：先真的登出（GET /Logout 会重定向回工作台，必须走 POST 表单）
    await page.goto(BASE + '/Index');
    await page.waitForTimeout(300);
    await page.click('.topbar form:not(.switch-form) button');
    await page.waitForURL(u => u.toString().includes('/Login'), { timeout: 15000 });
    check('顶栏「退出」仍可用', page.url().includes('/Login'), page.url().replace(BASE, ''));

    await page.goto(BASE + '/Login?pick=1');
    await page.waitForTimeout(500);
    const rowsBefore = await page.locator('.acct-row').count();
    check('登录页仍能看到本机账号', rowsBefore >= 1, rowsBefore + ' 行');
    if (rowsBefore > 0) {
        await page.locator('.acct-row .acct-del').first().click();
        await page.waitForTimeout(400);
        const rowsAfter = await page.locator('.acct-row').count();
        check('点 × 可移出本机账号', rowsAfter === rowsBefore - 1, `${rowsBefore} → ${rowsAfter}`);
    }
    const book3 = JSON.parse(await page.evaluate(() => localStorage.getItem('checkin_accounts')) || '[]');
    check('移除后账号簿已清空该条', !book3.some(a => a.u === QA.USER), JSON.stringify(book3));

    // 空账号簿时区块应隐藏
    check('没有存密码的号时区块隐藏', await page.locator('#acctBlock').isHidden());

    await browser.close();

    const bad = results.filter(r => !r.ok);
    console.log(`\n===== ${results.length - bad.length}/${results.length} 通过 =====`);
    if (bad.length) { bad.forEach(r => console.log(' - ' + r.name)); process.exit(1); }
})().catch(e => { console.error('EXCEPTION', e); process.exit(1); });