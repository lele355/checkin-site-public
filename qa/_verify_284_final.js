// _verify_284_final.js —— 2.8.4 发版前总点验手工探针（QA 严过关）
// 覆盖：#25 Bug#2 手工复验（13 路 forbidden=true / 19 路抽测）+ 模式开关错误路径
//      （非法 mode 400 / 缺省兼容 / 三模式 / 网页表单提交链路）。
// 用法：站点 127.0.0.1:5188 起好后 node _verify_284_final.js
const BASE = process.env.QA_BASE || 'http://127.0.0.1:5188';
const PW = 'QaGames2026!';

const results = [];
function T(name, ok, extra) {
    results.push({ name, ok: !!ok, extra: extra || '' });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}

async function api(method, path, body, token) {
    const r = await fetch(BASE + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' },
            token ? { Authorization: 'Bearer ' + token } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch (_) { }
    return { status: r.status, json };
}

let TOKEN = null;
async function login() {
    const r = await api('POST', '/api/v1/auth/login', { username: 'QA_alpha', password: PW, device: 'qa-final-284' });
    TOKEN = r.json && r.json.ok ? r.json.data.token : null;
    T('登录 QA_alpha', !!TOKEN, r.json && r.json.error);
}

async function snap(gameKey, id) {
    const r = await api('GET', `/api/v1/games/${gameKey}/rooms/${id}`, undefined, TOKEN);
    return r.json && r.json.ok ? r.json.data : { error: r.json && r.json.error, status: r.status };
}

async function mkRoom(gameKey, opts = {}) {
    const c = await api('POST', `/api/v1/games/${gameKey}/rooms`, Object.assign({ side: 1 }, opts), TOKEN);
    return c;
}

// ---------- 网页表单链路（Razor cookie 登录 → Lobby handler=Create） ----------
async function formCreate(gameKey, mode, side = 1) {
    const loginPage = await fetch(BASE + '/Login');
    const html = await loginPage.text();
    const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/);
    const token = m ? m[1] : '';
    const setCookies = loginPage.headers.getSetCookie ? loginPage.headers.getSetCookie() : [];
    const jar = new Map();
    for (const c of setCookies) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
    const body = new URLSearchParams({ Username: 'QA_alpha', Password: PW, __RequestVerificationToken: token, RememberMode: 'None' });
    const resp = await fetch(BASE + '/Login', {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') },
        body: body.toString(),
    });
    for (const c of (resp.headers.getSetCookie ? resp.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');

    // 先拿 Lobby 页的 antiforgery token（form 里带）。注意路由：Lobby = /Games/{gameKey}
    const lobby = await fetch(`${BASE}/Games/${gameKey}`, { headers: { Cookie: cookie } });
    const lobbyHtml = await lobby.text();
    // antiforgery cookie 可能随 Lobby GET 轮换，必须并进 jar 再 POST
    for (const c of (lobby.headers.getSetCookie ? lobby.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
    const cookie2 = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const fm = lobbyHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    const formToken = fm ? fm[1] : '';
    const form = new URLSearchParams({ gameKey, side: String(side), mode, __RequestVerificationToken: formToken });
    const post = await fetch(`${BASE}/Games/${gameKey}?handler=Create`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie2 },
        body: form.toString(),
    });
    return post;
}

(async () => {
    await login();

    // ================= 1. #25 Bug#2 手工复验 =================
    console.log('\n===== 1. #25 Bug#2 手工复验（快照顶层 size/forbidden） =====');
    {
        const c = await mkRoom('gomoku', { size: 13, forbidden: true });
        const ok = c.json && c.json.ok;
        T('手工建 13 路房（forbidden=true）', ok, c.json && JSON.stringify(c.json.error || c.json.data.id));
        if (ok) {
            const ss = await snap('gomoku', c.json.data.id);
            T('13 路房快照顶层 size=13', ss.size === 13, `size=${ss.size}`);
            T('13 路房快照顶层 forbidden=true', ss.forbidden === true, `forbidden=${JSON.stringify(ss.forbidden)}`);
        }
    }
    {
        const c = await mkRoom('gomoku', { size: 19, forbidden: false });
        const ok = c.json && c.json.ok;
        T('手工建 19 路房抽测', ok, c.json && JSON.stringify(c.json.error || c.json.data.id));
        if (ok) {
            const ss = await snap('gomoku', c.json.data.id);
            T('19 路房快照顶层 size=19', ss.size === 19, `size=${ss.size}`);
            T('19 路房 forbidden=false', ss.forbidden === false, `forbidden=${JSON.stringify(ss.forbidden)}`);
        }
    }

    // ================= 2. 模式开关（API） =================
    console.log('\n===== 2. 模式开关错误路径（API） =====');
    {
        const c = await mkRoom('armychess', { mode: 'bogus' });
        T('非法 mode → 400', c.status === 400, `status=${c.status} err=${c.json && JSON.stringify(c.json.error)}`);
    }
    {
        const c = await mkRoom('armychess', {});   // 旧客户端：不带 mode
        const ok = c.json && c.json.ok;
        T('缺省 mode 建房兼容（旧客户端）', ok, c.json && JSON.stringify(c.json.error || ''));
        if (ok) {
            const ss = await snap('armychess', c.json.data.id);
            T('缺省 mode = dark（现状兼容）', (ss.state && ss.state.mode) === 'dark' || ss.mode === 'dark',
                `mode=${(ss.state && ss.state.mode) || ss.mode}`);
        }
    }
    for (const mode of ['open', 'dark', 'fanqi']) {
        const c = await mkRoom('armychess', { mode });
        const ok = c.json && c.json.ok;
        T(`mode=${mode} 建房成功`, ok, c.json && JSON.stringify(c.json.error || ''));
        if (ok) {
            const ss = await snap('armychess', c.json.data.id);
            const got = (ss.state && ss.state.mode) || ss.mode;
            T(`mode=${mode} 快照透出`, got === mode, `mode=${got}`);
        }
    }
    {
        // 非军棋游戏带 mode 不应出错（字段被忽略）
        const c = await mkRoom('gomoku', { mode: 'fanqi', size: 15 });
        T('gomoku 带 mode 字段被忽略不炸', !!(c.json && c.json.ok), c.json && JSON.stringify(c.json.error || ''));
    }

    // ================= 3. 网页表单提交链路 =================
    console.log('\n===== 3. 网页建房表单链路（Lobby handler=Create） =====');
    for (const mode of ['open', 'fanqi', 'dark']) {
        const post = await formCreate('armychess', mode);
        const loc = post.headers.get('location') || '';
        T(`表单 mode=${mode} 提交 → 302 落 Play 页`, post.status === 302 && /Play/.test(loc), `status=${post.status} loc=${loc}`);
        const m2 = loc.match(/Play\/(\d+)/) || loc.match(/id=(\d+)/);
        if (m2) {
            const ss = await snap('armychess', Number(m2[1]));
            const got = (ss.state && ss.state.mode) || ss.mode;
            T(`表单 mode=${mode} 房间 Mode 正确`, got === mode, `mode=${got}`);
        }
    }

    // ================= 汇总 =================
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    console.log(`\n===== SUMMARY: ${pass} pass / ${fail} fail / ${results.length} total =====`);
    for (const r of results.filter(x => !x.ok)) console.log('  FAIL >> ' + r.name + '  [' + r.extra + ']');
    process.exit(fail ? 1 : 0);
})();
