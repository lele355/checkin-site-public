// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// qa_ui3.js — UI 动效专项测试（进度条 / 淡入交错 / sticky 分组标题 / 按压回弹 / 加载对勾 / 主题水波 / 磁吸 / 降级）
// 用法: NODE_PATH=... node qa_ui3.js   → 输出 report-ui3.json + console 明细 + _shots 截图
// 基建约定同 qa_full.js / qa_ui2.js：playwright 用系统 Edge（channel:'msedge'）；
// dbq 铁律：Python sqlite3 一次只执行一条语句——多条必须拆开逐条执行（dbqMulti）；
// 直接 goto URL 不弹窗；#appModal 作用域内定位按钮防命中侧栏退出表单。
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = 'http://localhost:5188';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const QA_DIR = 'D:/projects/checkin/qa';
const OUT = 'D:/projects/checkin/_shots';
const TAG = 'UI3';                       // 标记词（防撞演示数据）
const results = [];
let curSec = '';

function sec(name) { curSec = name; console.log('\n===== ' + name + ' ====='); }
function T(name, cond, extra) {
    const ok = !!cond;
    results.push({ sec: curSec, name, ok, extra: String(extra || '') });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
}
function dbq(sql) {
    try {
        const out = execSync(`"${PY}" "${QA_DIR}/dbq.py"`, { input: sql, encoding: 'utf8' });
        return JSON.parse(out);
    } catch (e) { return [{ error: String(e) }]; }
}
function dbqMulti(sql) {
    return sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean).map(dbq);
}
function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dateKey(offsetDays) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function login(page, user, pass) {
    await page.goto(BASE + '/Login');
    await page.fill('#Username', user);
    await page.fill('#Password', pass);
    await page.click('#loginForm button[type=submit]');
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(300);
}
async function modalOpen(page) { return await page.evaluate(() => { const d = document.getElementById('appModal'); return !!(d && d.open); }); }

(async () => {
    fs.mkdirSync(OUT, { recursive: true });

    // ---- 造数：28 个习惯（长列表测进度条）+ 两个分组的日程（测 sticky 顶替） ----
    const uid = dbq(`select Id from Users where Username=ADMIN`)[0].Id;
    const K = todayKey();
    dbqMulti(`delete from HabitCheckins where UserId=${uid} and HabitId in (select Id from Habits where Name like '${TAG}-%');\n` +
        `delete from Habits where UserId=${uid} and Name like '${TAG}-%';\n` +
        `delete from Schedules where UserId=${uid} and Title like '${TAG}-%';`);
    let habVals = [];
    for (let i = 1; i <= 28; i++) {
        habVals.push(`(${uid}, '${TAG}-习惯${String(i).padStart(2, '0')}', '🌱', '${K} 08:00:00')`);
    }
    dbq(`insert into Habits (UserId, Name, Icon, CreatedAt) values ${habVals.join(',')}`);
    // 今天 12 条（第一组，够长把第二组推出首屏）+ 10 天后 8 条（更远组），两组都要够长才能滚出顶替效果
    let schVals = [];
    for (let i = 1; i <= 12; i++) {
        schVals.push(`(${uid}, '${TAG}-今天${i}', '今天组', '${K} ${String(7 + i).padStart(2, '0')}:00:00', NULL, 0, '${K} 08:00:00', '${K} 08:00:00')`);
    }
    const K2 = dateKey(10);
    for (let i = 1; i <= 8; i++) {
        schVals.push(`(${uid}, '${TAG}-更远${i}', '更远组', '${K2} ${String(8 + i).padStart(2, '0')}:00:00', NULL, 0, '${K} 08:00:00', '${K} 08:00:00')`);
    }
    dbq(`insert into Schedules (UserId, Title, Description, StartAt, EndAt, AllDay, CreatedAt, UpdatedAt) values ${schVals.join(',')}`);
    const seeded = dbq(`select Id from Habits where UserId=${uid} and Name like '${TAG}-%'`);
    T('造数成功（28 习惯 + 20 日程）', seeded.length === 28, 'habits=' + seeded.length);

    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => d.accept().catch(() => { }));

    try {
        await login(page, ADMIN, PW);
        T('admin 登录成功', !page.url().includes('Login'), page.url());

        // ================= S1 阅读进度条绑定滚动进度 =================
        sec('S1 阅读进度条（scroll-timeline / JS 兜底）');
        await page.goto(BASE + '/Habits?view=list');
        await page.waitForSelector('.row-item');
        await page.waitForTimeout(1200);   // 等淡入动画落位
        const barInfo = await page.evaluate(() => {
            const bar = document.querySelector('.scroll-progress');
            return {
                exists: !!bar,
                cssTimeline: document.documentElement.classList.contains('has-scroll-timeline'),
            };
        });
        T('进度条元素存在', barInfo.exists);
        T('识别滚动实现路径', true, barInfo.cssTimeline ? 'CSS scroll-timeline' : 'JS 兜底');

        // 滚到底 → 进度 ≈ 100%
        await page.evaluate(() => {
            const m = document.querySelector('main.content');
            if (m) m.scrollTop = m.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
        });
        await page.waitForTimeout(400);
        const pFull = await page.evaluate(() => {
            const t = getComputedStyle(document.querySelector('.scroll-progress')).transform;
            const mm = t.match(/matrix\(([-\d.]+)/);
            return mm ? parseFloat(mm[1]) : -1;
        });
        T('滚到底进度条≈满', pFull > 0.95, 'scaleX=' + pFull.toFixed(3));

        // 滚到一半 → 进度 ≈ 50%
        await page.evaluate(() => {
            const m = document.querySelector('main.content');
            if (m) m.scrollTop = (m.scrollHeight - m.clientHeight) / 2; else window.scrollTo(0, 400);
        });
        await page.waitForTimeout(400);
        const pMid = await page.evaluate(() => {
            const t = getComputedStyle(document.querySelector('.scroll-progress')).transform;
            const mm = t.match(/matrix\(([-\d.]+)/);
            return mm ? parseFloat(mm[1]) : -1;
        });
        T('滚到一半进度条≈半', pMid > 0.35 && pMid < 0.68, 'scaleX=' + pMid.toFixed(3));

        // ================= S2 进入视口淡入（只触发一次） =================
        sec('S2 淡入上移（IntersectionObserver 只触发一次）');
        await page.goto(BASE + '/Habits?view=list');
        await page.waitForSelector('.row-item');
        await page.waitForTimeout(300);
        const r1 = await page.evaluate(() => {
            const cards = document.querySelectorAll('main.content .card');
            const el = cards[0];
            return el ? { cls: el.className, op: getComputedStyle(el).opacity } : null;
        });
        T('首屏卡片已标记 reveal', r1 && /reveal/.test(r1.cls), r1 && r1.cls);
        await page.waitForTimeout(1000);
        const r2 = await page.evaluate(() => {
            const el = document.querySelector('main.content .card');
            return { isIn: el.classList.contains('is-in'), op: getComputedStyle(el).opacity, anims: el.getAnimations().length };
        });
        T('首屏卡片淡入完成（opacity=1）', r2.isIn && parseFloat(r2.op) > 0.99, 'op=' + r2.op);
        // 只触发一次：滚走再滚回，动画不重播（fill:both 的动画留在 finished 态，不会重新跑）
        await page.evaluate(() => { const m = document.querySelector('main.content'); m.scrollTop = m.scrollHeight; });
        await page.waitForTimeout(700);
        await page.evaluate(() => { const m = document.querySelector('main.content'); m.scrollTop = 0; });
        await page.waitForTimeout(700);
        const r3 = await page.evaluate(() => {
            const el = document.querySelector('main.content .card');
            const anims = el.getAnimations();
            return {
                isIn: el.classList.contains('is-in'),
                allFinished: anims.length > 0 && anims.every(a => a.playState === 'finished'),
                op: getComputedStyle(el).opacity,
            };
        });
        T('滚走再滚回不重播（仍 is-in、动画已结束）', r3.isIn && r3.allFinished && parseFloat(r3.op) > 0.99, JSON.stringify(r3));

        // 屏外卡片滚到才触发（分两步滚：瞬移跳过中间卡片的话 IO 永远不交叉、不会触发）
        await page.goto(BASE + '/Schedule?view=list');
        await page.waitForSelector('.group-head');
        await page.waitForTimeout(1100);
        const far1 = await page.evaluate(() => {
            const cards = document.querySelectorAll('main.content .card');
            return Array.prototype.map.call(cards, c => c.classList.contains('is-in'));
        });
        T('屏外卡片初始未触发', far1.length >= 2 && far1.some(x => !x), JSON.stringify(far1));
        await page.evaluate(() => { const m = document.querySelector('main.content'); m.scrollTop = (m.scrollHeight - m.clientHeight) / 2; });
        await page.waitForTimeout(800);
        await page.evaluate(() => { const m = document.querySelector('main.content'); m.scrollTop = m.scrollHeight; });
        await page.waitForTimeout(1000);
        const far2 = await page.evaluate(() => {
            const cards = document.querySelectorAll('main.content .card');
            return Array.prototype.map.call(cards, c => c.classList.contains('is-in'));
        });
        T('滚到底后全部触发', far2.length >= 2 && far2.every(x => x), JSON.stringify(far2));

        // ================= S3 网格交错入场（每项 +80ms） =================
        sec('S3 卡片网格交错入场（--i × 80ms）');
        await page.goto(BASE + '/Habits?view=grid');
        await page.waitForSelector('.habit-card');
        await page.waitForTimeout(300);
        const st = await page.evaluate(() => {
            const els = document.querySelectorAll('main.content .habit-cards > *');
            return Array.prototype.slice.call(els, 0, 3).map(el => ({
                i: el.style.getPropertyValue('--i'),
                delay: getComputedStyle(el).animationDelay,
                cls: el.className,
            }));
        });
        T('交错序号 --i 已注入', st.length === 3 && st[0].i === '0' && st[1].i === '1' && st[2].i === '2', JSON.stringify(st.map(x => x.i)));
        T('动画延迟按 80ms 递增', st.length === 3 && st[1].delay === '0.08s' && st[2].delay === '0.16s', JSON.stringify(st.map(x => x.delay)));
        await page.waitForTimeout(1500);
        const stOps = await page.evaluate(() => {
            const els = document.querySelectorAll('main.content .habit-cards > *');
            return Array.prototype.slice.call(els, 0, 6).map(el => getComputedStyle(el).opacity);
        });
        T('交错入场完成可见（首屏 6 项）', stOps.length === 6 && stOps.every(o => parseFloat(o) > 0.99), 'n=' + stOps.length);

        // ================= S4 sticky 分组标题被下一组顶替 =================
        sec('S4 分组标题 sticky 顶替');
        await page.goto(BASE + '/Schedule?view=list');
        await page.waitForSelector('.group-head');
        await page.waitForTimeout(1100);
        // 选「行数最多的组」当主角：小组（如 1 行的）滚两屏就正常离场，不适合断言吸附
        const pick = await page.evaluate(() => {
            const m = document.querySelector('main.content');
            const hs = Array.prototype.slice.call(document.querySelectorAll('.group-head'));
            let best = 0, bestRows = -1;
            hs.forEach((h, i) => {
                const rows = h.parentElement.querySelectorAll('.row-item').length;
                if (rows > bestRows) { bestRows = rows; best = i; }
            });
            // 期望吸附位 = 滚动容器内容盒顶 + group-head 的 sticky top（跨断点自适应）
            const stickTop = m.getBoundingClientRect().top
                + parseFloat(getComputedStyle(m).paddingTop)
                + parseFloat(getComputedStyle(hs[0]).top);
            return { best, bestRows, n: hs.length, stickTop };
        });
        T('页面有 ≥2 个分组标题', pick.n >= 2, 'n=' + pick.n + ' big=hs[' + pick.best + '] rows=' + pick.bestRows);

        // 把大标题滚到吸附线以上 30px → 必然进入吸附态
        await page.evaluate((b) => {
            const hs = document.querySelectorAll('.group-head');
            const m = document.querySelector('main.content');
            const stickTop = m.getBoundingClientRect().top
                + parseFloat(getComputedStyle(m).paddingTop)
                + parseFloat(getComputedStyle(hs[0]).top);
            m.scrollTop += (hs[b].getBoundingClientRect().top - stickTop) + 30;
        }, pick.best);
        await page.waitForTimeout(400);
        const s1 = await page.evaluate((b) => {
            const m = document.querySelector('main.content');
            const hs = document.querySelectorAll('.group-head');
            const stickTop = m.getBoundingClientRect().top
                + parseFloat(getComputedStyle(m).paddingTop)
                + parseFloat(getComputedStyle(hs[0]).top);
            return { top: hs[b].getBoundingClientRect().top, stickTop };
        }, pick.best);
        T('大标题吸附在顶部', Math.abs(s1.top - s1.stickTop) < 24, `top=${s1.top.toFixed(0)} stickTop=${s1.stickTop.toFixed(0)}`);

        // 再滚 150px（组内还有行）→ 标题钉在原地不动 = 真 sticky
        await page.evaluate(() => { const m = document.querySelector('main.content'); m.scrollTop += 150; });
        await page.waitForTimeout(300);
        const s1b = await page.evaluate((b) => {
            const hs = document.querySelectorAll('.group-head');
            return hs[b].getBoundingClientRect().top;
        }, pick.best);
        T('继续滚动仍钉在原地', Math.abs(s1b - s1.top) < 6, `top=${s1b.toFixed(0)} was=${s1.top.toFixed(0)}`);

        // 顶替：上一组的标题已被顶到吸附线以上（滚到下一组时被顶走）
        const s2 = await page.evaluate((b) => {
            const hs = document.querySelectorAll('.group-head');
            return b > 0 ? hs[b - 1].getBoundingClientRect().top : 9999;
        }, pick.best);
        T('上一组标题已被顶走', s2 < s1.stickTop - 5, `prevTop=${s2.toFixed(0)} stickTop=${s1.stickTop.toFixed(0)}`);
        await page.screenshot({ path: OUT + '/ui3_pc_schedule_sticky.png' });

        // ================= S5 按下 92% 缩放、松手弹簧回位 =================
        sec('S5 按钮按压回弹（92% + spring）');
        await page.goto(BASE + '/Schedule?view=list');
        await page.waitForSelector('.btn');
        await page.waitForTimeout(900);
        const btn5 = page.locator('main.content .btn').first();
        await btn5.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
        const box = await btn5.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(250);
        const pressT = await btn5.evaluate(el => getComputedStyle(el).transform);
        const pressM = pressT.match(/matrix\(([-\d.]+)/);
        const pressScale = pressM ? parseFloat(pressM[1]) : -1;
        T('按下缩到 92%', Math.abs(pressScale - 0.92) < 0.02, 'scale=' + pressScale.toFixed(3));
        // 移出按钮再松手 = 取消点击（否则「新建」链接会被点开弹窗，污染下一段测试）
        await page.mouse.move(box.x - 80, box.y - 60);
        await page.mouse.up();
        await page.waitForTimeout(500);
        const relT = await btn5.evaluate(el => getComputedStyle(el).transform);
        const relM = relT.match(/matrix\(([-\d.]+)/);
        const relScale = relM ? parseFloat(relM[1]) : 1;
        T('松手弹回 ≈1（弹簧过冲后回位）', Math.abs(relScale - 1) < 0.03, 'scale=' + relScale.toFixed(3));

        // ================= S6 保存：加载转圈 → 对勾 + 高光闪 =================
        sec('S6 弹窗保存 加载→对勾');
        // POST 延迟 1.2s，把加载态留住好断言
        await page.route('**/Schedule/New*', async route => {
            if (route.request().method() === 'POST') await new Promise(r => setTimeout(r, 1200));
            await route.continue();
        });
        if (await modalOpen(page)) { await page.locator('#appModal .modal-close').click(); await page.waitForTimeout(300); }   // 兜底：防上一段残留弹窗挡点击
        await page.locator('a[href="/Schedule/New"]').first().click();
        await page.waitForTimeout(600);
        T('新建弹窗打开', await modalOpen(page));
        await page.fill('#appModal input[name="Title"]', TAG + '-保存动效');
        await page.fill('#appModal input[name="StartAt"]', todayKey() + 'T20:00');
        // 事件探针：loading / done 类出现即写 sessionStorage（跨刷新存活）
        await page.evaluate(() => {
            const btn = document.querySelector('#appModal button[type=submit]');
            sessionStorage.setItem('ui3flow', 'init');
            new MutationObserver(() => {
                if (btn.classList.contains('is-done')) sessionStorage.setItem('ui3flow', 'done');
                else if (btn.classList.contains('is-loading')) sessionStorage.setItem('ui3flow', 'loading');
            }).observe(btn, { attributes: true, attributeFilter: ['class'] });
        });
        await page.locator('#appModal button:has-text("保存")').click();
        await page.waitForTimeout(450);
        const flow1 = await page.evaluate(() => ({
            f: sessionStorage.getItem('ui3flow'),
            cls: (document.querySelector('#appModal button[type=submit]') || {}).className || '',
        }));
        T('保存中出现加载态（转圈）', flow1.f === 'loading' && /is-loading/.test(flow1.cls), JSON.stringify(flow1));
        await page.screenshot({ path: OUT + '/ui3_pc_modal_loading.png' });
        // 抓对勾瞬间截图（done 只停留 ~0.5s）
        let gotDoneShot = false;
        for (let i = 0; i < 45; i++) {
            const has = await page.evaluate(() => !!document.querySelector('#appModal button.is-done'));
            if (has) { await page.screenshot({ path: OUT + '/ui3_pc_modal_done.png' }); gotDoneShot = true; break; }
            await page.waitForTimeout(60);
        }
        T('对勾态出现并截图', gotDoneShot);
        await page.waitForTimeout(1200);   // 等 520ms 演完 + reload
        await page.waitForLoadState('networkidle').catch(() => { });
        const flow2 = await page.evaluate(() => sessionStorage.getItem('ui3flow'));
        T('流程走完：loading→done', flow2 === 'done', 'ui3flow=' + flow2);
        await page.unroute('**/Schedule/New*').catch(() => { });
        const saved = dbq(`select Id from Schedules where UserId=${uid} and Title='${TAG}-保存动效'`);
        T('保存动效那笔落库', saved.length === 1, 'n=' + saved.length);

        // ================= S7 主题切换液态水波 =================
        sec('S7 主题切换液态水波（点击点圆形扩散）');
        await page.goto(BASE + '/');
        await page.waitForTimeout(600);
        await page.click('#appearanceBtn');
        await page.waitForTimeout(300);
        await page.locator('button[data-theme-slug="neumorphism"]').click();
        const washNow = await page.evaluate(() => !!document.querySelector('.theme-wash'));
        T('点击后水波元素立即出现', washNow);
        await page.waitForTimeout(250);
        await page.screenshot({ path: OUT + '/ui3_pc_theme_wash.png' });
        T('主题已切到新拟物', (await page.getAttribute('html', 'data-theme')) === 'neumorphism');
        await page.waitForTimeout(1100);
        const washGone = await page.evaluate(() => !document.querySelector('.theme-wash'));
        T('水波演完自动移除', washGone);
        // 还原 editorial（面板还开着就别再点开关——#appearanceBtn 是 toggle 会把它关掉）
        if (await page.evaluate(() => document.getElementById('appearancePanel').hidden)) await page.click('#appearanceBtn');
        await page.waitForTimeout(300);
        await page.locator('button[data-theme-slug="editorial"]').click();
        await page.waitForTimeout(1100);
        T('主题还原 editorial', (await page.getAttribute('html', 'data-theme')) === 'editorial');

        // ================= S8 磁吸位移（细指针 .btn） =================
        sec('S8 悬浮磁吸位移');
        await page.goto(BASE + '/Schedule?view=list');
        await page.waitForSelector('main.content .btn');
        await page.waitForTimeout(800);
        const btn8 = page.locator('main.content .btn').first();
        const box8 = await btn8.boundingBox();
        await page.mouse.move(box8.x + box8.width * 0.85, box8.y + box8.height * 0.2);   // 靠角落 → 位移更大
        await page.waitForTimeout(120);
        const mag = await btn8.evaluate(el => ({ t: el.style.translate || '', cls: el.className }));
        const magM = mag.t.match(/([-\d.]+)px\s+([-\d.]+)px/);
        const magOff = magM ? Math.hypot(parseFloat(magM[1]), parseFloat(magM[2])) : 0;
        T('悬停时按钮向指针磁吸位移', magOff > 0.5 && magOff <= 4.3, 'offset=' + magOff.toFixed(2) + 'px cls=' + mag.cls);
        await page.mouse.move(10, 10);
        await page.waitForTimeout(500);
        const mag2 = await btn8.evaluate(el => el.style.translate || '');
        T('移开后磁吸归零（弹簧回位）', mag2 === '' || /0\.00px 0\.00px/.test(mag2), 'translate="' + mag2 + '"');

        // ================= S9 减少动态偏好降级 =================
        sec('S9 prefers-reduced-motion 降级');
        const rctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
        const rp = await rctx.newPage();
        rp.on('dialog', d => d.accept().catch(() => { }));
        await login(rp, ADMIN, PW);
        await rp.goto(BASE + '/Habits?view=grid');
        await rp.waitForSelector('.habit-card');
        await rp.waitForTimeout(250);
        const red1 = await rp.evaluate(() => {
            const el = document.querySelector('main.content .habit-cards > *');
            return { cls: el.className, op: getComputedStyle(el).opacity };
        });
        T('降级模式内容立即可见（不做淡入）', !/is-in/.test(red1.cls) && parseFloat(red1.op) > 0.99, JSON.stringify(red1));
        await rp.click('#appearanceBtn');
        await rp.waitForTimeout(200);
        await rp.locator('button[data-theme-slug="macos"]').click();
        const red2 = await rp.evaluate(() => !!document.querySelector('.theme-wash'));
        T('降级模式不起水波', !red2);
        if (await rp.evaluate(() => document.getElementById('appearancePanel').hidden)) await rp.click('#appearanceBtn');
        await rp.waitForTimeout(200);
        await rp.locator('button[data-theme-slug="editorial"]').click();
        await rctx.close();

        // ================= S10 手机端截图 =================
        sec('S10 手机端效果');
        const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const mp = await mctx.newPage();
        mp.on('dialog', d => d.accept().catch(() => { }));
        await login(mp, ADMIN, PW);
        await mp.goto(BASE + '/Habits?view=list');
        await mp.waitForSelector('.row-item');
        await mp.waitForTimeout(1300);
        await mp.evaluate(() => {
            const m = document.querySelector('main.content');
            const el = (m && m.scrollHeight > m.clientHeight + 5) ? m : document.scrollingElement;
            el.scrollTop = Math.round(el.scrollHeight * 0.45);
        });
        await mp.waitForTimeout(400);
        await mp.screenshot({ path: OUT + '/ui3_mobile_habits.png' });
        await mp.goto(BASE + '/Schedule?view=list');
        await mp.waitForSelector('.group-head');
        await mp.waitForTimeout(1200);
        await mp.screenshot({ path: OUT + '/ui3_mobile_schedule.png' });
        await mctx.close();

        // ================= S11 页面健康 =================
        sec('S11 页面健康');
        T('全程无页面 JS 错误', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
    } catch (e) {
        T('脚本异常', false, e.message);
    }

    // ---- 清理造数（逐条执行） ----
    dbqMulti(`delete from HabitCheckins where UserId=${uid} and HabitId in (select Id from Habits where Name like '${TAG}-%');\n` +
        `delete from Habits where UserId=${uid} and Name like '${TAG}-%';\n` +
        `delete from Schedules where UserId=${uid} and Title like '${TAG}-%';`);
    const left = dbq(`select count(*) as n from Habits where Name like '${TAG}-%'`);
    console.log('清理后 UI3 残留: ' + JSON.stringify(left));

    await browser.close();
    const fails = results.filter(r => !r.ok);
    fs.writeFileSync(QA_DIR + '/report-ui3.json', JSON.stringify({ total: results.length, pass: results.length - fails.length, fail: fails.length, results }, null, 2));
    console.log('\n===== 汇总: ' + (results.length - fails.length) + '/' + results.length + ' 通过 =====');
    if (fails.length) { console.log('失败项:'); fails.forEach(f => console.log('  [' + f.sec + '] ' + f.name + '  ' + f.extra)); }
    process.exit(fails.length ? 1 : 0);
})();
