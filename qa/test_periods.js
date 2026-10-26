// 功能测试：节次时间自定义（改时间→课表网格跟着变→加/删节→恢复默认）
const QA = require('./_env');
const { chromium } = require('playwright');
const BASE = 'http://localhost:5188';
let pass = 0, fail = 0;
function T(name, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
  ok ? pass++ : fail++;
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());   // confirm() 自动确认

  await page.goto(BASE + '/Login');
  await page.fill('input[name="Username"]', QA.USER);
  await page.fill('input[name="Password"]', QA.PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(u => !u.pathname.includes('Login'), { timeout: 10000 });

  // 前置：把节次配置复位成默认 12 节。
  // 这个脚本会改库里的全局配置，中途崩了下次跑就会撞上"13 行"的假失败；
  // 所以开头先自己收拾干净——恢复默认是幂等的，跑几次结果都一样。
  await page.goto(BASE + '/Courses/Periods');
  await page.waitForSelector('.pp-row');
  if (await page.locator('.pp-row').count() !== 12) {
    const r = page.locator('button:has-text("恢复默认")');
    await r.click();
    await page.waitForTimeout(200);
    await r.click();
    await page.waitForURL(/saved=True/i, { timeout: 8000 });
    await page.goto(BASE + '/Courses/Periods');
    await page.waitForSelector('.pp-row');
  }

  // ① 改第 1 节开始时间 08:00 → 07:30，保存
  await page.goto(BASE + '/Courses/Periods');
  await page.waitForSelector('.pp-row');
  T('节次设置页默认 12 行', await page.locator('.pp-row').count() === 12, 'rows=' + await page.locator('.pp-row').count());
  const firstStart = page.locator('.pp-row input').first();
  await firstStart.fill('07:30');
  // 注意：顶栏「退出」表单也有 button[type=submit]，DOM 在前——必须按文案定位「保存」
  await page.locator('form').filter({ has: page.locator('.pp-row') }).locator('button[type=submit]').first().click();
  await page.waitForURL(/saved=True/i, { timeout: 8000 });
  // .msg 横幅会被 modal.js 自动转 Toast，两者任一出现就算提示成功
  await page.waitForTimeout(300);
  const hinted = (await page.locator('.msg.ok').count()) + (await page.locator('.toast').count());
  T('保存后跳回并提示', hinted >= 1, 'hint=' + hinted);

  // ② 课表网格左侧节次跟着变
  await page.goto(BASE + '/Courses');
  await page.waitForSelector('.ttm-gcell');
  const g1 = await page.locator('.ttm-gcell').first().innerText();
  T('课表网格显示新时间 07:30', g1.includes('07:30'), g1.replace(/\n/g, '|'));

  // ③ 加一节 → 13 行，保存后网格 13 格
  await page.goto(BASE + '/Courses/Periods');
  await page.waitForSelector('.pp-row');
  await page.click('#ppAdd');
  T('加一节后 13 行', await page.locator('.pp-row').count() === 13);
  const lastStart = page.locator('.pp-row input').nth(24);
  await lastStart.fill('21:00');
  const lastEnd = page.locator('.pp-row input').nth(25);
  await lastEnd.fill('21:50');
  await page.locator('form').filter({ has: page.locator('.pp-row') }).locator('button[type=submit]').first().click();
  await page.waitForURL(/saved=True/i, { timeout: 8000 });
  await page.goto(BASE + '/Courses');
  await page.waitForSelector('.ttm-gcell');
  T('课表网格变 13 格', await page.locator('.ttm-gcell').count() === 13, 'cells=' + await page.locator('.ttm-gcell').count());

  // ④ 删除一行（点第一行的 ✕）→ 12 行
  await page.goto(BASE + '/Courses/Periods');
  await page.waitForSelector('.pp-row');
  await page.locator('.pp-del').first().click();
  T('删除一行后 12 行', await page.locator('.pp-row').count() === 12);

  // ⑤ 恢复默认 → 12 节、08:00 开头
  // 2.3.0 起危险操作改成就地二次确认：第一下只进入待确认态，第二下才真正提交
  const btnReset = page.locator('button:has-text("恢复默认")');
  await btnReset.click();
  await page.waitForTimeout(200);
  T('恢复默认需二次确认', await btnReset.evaluate(el => el.classList.contains('is-armed')));
  await btnReset.click();
  await page.waitForURL(/saved=True/i, { timeout: 8000 });
  await page.goto(BASE + '/Courses');
  await page.waitForSelector('.ttm-gcell');
  const g = await page.locator('.ttm-gcell').first().innerText();
  T('恢复默认后首节 08:00', g.includes('08:00'), g.replace(/\n/g, '|'));
  T('恢复默认后 12 格', await page.locator('.ttm-gcell').count() === 12);

  // ⑥ 加/删课程节次下拉范围 = 配置节数
  await page.goto(BASE + '/Courses/New');
  await page.waitForSelector('select[name="StartPeriod"]');
  const opts = await page.locator('select[name="StartPeriod"] option').count();
  T('新建课程节次下拉 = 12 项', opts === 12, 'opts=' + opts);

  console.log('===== 结果: ' + pass + '/' + (pass + fail) + ' 通过 =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
