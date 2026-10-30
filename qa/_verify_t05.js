// _verify_t05.js — T05 网页窄屏/横屏/落子精度 复验
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const BASE = 'http://127.0.0.1:5188';
const SHOTS = 'D:/checkin/site/qa/shots_t05';
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok, e: e || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const fs = require('fs');
fs.mkdirSync(SHOTS, { recursive: true });

async function loginApi(u) { const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'QaGames2026!', device: 't05' }) }); return (await r.json()).data.token; }

(async () => {
    const beta = await loginApi('QA_beta');
    const browser = await chromium.launch({ channel: 'msedge' });

    // 服务端实际提供的 CSS 是否含 T05 规则（静态文件不走 dll，以 HTTP 内容为准）
    {
        const css = await (await fetch(BASE + '/css/games.css')).text();
        T('0 CSS 已生效（max-width:min(520px,88vh)/<400px/ludo flex 修复/横屏 grid）',
            css.includes('max-width: min(520px, 88vh)') && css.includes('max-width: 400px') && css.includes('flex: 0 0 auto') && css.includes('data-gamekey="xiangqi"'),
            'len=' + css.length);
    }

    // ===== 1. 窄屏 360×640：大厅与对局 =====
    const ctxN = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const pageN = await ctxN.newPage();
    pageN.setDefaultTimeout(20000);
    const overflow = async p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    for (const gk of ['gomoku', 'reversi', 'jungle', 'xiangqi', 'ludo', 'armychess']) {
        await pageN.goto(BASE + '/Games/' + gk);
        await pageN.waitForLoadState('load');
        const ov = await overflow(pageN);
        T(`1 窄屏大厅 ${gk} 无横向溢出`, ov <= 1, 'scrollW-innerW=' + ov);
        if (gk === 'ludo') {
            await pageN.screenshot({ path: SHOTS + '/lobby_ludo_360.png', fullPage: true });
            // ludo 人数/AI 表单：子项不重叠
            const box = await pageN.evaluate(() => {
                const form = document.querySelector('.gm-ludo-form');
                if (!form) return { found: false };
                const kids = Array.from(form.children).map(el => {
                    const r = el.getBoundingClientRect();
                    return { tag: el.tagName + '.' + (el.className || '').toString().split(' ')[0], x: r.x, y: r.y, w: r.width, h: r.height, text: (el.innerText || el.value || '').slice(0, 20) };
                });
                return { found: true, kids, formW: form.getBoundingClientRect().width };
            });
            T('1 ludo 表单存在', box.found, '');
            if (box.found) {
                let overlap = null;
                for (let i = 0; i < box.kids.length; i++) for (let j = i + 1; j < box.kids.length; j++) {
                    const a = box.kids[i], b = box.kids[j];
                    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
                    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
                    if (ix > 2 && iy > 2) overlap = `${a.text} × ${b.text} (${ix.toFixed(0)}x${iy.toFixed(0)})`;
                }
                const inViewport = box.kids.every(k => k.x >= -1 && k.x + k.w <= 361);
                T('1 ludo 人数/AI 控件顺序堆叠不重叠', !overlap, overlap || `子项 ${box.kids.length} 个全部不重叠`);
                T('1 ludo 表单子项不超出视口', inViewport, JSON.stringify(box.kids.map(k => [k.text, Math.round(k.x), Math.round(k.w)])));
            }
        }
    }

    // 对局页（等待中即可验布局）：棋盘在视口内、按钮可点
    for (const gk of ['gomoku', 'xiangqi', 'jungle', 'armychess', 'ludo']) {
        await pageN.goto(BASE + '/Games/' + gk);
        await pageN.waitForLoadState('load');
        const btn = pageN.locator('form button[type="submit"]').filter({ hasText: /我先手|新建对局/ }).first();
        if (await btn.count()) {
            await Promise.all([pageN.waitForURL(/Play/i), btn.click()]);
            await pageN.waitForTimeout(700);
            const r = await pageN.evaluate(() => {
                const svg = document.querySelector('svg.gm-board');
                const b = svg ? svg.getBoundingClientRect() : null;
                const btns = Array.from(document.querySelectorAll('.gm-actions button, .gm-actions a')).filter(e => e.offsetParent !== null);
                return { hasBoard: !!svg, left: b ? b.left : -1, right: b ? b.right : -1, w: b ? b.width : 0, btns: btns.length, minBtnW: btns.length ? Math.min(...btns.map(x => x.getBoundingClientRect().width)) : 0 };
            });
            T(`1 窄屏对局 ${gk}：棋盘完整在视口内（宽<360）`, r.hasBoard && r.left >= -1 && r.right <= 361, JSON.stringify(r));
            T(`1 窄屏对局 ${gk}：操作按钮可点（可见数>0）`, r.btns > 0, 'btns=' + r.btns);
            const ov2 = await overflow(pageN);
            T(`1 窄屏对局 ${gk} 无横向溢出`, ov2 <= 1, 'ov=' + ov2);
            if (gk === 'gomoku') await pageN.screenshot({ path: SHOTS + '/play_gomoku_360.png', fullPage: true });
        }
    }
    await ctxN.close();

    // ===== 2. 落子精度（360×640 + 844×390）=====
    async function precisionRun(width, height, label) {
        const ctx = await browser.newContext({ viewport: { width, height } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(20000);
        // admin（自动登录）建房 → QA_beta 加入 → playing，admin=黑(side1)先手
        await page.goto(BASE + '/Games/gomoku');
        await page.waitForLoadState('load');
        const btn = page.locator('form button[type="submit"]').filter({ hasText: /我先手|新建对局/ }).first();
        await Promise.all([page.waitForURL(/Play/i), btn.click()]);
        const roomId = Number(page.url().match(/Play\/(\d+)/)[1]);
        const room = await (await fetch(`${BASE}/api/v1/games/gomoku/rooms/${roomId}`, { headers: { Authorization: 'Bearer ' + beta } })).json();
        // beta 凭 id 加入（API）
        await fetch(`${BASE}/api/v1/games/gomoku/rooms/${roomId}/join`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: '{}' });
        await page.waitForTimeout(1500); // 轮询到 playing
        const st = await page.evaluate(async id => {
            const r = await fetch('/api/v1/games/gomoku/rooms/' + id, { credentials: 'same-origin' });
            const j = await r.json(); return j.data;
        }, roomId);
        const showCoord = st.showCoord !== false;
        const S = (st.state && st.state.size) || 15;
        const targets = [[0, 0], [Math.floor(S / 2), Math.floor(S / 2)], [S - 1, S - 1], [Math.min(3, S - 1), Math.max(0, S - 4)]];
        let mism = [];
        for (const [c, r] of targets) {
            const pt = await page.evaluate(({ c, r, showCoord, S }) => {
                const svg = document.querySelector('svg.gm-board');
                const rect = svg.getBoundingClientRect();
                const pad = showCoord ? 40 : 20;
                const step = (640 - pad * 2) / S;
                const px = pad + c * step + step / 2, py = pad + r * step + step / 2;
                return { x: rect.left + px / 640 * rect.width, y: rect.top + py / 640 * rect.height, size: S };
            }, { c, r, showCoord, S });
            await page.mouse.click(pt.x, pt.y);
            await page.waitForTimeout(700);
            const last = await page.evaluate(async id => {
                const r = await fetch('/api/v1/games/gomoku/rooms/' + id, { credentials: 'same-origin' });
                const j = await r.json();
                const lastMove = j.data.lastMove;
                return lastMove;
            }, roomId);
            if (!last || last.x !== c || last.y !== r) mism.push(`(${c},${r})→${JSON.stringify(last)}`);
        }
        T(`2 落子精度 ${label}（${S} 路盘）：点 4 个交叉点（两角+中心+边）落点全准`, mism.length === 0, mism.join(' | ') || '4/4 准');
        if (label.includes('360')) await page.screenshot({ path: SHOTS + '/precision_360.png', fullPage: true });
        else await page.screenshot({ path: SHOTS + '/precision_844.png', fullPage: true });
        await ctx.close();
    }
    await precisionRun(360, 640, '360×640');
    await precisionRun(844, 390, '844×390');

    // ===== 3. 横屏 844×390 分栏 =====
    const ctxL = await browser.newContext({ viewport: { width: 844, height: 390 } });
    const pageL = await ctxL.newPage();
    pageL.setDefaultTimeout(20000);
    for (const gk of ['xiangqi', 'jungle', 'armychess', 'ludo']) {
        await pageL.goto(BASE + '/Games/' + gk);
        await pageL.waitForLoadState('load');
        const btn = pageL.locator('form button[type="submit"]').filter({ hasText: /我先手|新建对局/ }).first();
        if (await btn.count()) {
            await Promise.all([pageL.waitForURL(/Play/i), btn.click()]);
            await pageL.waitForTimeout(800);
            const r = await pageL.evaluate(() => {
                const card = document.querySelector('.gm-card');
                const bw = document.querySelector('.gm-board-wrap');
                const st = document.querySelector('.gm-status');
                const svg = document.querySelector('svg.gm-board');
                const bwr = bw.getBoundingClientRect(), str = st.getBoundingClientRect(), sr = svg.getBoundingClientRect();
                const cs = getComputedStyle(card);
                return { display: cs.display, cols: cs.gridTemplateColumns, bwLeft: bwr.left, bwRight: bwr.right, stLeft: str.left, svgBottom: sr.bottom, svgRight: sr.right, vh: window.innerHeight, vw: window.innerWidth };
            });
            const split = r.display === 'grid' && r.bwRight <= r.stLeft + 2 && r.bwLeft < r.stLeft;
            const boardOK = r.svgBottom <= r.vh + 2 && r.svgRight <= r.vw + 2;
            T(`3 横屏 ${gk}：左右分栏（棋盘左/信息右）`, split, `display=${r.display} cols=${r.cols} bwRight=${r.bwRight.toFixed(0)} stLeft=${r.stLeft.toFixed(0)}`);
            T(`3 横屏 ${gk}：棋盘完整不裁切`, boardOK, `svgBottom=${r.svgBottom.toFixed(0)}/${r.vh} right=${r.svgRight.toFixed(0)}/${r.vw}`);
            if (gk === 'xiangqi') await pageL.screenshot({ path: SHOTS + '/landscape_xiangqi.png' });
        }
    }
    for (const gk of ['gomoku', 'reversi']) {
        await pageL.goto(BASE + '/Games/' + gk);
        await pageL.waitForLoadState('load');
        const btn = pageL.locator('form button[type="submit"]').filter({ hasText: /我先手/ }).first();
        await Promise.all([pageL.waitForURL(/Play/i), btn.click()]);
        await pageL.waitForTimeout(600);
        const r = await pageL.evaluate(() => {
            const card = document.querySelector('.gm-card');
            const svg = document.querySelector('svg.gm-board');
            return { display: getComputedStyle(card).display, hasBoard: !!svg, h: svg ? svg.getBoundingClientRect().height : 0 };
        });
        T(`3 横屏 ${gk}：白名单外不分栏（保持竖排可用）`, r.display !== 'grid' && r.hasBoard, JSON.stringify(r));
    }
    await ctxL.close();

    // ===== 3b. 竖屏 DOM 顺序未被横屏样式影响 =====
    const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageP = await ctxP.newPage();
    await pageP.goto(BASE + '/Games/xiangqi');
    await pageP.waitForLoadState('load');
    const btnP = pageP.locator('form button[type="submit"]').filter({ hasText: /我先手/ }).first();
    await Promise.all([pageP.waitForURL(/Play/i), btnP.click()]);
    await pageP.waitForTimeout(700);
    const order = await pageP.evaluate(() => {
        const card = document.querySelector('.gm-card');
        const head = card.querySelector('.page-head');
        const bw = card.querySelector('.gm-board-wrap');
        const st = card.querySelector('.gm-status');
        const hb = head.getBoundingClientRect(), bb = bw.getBoundingClientRect(), sb = st.getBoundingClientRect();
        return { headTop: hb.top, boardTop: bb.top, statusTop: sb.top };
    });
    T('3b 竖屏 DOM 顺序不变（页头→状态→棋盘，既有布局）', order.headTop <= order.statusTop && order.statusTop <= order.boardTop, JSON.stringify(order));
    await ctxP.close();

    await browser.close();
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL: ' + r.n + '  [' + r.e + ']');
})();
