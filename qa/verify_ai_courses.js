// 管理员用户名（不是秘密；口令从环境变量 QA_PASS 读，见 _env.js）
const ADMIN = process.env.QA_USER || 'admin';
// 端到端验证「AI 依据截图批量导入课表」：
//   课程表页 → 从截图导入 → 选图 → AI 解析 → 建议卡 → 确认写入 → 课程表页核对
//
// 用法：CHECKIN_PASS=<本地库密码> node qa/verify_ai_courses.js <截图路径> [--execute]
// 账号密码走环境变量，不写进仓库 —— 脚本会被提交，明文密码等于把凭据钉进 git 历史。
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.CHECKIN_BASE || 'http://127.0.0.1:5188';
const USER = process.env.CHECKIN_USER || ADMIN;
const PASS = process.env.CHECKIN_PASS || '';
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const IMG = ARGS[0];
const OUT = 'D:/checkin/site/qa/shots/ai-courses';
const EXECUTE = process.argv.includes('--execute');

if (!PASS) {
    console.error('缺少 CHECKIN_PASS 环境变量（本地开发库的管理员密码）');
    process.exit(1);
}
if (!IMG) {
    console.error('用法：CHECKIN_PASS=xxx node qa/verify_ai_courses.js <课表截图路径> [--execute]');
    process.exit(1);
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch({ channel: 'msedge' });
    const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));

    // 登录
    await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
    await p.fill('#Username', USER);
    await p.fill('#Password', PASS);
    await p.locator('form:has(#Username) button[type=submit]').click();
    await p.waitForLoadState('domcontentloaded');

    // 起点必须是课程表页的入口（验证按钮真的在）
    await p.goto(BASE + '/Courses', { waitUntil: 'domcontentloaded' });
    const entry = await p.locator('a[href="/Ai?hint=courses"]');
    const hasEntry = await entry.count();
    console.log('课程表页「从截图导入」按钮:', hasEntry > 0 ? '✓ 存在' : '✗ 缺失');
    await p.screenshot({ path: `${OUT}/01-courses-entry.png` });

    // 走入口进 AI 页
    await entry.first().click();
    await p.waitForLoadState('domcontentloaded');
    await p.waitForTimeout(600);

    const draft = await p.inputValue('textarea[name=text]');
    console.log('预填提示词:', draft ? '✓ ' + draft.slice(0, 40) + '…' : '✗ 空');
    await p.screenshot({ path: `${OUT}/02-ai-page-hint.png` });

    // 选图（走真实的 change 流程：页面会把图压成 data URL 塞进隐藏字段）
    await p.setInputFiles('#aiFile', IMG);
    await p.waitForTimeout(2500);
    const imgLen = await p.inputValue('#aiImageData');
    console.log('图片压缩后进隐藏字段:', imgLen ? `✓ ${(imgLen.length / 1024).toFixed(0)} KB` : '✗ 空');
    await p.screenshot({ path: `${OUT}/03-image-attached.png` });

    // 发送（这一步会真花一次 AI 调用，整张课表要十几到几十秒，别用默认 30s 导航超时）
    console.log('发送中（等模型解析整张课表）…');
    const t0 = Date.now();
    await p.locator('#aiSend').click({ noWaitAfter: true });
    await p.waitForLoadState('domcontentloaded', { timeout: 180000 });
    console.log(`回包耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/04-suggestion.png`, fullPage: true });

    // 抓建议卡：标签 + 摘要
    const cards = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll('.ai-act, .ai-action, .ai-suggest, [class*=act]').forEach(el => {
            const t = (el.innerText || '').trim();
            if (t && /导入|课程|确认/.test(t)) out.push(t.replace(/\s+/g, ' ').slice(0, 200));
        });
        return out;
    });
    console.log('--- 页面上的建议卡文本 ---');
    cards.slice(0, 6).forEach(t => console.log('  ' + t));

    // 消息正文（AI 的回复）
    const reply = await p.evaluate(() => {
        const rows = [...document.querySelectorAll('.ai-bubble, .ai-row')];
        const last = rows[rows.length - 1];
        return last ? last.innerText.replace(/\s+/g, ' ').slice(0, 400) : '';
    });
    console.log('--- AI 回复 ---');
    console.log('  ' + reply);

    if (EXECUTE && cards.length) {
        console.log('\n点「确认写入」…');
        const btn = p.locator('button:has-text("确认"), a:has-text("确认")').first();
        if (await btn.count()) {
            await btn.click();
            await p.waitForLoadState('domcontentloaded');
            await p.waitForTimeout(1200);
            const notice = await p.evaluate(() => {
                const n = document.querySelector('.notice, .alert, [class*=notice]');
                return n ? n.innerText.trim().slice(0, 120) : '';
            });
            console.log('执行结果提示:', notice || '(未捕获到提示文本)');
            await p.screenshot({ path: `${OUT}/05-executed.png`, fullPage: true });

            // 回课程表页核对（课程卡片是 .course-card，名字在 .cc-name 里）
            await p.goto(BASE + '/Courses', { waitUntil: 'domcontentloaded' });
            await p.waitForTimeout(600);
            const cnt = await p.evaluate(() => {
                const cards = [...document.querySelectorAll('.course-card')];
                const names = cards.map(c => {
                    const n = c.querySelector('.cc-name');
                    return (n ? n.innerText : c.innerText.split('\n')[0] || '').trim();
                }).filter(Boolean);
                return { cellCount: cards.length, names: [...new Set(names)] };
            });
            console.log('课程表页格子数:', cnt.cellCount);
            console.log('课程名:', cnt.names.join(' / ') || '(空)');
            await p.screenshot({ path: `${OUT}/06-courses-after.png`, fullPage: true });
        }
    }

    console.log('\npageerror:', errs.length ? errs : 'none');
    await b.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
