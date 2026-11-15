// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// qa_opt_3110.js — 2.11.0 四项优化专项（真实浏览器 + 真接口）
// 覆盖：1) 浮动标签 2) 记账搜索 3) 飞行棋彻底下架 4) 扫雷可玩与记分
// 用法：node qa_opt_3110.js     站点 127.0.0.1:5099 已起
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5099';
// 页面走 BASE，接口统一走 /api/v1（两者前缀不同，别混）
const API = BASE + '/api/v1';
const DB = 'D:/checkin/site/CheckinApp/data/checkin.db';
const PW = 'QaGames2026!';
const SHOTS = 'D:/checkin/site/qa/shots_opt';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function db(sql, mode = 'ro') {
    const out = execFileSync('python', ['-c',
        `import sqlite3,json
c=sqlite3.connect(r'file:${DB}?mode=${mode}', uri=True)
cur=c.cursor(); cur.execute("""${sql.replace(/"/g, '\\"')}""")
rows=cur.fetchall() if cur.description else []
cols=[d[0] for d in cur.description] if cur.description else []
${mode === 'ro' ? '' : 'c.commit()'}
c.close()
print(json.dumps({'cols':cols,'rows':rows}, default=str, ensure_ascii=False))`], { encoding: 'utf8' });
    return JSON.parse(out);
}

// 本机环境把 http_proxy 指向 127.0.0.1:1879，Node 内置 fetch 会被它劫持（GET 返回 HTML、POST body 丢失）。
// 统一走 curl --noproxy '*' 直连，和《操作手册》里「核验站点绕开代理」是同一条规矩。
function api(method, path, body, token) {
    // 接口前缀是 /api/v1（页面是 /），路径别写错。用 -i 把状态行一起拿回来。
    const args = ['-s', '-i', '--noproxy', '*', '-X', method, API + path,
        '-H', 'Content-Type: application/json'];
    if (token) args.push('-H', 'Authorization: Bearer ' + token);
    if (body != null) args.push('-d', JSON.stringify(body));
    const out = execFileSync('curl', args, { encoding: 'utf8' });
    const m = out.match(/^HTTP\/[\d.]+\s+(\d{3})/);
    const status = m ? parseInt(m[1], 10) : 0;
    const sep = out.indexOf('\r\n\r\n');
    const text = sep >= 0 ? out.slice(sep + 4) : out;
    let json = null;
    try { json = JSON.parse(text); } catch (_) { }
    return Promise.resolve({ status, json, raw: text.slice(0, 160) });
}

(async () => {
    // ---------------- 登录 ----------------
    // 站点以 CHECKIN_LOCAL=1 起（回环 + 本机 Host 才放行），中间件自动以 admin 身份放行，
    // API 与页面都不需要密码。测试账目全部带唯一标记，跑完即删。
    const MARK = 'QAMARK3110';
    const token = null;


    // ================= 1. 记账搜索（API） =================
    const created = [];
    for (const e of [
        { amount: 23.5, type: 'out', category: MARK + '餐饮', occurDate: '2026-11-10', note: MARK + 'A 午饭' },
        { amount: 6, type: 'out', category: '交通', occurDate: '2026-10-02', note: MARK + 'B 地铁' },
        { amount: 300, type: 'in', category: '其他', occurDate: '2026-09-15', note: MARK + 'C 卖书' },
    ]) {
        const r = await api('POST', '/expenses', e, token);
        if (r.json && r.json.ok) created.push(r.json.data.id);
    }
    T('建 3 笔测试账目', created.length === 3, created.join(',') + ' | ' + JSON.stringify((await api('POST','/expenses',{amount:1,type:'out',category:'x',occurDate:'2026-11-01',note:'errprobe'},token)).json));

    const s1 = await api('GET', '/expenses?month=2026-11&q=' + encodeURIComponent(MARK + 'A'), null, token);
    T('搜索请求成功', s1.json && s1.json.ok);
    T('搜索态标记 searching=true', s1.json && s1.json.data.searching === true);
    T('搜唯一标记命中 1 笔', s1.json && s1.json.data.items.length === 1,
        s1.json && s1.json.data.items.length);
    T('命中项备注含关键字', s1.json && (s1.json.data.items[0].note || '').includes(MARK + 'A'));

    const s2 = await api('GET', '/expenses?month=2026-11&q=' + encodeURIComponent(MARK + '餐饮'), null, token);
    T('按分类也能搜到', s2.json && s2.json.data.items.length === 1 && s2.json.data.items[0].category === MARK + '餐饮');

    const s3 = await api('GET', '/expenses?month=2026-11&q=' + encodeURIComponent('不存在的词xyz'), null, token);
    T('没匹配时返回空列表', s3.json && s3.json.ok && s3.json.data.items.length === 0);

    // 跨月：搜 10 月的「地铁」不该受 month=2026-11 限制
    const s4 = await api('GET', '/expenses?month=2026-11&q=' + encodeURIComponent(MARK + 'B'), null, token);
    T('跨月命中（10 月的账）', s4.json && s4.json.data.items.length === 1 &&
        String(s4.json.data.items[0].occurDate).startsWith('2026-10'), s4.json && JSON.stringify(s4.json.data.items[0] || {}));

    const s5 = await api('GET', '/expenses?month=2026-11', null, token);
    T('不带 q：searching=false', s5.json && s5.json.data.searching === false);
    T('不带 q：仍按月返回', s5.json && s5.json.ok && s5.json.data.items.every(x => String(x.occurDate).startsWith('2026-11')), s5.json && s5.json.data.items.length + ' 笔');
    T('不带 q：近 12 个月在', s5.json && s5.json.data.months.length === 12);
    T('搜索态不回 12 个月（省查询）', s1.json && s1.json.data.months.length === 0);

    // ================= 2. 扫雷（API 记分） =================
    const lb0 = await api('GET', '/games/minesweeper/leaderboard', null, token);
    T('扫雷排行榜可用', lb0.json && lb0.json.ok, lb0.json && lb0.json.error);

    const sc1 = await api('POST', '/games/minesweeper/score', { score: 2500 }, token);
    T('扫雷记分 2500', sc1.json && sc1.json.ok && sc1.json.data.bestScore === 2500, JSON.stringify(sc1.json));

    const sc2 = await api('POST', '/games/minesweeper/score', { score: 1200 }, token);
    T('低分不覆盖最高分（幂等 max）', sc2.json && sc2.json.ok && sc2.json.data.bestScore === 2500);

    const sc3 = await api('POST', '/games/minesweeper/score', { score: 99999999 }, token);
    T('超上限被拒', sc3.json && !sc3.json.ok);

    // ================= 3. 飞行棋彻底下架（API） =================
    const ludo1 = await api('GET', '/games/ludo/rooms', null, token);
    T('ludo 建房接口已不存在', ludo1.status === 400 || ludo1.status === 404, 'status=' + ludo1.status);
    const ludo2 = await api('POST', '/games/ludo/rooms', { side: 1 }, token);
    T('ludo 建房被拒', ludo2.json && !ludo2.json.ok, JSON.stringify(ludo2.json));
    const ludo3 = await api('POST', '/games/ludo/rooms/1/roll', {}, token);
    T('ludo 掷骰接口已删', ludo3.status === 404 || (ludo3.json && !ludo3.json.ok), 'status=' + ludo3.status);

    const cols = db('PRAGMA table_info(GameRooms)');
    T('SeatsJson 列已删除', !cols.rows.some(r => r[1] === 'SeatsJson'));
    const left = db("select count(*) from GameRooms where GameKey='ludo'");
    T('库里没有 ludo 房间', Number(left.rows[0][0]) === 0, left.rows[0][0]);

    // ================= 4. 页面（真实浏览器） =================
    const browser = await chromium.launch({ channel: 'msedge' });
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    // 4.1 游戏列表：无飞行棋、有扫雷
    await page.goto(BASE + '/Games');
    await sleep(400);
    const gamesTxt = await page.evaluate(() => document.body.innerText);
    T('游戏列表含「扫雷」', gamesTxt.includes('扫雷'));
    T('游戏列表不含「飞行棋」', !gamesTxt.includes('飞行棋'));
    await page.screenshot({ path: SHOTS + '/games-list.png', fullPage: true });

    // 4.2 扫雷页可玩
    await page.goto(BASE + '/Games/minesweeper/Solo');
    await sleep(800);
    const msPage = await page.evaluate(() => ({
        hasCanvas: !!document.getElementById('soloCanvas'),
        levels: document.querySelectorAll('[data-ms-level]').length,
        hasCore: !!window.MineCore,
        hasGame: !!window.__msGame,
        canvasW: document.getElementById('soloCanvas')?.width,
        canvasH: document.getElementById('soloCanvas')?.height,
    }));
    T('扫雷页有画布', msPage.hasCanvas);
    T('三档难度按钮', msPage.levels === 3, msPage.levels);
    T('规则内核已加载', msPage.hasCore);
    T('初始盘 9×9（360×360）', msPage.canvasW === 360 && msPage.canvasH === 360,
        msPage.canvasW + '×' + msPage.canvasH);

    // 点开一格：opened 增长、计时开始
    const play = await page.evaluate(() => {
        const g = window.__msGame;
        const before = { opened: g.opened, started: g.started };
        g.reveal(40);
        return {
            before,
            after: { opened: g.opened, started: g.started, over: g.over },
            hasNumber: g.cells.some(c => c.open && c.adj > 0),
        };
    });
    T('首次点击安全开局', play.after.started && !play.after.over);
    T('点开一片（递归展开）', play.after.opened > 1, play.after.opened + ' 格');

    // 切中级：16×16 / 512
    await page.click('[data-ms-level="2"]');
    await sleep(500);
    const mid = await page.evaluate(() => ({
        w: document.getElementById('soloCanvas').width,
        h: document.getElementById('soloCanvas').height,
        cols: window.__msGame.cols, rows: window.__msGame.rows, mines: window.__msGame.mines,
    }));
    T('中级 16×16 / 40 雷', mid.cols === 16 && mid.rows === 16 && mid.mines === 40);
    T('中级画布 512×512', mid.w === 512 && mid.h === 512, mid.w + '×' + mid.h);

    // 切高级：30 列
    await page.click('[data-ms-level="3"]');
    await sleep(500);
    const hard = await page.evaluate(() => ({
        w: document.getElementById('soloCanvas').width,
        h: document.getElementById('soloCanvas').height,
        cols: window.__msGame.cols, mines: window.__msGame.mines,
    }));
    T('高级 30 列 / 99 雷', hard.cols === 30 && hard.mines === 99);
    T('高级画布 660×352', hard.w === 660 && hard.h === 352, hard.w + '×' + hard.h);

    // 退回初级并截图
    await page.click('[data-ms-level="1"]');
    await sleep(300);
    await page.evaluate(() => window.__msGame.reveal(40));
    await sleep(300);
    await page.screenshot({ path: SHOTS + '/minesweeper.png', fullPage: true });

    // 4.3 记账页搜索框 + 搜索态
    await page.goto(BASE + '/Expenses');
    await sleep(300);
    const hasSearch = await page.evaluate(() => !!document.querySelector('form.inline-form input[name="q"]'));
    T('记账页有搜索框', hasSearch);

    await page.goto(BASE + '/Expenses?q=' + encodeURIComponent(MARK + 'A'));
    await sleep(300);
    const sTxt = await page.evaluate(() => document.body.innerText);
    T('搜索页显示关键字标题', sTxt.includes('搜索「' + MARK + 'A」'));
    T('搜索结果含命中账目', sTxt.includes(MARK + 'A'));
    T('搜索页不出现月度切换', !sTxt.includes('月度'));
    await page.screenshot({ path: SHOTS + '/expenses-search.png', fullPage: true });

    // 4.4 浮动标签（记账新建页）
    await page.goto(BASE + '/Expenses/New');
    await sleep(400);
    const floatInfo = await page.evaluate(() => {
        const fields = [...document.querySelectorAll('.field')];
        const fl = fields.filter(f => f.classList.contains('float'));
        const first = fl[0];
        const lab = first && first.querySelector('label');
        const cs = lab ? getComputedStyle(lab) : null;
        return {
            total: fields.length,
            floated: fl.length,
            labels: fl.map(f => f.querySelector('label')?.textContent.trim()),
            pos: cs && cs.position,
            top: cs && cs.top,
            fontSize: cs && cs.fontSize,
            // 开关型字段不应参与
            switches: [...document.querySelectorAll('.field:has(> label > input.switch)')]
                .filter(f => f.classList.contains('float')).length,
        };
    });
    T('记账新建页字段被识别为浮动标签', floatInfo.floated >= 3, JSON.stringify(floatInfo.labels));
    T('浮动标签绝对定位（坐进输入框）', floatInfo.pos === 'absolute', floatInfo.pos);
    // 未聚焦且空值的文本输入框：label 应该还在框内（top 不是负偏移）。
    // 「类型」是 select，恒上浮，所以不能拿第一个字段当代表。
    const noteTop = await page.evaluate(() => {
        const f = [...document.querySelectorAll('.field.float')].find(x => x.querySelector('input[name="Note"]'));
        return f ? getComputedStyle(f.querySelector('label')).top : 'none';
    });
    T('空值未聚焦时 label 留在框内', parseFloat(noteTop) >= 0, noteTop);
    T('开关型字段不参与浮动', floatInfo.switches === 0);

    // 聚焦金额框 → label 上浮（top 变负）
    await page.click('input[name="Amount"]');
    await sleep(350);
    const upTop = await page.evaluate(() => {
        const f = [...document.querySelectorAll('.field.float')].find(x => x.querySelector('input[name="Amount"]'));
        return getComputedStyle(f.querySelector('label')).top;
    });
    T('聚焦后 label 上浮到边框', parseFloat(upTop) < 0, upTop);

    // 已经有值的输入框（金额空、备注空；改日期看 select 恒上浮）
    const selTop = await page.evaluate(() => {
        const f = [...document.querySelectorAll('.field.float')].find(x => x.querySelector('select'));
        return f ? getComputedStyle(f.querySelector('label')).top : 'none';
    });
    T('select 的 label 恒上浮', parseFloat(selTop) < 0, selTop);
    await page.screenshot({ path: SHOTS + '/float-label.png', fullPage: true });

    // 4.5 其它游戏大厅未被删飞行棋带崩
    await page.goto(BASE + '/Games/armychess');
    await sleep(300);
    T('军旗大厅正常', (await page.evaluate(() => document.body.innerText)).includes('新开一盘'));
    await page.goto(BASE + '/Games/melon/Solo');
    await sleep(500);
    T('合成大西瓜仍可打开', await page.evaluate(() => !!document.getElementById('soloCanvas')));

    T('页面无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

    await browser.close();

    // ---------------- 清理测试数据 ----------------
    for (const id of created) await api('DELETE', '/expenses/' + id, null, token);
    db("delete from GameScores where GameKey='minesweeper' and UserId=(select Id from Users where Username=ADMIN)", 'rw');

    const fail = results.filter(r => !r.ok);
    console.log('\n合计：' + (results.length - fail.length) + ' 通过 / ' + fail.length + ' 失败');
    if (fail.length) { console.log('失败项：'); fail.forEach(f => console.log(' - ' + f.name + '  ' + f.extra)); }
    process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('脚本异常：', e); process.exit(2); });
