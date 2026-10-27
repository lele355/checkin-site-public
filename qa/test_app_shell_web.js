// test_app_shell_web.js — 确认壳适配脚本在普通浏览器里是"零副作用"
// 前置：站点跑在 http://localhost:5188
const { chromium } = require('playwright');

const BASE = 'http://localhost:5188';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`  ✅ ${n}${e ? ' — ' + e : ''}`)) : (fail++, console.log(`  ❌ ${n}${e ? ' — ' + e : ''}`)); };

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 100)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 100)); });

    await page.goto(BASE + '/Login', { waitUntil: 'load' });
    await page.waitForTimeout(800);

    const st = await page.evaluate(async () => {
        const res = await fetch('/js/app-shell.js');
        return {
            status: res.status,
            hasCapacitor: typeof window.Capacitor !== 'undefined',
            isNativeClass: document.documentElement.classList.contains('is-native')
        };
    });

    console.log('【浏览器环境（非壳）】');
    ok('app-shell.js 可访问', st.status === 200, 'HTTP ' + st.status);
    ok('没有 window.Capacitor（说明不是壳）', st.hasCapacitor === false);
    ok('没有误加 .is-native 类', st.isNativeClass === false);
    ok('无 JS 报错', errors.length === 0, errors.join(' | ') || '干净');

    console.log(`\n=== 结果：${pass}/${pass + fail} 通过`);
    await browser.close();
    process.exit(fail ? 1 : 0);
})();
