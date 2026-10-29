// qa_games_250.js — 小游戏（五子棋）网页端专项验证
// 用法：export QA_PASS='…' && node qa_games_250.js
// 前提：本地站跑在 http://127.0.0.1:5188；管理员口令走 _env.js（不写死在文件里）；
//       另需一个普通账号 qagamer / Qa123456（脚本会自动建）。
//
// 这个脚本覆盖：建房 → 页面渲染 → 点击落子（考验 SVG 坐标换算）→
// 对手（另一个账号，走 API）落子 → 轮询把对手那手拉回来 → 手机视口不横向溢出。
const { chromium } = require('playwright');
const { USER, PASS } = require('./_env');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const GUEST = { u: 'qagamer', p: 'Qa123456' };

const out = [];
function T(name, ok, extra) {
    out.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}

async function api(method, path, body, token) {
    const r = await fetch(BASE + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' },
            token ? { Authorization: 'Bearer ' + token } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return r.json();
}

/**
 * 点棋盘交叉点：把格子坐标换算成相对 svg 的像素位置。
 * 留白和步长都从页面下发的 #gmState 里取 —— 盘面可能是 13/15/19，
 * 开了坐标时留白也会变大，写死 20/40 迟早对不上。
 */
async function tapPoint(page, col, row) {
    const st = JSON.parse(await page.locator('#gmState').textContent());
    const pad = st.pad, step = (640 - st.pad * 2) / (st.size - 1);
    const box = await page.locator('#gmBoard').boundingBox();
    const x = box.x + (pad + col * step) / 640 * box.width;
    const y = box.y + (pad + row * step) / 640 * box.height;
    await page.mouse.click(x, y);
    await page.waitForTimeout(600);
}

const stoneCount = async (page) => page.locator('#gmStones circle.gm-stone').count();

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => T('页面无 JS 异常', false, e.message));

    // ---------- 登录 ----------
    await page.goto(BASE + '/Login');
    await page.fill('#Username', USER);
    await page.fill('input[type="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    T('登录成功', !page.url().toLowerCase().includes('/login'), page.url());

    // ---------- 侧栏有入口 ----------
    const navText = await page.locator('.sidebar').innerText().catch(() => '');
    T('侧栏出现「小游戏」入口', navText.includes('小游戏'));

    // ---------- 先把我的默认设置摁回出厂值 ----------
    // 这个脚本假设「单击即落、带坐标、15 路、自由规则、不限时」。
    // 设置是账号级的，上一个脚本（或手动测试）留下 tapConfirm=true 时，
    // 这里的第一下就只出预览圈 —— 会让后面 5 条断言连锁失败。
    // 与其依赖执行顺序，不如进来先自证环境。
    const meLogin = await api('POST', '/api/v1/auth/login',
        { username: USER, password: PASS, device: 'qa-games-250' });
    const meTok = meLogin && meLogin.ok ? meLogin.data.token : null;
    T('拿到自己的令牌（用于重置设置）', !!meTok, meLogin && meLogin.error);
    if (meTok) {
        // 设置分两个入口，各存各的半 —— 得打两枪才能整体恢复出厂值
        const rd = await api('PUT', '/api/v1/games/settings', {
            tapConfirm: false, showCoord: true, lastMark: true, vibrate: true,
        }, meTok);
        const rr = await api('PUT', '/api/v1/games/gomoku/settings', {
            size: 15, forbidden: false, moveTimeoutSec: 0, totalTimeoutSec: 0,
        }, meTok);
        T('默认设置已重置为出厂值', rd.ok === true && rr.ok === true && rd.data.tapConfirm === false,
            JSON.stringify(rd.data || rd.error) + ' / ' + JSON.stringify(rr.data || rr.error));
    }

    // ---------- 大厅 ----------
    await page.goto(BASE + '/Games/Gomoku');
    await page.waitForLoadState('networkidle');
    T('大厅可达', page.url().includes('/Games'), page.url());
    T('有「新建对局（我先手）」按钮', (await page.locator('body').innerText()).includes('新建对局（我先手）'));
    await page.screenshot({ path: 'qa_games_lobby_pc.png', fullPage: true });

    // ---------- 建房 ----------
    const createBtn = page.locator('form[action*="handler=Create"] button').first();
    await createBtn.click();
    await page.waitForLoadState('networkidle');
    T('建房后进入棋盘页', /\/Games\/Gomoku\/Play\/\d+/.test(page.url()), page.url());

    const roomId = page.url().match(/\/Games\/Gomoku\/Play\/(\d+)/)[1];
    const codeText = await page.locator('.gm-code').innerText();
    const code = codeText.replace(/[^A-Z0-9]/g, '');
    T('显示房间码（6 位）', code.length === 6, codeText);

    T('棋盘 SVG 已渲染', await page.locator('#gmBoard').count() === 1);
    T('等待中有「解散」按钮', (await page.locator('body').innerText()).includes('解散'));
    T('初始没有棋子', await stoneCount(page) === 0);
    await page.screenshot({ path: 'qa_games_play_waiting_pc.png', fullPage: true });

    // ---------- 对手加入（走 API） ----------
    let g = await api('POST', '/api/v1/auth/login', { username: GUEST.u, password: GUEST.p, device: 'qa' });
    if (!g.ok) {
        const adm = await api('POST', '/api/v1/auth/login', { username: USER, password: PASS, device: 'qa' });
        const roles = await api('GET', '/api/v1/admin/roles', undefined, adm.data.token);
        const rid = roles.data.roles.find(r => r.name === '普通用户').id;
        await api('POST', '/api/v1/admin/users',
            { username: GUEST.u, displayName: 'QA棋友', email: '', roleId: rid, isActive: true, password: GUEST.p },
            adm.data.token);
        g = await api('POST', '/api/v1/auth/login', { username: GUEST.u, password: GUEST.p, device: 'qa' });
    }
    T('对手账号登录', g.ok, g.error || '');
    const gt = g.data.token;

    const joined = await api('POST', '/api/v1/games/join', { code }, gt);
    T('对手凭房间码加入', joined.ok, joined.error || '');

    // 状态从 waiting → playing，前端会整页刷新一次
    await page.waitForTimeout(2600);
    await page.waitForLoadState('networkidle');
    T('加入后页面自动刷新到对局中', (await page.locator('#gmStatus').innerText()).includes('轮到你'),
        await page.locator('#gmStatus').innerText());

    // ---------- 我（黑）点棋盘落子 ----------
    await tapPoint(page, 7, 7);
    T('点击落子后出现 1 颗棋子', await stoneCount(page) === 1, String(await stoneCount(page)));
    T('出现最后一手标记', await page.locator('#gmStones circle.gm-last').count() === 1);

    const st = await api('GET', '/api/v1/games/gomoku/rooms/' + roomId, undefined, gt);
    T('服务端记录了这手 (7,7)', st.data.moveCount === 1 && st.data.moves[0].x === 7 && st.data.moves[0].y === 7,
        JSON.stringify(st.data.moves));

    // ---------- 对手落子 → 轮询拉回 ----------
    const mv = await api('POST', '/api/v1/games/gomoku/rooms/' + roomId + '/move', { x: 8, y: 8 }, gt);
    T('对手落子成功', mv.ok, mv.error || '');
    await page.waitForTimeout(2600);
    T('轮询自动拉回对手那一手（2 颗子）', await stoneCount(page) === 2, String(await stoneCount(page)));
    T('轮到我时状态条更新', (await page.locator('#gmStatus').innerText()).includes('轮到你'));

    // ---------- 点了已有子的位置不该变化 ----------
    await tapPoint(page, 7, 7);
    T('点已有棋子的交叉点不落子', await stoneCount(page) === 2, String(await stoneCount(page)));

    await page.screenshot({ path: 'qa_games_play_pc.png', fullPage: true });

    // ---------- 手机视口 ----------
    const mob = await ctx.newPage();
    await mob.setViewportSize({ width: 390, height: 844 });
    mob.on('pageerror', e => T('手机视口无 JS 异常', false, e.message));
    await mob.goto(BASE + '/Games/Gomoku/Play/' + roomId);
    await mob.waitForLoadState('networkidle');
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    T('手机视口无横向溢出', overflow <= 1, 'overflow=' + overflow);
    const box = await mob.locator('#gmBoard').boundingBox();
    T('手机视口棋盘在可视宽度内', box && box.width <= 390, box ? String(Math.round(box.width)) : 'no box');
    await mob.screenshot({ path: 'qa_games_play_mobile.png', fullPage: true });

    // ---------- 大厅能看到这盘 ----------
    await mob.goto(BASE + '/Games/Gomoku');
    await mob.waitForLoadState('networkidle');
    const lobby = await mob.locator('body').innerText();
    // 对局中的房间行显示的是「手数」而不是房间码，所以这里认链接和分组标题
    T('大厅里列出我的对局',
        lobby.includes('我的对局') && (await mob.locator(`a[href="/Games/Gomoku/Play/${roomId}"]`).count()) > 0);

    await browser.close();

    const bad = out.filter(x => !x.ok).length;
    console.log('\n结果：' + (out.length - bad) + ' 通过 / ' + bad + ' 失败');
    process.exit(bad ? 1 : 0);
})();
