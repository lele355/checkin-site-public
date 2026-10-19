// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// AI 图片输入 · 端到端 UI 测试（手机视口）
// 选图 → 前端压缩 → 发送 → AI 识图回复 → 气泡显示图片 → 取图接口鉴权
const { chromium } = require('playwright');
const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';
const IMG = 'D:/projects/checkin/_shots/m2_ai_input.png';

let pass = 0, fail = 0;
function T(name, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
  ok ? pass++ : fail++;
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  await page.goto(BASE + '/Login');
  await page.fill('input[name="Username"]', ADMIN);
  await page.fill('input[name="Password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL(u => !u.pathname.includes('Login'), { timeout: 10000 });

  await page.goto(BASE + '/Ai');
  await page.waitForSelector('#aiFile', { state: 'attached' });

  // ① 附件按钮 + 选图 → 前端压缩成 data URL
  T('附件按钮存在', await page.locator('#aiAttach').isVisible());
  await page.setInputFiles('#aiFile', IMG);
  await page.waitForFunction(() => {
    const v = document.getElementById('aiImageData').value;
    return v && v.startsWith('data:image/jpeg;base64,');
  }, null, { timeout: 15000 });
  const dataLen = await page.evaluate(() => document.getElementById('aiImageData').value.length);
  T('压缩产出 JPEG data URL', dataLen > 10000, 'chars=' + dataLen);
  T('预览可见', await page.locator('#aiPreview').isVisible());

  // ② 发送（带一句问题）
  const text = '这张截图是什么界面？一句话回答，别太长。';
  await page.fill('#aiForm textarea', text);
  await page.screenshot({ path: OUT + '/ai_img_preview.png' });
  await Promise.all([
    page.waitForNavigation({ timeout: 60000 }).catch(() => null),
    page.click('#aiSend'),
  ]);
  await page.waitForTimeout(500);

  // ③ 历史里出现带图气泡 + 助手回复
  const bubbleImg = page.locator('.ai-row.me .ai-shot img').last();
  T('用户气泡显示图片', await bubbleImg.count() > 0);
  if (await bubbleImg.count() > 0) {
    await page.waitForFunction(() => {
      const imgs = document.querySelectorAll('.ai-row.me .ai-shot img');
      const im = imgs[imgs.length - 1];
      return im && im.complete && im.naturalWidth > 0;
    }, null, { timeout: 10000 }).catch(() => {});
    const nw = await bubbleImg.evaluate(el => el.naturalWidth);
    T('图片真的加载出来（取图接口可用）', nw > 0, 'naturalWidth=' + nw);
  }
  const rows = await page.locator('.ai-row').count();
  T('出现了助手回复', rows >= 2, 'rows=' + rows);
  const lastAssistant = (await page.locator('.ai-row:not(.me) .ai-bubble').last().innerText()).trim();
  T('助手回复非错误文案', lastAssistant.length > 0 && !lastAssistant.includes('⚠️'), lastAssistant.slice(0, 60).replace(/\n/g, ' '));
  await page.screenshot({ path: OUT + '/ai_img_result.png' });
  await page.screenshot({ path: OUT + '/ai_img_result_full.png', fullPage: true });

  // ④ 移除预览：再选一次图后点 ✕ 清空
  await page.setInputFiles('#aiFile', IMG);
  await page.waitForFunction(() => document.getElementById('aiImageData').value.length > 10000, null, { timeout: 15000 });
  await page.click('#aiPreviewDel');
  T('移除按钮清空图片', await page.evaluate(() => document.getElementById('aiImageData').value === ''));

  // ⑤ 取图接口鉴权：不存在的 id → 404
  const r404 = await page.request.get(BASE + '/Ai?handler=Image&id=999999');
  T('取图接口不存在 id → 404', r404.status() === 404, 'status=' + r404.status());

  T('全程无 JS 错误', jsErrors.length === 0, jsErrors.join('; ').slice(0, 120));
  console.log('===== 结果: ' + pass + '/' + (pass + fail) + ' 通过 =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
