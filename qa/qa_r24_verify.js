// qa_r24_verify.js — R2-4 补验：记账分类自动返回后提示可见（发版前最后一道闸）
// 只验 R2-4 这一条修复的 5 个验证点 + 2 个边界，不扩面。
// 用法（Git Bash，口令走 _env.js，严禁落盘）：
//   export QA_PASS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('D:/checkin/site/CheckinApp/appsettings.Local.json','utf8')).Seed.AdminPassword)")
//   NODE_PATH=C:/Users/An/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules node qa_r24_verify.js
//
// 提示观测方式：modal.js 把 .msg 横幅转成 #toastWrap 里的 .toast 并把元素 remove，
// 所以断言不能找 .msg。本脚本用 init 脚本挂 MutationObserver，把真正挂进
// #toastWrap 的 .toast 记进 window.__toasts —— 元素真的进了 DOM 才算「可见」。
const { chromium } = require('playwright');
const env = require('./_env.js');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const out = [];
function T(name, ok, extra) {
    out.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}

/** init 脚本：记录所有真正挂进 #toastWrap 的 .toast（含挂观察器前已存在的快照） */
function toastHook() {
    window.__toasts = [];
    var hooked = false;
    function record(n) {
        window.__toasts.push((n.textContent || '').trim());
    }
    function hook() {
        if (hooked) return true;
        var wrap = document.getElementById('toastWrap');
        if (!wrap) return false;
        hooked = true;
        // 挂载前已存在的 .toast（modal.js 在解析期就把 .msg 转掉了）补记
        Array.prototype.forEach.call(wrap.querySelectorAll('.toast'), record);
        new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                Array.prototype.forEach.call(m.addedNodes, function (n) {
                    if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) record(n);
                });
            });
        }).observe(wrap, { childList: true });
        return true;
    }
    hook();
    var raf = function () { if (!hook()) requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    var iv = setInterval(function () { if (hook()) clearInterval(iv); }, 30);
    document.addEventListener('DOMContentLoaded', function () { hook(); });
}

const readToasts = (page) => page.evaluate(() => (window.__toasts || []).slice());
const readLive = (page) => page.evaluate(() =>
    Array.from(document.querySelectorAll('#toastWrap .toast')).map(e => e.textContent.trim()));

/** 轮询直至出现含 substr 的 toast（记录流 + 实时 DOM 双通道），返回 { hit, toasts, live } */
async function waitToast(page, substr, timeout = 6000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        const toasts = await readToasts(page);
        const live = await readLive(page);
        if (toasts.concat(live).some(t => t.includes(substr))) {
            return { hit: true, toasts, live };
        }
        await page.waitForTimeout(250);
    }
    return { hit: false, toasts: await readToasts(page), live: await readLive(page) };
}

/** 观察 ms 毫秒，期间不应出现含 substr 的 toast（记录流 + 实时 DOM 双通道） */
async function expectNoToast(page, substr, ms = 4200) {
    const end = Date.now() + ms;
    let all = [];
    while (Date.now() < end) {
        all = all.concat(await readToasts(page), await readLive(page));
        if (all.some(t => t.includes(substr))) return { ok: false, toasts: all };
        await page.waitForTimeout(250);
    }
    return { ok: true, toasts: all };
}

const rnd = () => Math.random().toString(36).slice(2, 4);

(async () => {
    // 代理会把 5188 的请求吃掉/假 200，全部直连
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

    const browser = await chromium.launch({ channel: 'msedge', args: ['--no-proxy-server'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(toastHook);
    const page = await ctx.newPage();
    page.on('pageerror', e => T('（全局）页面无 JS 异常', false, e.message));

    // ---------- 登录 ----------
    await page.goto(BASE + '/Login');
    await page.fill('#Username', env.USER);
    await page.fill('input[type="password"]', env.PASS);
    await page.click('#loginForm button[type="submit"]');
    await page.waitForLoadState('networkidle');
    T('登录成功', !page.url().toLowerCase().includes('/login'), page.url());

    const nameA = 'R24A' + rnd();   // 测点 1
    const nameB = 'R24B' + rnd();   // 测点 2
    const nameC = 'R24C' + rnd();   // 测点 4（再触发）
    const names = [nameA, nameB, nameC];

    // ---------- 测点 2：手动入口（先跑，隔离 sessionStorage）----------
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(BASE + '/Expenses/Categories');
    await page.waitForLoadState('networkidle');
    await page.fill('input[name="NewName"]', nameB);
    await page.click('form[action*="handler=Add"] button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    const url2 = page.url();
    T('测点2 手动入口保存后停在列表页', url2.includes('/Expenses/Categories'), url2);
    const r2 = await waitToast(page, '已添加', 5000);
    T('测点2 手动入口保存后提示可见', r2.hit, r2.hit ? r2.toasts.join(' | ') : 'toasts=' + JSON.stringify(r2.toasts));
    const ss2 = await page.evaluate(() => sessionStorage.getItem('expenseCatToast'));
    T('测点2 手动路径未写 expenseCatToast（不双显）', ss2 === null, 'value=' + ss2);

    // ---------- 测点 1：下拉入口 ----------
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(BASE + '/Expenses/New');
    await page.waitForLoadState('networkidle');
    const nav1 = page.waitForURL('**/Expenses/Categories', { timeout: 8000 });
    await page.selectOption('select[name="Category"]', '__manage');
    await nav1;
    await page.waitForLoadState('networkidle');
    const ssCat = await page.evaluate(() => sessionStorage.getItem('catManage'));
    T('测点1 下拉进入分类页并写入 catManage 标记', ssCat !== null, 'catManage=' + (ssCat ? 'set' : ssCat));
    await page.fill('input[name="NewName"]', nameA);
    const navBack = page.waitForURL('**/Expenses/New', { timeout: 8000 });
    await page.click('form[action*="handler=Add"] button[type="submit"]');
    await navBack;
    T('测点1 保存后自动回到记账表单', page.url().includes('/Expenses/New'), page.url());
    const r1 = await waitToast(page, '已添加', 6000);
    T('测点1 回到表单后提示可见', r1.hit, r1.hit ? r1.toasts.join(' | ') : 'toasts=' + JSON.stringify(r1.toasts));
    const ss1 = await page.evaluate(() => sessionStorage.getItem('expenseCatToast'));
    T('测点1 提示消费后 expenseCatToast 已清除', ss1 === null, 'value=' + ss1);

    // ---------- 测点 3：刷新不重复 ----------
    await page.reload();
    await page.waitForLoadState('networkidle');
    const r3 = await expectNoToast(page, '已添加', 4200);
    T('测点3 刷新表单页后提示不再出现', r3.ok, r3.ok ? '无 toast' : '复活了: ' + JSON.stringify(r3.toasts));

    // ---------- 测点 4：bfcache 层 ----------
    // 4a 后退/前进：提示不复活
    await page.goBack();
    await page.waitForLoadState('load');
    await page.goForward();
    await page.waitForLoadState('load');
    const r4a = await expectNoToast(page, '已添加', 4200);
    T('测点4 后退/前进后提示不复活', r4a.ok, r4a.ok ? '无 toast' : '复活了: ' + JSON.stringify(r4a.toasts));
    // 4b 再触发一次路径 1：提示不丢
    await page.goto(BASE + '/Expenses/New');
    await page.waitForLoadState('networkidle');
    const nav4 = page.waitForURL('**/Expenses/Categories', { timeout: 8000 });
    await page.selectOption('select[name="Category"]', '__manage');
    await nav4;
    await page.waitForLoadState('networkidle');
    await page.fill('input[name="NewName"]', nameC);
    const navBack4 = page.waitForURL('**/Expenses/New', { timeout: 8000 });
    await page.click('form[action*="handler=Add"] button[type="submit"]');
    await navBack4;
    const r4b = await waitToast(page, '已添加', 6000);
    T('测点4 再触发路径1提示仍然可见（不丢）', r4b.hit, r4b.hit ? r4b.toasts.join(' | ') : 'toasts=' + JSON.stringify(r4b.toasts));

    // ---------- 边界 1：无 catManage 标记直接带 ?ok= 进分类页，不误触发 go(-2) ----------
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(BASE + '/Expenses/Categories?ok=' + encodeURIComponent('直接进来'));
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1800);
    T('边界1 无标记时留在分类页（未误触发 go(-2)）', page.url().includes('/Expenses/Categories'), page.url());

    // ---------- 边界 2：消费后离开再回表单，提示不再出现 ----------
    await page.goto(BASE + '/Expenses');
    await page.waitForLoadState('networkidle');
    await page.goto(BASE + '/Expenses/New');
    await page.waitForLoadState('networkidle');
    const rB2 = await expectNoToast(page, '已添加', 3000);
    T('边界2 切走再回表单提示不再出现', rB2.ok, rB2.ok ? '无 toast' : '复活了: ' + JSON.stringify(rB2.toasts));

    // ---------- 清理测试分类 ----------
    await page.goto(BASE + '/Expenses/Categories');
    await page.waitForLoadState('networkidle');
    for (const n of names) {
        const btn = page.locator('form[action*="handler=Delete"] button', { hasText: n });
        if (await btn.count()) {
            await btn.first().click();               // data-confirm 就地二次确认：点两下
            await btn.first().click();
            await page.waitForLoadState('networkidle');
        }
    }
    const left = await page.locator('form[action*="handler=Delete"] button').allInnerTexts();
    T('清理：测试分类已删除', !names.some(n => left.join(',').includes(n)), left.join(','));

    await browser.close();

    const fail = out.filter(o => !o.ok);
    console.log('\n==== R2-4 补验结果：' + (out.length - fail.length) + '/' + out.length + ' 通过 ====');
    if (fail.length) { console.log('失败项：'); fail.forEach(f => console.log(' - ' + f.name + ' ' + f.extra)); process.exit(1); }
})().catch(e => { console.error('脚本异常：', e); process.exit(2); });
