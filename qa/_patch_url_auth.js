// _patch_url_auth.js — URL 用例改真实 cookie 登录（不依赖 CHECKIN_LOCAL 自动登录）
const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/qa_suite_280_api.js', 'utf8');

// 1) 插入 cookie 登录助手（放在 api() 助手之后）
s = s.replace(
    `// ---------- DB（只读查询 + 受控写入测试数据） ----------`,
    `// ---------- Razor 页 cookie 登录（URL 用例；Bearer 只对 /api 生效） ----------
let COOKIE_JAR = null;
async function pageGet(path) {
    if (!COOKIE_JAR) {
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
        COOKIE_JAR = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    }
    return fetch(BASE + path, { redirect: 'manual', headers: { Cookie: COOKIE_JAR } });
}

// ---------- DB（只读查询 + 受控写入测试数据） ----------`
);

// 2) URL 用例改走 pageGet（cookie 登录）
s = s.split("const r = await fetch(BASE + p, { redirect: 'manual' });").join("const r = await pageGet(p);");
s = s.replace(
    "const playUrl = await fetch(BASE + `/Games/Gomoku/Play/${room.id}`, { redirect: 'manual' });",
    "const playUrl = await pageGet(`/Games/Gomoku/Play/${room.id}`);"
);

fs.writeFileSync('D:/checkin/site/qa/qa_suite_280_api.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/qa_suite_280_api.js');
console.log('URL auth patched:', s.includes('pageGet'), '| syntax OK');
