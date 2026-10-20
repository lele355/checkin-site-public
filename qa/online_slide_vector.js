// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// online_slide_vector.js — 线上「矢量模式」专项抽验
// 覆盖：LibreOffice 转换产出 deck.pdf、PDF 鉴权读接口（含 Range）、PDF.js 画布渲染、
// 全屏重画、切图片模式、删除后 PDF 随之消失。
// 用法：node online_slide_vector.js
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'https://example.com';
const PPTX = 'D:/tmp/t2.pptx';
const OUT = 'D:/projects/checkin/qa/shots/online';
const USER = ADMIN;
const PASS = PW;
const TITLE = 'ONLINE_QA_矢量';

let pass = 0, fail = 0;
const rows = [];
function T(name, ok, extra) {
  rows.push({ name, ok: !!ok, extra: extra == null ? '' : String(extra) });
  if (ok) { pass++; console.log('  v ' + name + (extra != null ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  x ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
function sec(t) { console.log('\n■ ' + t); }

const snapCanvas = () => {
  const cv = document.getElementById('pySlideCanvas');
  if (!cv || cv.width < 4) return { w: cv ? cv.width : 0, h: cv ? cv.height : 0, op: '', sig: 0, ink: 0, pdfjs: !!window.pdfjsLib };
  const c = document.createElement('canvas');
  c.width = 32; c.height = 18;
  const g = c.getContext('2d');
  g.drawImage(cv, 0, 0, 32, 18);
  const d = g.getImageData(0, 0, 32, 18).data;
  let sig = 0, lum = 0, ink = 0;
  for (let i = 0; i < d.length; i += 4) {
    sig += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7;
    lum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (d[i + 3] > 8) ink++;
  }
  return { w: cv.width, h: cv.height, op: cv.style.opacity, sig, lum: Math.round(lum / (d.length / 4)), ink, pdfjs: !!window.pdfjsLib };
};

// 矢量是「图片先顶上、PDF 就绪后再换」的异步流程，断言必须等它收敛，不能定个 sleep 就取数
const waitVector = (p, timeout) => p.waitForFunction(() => {
  const cv = document.getElementById('pySlideCanvas');
  if (!cv || cv.hidden || cv.width < 100) return false;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 9;
  const g = c.getContext('2d');
  g.drawImage(cv, 0, 0, 16, 9);
  const d = g.getImageData(0, 0, 16, 9).data;
  let lum = 0;
  for (let i = 0; i < d.length; i += 4) lum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return lum / (d.length / 4) > 40;      // 不是一块黑
}, null, { timeout: timeout || 45000 });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => {
    if (m.type() !== 'error' || /favicon/i.test(m.text())) return;
    const u = (m.location() && m.location().url) || '';
    if (/handler=Pdf/.test(u) && /404/.test(m.text())) return;   // 删除后我们自己探测的 404，预期内
    errs.push(m.text());
  });

  sec('登录与上传');
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', USER);
  await p.fill('#Password', PASS);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  T('线上登录成功', !p.url().toLowerCase().includes('login'), p.url());

  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 25000 })
    .then(() => T('PyLab 初始化完成', true)).catch(() => T('PyLab 初始化完成', false));

  await p.click('.py-tab[data-tab="deck"]');
  await p.click('.py-segbtn[data-deckview="lib"]');
  await p.waitForTimeout(800);

  await p.setInputFiles('#pyDeckFile', PPTX);
  await p.fill('#pyDeckTitle', TITLE);
  await p.click('[data-act="upload"]');
  const done = await p.waitForFunction(
    () => /搞定|失败|错误/.test(document.getElementById('pyUploadStatus')?.textContent || ''),
    null, { timeout: 240000 }).then(() => true).catch(() => false);
  const upMsg = (await p.locator('#pyUploadStatus').innerText().catch(() => '')).trim();
  T('LibreOffice 转换完成', done && !/失败|错误/.test(upMsg), upMsg.replace(/\s+/g, ' ').slice(0, 80));
  // 上传成功的 Toast 固定悬浮在下半屏，会挡住播放控制条 —— 等它自然消失（3.8s）再点
  await p.waitForSelector('.toast-ok, .toast-err', { state: 'attached', timeout: 3000 }).catch(() => { });
  await p.waitForSelector('.toast-ok, .toast-err', { state: 'detached', timeout: 8000 }).catch(() => { });
  await p.waitForTimeout(600);

  const card = p.locator('#pyDeckGrid .py-deck', { hasText: TITLE }).first();
  const sub = (await card.locator('.sub').innerText().catch(() => '')).trim();
  T('卡片上出现 PDF 体积', /PDF\s+[\d.]+\s*MB/.test(sub), sub.replace(/\s+/g, ' '));

  const deck = await p.evaluate(() => {
    const list = (window.__pyLab.decks.decks || []);
    return list.find(d => d.title === 'ONLINE_QA_矢量') || null;
  });
  T('Decks 接口回报 hasPdf', deck && deck.hasPdf === true, deck && deck.pdfMb + 'MB / ' + deck.pageCount + ' 页');

  sec('PDF 读接口');
  const probe = await p.evaluate(async (id) => {
    const u = '/PyLab?handler=Pdf&deckId=' + id;
    const full = await fetch(u);
    const rng = await fetch(u, { headers: { Range: 'bytes=0-1023' } });
    const buf = new Uint8Array(await full.arrayBuffer()).slice(0, 5);
    return {
      status: full.status, type: full.headers.get('content-type'), len: full.headers.get('content-length'),
      cache: full.headers.get('cache-control'), rngStatus: rng.status, rngLen: rng.headers.get('content-length'),
      magic: Array.from(buf).map(c => String.fromCharCode(c)).join(''),
    };
  }, deck.id);
  T('GET Pdf 200', probe.status === 200, probe.status);
  T('Content-Type application/pdf', /application\/pdf/.test(probe.type || ''), probe.type);
  T('Content-Length 合理（> 100KB）', Number(probe.len) > 100000, probe.len);
  T('私有缓存头', /max-age=86400/.test(probe.cache || ''), probe.cache);
  T('Range 请求 → 206 + 1KB', probe.rngStatus === 206 && Number(probe.rngLen) === 1024, probe.rngStatus + ' / ' + probe.rngLen);
  T('响应体 %PDF-', probe.magic === '%PDF-', probe.magic);
  T('反代没改坏 Content-Type（nginx 不套 gzip 到 pdf）', !/charset/i.test(probe.type || ''), probe.type);

  // 缩略图必须走小图：以前页码条直接用 p{n}.png（1.2MB/张），一份 14 页课件
  // 光缩略图就下 18MB，把带宽吃干净 → 正文和 PDF 全排在后面，看起来就是「半天不出图」
  const thumb = await p.evaluate(async (id) => {
    const u = '/PyLab?handler=Image&deckId=' + id + '&pageNo=2&thumb=1';
    const r = await fetch(u);
    const b = await r.blob();
    const full = await fetch('/PyLab?handler=Image&deckId=' + id + '&pageNo=2');
    const fb = await full.blob();
    return { status: r.status, size: b.size, fullSize: fb.size };
  }, deck.id);
  T('缩略图走小图接口（< 200KB）', thumb.status === 200 && thumb.size > 1000 && thumb.size < 200000,
    Math.round(thumb.size / 1024) + 'KB（正文 ' + Math.round(thumb.fullSize / 1024) + 'KB）');

  sec('播放器矢量渲染');
  await p.click('.py-segbtn[data-deckview="play"]');
  await p.selectOption('#pyDeckSel', String(deck.id)).catch(() => { });

  // 新契约：先出图片（慢网下也不黑屏），PDF 到手后自动升级成 canvas
  const imgOk = await p.waitForFunction(() => {
    const im = document.getElementById('pySlideImg');
    return !!(im && !im.hidden && im.naturalWidth > 100);
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  T('先出图片（矢量就绪前不黑屏）', imgOk);

  await waitVector(p, 60000)
    .then(() => T('画布渲染出位图', true))
    .catch(async () => T('画布渲染出位图', false, JSON.stringify(await p.evaluate(() => {
      const cv = document.getElementById('pySlideCanvas');
      return cv ? { hidden: cv.hidden, w: cv.width, op: cv.style.opacity } : 'no-canvas';
    }))));
  await p.waitForTimeout(300);

  const st1 = await p.evaluate(snapCanvas);
  const box = await p.evaluate(() => {
    const b = document.getElementById('pyFsBox');
    return { w: b.clientWidth, dpr: Math.min(window.devicePixelRatio || 1, 2) };
  });
  T('画布位图 = 容器宽 × dpr', Math.abs(st1.w - box.w * box.dpr) <= 2, st1.w + ' vs ' + Math.round(box.w * box.dpr));
  T('画布有内容', st1.lum > 40, '亮度 ' + st1.lum);
  T('PDF.js 按需加载成功', st1.pdfjs === true);
  const strip = await p.evaluate(() => {
    const im = document.querySelector('#pyThumbs img[data-thumb="2"]');
    return im ? im.getAttribute('src') : '';
  });
  T('页码条用 thumb=1 小图', /thumb=1/.test(strip), strip);
  await p.screenshot({ path: OUT + '/online_vector_p1.png' });

  await p.click('.py-slidebar [data-act="dnext"]');
  await p.waitForFunction(() => document.getElementById('pyFsPage').textContent.trim().startsWith('2 /'), null, { timeout: 5000 })
    .then(() => T('翻页到第 2 页', true)).catch(() => T('翻页到第 2 页', false));
  // 翻页同样是「图片先上 → 矢量顶上」，等它收敛再比较
  await waitVector(p, 45000).catch(() => { });
  await p.waitForTimeout(300);
  const st2 = await p.evaluate(snapCanvas);
  T('翻页后画布重画（内容变了）', st2.sig !== st1.sig && st2.sig > 0, st1.sig + ' → ' + st2.sig);

  await p.click('.py-slidebar [data-act="fs"]');
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 }).catch(() => { });
  await p.waitForFunction(prevW => {
    const cv = document.getElementById('pySlideCanvas');
    return cv && cv.width > prevW;
  }, st2.w, { timeout: 20000 }).catch(() => { });
  await p.waitForTimeout(300);
  const fst = await p.evaluate(() => {
    const cv = document.getElementById('pySlideCanvas');
    return { fs: !!document.fullscreenElement, w: cv.width };
  });
  T('全屏后按新尺寸重画', fst.fs && fst.w > st2.w, st2.w + ' → ' + fst.w);
  await p.screenshot({ path: OUT + '/online_vector_fullscreen.png' });
  await p.evaluate(() => document.exitFullscreen && document.exitFullscreen());
  await p.waitForTimeout(400);

  sec('图片模式仍可用');
  await p.locator('#pyModes [data-slide-mode="image"]').click();
  await p.waitForTimeout(800);
  const imgSt = await p.evaluate(async () => {
    const im = document.getElementById('pySlideImg');
    if (!im.hidden && !im.complete) await new Promise(r => { im.onload = r; im.onerror = r; setTimeout(r, 5000); });
    return { hidden: im.hidden, w: im.naturalWidth, src: im.getAttribute('src') || '' };
  });
  T('切图片模式出图', imgSt.hidden === false && imgSt.w > 100, imgSt.w + 'px');
  T('走 Image 处理器', /handler=Image&deckId=\d+&pageNo=2/.test(imgSt.src), imgSt.src);
  await p.screenshot({ path: OUT + '/online_image_p2.png' });

  sec('清理');
  await p.click('.py-segbtn[data-deckview="lib"]');
  await p.waitForTimeout(600);
  p.once('dialog', d => d.accept());
  await card.locator('[data-deck-del]').click().catch(() => { });
  await p.waitForSelector('#pyDeckGrid .py-deck:has-text("' + TITLE + '")', { state: 'detached', timeout: 15000 })
    .catch(() => { });
  const left = await p.locator('#pyDeckGrid .py-deck', { hasText: TITLE }).count();
  T('测试课件已删除', left === 0, 'remaining=' + left);
  const gone = await p.evaluate(async (id) => (await fetch('/PyLab?handler=Pdf&deckId=' + id, { cache: 'no-store' })).status, deck.id);
  T('删除后 PDF 也跟着没了（404）', gone === 404, gone);

  T('全程无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n══════ 线上矢量模式抽验：${pass} 通过 / ${fail} 失败 ══════`);
  fs.writeFileSync('D:/projects/checkin/qa/report-online-slide-vector.json', JSON.stringify({ pass, fail, rows }, null, 2));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
