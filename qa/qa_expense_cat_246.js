// qa_expense_cat_246.js — 2.4.6 记账自定义分类（网页端）专项验证
// 用法：node qa_expense_cat_246.js
// 前提：本地站跑在 http://127.0.0.1:5099，账号 qa_cat / QaCat#2026（临时测试号）
//
// 注意三件事（都会让断言假失败，踩过）：
// 1. 带 data-confirm 的表单是「就地二次确认」—— 第一次点击只把按钮变成确认文案，
//    第二次点击才真正提交。所以要点两下。
// 2. 输入框有 maxlength，浏览器自己会截断，别指望用 fill 超长字符串去测服务端拦截。
// 3. 页面上的 .msg 横幅会被 modal.js 转成浮动 Toast 并把元素 remove 掉，
//    所以断言不能找 .msg，要读 body 文本。
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5099';
const USER = process.env.QA_USER || 'qa_cat';
const PASS = process.env.QA_PASS || 'QaCat#2026';

const out = [];
function T(name, ok, extra) {
    out.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}

const chipTexts = async (page) =>
    (await page.locator('form[action*="handler=Delete"] button').allInnerTexts()).map(s => s.trim());

const bodyText = async (page) => (await page.locator('body').innerText());

/** 带就地二次确认的按钮：点两下 */
async function clickTwice(page, locator) {
    const h = await locator.first().elementHandle();
    await h.click();
    await h.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
}

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => T('页面无 JS 异常', false, e.message));

    await page.goto(BASE + '/Login');
    await page.fill('#Username', USER);
    await page.fill('input[type="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    T('登录成功', !page.url().toLowerCase().includes('/login'), page.url());

    // ---------- 分类管理页 ----------
    await page.goto(BASE + '/Expenses/Categories');
    await page.waitForLoadState('networkidle');
    T('分类管理页可达', page.url().includes('/Expenses/Categories'), page.url());
    T('默认 7 个分类', (await chipTexts(page)).length === 7, (await chipTexts(page)).join(','));
    T('上限文案与后端常量一致', (await page.locator('body').innerText()).includes('上限 24'));
    await page.screenshot({ path: 'qa_expense_cat_page_pc.png', fullPage: true });

    // ---------- 新增 ----------
    await page.fill('input[name="NewName"]', '宠物');
    await page.click('form[action*="handler=Add"] button[type="submit"]');
    await page.waitForLoadState('networkidle');
    let chips = await chipTexts(page);
    T('新增「宠物」成功', chips.some(t => t.includes('宠物')), chips.join(','));
    await page.waitForTimeout(200);
    T('新增后有提示', (await bodyText(page)).includes('已添加「宠物」'));

    // 重名拦截
    await page.fill('input[name="NewName"]', '宠物');
    await page.click('form[action*="handler=Add"] button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);
    T('重名被拦下并提示', (await bodyText(page)).includes('已经在列表里'), '');

    // 超长拦截（绕过 maxlength，直接按表单字段提交，等价于老浏览器/脚本提交）
    const longName = '一二三四五六七八九十';
    if (await page.locator('input[name="NewName"]').count()) {
        await page.locator('input[name="NewName"]').evaluate(el => { el.removeAttribute('maxlength'); });
        await page.fill('input[name="NewName"]', longName);
        await page.click('form[action*="handler=Add"] button[type="submit"]');
        await page.waitForLoadState('networkidle');
        chips = await chipTexts(page);
        T('超 8 字被服务端拦下', !chips.some(t => t.includes('一二三四五')), chips.length + ' 个');
    }

    // ---------- 删除现有分类（两下确认）----------
    await clickTwice(page, page.locator('form[action*="handler=Delete"] button', { hasText: '娱乐' }));
    chips = await chipTexts(page);
    T('删除「娱乐」成功', !chips.includes('娱乐'), chips.join(','));
    T('删除后有提示', (await bodyText(page)).includes('已删除「娱乐」'));

    // ---------- 新建记账页下拉是否跟着变 ----------
    await page.goto(BASE + '/Expenses/New');
    await page.waitForLoadState('networkidle');
    const opts = (await page.locator('select[name="Category"] option').allInnerTexts()).map(s => s.trim());
    T('新建页下拉含「宠物」', opts.includes('宠物'), opts.join(','));
    T('新建页下拉不含「娱乐」', !opts.includes('娱乐'), opts.join(','));
    T('新建页有分类管理入口', (await page.locator('a[href="/Expenses/Categories"]').count()) > 0);
    await page.screenshot({ path: 'qa_expense_cat_new_pc.png', fullPage: true });

    // 真记一笔，验证自定义分类能存下来
    await page.fill('input[name="Amount"]', '12.50');
    await page.selectOption('select[name="Category"]', { label: '宠物' });
    await page.locator('form:has(input[name="Amount"]) button[type="submit"]').click();
    await page.waitForLoadState('networkidle');
    T('用自定义分类记一笔成功', page.url().includes('/Expenses') && !page.url().includes('/New'), page.url());
    const listBody = await page.locator('body').innerText();
    T('流水里能看到「宠物」分类的那笔', listBody.includes('宠物'));

    // ---------- 恢复默认 ----------
    await page.goto(BASE + '/Expenses/Categories');
    await page.waitForLoadState('networkidle');
    await clickTwice(page, page.locator('form[action*="handler=Reset"] button[type="submit"]'));
    chips = await chipTexts(page);
    T('恢复默认回到 7 个', chips.length === 7, chips.join(','));

    // ---------- 手机视口 ----------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/Expenses/Categories');
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    T('手机视口无横向溢出', overflow <= 1, 'overflow=' + overflow);
    await page.screenshot({ path: 'qa_expense_cat_page_mobile.png', fullPage: true });

    await browser.close();

    const fail = out.filter(o => !o.ok);
    console.log('\n==== 结果：' + (out.length - fail.length) + '/' + out.length + ' 通过 ====');
    if (fail.length) { console.log('失败项：'); fail.forEach(f => console.log(' - ' + f.name + ' ' + f.extra)); process.exit(1); }
})().catch(e => { console.error('脚本异常：', e); process.exit(2); });
