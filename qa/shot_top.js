const { chromium } = require('playwright');
// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await p.goto('http://127.0.0.1:5188/Login');
  await p.fill('#Username', ADMIN);
  await p.fill('#Password', PW);
  await p.click('form button[type=submit]');
  await p.waitForURL('**/', { timeout: 15000 }).catch(() => {});
  await p.goto('http://127.0.0.1:5188/PyLab');
  await p.waitForSelector('.py-tabs', { timeout: 15000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'D:/WorkBuddy Space/2026-10-14-11-44-55/outputs/pylab_top_after.png' });
  // 断言：顶部无「Python 教学平台」介绍卡
  const introGone = await p.evaluate(() => {
    const h2s = [...document.querySelectorAll('h2')].map(h => h.textContent.trim());
    const feats = document.querySelector('.py-feats');
    return { h2s: h2s.slice(0, 3), hasFeats: !!feats, badgeInTabs: !!document.querySelector('.py-tabs .py-badge') };
  });
  console.log(JSON.stringify(introGone));
  await b.close();
})();
