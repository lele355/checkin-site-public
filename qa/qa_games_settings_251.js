// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// 小游戏「设置」专项（网页端）
//
// 覆盖：设置页读写 → 大厅建房选项 → 盘面尺寸/坐标 → 落子二次确认 → 计时条 → 超时判负 → 恢复默认
//
// 对手（qagamer）走 API 而不是 UI：它是被管理员建的号，首次登录会被强制改密，
// 走 UI 会卡在 /ChangePassword。API 登录没有这个门槛，也更快。
//
// 跑法：本地起好服务（5188）后
//   NODE_PATH=C:/Users/An/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules node qa/qa_games_settings_251.js
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5188';
const HOST = { u: ADMIN, p: process.env.QA_PASS };
const GUEST = { u: 'qagamer', p: 'Qa123456' };

let ok = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { ok++; console.log('PASS  ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + '  [' + extra + ']'); }
}

/** 直接打接口（对手侧用，避开 App/网页的登录限制） */
async function api(method, path, body, token) {
  const opt = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  if (token) opt.headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, opt);
  const j = await r.json().catch(() => ({}));
  return Object.assign({ status: r.status }, j.ok === true ? j.data : j);
}

async function login(ctx, who) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/Login');
  await p.fill('#Username', who.u);
  await p.fill('input[type="password"]', who.p);
  await p.click('button[type="submit"]');
  await p.waitForLoadState('networkidle');
  return p;
}

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const hostCtx = await b.newContext({ viewport: { width: 1100, height: 1000 } });
  const host = await login(hostCtx, HOST);
  check('房主登录成功', !host.url().includes('/Login'), host.url());

  const gLogin = await api('POST', '/api/v1/auth/login', {
    username: GUEST.u, password: GUEST.p, device: 'qa-settings'
  });
  const gTok = gLogin.token;
  check('对手账号拿到令牌', !!gTok, gLogin.error || '');

  // ---------- 1. 设置页读写 ----------
  await host.goto(BASE + '/Games/Settings');
  await host.waitForLoadState('networkidle');
  check('设置页可达', (await host.locator('h2').first().innerText()).includes('小游戏设置'));
  check('设置页有四个对局规则下拉', (await host.locator('select').count()) === 4,
    await host.locator('select').count());

  await host.selectOption('#size', '19');
  await host.selectOption('#forbidden', '1');
  await host.selectOption('#moveTimeoutSec', '30');
  await host.selectOption('#totalTimeoutSec', '300');
  const tap = host.locator('input[name="tapConfirm"]');
  if (!(await tap.isChecked())) await tap.check();

  await host.click('form:has(button:has-text("保存设置")) button:has-text("保存设置")');
  await host.waitForLoadState('networkidle');
  const savedText = await host.locator('body').innerText();
  check('保存后有提示', savedText.includes('已保存'));
  check('保存后仍是 19×19', (await host.inputValue('#size')) === '19', await host.inputValue('#size'));
  check('保存后仍是标准规则', (await host.inputValue('#forbidden')) === '1');
  check('保存后单步 30 秒', (await host.inputValue('#moveTimeoutSec')) === '30');
  check('保存后总用时 5 分钟', (await host.inputValue('#totalTimeoutSec')) === '300');
  check('保存后二次确认仍勾着', await tap.isChecked());

  // ---------- 2. 大厅：设置入口 + 建房选项 ----------
  await host.goto(BASE + '/Games');
  await host.waitForLoadState('networkidle');
  check('大厅有「设置」入口', (await host.locator('a[href="/Games/Settings"]').count()) >= 1);
  check('建房处有盘面下拉', (await host.locator('form select[name="size"]').count()) === 1);
  check('盘面下拉默认 19×19', (await host.inputValue('form select[name="size"]')) === '19');
  check('规则下拉默认标准', (await host.inputValue('form select[name="forbidden"]')) === '1');

  // ---------- 3. 建房 → 19 路 + 坐标 ----------
  await host.click('button[name="side"][value="1"]');
  await host.waitForLoadState('networkidle');
  const playUrl = host.url();
  check('建房后进棋盘页', /\/Games\/Play\/\d+/.test(playUrl), playUrl);
  const roomId = Number(playUrl.split('/').pop());
  const roomCode = (await host.locator('.gm-code').innerText()).replace(/[^A-Z0-9]/g, '');
  check('棋盘页显示房间码', roomCode.length === 6, roomCode);

  const gridLines = await host.locator('.gm-grid line').count();
  check('棋盘是 19 路（38 条网格线）', gridLines === 38, gridLines);
  check('显示坐标（19 行 + 19 列 = 38 个）', (await host.locator('.gm-coord text').count()) === 38);
  const chips = (await host.locator('.gm-rules').innerText()).replace(/\n/g, ' ');
  check('规则 chips 含 19×19', chips.includes('19×19'), chips);
  check('规则 chips 含标准规则', chips.includes('标准规则'), chips);

  // ---------- 4. 对手先坐下，再测落子确认 ----------
  const joined = await api('POST', `/api/v1/games/${roomId}/join`, undefined, gTok);
  check('对手坐下成功', joined.status === 200, joined.error || joined.status);

  await host.reload();
  await host.waitForLoadState('networkidle');
  check('进入对局中', /轮到你/.test(await host.locator('.gm-status').innerText()),
    (await host.locator('.gm-status').innerText()).replace(/\n/g, ' '));

  // 口径直接从页面下发的 JSON 取，别在脚本里另算一套（改布局就会对不上）
  const st = JSON.parse(await host.locator('#gmState').textContent());
  check('页面下发了落子确认开关', st.tapConfirm === true, 'tapConfirm=' + st.tapConfirm);
  check('页面下发了 19 路盘面', st.size === 19, 'size=' + st.size);
  check('页面下发了坐标留白 40', st.pad === 40, 'pad=' + st.pad);

  const box = await host.locator('#gmBoard').boundingBox();
  const pt = (c, r) => ({
    x: box.x + (st.pad + c * (640 - st.pad * 2) / (st.size - 1)) / 640 * box.width,
    y: box.y + (st.pad + r * (640 - st.pad * 2) / (st.size - 1)) / 640 * box.height
  });
  // SVG 的 <circle> 没有固有尺寸，Playwright 的 isVisible() 对它会误判成不可见，
  // 所以统一读 hidden 属性 + getAttribute，不碰 isVisible()
  const ghostOf = async () => ({
    hidden: await host.locator('#gmGhost').getAttribute('hidden'),
    cx: await host.locator('#gmGhost').getAttribute('cx'),
    cy: await host.locator('#gmGhost').getAttribute('cy')
  });
  // #gmStones 里除了棋子还有「最后一手」的小标记圈，数棋子要认 .gm-stone
  const stones = () => host.locator('#gmStones circle.gm-stone').count();
  const movesOf = async () => {
    const r = await api('GET', `/api/v1/games/${roomId}`, undefined, gTok);
    return r.moves || [];
  };

  // A → 只预览
  const pa = pt(9, 9), pb = pt(11, 11);
  await host.mouse.click(pa.x, pa.y);
  await host.waitForTimeout(400);
  let g = await ghostOf();
  check('第一下只出预览圈，不落子', g.hidden === null && (await stones()) === 0 && (await movesOf()).length === 0,
    'hidden=' + g.hidden + ' stones=' + (await stones()) + ' moves=' + (await movesOf()).length);

  // B → 预览圈跟着挪，还是不落子
  await host.mouse.click(pb.x, pb.y);
  await host.waitForTimeout(400);
  const g2 = await ghostOf();
  check('改点到别处只挪预览圈',
    g2.hidden === null && (g2.cx + ',' + g2.cy) !== (g.cx + ',' + g.cy) && (await stones()) === 0,
    (g.cx + ',' + g.cy) + ' → ' + (g2.cx + ',' + g2.cy) + ' stones=' + (await stones()));

  // B 再来一下 → 落子
  await host.mouse.click(pb.x, pb.y);
  await host.waitForTimeout(1200);
  check('第二下才落在同一处', (await stones()) === 1, await stones());
  check('落子后预览圈收起', (await ghostOf()).hidden !== null);

  const mv = await movesOf();
  check('服务端记录了这一手', mv.length === 1 && mv[0].x === 11 && mv[0].y === 11, JSON.stringify(mv));

  // ---------- 5. 计时条 ----------
  // #gmClock 服务端渲染时就带 hidden，靠 JS 解开；textContent 不受可见性影响
  check('计时条元素存在', (await host.locator('#gmClock').count()) === 1);
  const c1 = await host.locator('#gmClock').textContent();
  check('计时条已展开并有数字', !!(c1 && c1.trim()), 'hidden=' + (await host.locator('#gmClock').getAttribute('hidden')) + ' text=' + c1);
  await host.waitForTimeout(2400);
  const c2 = await host.locator('#gmClock').textContent();
  check('计时条在倒数', c1 !== c2, c1 + ' → ' + c2);
  check('计时条含本步/我的剩余', /本步|我 /.test(c2 || ''), c2);

  // ---------- 6. 超时判负：单步 15 秒，轮到黑方不动 ----------
  await host.goto(BASE + '/Games/Settings');
  await host.waitForLoadState('networkidle');
  await host.selectOption('#moveTimeoutSec', '15');
  await host.selectOption('#totalTimeoutSec', '0');
  await host.click('form:has(button:has-text("保存设置")) button:has-text("保存设置")');
  await host.waitForLoadState('networkidle');

  await host.goto(BASE + '/Games');
  await host.waitForLoadState('networkidle');
  await host.click('button[name="side"][value="1"]');     // 我执黑先手，且我不动
  await host.waitForLoadState('networkidle');
  const url2 = host.url();
  const id2 = Number(url2.split('/').pop());
  const code2 = (await host.locator('.gm-code').innerText()).replace(/[^A-Z0-9]/g, '').slice(-6);
  const j2 = await api('POST', `/api/v1/games/${id2}/join`, undefined, gTok);
  check('第二盘对手坐下成功', j2.status === 200, j2.error || j2.status);

  console.log('       … 等 17 秒让单步限时走完');
  await host.goto(url2);
  await host.waitForLoadState('networkidle');
  await host.waitForTimeout(17000);
  await host.reload();
  await host.waitForLoadState('networkidle');
  const overText = (await host.locator('.gm-status').innerText()).replace(/\n/g, ' ');
  check('超时后判负并写明原因', /超时/.test(overText), overText);
  // 我执黑且一直没落子 → 判我输（对局页 JS 会改写成「你输了」）
  check('超时方是黑（不动的那方）', /你输了|白棋胜/.test(overText), overText);

  // ---------- 7. 恢复默认 ----------
  await host.goto(BASE + '/Games/Settings');
  await host.waitForLoadState('networkidle');
  // 这个表单带 data-confirm，第一下只把按钮改成确认文案（按钮文字会变），
  // 所以按 action 里的 handler 定位，别按文字定位
  const resetBtn = host.locator('form[action*="handler=Reset"] button[type="submit"]');
  await resetBtn.click();
  await host.waitForTimeout(200);
  await resetBtn.click();
  await host.waitForLoadState('networkidle');
  check('恢复默认后 15×15', (await host.inputValue('#size')) === '15', await host.inputValue('#size'));
  check('恢复默认后自由规则', (await host.inputValue('#forbidden')) === '0', await host.inputValue('#forbidden'));
  check('恢复默认后不限时', (await host.inputValue('#moveTimeoutSec')) === '0', await host.inputValue('#moveTimeoutSec'));
  check('恢复默认后二次确认关闭', !(await host.locator('input[name="tapConfirm"]').isChecked()));

  // 收摊：清掉这两盘，别在大厅里留垃圾
  await host.goto(url2);
  await host.waitForLoadState('networkidle');
  const clean = host.locator('form:has(button:has-text("收摊")) button:has-text("收摊")');
  if (await clean.count()) { await clean.click(); await host.waitForLoadState('networkidle'); }
  await host.goto(playUrl);
  await host.waitForLoadState('networkidle');
  const clean2 = host.locator('form:has(button:has-text("收摊")) button:has-text("收摊")');
  if (await clean2.count()) { await clean2.click(); await host.waitForLoadState('networkidle'); }

  console.log('');
  console.log('结果：' + ok + ' 通过 / ' + fail + ' 失败');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
