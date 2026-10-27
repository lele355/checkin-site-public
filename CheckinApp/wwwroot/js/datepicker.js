// ============================================================
// 统一日期 / 时间选择组件
// ------------------------------------------------------------
// 站内所有 <input type="date|datetime-local|time|month"> 由本文件自动接管：
//   ① 原生控件视觉隐藏（仍在表单里、仍参与校验提交，字段名一个字都不用改）
//   ② 旁边长出一个统一皮肤的触发按钮，显示「2026年10月26日 周一」这种中文
//   ③ 点开弹出月历（时间类带时分选择），点选即写回 input 并派发 change
// 为什么不用原生控件：各浏览器外观不一致、暗色主题下白底刺眼、
// 中文日期格式由系统区域决定（可能显示成 10/26/2026），换主题也改不动它。
//
// 无 JS / 旧浏览器：按钮不生成，原生控件照旧可用，表单不受影响。
// 主题适配：全部走 CSS 变量（tokens.css），五套主题自动跟随，无需按主题写分支。
// ============================================================
(function () {
  'use strict';

  var WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];   // getDay() 的索引
  var MONTH_CN = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月',
                  '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];
  var SEL = 'input[type="date"], input[type="datetime-local"], input[type="time"], input[type="month"]';

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }

  // ---- 解析 input.value → {y,m,d,h,mi}（m 为 0-11） -------------------
  function parseValue(type, v) {
    if (!v) return null;
    var m;
    if (type === 'time') {
      m = /^(\d{1,2}):(\d{2})/.exec(v);
      return m ? { h: +m[1], mi: +m[2] } : null;
    }
    if (type === 'month') {
      m = /^(\d{4})-(\d{2})/.exec(v);
      return m ? { y: +m[1], m: +m[2] - 1, d: 1 } : null;
    }
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(v);
    if (!m) return null;
    return { y: +m[1], m: +m[2] - 1, d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null };
  }

  // ---- 真实当天（以浏览器本地时间为准，见文件末尾的日期校正） ----
  function todayParts() {
    var n = new Date();
    return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate(), h: n.getHours(), mi: n.getMinutes() };
  }

  // ---- 触发器上显示的文字 -------------------------------------------
  function labelOf(type, v) {
    var p = parseValue(type, v);
    if (!p) return { text: '', empty: true };
    if (type === 'time') return { text: pad2(p.h) + ':' + pad2(p.mi), empty: false };
    if (type === 'month') return { text: p.y + '年' + (p.m + 1) + '月', empty: false };
    var d = new Date(p.y, p.m, p.d);
    var head = p.y + '年' + (p.m + 1) + '月' + p.d + '日';
    var wd = ' 周' + WEEK_CN[d.getDay()];
    if (type === 'datetime-local') {
      var hh = p.h == null ? 0 : p.h, mm = p.mi == null ? 0 : p.mi;
      return { text: head + wd + ' · ' + pad2(hh) + ':' + pad2(mm), empty: false };
    }
    return { text: head + wd, empty: false };
  }

  // ---- 弹层：单例，避免多个控件各建一份 -----------------------------
  var pop = null;          // 弹层 DOM
  var ctx = null;          // 当前正在编辑的控件上下文
  var view = null;         // {y, m} 当前展示的年月（日期类）
  var draft = null;        // 未确认的草稿值

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'dp-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.hidden = true;
    pop.innerHTML =
      '<div class="dp-head">' +
        '<button type="button" class="dp-nav" data-nav="-12" aria-label="上一年">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg></button>' +
        '<button type="button" class="dp-nav" data-nav="-1" aria-label="上个月">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
        '<span class="dp-title" aria-live="polite"></span>' +
        '<button type="button" class="dp-nav" data-nav="1" aria-label="下个月">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>' +
        '<button type="button" class="dp-nav" data-nav="12" aria-label="下一年">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/></svg></button>' +
      '</div>' +
      '<div class="dp-body"></div>' +
      '<div class="dp-quick"></div>' +
      '<div class="dp-time" hidden>' +
        '<span class="dp-time-label">时间</span>' +
        '<select class="dp-sel dp-hh" aria-label="小时"></select>' +
        '<span class="dp-colon">:</span>' +
        '<select class="dp-sel dp-mm" aria-label="分钟"></select>' +
      '</div>' +
      '<div class="dp-foot">' +
        '<button type="button" class="dp-clear">清除</button>' +
        '<button type="button" class="dp-ok btn">确定</button>' +
      '</div>';
    document.body.appendChild(pop);

    // 时分下拉的选项只建一次
    var hh = pop.querySelector('.dp-hh'), mm = pop.querySelector('.dp-mm'), i;
    for (i = 0; i < 24; i++) hh.appendChild(new Option(pad2(i), String(i)));
    for (i = 0; i < 60; i++) mm.appendChild(new Option(pad2(i), String(i)));

    pop.addEventListener('click', onPopClick);
    pop.addEventListener('change', onPopChange);
    return pop;
  }

  // ---- 渲染月历 ------------------------------------------------------
  function render() {
    var type = ctx.type;
    var body = pop.querySelector('.dp-body');
    var title = pop.querySelector('.dp-title');
    var quick = pop.querySelector('.dp-quick');
    var timeBox = pop.querySelector('.dp-time');
    var okBtn = pop.querySelector('.dp-ok');
    var clearBtn = pop.querySelector('.dp-clear');
    var foot = pop.querySelector('.dp-foot');
    var today = todayParts();
    // 必填字段不给「清除」—— 清了也提交不了，只是多一个会报错的按钮
    var canClear = !ctx.input.required;

    // —— 月份选择（input[type=month]）——
    if (type === 'month') {
      title.textContent = view.y + '年';
      var mh = '<div class="dp-months">';
      for (var k = 0; k < 12; k++) {
        var on = draft && draft.y === view.y && draft.m === k;
        mh += '<button type="button" class="dp-month' + (on ? ' on' : '') +
          (view.y === today.y && k === today.m ? ' now' : '') +
          '" data-month="' + k + '">' + MONTH_CN[k] + '</button>';
      }
      mh += '</div>';
      body.innerHTML = mh;
      quick.hidden = true;
      timeBox.hidden = true;
      okBtn.hidden = true;
      clearBtn.hidden = !canClear;
      foot.hidden = !canClear;
      return;
    }

    // —— 纯时间（input[type=time]）——
    if (type === 'time') {
      title.textContent = '选择时间';
      body.innerHTML = '';
      quick.hidden = false;
      renderQuick(true);
      timeBox.hidden = false;
      okBtn.hidden = false;
      clearBtn.hidden = !canClear;
      foot.hidden = false;
      syncTimeSelects();
      return;
    }

    // —— 日期 / 日期时间 ——
    title.textContent = view.y + '年' + (view.m + 1) + '月';
    var first = new Date(view.y, view.m, 1);
    var offset = (first.getDay() + 6) % 7;               // 周一开头
    var days = new Date(view.y, view.m + 1, 0).getDate();
    var prevDays = new Date(view.y, view.m, 0).getDate();

    var html = '<div class="dp-grid">';
    var dows = ['一', '二', '三', '四', '五', '六', '日'];
    for (var w = 0; w < 7; w++) html += '<span class="dp-dow">' + dows[w] + '</span>';

    var total = 0, d;
    for (d = 0; d < offset; d++) {
      html += '<button type="button" class="dp-day other" disabled>' + (prevDays - offset + 1 + d) + '</button>';
      total++;
    }
    for (d = 1; d <= days; d++) {
      var cls = 'dp-day';
      if (draft && draft.y === view.y && draft.m === view.m && draft.d === d) cls += ' on';
      if (view.y === today.y && view.m === today.m && d === today.d) cls += ' now';
      html += '<button type="button" class="' + cls + '" data-day="' + d + '">' + d + '</button>';
      total++;
    }
    var rest = (7 - total % 7) % 7;
    for (var n = 1; n <= rest; n++) html += '<button type="button" class="dp-day other" disabled>' + n + '</button>';
    html += '</div>';
    body.innerHTML = html;

    quick.hidden = false;
    renderQuick(false);
    var isDT = type === 'datetime-local';
    timeBox.hidden = !isDT;
    // 日期类点一下就算选完，不需要「确定」；日期时间要连时间一起定，留确定键
    okBtn.hidden = !isDT;
    clearBtn.hidden = !canClear;
    foot.hidden = okBtn.hidden && clearBtn.hidden;
    if (isDT) syncTimeSelects();
  }

  function renderQuick(timeOnly) {
    var quick = pop.querySelector('.dp-quick');
    var t = todayParts();
    if (timeOnly) {
      quick.innerHTML = '<button type="button" class="dp-chip" data-quick="now">现在</button>';
      return;
    }
    var items = [['today', '今天'], ['tomorrow', '明天'], ['nextweek', '下周同一天']];
    var html = '';
    for (var i = 0; i < items.length; i++) {
      html += '<button type="button" class="dp-chip" data-quick="' + items[i][0] + '">' + items[i][1] + '</button>';
    }
    quick.innerHTML = html;
  }

  function syncTimeSelects() {
    var h = draft && draft.h != null ? draft.h : todayParts().h;
    var mi = draft && draft.mi != null ? draft.mi : 0;
    pop.querySelector('.dp-hh').value = String(h);
    pop.querySelector('.dp-mm').value = String(mi);
  }

  // ---- 打开 / 关闭 ---------------------------------------------------
  function open(inp) {
    ensurePop();
    var type = inp.type;
    var v = parseValue(type, inp.value);
    var t = todayParts();

    if (type === 'time') {
      draft = { h: v ? v.h : t.h, mi: v ? v.mi : 0 };
      view = { y: t.y, m: t.m };
    } else {
      var base = v || { y: t.y, m: t.m, d: t.d };
      draft = {
        y: base.y, m: base.m, d: base.d,
        h: base.h != null ? base.h : (inp.dataset.defaultHour != null ? +inp.dataset.defaultHour : t.h),
        mi: base.mi != null ? base.mi : 0
      };
      view = { y: base.y, m: base.m };
    }

    ctx = { input: inp, type: type };
    render();
    pop.hidden = false;
    pop.dataset.type = type;
    place(inp);
    requestAnimationFrame(function () { pop.classList.add('is-open'); });

    // 移动端底部弹层：锁页面滚动
    if (window.matchMedia('(max-width: 640px)').matches) document.body.classList.add('dp-lock');

    document.addEventListener('keydown', onKeydown, true);
    setTimeout(function () { document.addEventListener('click', onDocClick, true); }, 0);
  }

  function close() {
    if (!pop || pop.hidden) return;
    pop.classList.remove('is-open');
    pop.hidden = true;
    ctx = null;
    document.body.classList.remove('dp-lock');
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('click', onDocClick, true);
  }
  window.dpClose = close;

  // 桌面端锚在控件下方（空间不够就翻到上方）；移动端固定贴底
  function place(inp) {
    if (window.matchMedia('(max-width: 640px)').matches) {
      pop.style.left = ''; pop.style.top = ''; pop.dataset.sheet = '1';
      return;
    }
    pop.dataset.sheet = '0';
    var r = inp.getBoundingClientRect();
    var w = pop.offsetWidth || 296;
    var h = pop.offsetHeight || 360;
    var left = r.left + r.width / 2 - w / 2;
    left = Math.max(10, Math.min(left, innerWidth - w - 10));
    var top = r.bottom + 8;
    if (top + h > innerHeight - 10) top = Math.max(10, r.top - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function onDocClick(e) {
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (ctx && ctx.input === e.target) return;
    if (e.target.closest && e.target.closest('.dp-wrap')) return;
    close();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (!ctx || ctx.type === 'time') return;
    // 方向键在网格里移动焦点，Enter 由按钮原生处理
    var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step == null) return;
    var cur = document.activeElement;
    if (!cur || !cur.classList || !cur.classList.contains('dp-day')) return;
    e.preventDefault();
    var d = +cur.dataset.day;
    if (!d) return;
    var next = new Date(view.y, view.m, d + step);
    view = { y: next.getFullYear(), m: next.getMonth() };
    render();
    var again = pop.querySelector('.dp-day[data-day="' + next.getDate() + '"]:not(.other)');
    if (again) again.focus();
  }

  // ---- 交互：翻页 / 选日 / 快选 / 时间 / 确定 / 清除 -------------------
  function onPopClick(e) {
    var nav = e.target.closest('.dp-nav');
    if (nav) {
      var delta = +nav.dataset.nav;
      if (ctx.type === 'month' && Math.abs(delta) === 1) { view.y += delta; }
      else if (ctx.type === 'month') { view.y += delta; }
      else {
        var nm = view.m + delta;
        view = { y: view.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
      }
      render();
      return;
    }

    var dayBtn = e.target.closest('.dp-day');
    if (dayBtn && dayBtn.dataset.day) {
      draft.y = view.y; draft.m = view.m; draft.d = +dayBtn.dataset.day;
      if (ctx.type === 'datetime-local') { render(); return; }   // 还要选时间，先留在弹层
      commit(true);
      return;
    }

    var monBtn = e.target.closest('.dp-month');
    if (monBtn) {
      commitMonth(+monBtn.dataset.month);
      return;
    }

    var q = e.target.closest('.dp-chip');
    if (q) {
      applyQuick(q.dataset.quick);
      return;
    }

    if (e.target.closest('.dp-ok')) { commit(true); return; }
    if (e.target.closest('.dp-clear')) { clearValue(); return; }
  }

  function onPopChange(e) {
    if (!e.target.classList.contains('dp-sel') || !draft) return;
    draft.h = +pop.querySelector('.dp-hh').value;
    draft.mi = +pop.querySelector('.dp-mm').value;
  }

  function applyQuick(kind) {
    var t = todayParts();
    if (kind === 'now') {
      draft.h = t.h; draft.mi = t.mi;
      syncTimeSelects();
      commit(true);
      return;
    }
    var base = new Date(draft ? draft.y : t.y, draft ? draft.m : t.m, draft ? draft.d : t.d);
    if (kind === 'today') base = new Date(t.y, t.m, t.d);
    else if (kind === 'tomorrow') base = new Date(t.y, t.m, t.d + 1);
    else if (kind === 'nextweek') base = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 7);

    draft.y = base.getFullYear(); draft.m = base.getMonth(); draft.d = base.getDate();
    view = { y: draft.y, m: draft.m };
    if (ctx.type === 'datetime-local') { render(); return; }
    commit(true);
  }

  // ---- 写回 input ----------------------------------------------------
  function writeValue(v, fire) {
    var inp = ctx.input;
    inp.value = v;
    if (fire) {
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
    refreshTrigger(inp);
  }

  function commit(closeAfter) {
    if (!ctx || !draft) return;
    var type = ctx.type;
    var v = '';
    if (type === 'month') v = draft.y + '-' + pad2(draft.m + 1);
    else if (type === 'datetime-local') {
      v = ymd(draft.y, draft.m, draft.d) + 'T' + pad2(draft.h == null ? 0 : draft.h) + ':' + pad2(draft.mi == null ? 0 : draft.mi);
    }
    else if (type === 'time') v = pad2(draft.h == null ? 0 : draft.h) + ':' + pad2(draft.mi == null ? 0 : draft.mi);
    else v = ymd(draft.y, draft.m, draft.d);

    writeValue(v, true);
    if (closeAfter) close();
  }

  function commitMonth(m) {
    draft.m = m;
    commit(true);
  }

  function clearValue() {
    if (!ctx) return;
    writeValue('', true);
    close();
  }

  // ---- 触发器维护 ----------------------------------------------------
  function refreshTrigger(inp) {
    var wrap = inp.closest('.dp-wrap');
    if (!wrap) return;
    var btn = wrap.querySelector('.dp-trigger');
    if (!btn) return;
    var lab = labelOf(inp.type, inp.value);
    btn.querySelector('.dp-value').textContent = lab.text || (inp.dataset.placeholder || '选择日期');
    btn.classList.toggle('is-empty', lab.empty);
    btn.disabled = inp.disabled;
  }

  function enhance(inp) {
    if (inp.dataset.dpReady === '1') return;
    inp.dataset.dpReady = '1';

    var wrap = document.createElement('span');
    wrap.className = 'dp-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    inp.classList.add('dp-native');
    inp.setAttribute('tabindex', '-1');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dp-trigger';
    btn.setAttribute('aria-haspopup', 'dialog');
    if (inp.id) btn.setAttribute('aria-controls', inp.id);
    btn.innerHTML = '<span class="dp-value"></span>' +
      '<svg class="dp-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>';
    wrap.appendChild(btn);

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (!pop || pop.hidden || ctx.input !== inp) open(inp);
      else close();
    });

    refreshTrigger(inp);
  }

  // 表单校验失败时把焦点交回可见的触发器（原生控件是视觉隐藏的，
  // 焦点落在它上面用户看不到任何反馈，会以为「点了保存但没反应」）
  document.addEventListener('invalid', function (e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('dp-native')) return;
    var wrap = t.closest('.dp-wrap');
    var btn = wrap && wrap.querySelector('.dp-trigger');
    if (btn) { try { btn.focus({ preventScroll: false }); } catch (err) { btn.focus(); } }
  }, true);

  // ---- 对外入口：整页 / 弹窗表单 / pjax 换主区后都要跑一遍 -----------
  window.enhanceDates = function (root) {
    var scope = root || document;
    var list = scope.querySelectorAll(SEL);
    for (var i = 0; i < list.length; i++) enhance(list[i]);
  };

  window.enhanceDates(document);
  document.addEventListener('page:load', function (e) { window.enhanceDates(e.detail || document); });
  // 弹窗（modal.js）把表单装进来后也会触发 page:load 之外的路径，这里再兜一层
  window.addEventListener('resize', function () { if (pop && !pop.hidden && ctx) place(ctx.input); });

  // ============================================================
  // 真实日期校正
  // ------------------------------------------------------------
  // 服务端按 Asia/Shanghai 渲染「今天」，但用户设备的时钟/时区才是他自己认的
  // 那个「今天」。两者不一致时（跨时区、设备时钟偏、页面开着过了一夜），
  // 页面上的「今天/还剩 N 天/第 N 周」就会错位。
  // 这里把服务端日期与浏览器日期对一次：不一致就静默重新取一次主区，
  // 让所有依赖日期的显示都回到用户眼里的真实日期。
  // ============================================================
  (function dateDrift() {
    var html = document.documentElement;
    var server = html.getAttribute('data-server-today');
    if (!server) return;

    function nowKey() {
      var n = new Date();
      return n.getFullYear() + '-' + pad2(n.getMonth() + 1) + '-' + pad2(n.getDate());
    }

    var fired = false;
    function check() {
      if (fired) return;
      var local = nowKey();
      if (local === server) return;
      fired = true;
      html.setAttribute('data-server-today', local);   // 防止连续触发
      // 有 pjax 就只换主区（无整页闪白）；没有就整页刷新
      var url = location.pathname + location.search;
      if (window.pjaxReplace) window.pjaxReplace(url);
      else location.replace(url);
    }

    // 首屏先等一下（别和首屏动画抢帧）；之后每次回到前台都再看一眼
    setTimeout(check, 1200);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { fired = false; check(); }
    });
  })();
})();
