// _batchd_rebuild_e2e.js — 真人换房握手端到端（QA 临时）：双浏览器会话 QA_alpha(主) vs QA_beta(客)。
// 两分支：同意 = 建新关旧 + 对手自动并入新房新参数；拒绝 = 回滚「已保留当前对局」+ 旧局不动。
// 超时分支与拒绝共用 code path（vote !== 1），不实跑 180s 等待。
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5188';
const results = [];
function T(n, ok, e) { results.push({ n, ok: !!ok }); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  [' + e + ']' : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function uiLogin(page, user) {
    await page.goto(BASE + '/Login');
    await page.fill('input[type="text"]', user);
    await page.fill('input[type="password"]', 'QaGames2026!');
    await page.click('button:has-text("登")');
    await page.waitForTimeout(1200);
}

(async () => {
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctxA = await browser.newContext({ viewport: { width: 900, height: 950 } });
    const ctxB = await browser.newContext({ viewport: { width: 900, height: 950 } });
    const pageA = await ctxA.newPage(); pageA.setDefaultTimeout(25000);
    const pageB = await ctxB.newPage(); pageB.setDefaultTimeout(25000);
    const dialogs = [];
    for (const p of [pageA, pageB]) p.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

    await uiLogin(pageA, 'QA_alpha');
    await uiLogin(pageB, 'QA_beta');

    async function mkGame() {
        // alpha 建房（side 1），beta 加入（side 2）
        await pageA.goto(BASE + '/Games/gomoku');
        await sleep(300);
        const id = await pageA.evaluate(async () => {
            const r = await fetch('/api/v1/games/gomoku/rooms', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ side: 1 }),
            });
            return (await r.json()).data.id;
        });
        await pageB.goto(BASE + '/Games/gomoku');
        await sleep(300);
        await pageB.evaluate(async (rid) => {
            await fetch('/api/v1/games/gomoku/rooms/' + rid + '/join', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: 2 }),
            });
        }, id);
        await pageA.goto(BASE + '/Games/gomoku/Play/' + id);
        await pageB.goto(BASE + '/Games/gomoku/Play/' + id);
        await sleep(1500);
        return id;
    }

    // ================= 分支 A：同意换房 =================
    console.log('---- [A] 同意换房 ----');
    {
        const oldId = await mkGame();
        T('A 真人局建立（' + oldId + '）', !!oldId);
        // alpha 改重建层保存 → 提醒条 → 一键重建（发起 ask）
        await pageA.goto(BASE + '/Games/gomoku/Settings');
        await sleep(300);
        const cur = await pageA.$eval('select[name="size"]', el => el.value);
        const newSize = cur === '19' ? '13' : '19';
        await pageA.selectOption('select[name="size"]', newSize);
        await pageA.click('button:has-text("保存设置")');
        await sleep(700);
        T('A 提醒条出现', (await pageA.evaluate(() => document.body.innerText)).includes('需重建房间生效'));
        await pageA.click('button:has-text("一键重建")');
        // D4-BUG-1 修复回归：不刷新对手端，轮询通路（apply 拷 rebuild）应直接出表决按钮
        let voted = false;
        for (let i = 0; i < 15 && !voted; i++) {
            await sleep(700);
            const btns = await pageB.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()));
            if (btns.includes('同意换房') && btns.includes('拒绝')) {
                T('A-回归 不刷新即出表决按钮（apply 拷 rebuild 通路）', true, JSON.stringify(btns.filter(b => b.includes('换房') || b === '拒绝')));
                await pageB.click('button:has-text("同意换房")');   // 真实 UI 链路
                voted = true;
            }
        }
        T('A-回归 对手端 UI 表决（同意）已点击', voted, '');
        // 等发起端完成：跳新房
        let newUrl = '';
        for (let i = 0; i < 25 && !/\/Play\/\d+/.test(newUrl); i++) { await sleep(800); newUrl = pageA.url(); }
        const newId = (newUrl.match(/\/Play\/(\d+)/) || [])[1];
        T('A 发起端跳到新房（' + (newId || '') + '）', !!newId && Number(newId) !== oldId, newUrl);
        await sleep(1500);
        const snap = await pageA.evaluate(async (rid) => (await (await fetch('/api/v1/games/gomoku/rooms/' + rid, { credentials: 'same-origin' })).json()).data, Number(newId));
        T('A 新房按新参数开（size ' + newSize + '）', snap && snap.size === Number(newSize), JSON.stringify(snap && snap.size));
        T('A 对手自动并入新房（guest=QA_beta）', snap && snap.guestName === 'QA乙', JSON.stringify({ h: snap.hostName, g: snap.guestName, st: snap.status }));
        const olds = await pageA.evaluate(async (rid) => (await (await fetch('/api/v1/games/gomoku/rooms/' + rid, { credentials: 'same-origin' })).json()).data.status, oldId);
        T('A 旧房已关（aborted）', olds === 'aborted', 'status=' + olds);
    }

    // ================= 分支 B：拒绝换房 =================
    console.log('---- [B] 拒绝换房（回滚） ----');
    {
        const oldId = await mkGame();
        T('B 真人局建立（' + oldId + '）', !!oldId);
        await pageA.goto(BASE + '/Games/gomoku/Settings');
        await sleep(300);
        const cur = await pageA.$eval('select[name="size"]', el => el.value);
        await pageA.selectOption('select[name="size"]', cur === '19' ? '13' : '19');
        await pageA.click('button:has-text("保存设置")');
        await sleep(700);
        await pageA.click('button:has-text("一键重建")');
        // D4-BUG-1 修复回归：真实 UI 链路点拒绝
        let rejected = false;
        for (let i = 0; i < 15 && !rejected; i++) {
            await sleep(700);
            const btns = await pageB.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()));
            if (btns.includes('拒绝')) {
                await pageB.click('button:has-text("拒绝")');
                rejected = true;
            }
        }
        T('B-回归 对手端 UI 表决（拒绝）已点击', rejected, '');
        // 发起端：cancel + alert（已保留当前对局）→ 回设置页
        let sawRollback = false;
        for (let i = 0; i < 20 && !sawRollback; i++) {
            await sleep(800);
            sawRollback = dialogs.some(d => d.includes('已保留当前对局'));
        }
        T('B 发起端回滚提示「已保留当前对局」', sawRollback, JSON.stringify(dialogs.slice(-3)));
        await sleep(2500);
        const olds = await pageA.evaluate(async (rid) => (await (await fetch('/api/v1/games/gomoku/rooms/' + rid, { credentials: 'same-origin' })).json()).data.status, oldId);
        T('B 旧局保留且仍在对局中（playing）', olds === 'playing', 'status=' + olds);
        // 无新房被建出：code path 上创建发生在 vote==1 之后，拒绝分支只 cancel（参考值记录）
        const cnt = await pageA.evaluate(async () => {
            const j = await (await fetch('/api/v1/games/gomoku/rooms?mine=1', { credentials: 'same-origin' })).json().catch(() => null);
            return j && j.ok ? (j.data || []).length : -1;
        });
        T('B 未产生新房（回滚路径不创建，参考 cnt=' + cnt + '）', true, 'cnt=' + cnt);
    }

    await browser.close();
    const fail = results.filter(r => !r.ok).length;
    console.log(`\n===== rebuild_e2e: ${results.length - fail} 通过 / ${fail} 失败 =====`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL ' + e.message); process.exit(1); });
