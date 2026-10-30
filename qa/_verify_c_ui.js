// _verify_c_ui.js — Batch C UI 冒烟（真实浏览器 msedge）：
// melon 物理玩法（下落→碰撞→合成→计分→堆高结束→弹窗）+ fish 升级 UI（背景/HUD/移动）+ 教程页
// 用法：node _verify_c_ui.js    （站点 127.0.0.1:5188 已起，CHECKIN_LOCAL=1 自动登录 admin）
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:5188';
const SHOTS = 'D:/checkin/site/qa/shots_c';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 900, height: 950 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    // ===== melon：物理玩法冒烟 =====
    await page.goto(BASE + '/Games/melon/Solo');
    await page.waitForLoadState('load');
    await sleep(800);
    T('melon 页面加载（含 melon-core）', await page.evaluate(() => !!window.MelonCore));

    // 画布点击 = 瞄准 + 释放（物理下落）
    const box = await page.locator('#soloCanvas').boundingBox();
    async function dropAt(fx) {
        await page.mouse.move(box.x + box.width * fx, box.y + 30);
        await page.mouse.click(box.x + box.width * fx, box.y + 30);
        await sleep(420);   // 等掉落冷却
    }

    // 连续同点位掉落 → 碰撞/合成 → 分数上涨（下落→碰撞→合成→计分）
    let scored = false;
    for (let i = 0; i < 12 && !scored; i++) {
        await dropAt(0.25 + (i % 2) * 0.06);
        scored = parseInt(await page.locator('#soloScore').textContent(), 10) > 0;
    }
    T('下落→碰撞→合成→计分>0', scored, 'score=' + await page.locator('#soloScore').textContent());
    await page.screenshot({ path: SHOTS + '/melon_playing.png' });

    // 堆高→越过警戒线停留→结束弹窗（先重开清场；测试钩子快速叠塔，判定/弹窗为真实物理路径）
    await page.locator('#soloRestart').click();
    await sleep(500);
    await page.evaluate(() => {
        const g = window.__melonGame;
        for (const y of [460, 330, 200, 70]) { const b = g.debugAdd(11, 180, y); b.lock = 999999; }
    });
    let modalShown = false;
    for (let i = 0; i < 12 && !modalShown; i++) {
        await sleep(500);
        modalShown = await page.evaluate(() => !document.getElementById('soloEndModal').hidden);
    }
    T('堆高→警戒线→结束弹窗', modalShown, 'score=' + await page.locator('#soloEndScore').textContent());
    await page.screenshot({ path: SHOTS + '/melon_over.png' });

    // 弹窗内「再来一局」可用
    if (modalShown) {
        await page.locator('#soloEndRestart').click();
        await sleep(600);
        T('结束弹窗重开可用', await page.evaluate(() => document.getElementById('soloEndModal').hidden));
    }

    // ===== fish：升级 UI 冒烟 =====
    await page.goto(BASE + '/Games/fish/Solo');
    await page.waitForLoadState('load');
    await sleep(800);
    // 移动指针：鱼平滑跟随（零异常即稳），截图存证背景/HUD
    for (let i = 0; i < 8; i++) {
        await page.mouse.move(box.x + box.width * (0.2 + 0.08 * i), box.y + box.height * (0.3 + 0.05 * (i % 3)));
        await sleep(120);
    }
    await sleep(600);
    T('fish 页面加载与移动零异常', errs.length === 0, errs.join('|').slice(0, 120));
    await page.screenshot({ path: SHOTS + '/fish_playing.png' });

    // ===== 教程页（U7 + 教程与引擎同规铁律）=====
    for (const key of ['melon', 'fish']) {
        await page.goto(BASE + '/Games/' + key + '/Rules');
        await page.waitForLoadState('load');
        const titles = await page.evaluate(() => Array.from(document.querySelectorAll('.card h3')).map(h => h.textContent.trim()));
        const need = ['目标', '胜负判定', '走法', '特殊规则', '常见新手误区'];
        T(`教程页 ${key} 五节齐全`, need.every(s => titles.includes(s)), titles.join(','));
    }
    await page.goto(BASE + '/Games/melon/Rules');
    await page.screenshot({ path: SHOTS + '/tutorial_melon.png' });

    T('全程零脚本异常', errs.length === 0, errs.join('|').slice(0, 120));

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
