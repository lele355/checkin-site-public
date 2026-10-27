// 页脚备案号目检（桌面 + 手机 + 登录页）
const QA = require('./_env');
const { chromium } = require('playwright');
const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/_shots';

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });

  const ctxD = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const pd = await ctxD.newPage();
  await pd.goto(BASE + '/Login');
  const login = await pd.evaluate(() => {
    const f = document.querySelector('.site-foot');
    const r = f.getBoundingClientRect();
    return { text: f.innerText.trim(), bottom: Math.round(r.bottom), visible: r.height > 0 };
  });
  console.log('登录页页脚:', JSON.stringify(login));
  await pd.screenshot({ path: OUT + '/foot_login.png' });

  await pd.fill('#Username', QA.USER);
  await pd.fill('#Password', QA.PASS);
  await pd.click('button[type=submit]');
  await pd.waitForURL(u => !u.pathname.toLowerCase().includes('login'));
  await pd.goto(BASE + '/');
  await pd.waitForTimeout(400);
  const home = await pd.evaluate(() => {
    const m = document.querySelector('main.content');
    const f = document.querySelector('.site-foot');
    m.scrollTop = m.scrollHeight;
    const r = f.getBoundingClientRect(), mr = m.getBoundingClientRect();
    return {
      inView: r.bottom <= mr.bottom + 1 && r.top >= mr.top - 1,
      gapToBottom: Math.round(mr.bottom - r.bottom),
      link: f.querySelector('a').href,
    };
  });
  console.log('工作台页脚:', JSON.stringify(home));
  await pd.waitForTimeout(200);
  await pd.screenshot({ path: OUT + '/foot_home_d.png' });

  const ctxM = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const pm = await ctxM.newPage();
  await pm.goto(BASE + '/Login');
  await pm.fill('#Username', QA.USER);
  await pm.fill('#Password', QA.PASS);
  await pm.click('button[type=submit]');
  await pm.waitForURL(u => !u.pathname.toLowerCase().includes('login'));
  await pm.goto(BASE + '/');
  // 手机断点下滚动容器是 window，不是 main.content
  await pm.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
  await pm.waitForTimeout(500);
  const mob = await pm.evaluate(() => {
    const f = document.querySelector('.site-foot');
    const bar = document.querySelector('.bottombar');
    const r = f.getBoundingClientRect();
    const br = bar ? bar.getBoundingClientRect() : null;
    return {
      footBottom: Math.round(r.bottom),
      barTop: br ? Math.round(br.top) : null,
      overlapped: br ? r.bottom > br.top : false,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log('手机页脚:', JSON.stringify(mob));
  await pm.screenshot({ path: OUT + '/foot_home_m.png' });

  await b.close();
})();
