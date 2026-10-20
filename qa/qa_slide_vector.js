// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// qa_slide_vector.js — PyLab 课件「矢量模式」专项（PDF.js 路线 + 翻页淡入）
// 只覆盖本次新增：PPT 转换多产出 deck.pdf、PDF 鉴权读接口（含 Range）、
// 播放器矢量/图片开关、翻页重画、模式记忆、越权隔离。
// 用法: node qa_slide_vector.js        （本地 5188 + admin 登录）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:5188';
const SHOTS = 'D:/projects/checkin/qa/shots/pylab';
const DATA = 'D:/projects/checkin/CheckinApp/data/pylab';

let pass = 0, fail = 0;
const results = [];
function T(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra == null ? '' : String(extra) });
  if (cond) { pass++; console.log('  v ' + name + (extra != null ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  x ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
function sec(t) { console.log('\n■ ' + t); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const jsErrs = [];
  p.on('pageerror', e => jsErrs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) jsErrs.push(m.text()); });

  const txt = async (sel) => (await p.locator(sel).first().innerText().catch(() => '')).trim();

  // 画布快照：缩到 32×18 算内容指纹（判断「换页真的重画了」），顺带看透明度与尺寸
  const snapCanvas = () => {
    const cv = document.getElementById('pySlideCanvas');
    const img = document.getElementById('pySlideImg');
    const c = document.createElement('canvas');
    c.width = 32; c.height = 18;
    const g = c.getContext('2d');
    g.drawImage(cv, 0, 0, 32, 18);
    const d = g.getImageData(0, 0, 32, 18).data;
    let sig = 0, ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      sig += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7;
      if (d[i + 3] > 8) ink++;
    }
    return { w: cv.width, h: cv.height, op: cv.style.opacity, sig, ink, imgHidden: img.hidden, pdfjs: !!window.pdfjsLib };
  };

  // ---------- 登录 ----------
  sec('登录与初始化');
  await p.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await p.fill('#Username', ADMIN);
  await p.fill('#Password', PW);
  await p.locator('form:has(#Username) button[type=submit]').click();
  await p.waitForLoadState('domcontentloaded');
  T('管理员登录成功', !p.url().toLowerCase().includes('login'), p.url());

  await p.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 })
    .then(() => T('页面初始化完成', true)).catch(() => T('页面初始化完成', false));

  // 切到「② 课件播放」
  await p.locator('.py-tab[data-tab="deck"]').click();
  await p.waitForTimeout(400);

  // ---------- 接口层：hasPdf 字段 ----------
  sec('接口：hasPdf 字段');
  let decks = await p.evaluate(() => fetch('/PyLab?handler=Decks').then(r => r.json()).then(j => j.data.decks));
  T('Decks 返回课件列表', Array.isArray(decks) && decks.length > 0, decks.length + ' 份');
  const readyDeck = decks.find(d => d.status === 'ready');
  T('存在可播放课件', !!readyDeck, readyDeck && readyDeck.title);
  T('每条记录带 hasPdf 字段', decks.every(d => typeof d.hasPdf === 'boolean'));
  T('每条记录带 pdfMb 字段', decks.every(d => typeof d.pdfMb === 'number'));

  // ---------- 没有 PDF 就重新转一次（顺便验证 PowerPoint 分支也导 PDF） ----------
  sec('转换产物：PNG + PDF 并存');
  if (!readyDeck.hasPdf) {
    console.log('  · 该课件是老数据，触发重新转换…');
    const r = await p.evaluate((id) => fetch('/PyLab?handler=DeckRetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'RequestVerificationToken': document.querySelector('#pyToken input[name="__RequestVerificationToken"]').value },
      body: 'id=' + id
    }).then(x => x.json()), readyDeck.id);
    T('重新转换成功', r.ok && r.data.status === 'ready', JSON.stringify(r.data || r));
    T('转换结果回报 hasPdf', r.ok && r.data.hasPdf === true, r.ok ? r.data.hasPdf : 'n/a');
  }
  const deckDir = path.join(DATA, '1', 'deck_' + readyDeck.id);
  const pngs = fs.existsSync(deckDir) ? fs.readdirSync(deckDir).filter(f => /^p\d+\.png$/.test(f)) : [];
  const hasPdfFile = fs.existsSync(path.join(deckDir, 'deck.pdf'));
  T('磁盘上有逐页 PNG', pngs.length === readyDeck.pageCount, pngs.length + ' 张 / ' + readyDeck.pageCount + ' 页');
  T('磁盘上有 deck.pdf', hasPdfFile);
  T('PDF 比 PNG 总量小', hasPdfFile && npng(pngs, deckDir) > fs.statSync(path.join(deckDir, 'deck.pdf')).size,
    hasPdfFile ? fmt(npng(pngs, deckDir)) + ' vs ' + fmt(fs.statSync(path.join(deckDir, 'deck.pdf')).size) : 'n/a');

  // ---------- 刷新后重新读状态 ----------
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  await p.locator('.py-tab[data-tab="deck"]').click();
  await p.waitForTimeout(400);
  decks = await p.evaluate(() => fetch('/PyLab?handler=Decks').then(r => r.json()).then(j => j.data.decks));
  const d2 = decks.find(d => d.id === readyDeck.id);
  T('刷新后 hasPdf 仍为 true', d2.hasPdf === true);

  // ---------- PDF 读接口 ----------
  sec('PDF 读接口（鉴权 + Range）');
  const probe = await p.evaluate(async (id) => {
    const u = '/PyLab?handler=Pdf&deckId=' + id;
    const full = await fetch(u);
    const head = await fetch(u, { headers: { Range: 'bytes=0-1023' } });
    return {
      status: full.status,
      type: full.headers.get('content-type'),
      len: full.headers.get('content-length'),
      cache: full.headers.get('cache-control'),
      rangeStatus: head.status,
      rangeLen: head.headers.get('content-length'),
      magic: Array.from(new Uint8Array(await full.arrayBuffer()).slice(0, 5)).map(c => String.fromCharCode(c)).join(''),
    };
  }, readyDeck.id);
  T('GET Pdf 返回 200', probe.status === 200, probe.status);
  T('Content-Type 是 application/pdf', /application\/pdf/.test(probe.type || ''), probe.type);
  T('带 Content-Length', Number(probe.len) > 10000, probe.len + ' 字节');
  T('带私有缓存头', /max-age=86400/.test(probe.cache || ''), probe.cache);
  T('Range 请求返回 206', probe.rangeStatus === 206, probe.rangeStatus);
  T('Range 只回 1KB', Number(probe.rangeLen) === 1024, probe.rangeLen);
  T('响应体是 PDF 文件头', probe.magic === '%PDF-', probe.magic);

  // ---------- 播放器 UI ----------
  sec('播放器：矢量 / 图片开关');
  await p.waitForSelector('#pyModes', { state: 'visible', timeout: 5000 })
    .then(() => T('有 PDF 时显示模式开关', true)).catch(() => T('有 PDF 时显示模式开关', false));
  const modeOn = await p.locator('#pyModes .py-modebtn.on').getAttribute('data-slide-mode');
  T('默认选中矢量模式', modeOn === 'vector', modeOn);

  await p.waitForFunction(() => {
    const cv = document.getElementById('pySlideCanvas');
    return cv && !cv.hidden && cv.width > 100;
  }, null, { timeout: 15000 }).then(() => T('矢量模式首屏画布已渲染', true))
    .catch(() => T('矢量模式首屏画布已渲染', false));

  const st1 = await p.evaluate(snapCanvas);
  const box = await p.evaluate(() => {
    const b = document.getElementById('pyFsBox');
    return { w: b.clientWidth, h: b.clientHeight, dpr: Math.min(window.devicePixelRatio || 1, 2) };
  });
  const fitW = Math.abs(st1.w - box.w * box.dpr) <= 2, fitH = Math.abs(st1.h - box.h * box.dpr) <= 2;
  T('画布位图 = 容器尺寸 × dpr（矢量按物理像素出图）', fitW && fitH,
    st1.w + '×' + st1.h + ' vs ' + Math.round(box.w * box.dpr) + '×' + Math.round(box.h * box.dpr));
  T('画布保持 16:9、填满容器不溢出', Math.abs(st1.w / st1.h - 16 / 9) < 0.02, (st1.w / st1.h).toFixed(3));
  T('画布不是空白（缩略采样 576 点里有底色）', st1.ink > 100, st1.ink + '/576');
  T('矢量模式下 <img> 收起', st1.imgHidden === true);
  T('PDF.js 已按需加载', st1.pdfjs === true);
  T('第 1 页画布已显形', st1.op === '1', st1.op);
  await p.screenshot({ path: path.join(SHOTS, 'vector_p1.png') });

  // 翻页：画布重画到第 2 页
  await p.click('.py-slidebar [data-act="dnext"]');
  await p.waitForFunction(() => document.getElementById('pyFsPage').textContent.trim().startsWith('2 /'), null, { timeout: 5000 })
    .then(() => T('翻到第 2 页', true)).catch(() => T('翻到第 2 页', false));
  await p.waitForTimeout(600);
  const st2 = await p.evaluate(snapCanvas);
  T('第 2 页画布内容与第 1 页不同', st2.sig !== st1.sig && st2.sig > 0, st1.sig + ' → ' + st2.sig);
  T('第 2 页画布不透明（渲染完才显出来）', st2.op === '1', st2.op);
  await p.screenshot({ path: path.join(SHOTS, 'vector_p2.png') });

  // 全屏后重画
  await p.click('.py-slidebar [data-act="fs"]');
  await p.waitForTimeout(800);
  const fst = await p.evaluate(() => {
    const cv = document.getElementById('pySlideCanvas');
    return { fs: !!document.fullscreenElement, w: cv.width, h: cv.height, cssW: Math.round(cv.getBoundingClientRect().width) };
  });
  T('进入全屏', fst.fs === true);
  T('全屏后画布按新尺寸重画（幅面更大）', fst.w > st2.w, st2.w + ' → ' + fst.w);
  T('全屏后画布不出画布边界', fst.cssW <= 1441, fst.cssW + 'px');
  await p.screenshot({ path: path.join(SHOTS, 'vector_fullscreen.png') });
  await p.evaluate(() => document.exitFullscreen && document.exitFullscreen());
  await p.waitForTimeout(400);

  // 切回图片模式
  await p.locator('#pyModes [data-slide-mode="image"]').click();
  await p.waitForTimeout(400);
  const st3 = await p.evaluate(() => {
    const cv = document.getElementById('pySlideCanvas');
    const img = document.getElementById('pySlideImg');
    return { cvHidden: cv.hidden, imgHidden: img.hidden, src: img.getAttribute('src') || '' };
  });
  T('切图片模式后 <img> 显示', st3.imgHidden === false);
  T('切图片模式后画布收起', st3.cvHidden === true);
  T('图片指向 Image 处理器第 2 页', /handler=Image&deckId=\d+&pageNo=2/.test(st3.src), st3.src);
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'image_p2.png') });

  // 模式记忆
  sec('模式记忆');
  await p.locator('#pyModes [data-slide-mode="vector"]').click();
  await p.waitForTimeout(300);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  await p.locator('.py-tab[data-tab="deck"]').click();
  await p.waitForTimeout(900);
  const remembered = await p.evaluate(() => {
    const on = document.querySelector('#pyModes .py-modebtn.on');
    return { mode: on && on.getAttribute('data-slide-mode'), ls: localStorage.getItem('pylab.slideMode') };
  });
  T('刷新后记住矢量模式', remembered.mode === 'vector' && remembered.ls === 'vector', JSON.stringify(remembered));

  // ---------- 越权隔离 ----------
  sec('越权隔离');
  const anon = await b.newContext();   // 全新上下文 = 无 Cookie
  const ap = await anon.newPage();
  await ap.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });   // 先落到同源页面，否则 fetch 跨源被拦
  const code = await ap.evaluate(async (id) => {
    const r = await fetch('/PyLab?handler=Pdf&deckId=' + id, { redirect: 'manual' });
    return r.type === 'opaqueredirect' ? 302 : r.status;
  }, readyDeck.id).catch(e => 'ERR ' + e.message);
  T('未登录访问 PDF 被拒（404 或跳登录，不吐字节）', code === 404 || code === 302, code);
  await anon.close();

  // ---------- 老课件（无 PDF）不显示开关 ----------
  sec('降级：没有 PDF 的课件');
  const noPdf = await p.evaluate(() => {
    // 直接在页面里模拟：把当前课件的 hasPdf 置 false 后重绘
    const dk = window.__pyLab.decks.decks.find(d => d.id === window.__pyLab.deckId);
    const real = dk.hasPdf;
    dk.hasPdf = false;
    window.__pyLab.slideMode = 'vector';
    window.__pyLab.paintKey = '';
    // paintPlayer 是闭包内函数，借列表刷新链路间接触发
    document.getElementById('pyDeckSel').dispatchEvent(new Event('change', { bubbles: true }));
    return { modesHidden: document.getElementById('pyModes').hidden, cvHidden: document.getElementById('pySlideCanvas').hidden, imgHidden: document.getElementById('pySlideImg').hidden, real };
  });
  T('无 PDF 时藏掉模式开关', noPdf.modesHidden === true, JSON.stringify(noPdf));
  T('无 PDF 时自动走图片模式', noPdf.cvHidden === true && noPdf.imgHidden === false);

  // ---------- 翻页过渡（带动效的上下文，验证不会卡在 opacity:0） ----------
  sec('翻页过渡（正常动效）');
  const mv = await b.newContext({ viewport: { width: 1440, height: 950 } });   // 不传 reducedMotion
  const mp = await mv.newPage();
  const mvErr = [];
  mp.on('pageerror', e => mvErr.push(e.message));
  await mp.goto(BASE + '/Login', { waitUntil: 'domcontentloaded' });
  await mp.fill('#Username', ADMIN);
  await mp.fill('#Password', PW);
  await mp.locator('form:has(#Username) button[type=submit]').click();
  await mp.waitForLoadState('domcontentloaded');
  await mp.goto(BASE + '/PyLab', { waitUntil: 'domcontentloaded' });
  await mp.waitForFunction(() => window.__pyLab && window.__pyLab.boot, null, { timeout: 20000 });
  await mp.locator('.py-tab[data-tab="deck"]').click();
  await mp.waitForTimeout(500);
  await mp.locator('#pyModes [data-slide-mode="image"]').click();
  await mp.waitForTimeout(400);
  await mp.click('.py-slidebar [data-act="dnext"]');
  await mp.waitForTimeout(700);
  const fade = await mp.evaluate(() => {
    const img = document.getElementById('pySlideImg');
    const cv = document.getElementById('pySlideCanvas');
    return { imgOp: getComputedStyle(img).opacity, cvOp: getComputedStyle(cv).opacity, page: document.getElementById('pyFsPage').textContent.trim() };
  });
  T('图片模式淡入结束停在 opacity:1（不会留白）', Number(fade.imgOp) === 1, fade.imgOp + ' @ ' + fade.page);
  await mp.locator('#pyModes [data-slide-mode="vector"]').click();
  await mp.waitForTimeout(900);
  const fade2 = await mp.evaluate(() => getComputedStyle(document.getElementById('pySlideCanvas')).opacity);
  T('矢量模式淡入结束停在 opacity:1', Number(fade2) === 1, fade2);
  T('带动效上下文无 JS 报错', mvErr.length === 0, mvErr.slice(0, 2).join(' | '));
  await mv.close();

  // ---------- JS 无报错 ----------
  sec('控制台');
  T('全程无 JS 报错', jsErrs.length === 0, jsErrs.slice(0, 3).join(' | '));

  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  fs.writeFileSync('D:/projects/checkin/qa/report-slide-vector.json', JSON.stringify({ pass, fail, results }, null, 2));
  await b.close();
  process.exit(fail ? 1 : 0);
})();

function npng(list, dir) {
  return list.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
}
function fmt(n) { return (n / 1024 / 1024).toFixed(1) + 'MB'; }
