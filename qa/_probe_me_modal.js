// _probe_me_modal.js — A4 弹窗（modal）真实 UX 路径验证
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.setDefaultTimeout(20000);
    page.on('dialog', d => d.accept());

    // ---- Me/Password 弹窗流程 ----
    await page.goto(BASE + '/Me');
    await page.waitForLoadState('load');
    const pwLink = page.getByText('修改密码', { exact: false }).first();
    console.log('修改密码入口:', await pwLink.count());
    await pwLink.click();
    await page.waitForTimeout(800);
    // 弹窗是否打开（modal dialog 容器可见）
    const dlgVisible = await page.locator('.modal, dialog, [class*=modal]').first().isVisible().catch(() => false);
    console.log('弹窗打开:', dlgVisible, '| url 未跳转:', page.url());
    const cur = page.locator('input[name="OldPassword"]');
    const np = page.locator('input[name="NewPassword"]');
    const cf = page.locator('input[name="ConfirmPassword"]');
    console.log('弹窗内三个输入框:', await cur.count(), await np.count(), await cf.count());
    if (await cur.count()) {
        await cur.fill('WrongPass123!');
        await np.fill('NewQaPass2026!');
        await cf.fill('NewQaPass2026!');
        const [resp] = await Promise.all([
            page.waitForResponse(r => r.request().method() === 'POST' && (r.url().includes('/Me'))),
            page.locator('form').filter({ has: np }).locator('button[type="submit"]').first().click(),
        ]);
        console.log('错误提交响应:', resp.status());
        await page.waitForTimeout(800);
        const bodyText = await page.locator('.modal, dialog, [class*=modal]').first().innerText().catch(() => '');
        console.log('弹窗仍在:', bodyText.length > 0);
        console.log('内联错误:', /不正确|错误|不对|失败/.test(bodyText), '|', bodyText.substring(0, 100).replace(/\n/g, ' '));
        console.log('输入框保留 cur=', JSON.stringify(await cur.inputValue()), 'np=', JSON.stringify(await np.inputValue()));
    }

    // ---- Me/Edit 弹窗流程（资料，可回显）----
    await page.goto(BASE + '/Me');
    await page.waitForLoadState('load');
    const editLink = page.getByText('编辑资料', { exact: false }).first();
    console.log('\n编辑资料入口:', await editLink.count());
    await editLink.click();
    await page.waitForTimeout(800);
    const dn = page.locator('input[name="DisplayName"]');
    if (await dn.count()) {
        await page.locator('input[name="Email"]').fill('');
        // 先试 type=email 的原生校验是否拦；改用超长昵称更稳
        await dn.fill('X'.repeat(25));
        const [resp] = await Promise.all([
            page.waitForResponse(r => r.request().method() === 'POST' && (r.url().includes('/Me'))),
            page.locator('form').filter({ has: dn }).locator('button[type="submit"]').first().click(),
        ]).catch(e => [{ status: -2 }]);
        console.log('资料错误提交响应:', resp.status);
        await page.waitForTimeout(800);
        const modalText = await page.locator('.modal, dialog, [class*=modal]').first().innerText().catch(() => '');
        console.log('资料弹窗仍在:', modalText.length > 0, '| 内联错误:', /昵称|邮箱|格式|最多/.test(modalText), '|', modalText.substring(0, 100).replace(/\n/g, ' '));
        const dnVal = await dn.inputValue().catch(() => 'N/A');
        console.log('昵称保留:', JSON.stringify(dnVal), '(期望 X…25)');
        const mailVal = await page.locator('input[name="Email"]').inputValue().catch(() => 'N/A');
        console.log('邮箱保留:', JSON.stringify(mailVal));
    } else {
        console.log('编辑资料弹窗未找到表单');
    }
    await browser.close();
})();
