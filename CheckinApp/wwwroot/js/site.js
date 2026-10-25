// ============================================================
// 通用界面交互：手机抽屉 / 外观面板互斥 / 旋转清理 / 防重复提交
// （主题逻辑在 theme.js，本文件只管布局壳的交互）
// ============================================================
(function () {
  // 原生壳标记：CSS 里 html.is-native 那一档降级全靠这个类。
  // Capacitor 会在页面脚本执行前注入 window.Capacitor，所以这里能提前判定，
  // 不必等 app-shell.js（它在本文件之后加载），否则首屏会先按网页版渲染一下。
  var NATIVE = !!(window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform());
  if (NATIVE) document.documentElement.classList.add('is-native');
  // ---- 手机抽屉开关（汉堡 / 遮罩共用） ----
  window.toggleDrawer = function (show) {
    var open = (typeof show === 'boolean')
      ? show
      : !document.body.classList.contains('drawer-open');
    // 互斥：抽屉和外观面板不同时开，否则面板会被遮罩压住
    if (open && window.toggleAppearancePanel) window.toggleAppearancePanel(false);
    document.body.classList.toggle('drawer-open', open);
  };

  // ---- 返回上一页（顶栏返回按钮用） ----
  // 站内点进来的 → history.back() 回真实的上一页；
  // 直接输网址 / 新标签页打开 / 从站外进来 → 回工作台，避免“后退”把人退出网站
  window.goBack = function () {
    var sameOrigin = document.referrer && document.referrer.indexOf(location.origin) === 0;
    if (sameOrigin && history.length > 1) history.back();
    else location.href = '/';
  };

  // ---- PC 侧栏收起/展开（html[data-sidebar] 驱动 CSS，localStorage 记偏好） ----
  window.toggleSidebar = function () {
    var el = document.documentElement;
    var hidden = el.dataset.sidebar !== 'hidden';
    if (hidden) el.dataset.sidebar = 'hidden';
    else delete el.dataset.sidebar;
    try { localStorage.setItem('layout.sidebar', hidden ? 'hidden' : 'shown'); } catch (e) { }
    var btn = document.querySelector('.sidebar-toggle');
    if (btn) {
      btn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      btn.setAttribute('aria-label', hidden ? '展开侧边栏' : '收起侧边栏');
    }
  };

  // ---- 横竖屏切换清理 ----
  // 旋转到 ≥768px 后抽屉样式自动失效，但 body 上的 class 会残留，
  // 转回竖屏时抽屉“自己弹出来”，所以切到平板/桌面布局就清掉
  var mq = window.matchMedia('(min-width: 768px)');
  var onBreak = function (e) { if (e.matches) document.body.classList.remove('drawer-open'); };
  if (mq.addEventListener) mq.addEventListener('change', onBreak);
  else if (mq.addListener) mq.addListener(onBreak);   // 旧 Safari

  // ---- Esc 关抽屉 ----
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.body.classList.remove('drawer-open');
  });

  // ---- 防重复提交 ----
  // 提交成功走 PRG（重定向），不会重复；这里防的是请求在路上时手抖双击/双指连点
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.dataset && form.dataset.submitted === '1') { e.preventDefault(); return; }
    if (form.dataset) form.dataset.submitted = '1';
  });

  // ---- 整页刷新后保持滚动位置 ----
  // 打卡、保存、删除这类操作走 PRG（提交→302→整页回来），浏览器默认回到页顶，
  // 长列表里点一次打卡就被扔回顶部很恼火。提交前记住位置，回来后复位。
  // 注意：布局把滚动放在 main.content 内部容器（window.scrollY 恒为 0），
  // 必须存/取真正滚动的那个元素；恢复要同步做，才能穿过「记忆视图自动跳转」链。
  var SCROLL_KEY = 'scrollkeep';
  function getScroller() {
    var m = document.querySelector('main.content');
    return (m && m.scrollHeight > m.clientHeight + 5) ? m : null;
  }
  window.keepScroll = function () {
    try {
      var m = getScroller();
      var y = m ? m.scrollTop : window.scrollY;
      if (y > 0) sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ path: location.pathname, y: y }));
    } catch (e) { }
  };
  document.addEventListener('submit', function () { window.keepScroll(); }, true);   // 捕获阶段：弹窗 fetch 提交前也能记上
  try {
    var raw = sessionStorage.getItem(SCROLL_KEY);
    sessionStorage.removeItem(SCROLL_KEY);
    if (raw) {
      var d = JSON.parse(raw);
      if (d && d.path === location.pathname && typeof d.y === 'number' && d.y > 0) {
        var m2 = getScroller();
        if (m2) m2.scrollTop = d.y; else window.scrollTo(0, d.y);   // 同步复位
      }
    }
  } catch (e) { }
})();

// ===== 视图切换偏好记忆 =====
// 约定：.view-switch[data-viewkey="schedule"] 包着 .vs-btn[data-view="calendar"] 按钮。
// 页面 URL 带 ?view= 时记住选择；不带时按记忆自动恢复（replace 不留历史）。
// 切换走 pjaxGo 免整页刷新（无 pjax 的老浏览器回落 location.href）。
function initViewSwitch() {
  var sw = document.querySelector('.view-switch');
  if (!sw || sw.dataset.bound === '1') return;
  sw.dataset.bound = '1';
  var key = 'view:' + (sw.dataset.viewkey || location.pathname);
  var btns = sw.querySelectorAll('.vs-btn');
  var current = null, stored = null;
  try { stored = localStorage.getItem(key); } catch (e) { }
  btns.forEach(function (b) {
    if (b.classList.contains('on')) current = b.dataset.view;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      // 已在当前视图不重复跳转
      if (b.dataset.view === current && new URLSearchParams(location.search).has('view')) return;
      try { localStorage.setItem(key, b.dataset.view); } catch (err) { }
      // 保留其他 URL 参数（如记账的 ?m=），只改 view
      var p = new URLSearchParams(location.search);
      p.set('view', b.dataset.view);
      var url = location.pathname + '?' + p.toString();
      if (window.keepScroll) window.keepScroll();   // 切视图也别把人扔回页顶
      if (window.pjaxGo) window.pjaxGo(url); else location.href = url;
    });
  });
  // URL 显式带 view 时同步记忆（只认本页切换器里真实存在的视图，防串页污染）；
  // 没带且记忆里有别的视图 → 自动跳过去
  var qs = new URLSearchParams(location.search);
  var validViews = {};
  Array.prototype.forEach.call(btns, function (b) { validViews[b.dataset.view] = 1; });
  if (qs.has('view') && validViews[qs.get('view')]) {
    try { localStorage.setItem(key, qs.get('view')); } catch (e) { }
  } else if (stored && stored !== current) {
    var valid = Array.prototype.some.call(btns, function (b) { return b.dataset.view === stored; });
    if (valid) {
      qs.set('view', stored);
      var url2 = location.pathname + '?' + qs.toString();
      if (window.keepScroll) window.keepScroll();   // 穿过自动跳转链保住滚动位
      if (window.pjaxReplace) window.pjaxReplace(url2); else location.replace(url2);
    }
  }
}
initViewSwitch();
document.addEventListener('page:load', initViewSwitch);   // 无刷新换主区后重新绑定

// ===== 表单布局增强 =====
// ① 连续「短字段」（只含一个 select / 日期 / 时间 / 数字控件的 .field）自动并排一行
// ② 表单末行的动作条统一加 .form-actions（分隔线 + 窄屏按钮均分）
// 整页渲染这里自动跑一遍；弹窗表单由 modal.js 在 fillModal 后调 window.enhanceForms(body)。
(function () {
  function isShortField(el) {
    if (el.querySelector('textarea')) return false;
    // 注意排除隐藏控件：number/date 旁会有 ASP.NET 不变文化绑定的 __Invariant 隐藏字段
    var ctrls = el.querySelectorAll('input:not([type=hidden]), select, textarea');
    if (ctrls.length !== 1) return false;
    var c = ctrls[0];
    if (c.tagName === 'SELECT') return true;
    if (c.tagName !== 'INPUT') return false;
    return /^(date|time|datetime-local|number)$/.test(c.type);
  }

  window.enhanceForms = function (root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('form'), function (form) {
      if (form.dataset.enhanced === '1') return;
      form.dataset.enhanced = '1';

      // ① 连续短字段并排（CSS 弹性换行，窄屏自动竖排）
      var kids = Array.prototype.slice.call(form.children);
      var run = [];
      function flush() {
        if (run.length >= 2) {
          var row = document.createElement('div');
          row.className = 'field-row';
          run[0].parentNode.insertBefore(row, run[0]);
          run.forEach(function (f) { row.appendChild(f); });
        }
        run = [];
      }
      kids.forEach(function (el) {
        if (el.classList && el.classList.contains('field') && isShortField(el)) run.push(el);
        else flush();
      });
      flush();

      // ② 动作条统一 class（找提交按钮所在的那行；表单末尾常有隐藏字段，不能用 lastElementChild）
      //    含输入控件的行是「输入条」不是动作条（如 AI 输入行 textarea+发送），不能加分隔线/均分
      var btn = form.querySelector('button[type=submit]');
      var row = btn && btn.parentElement;
      if (row && row.tagName === 'DIV' && row.parentElement === form
        && !row.classList.contains('form-actions')
        && !row.querySelector('textarea, input:not([type=hidden]), select')) {
        row.classList.add('form-actions');
        row.removeAttribute('style');
      }
    });
  };
  window.enhanceForms(document);
})();

// ===== 滚动与按钮动效增强 =====
// ① 阅读进度条：CSS scroll-timeline 不支持时用 JS 写 transform 兜底
// ② 进入视口淡入上移（IntersectionObserver，只触发一次）+ 网格 80ms 交错入场
// ③ 细指针磁吸：.btn 跟手位移（translate 独立属性，不挡按压缩放），移开弹簧回位
// 全部尊重 prefers-reduced-motion：减少动态时直接不做。
(function () {
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- ① 进度条 ----
  var bar = document.querySelector('.scroll-progress');
  var cssTimeline = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'));
  if (cssTimeline) document.documentElement.classList.add('has-scroll-timeline');
  if (bar && !cssTimeline) {
    // 兜底：哪条滚动链动了就重算进度（手机=window，PC=main.content）
    // 进度条在 main.content 里，无刷新换主区后是新节点——每次重取，不闭包抓旧节点
    var tickQueued = false;
    var pickScrollEl = function () {
      var m = document.querySelector('main.content');
      return (m && m.scrollHeight > m.clientHeight + 5) ? m : document.documentElement;
    };
    var tick = function () {
      // 读 scrollHeight / clientHeight / scrollTop 都会强制同步布局；滚动时 scroll
      // 事件一帧可能触发多次，不合并就是每帧多次 layout thrashing —— 桌面 Chrome
      // 扛得住，Android WebView 上直接掉帧。合并到下一帧只算一次。
      if (tickQueued) return;
      tickQueued = true;
      requestAnimationFrame(function () {
        tickQueued = false;
        var el = pickScrollEl();
        var max = el.scrollHeight - el.clientHeight;
        var p = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
        var b2 = document.querySelector('.scroll-progress');
        if (b2) b2.style.transform = 'scaleX(' + p + ')';
      });
    };
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', tick);
    if (document.querySelector('main.content')) {
      document.querySelector('main.content').addEventListener('scroll', tick, { passive: true });
    }
    tick();
  }

  // ---- ② 淡入 + 交错 ----
  // 网格容器的子项走交错（--i 每项 +80ms）；独立卡片走单次淡入；
  // 内含 sticky 分组标题的卡片只淡不变形（transform 会干扰 sticky）
  // 暴露 initReveal：无刷新换主区（pjax）后对新内容重跑一遍
  window.initReveal = function (root) {
    if (reduced || !('IntersectionObserver' in window)) return;
    var scope = root || document;
    var GRIDS = '.grid-cards, .habit-cards, .anni-cards';
    var marks = [];
    Array.prototype.forEach.call(scope.querySelectorAll(GRIDS), function (grid) {
      Array.prototype.forEach.call(grid.children, function (el, i) {
        el.classList.add('reveal');
        el.style.setProperty('--i', String(Math.min(i, 11)));
        marks.push(el);
      });
    });
    Array.prototype.forEach.call(scope.querySelectorAll('.card'), function (card) {
      if (card.closest(GRIDS)) return;                       // 网格子项已交错
      if (card.classList.contains('reveal')) return;
      if (card.querySelector('.group-head')) card.classList.add('reveal-fade');
      else card.classList.add('reveal');
      marks.push(card);
    });
    // 观察器的回调跑在浏览器的布局阶段里，这时候改 class 会当场触发一次样式重算；
    // 一屏进来十几张卡片就是十几次。攒到下一帧一次性加完，只重算一轮。
    var pending = [];
    var flushQueued = false;
    var flush = function () {
      flushQueued = false;
      var batch = pending;
      pending = [];
      for (var i = 0; i < batch.length; i++) batch[i].classList.add('is-in');
    };
    // rootMargin 往下外扩 280px（约手机半屏）：元素还在视口外就开始淡入，
    // 等它真滚到眼前，动画早走完了 —— 用户看到的是「稳稳在那儿的内容」，
    // 而不是「滚一屏、冒一批、再滚一屏、又冒一批」。
    // 原来的 -4% 是往视口里收，等于等元素探进视口才起跑，顿挫感最重。
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        pending.push(entries[i].target);
        io.unobserve(entries[i].target);                     // 只触发一次
      }
      if (!pending.length || flushQueued) return;
      flushQueued = true;
      requestAnimationFrame(flush);
    }, { threshold: 0, rootMargin: '0px 0px 280px 0px' });
    marks.forEach(function (el) { io.observe(el); });
    // 原来这里还有个 1s 兜底：遍历所有标记逐个 getBoundingClientRect() 补亮。
    // 但 observe() 时浏览器就会对每个目标做一次初始相交计算，屏内的元素早被
    // 观察器自己标好了；屏外的元素用户没滚到也看不见。那次遍历纯属白做一次
    // 全量强制布局，而且卡在「点开页面 1 秒」这个最要命的时机，删掉。
  };
  window.initReveal(document);
  document.addEventListener('page:load', function (e) { window.initReveal(e.detail || document); });

  // ---- ③ 磁吸位移（只对 .btn、只在细指针设备）----
  if (!reduced && window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var cur = null;
    document.addEventListener('mousemove', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.btn') : null;
      if (b !== cur) {
        if (cur) { cur.classList.remove('mag-live'); cur.style.translate = ''; }
        cur = b;
        if (cur) cur.classList.add('mag-live');   // 跟手无延迟，移开后 CSS 弹簧回位
      }
      if (!cur) return;
      var r = cur.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2) * 3;   // 最多磁吸 3px
      var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2) * 3;
      dx = Math.max(-3, Math.min(3, dx));
      dy = Math.max(-3, Math.min(3, dy));
      cur.style.translate = dx.toFixed(2) + 'px ' + dy.toFixed(2) + 'px';
    }, { passive: true });
  }
})();

// ===== 方案1：免刷新局部更新（置顶 / 打卡）+ FLIP 位移动画 =====
// form[data-ajax="pin|checkin"] 提交走 fetch（X-Requested-With: fetch），
// 服务端回 JSON，前端就地更新 DOM；置顶=FLIP 动画滑到列表顶部，全程不整页刷新。
(function () {
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // FLIP：先量旧位置 → mutate() 改 DOM → 量新位置 → 反向位移后动画归零
  window.flipMove = function (container, mutate) {
    if (!container || reduced || !container.animate) { mutate(); return; }
    var kids = Array.prototype.slice.call(container.children);
    var first = kids.map(function (el) { return el.getBoundingClientRect(); });
    mutate();
    kids.forEach(function (el, i) {
      if (!el.isConnected) return;
      var f = first[i], l = el.getBoundingClientRect();
      var dx = f.left - l.left, dy = f.top - l.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px)' },
        { transform: 'none' }
      ], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  };

  function actionOf(form) { return form.getAttribute('action') || location.href; }
  function setHandler(form, name) {
    try {
      var u = new URL(actionOf(form), location.href);
      u.searchParams.set('handler', name);
      form.setAttribute('action', u.pathname + u.search);
    } catch (e) { /* 兜底：原样不动 */ }
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.matches || !form.matches('form[data-ajax]')) return;
    if (e.defaultPrevented) return;      // 防重复提交锁先拦下的就别再发请求
    e.preventDefault();                  // 拦住整页刷新
    if (form.dataset.ajaxBusy === '1') return;
    form.dataset.ajaxBusy = '1';

    var btn = form.querySelector('[type=submit]');
    if (btn) btn.disabled = true;

    fetch(actionOf(form), {
      method: (form.getAttribute('method') || 'post').toUpperCase(),
      body: new FormData(form),
      headers: { 'X-Requested-With': 'fetch' }
    }).then(function (r) {
      if (r.redirected || /\/login/i.test(r.url || '')) { location.href = '/Login'; return null; }
      return r.json();
    }).then(function (d) {
      if (!d || !d.ok) throw new Error('bad response');
      if (form.dataset.ajax === 'pin') applyPin(form, d);
      else if (form.dataset.ajax === 'checkin') applyCheckin(form, d);
    }).catch(function () {
      if (window.toast) window.toast('操作失败，请重试', 'err');
    }).then(function () {
      if (btn) btn.disabled = false;
      form.dataset.ajaxBusy = '';
      form.dataset.submitted = '';      // 放行防重复提交锁
    });
  });

  // ---- 备忘置顶：翻图钉 + 置顶时 FLIP 滑到顶部 ----
  function applyPin(form, d) {
    var btn = form.querySelector('.pin-btn');
    if (btn) {
      btn.classList.toggle('on', !!d.pinned);
      var label = d.pinned ? '取消置顶' : '置顶';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
    if (window.toast) window.toast(d.pinned ? '已置顶，移到列表顶部' : '已取消置顶', 'ok');
    if (!d.pinned) return;
    var row = form.closest('.memo-row, .memo-card');
    var box = row && row.parentElement;
    if (row && box) {
      window.flipMove(box, function () { box.insertBefore(row, box.firstChild); });
    }
  }

  // ---- 习惯打卡：按钮就地换态 + 统计数字 / 近 7 天点阵刷新 ----
  function applyCheckin(form, d) {
    var btn = form.querySelector('[type=submit]');
    if (btn) {
      if (d.checked) {
        btn.textContent = '✓ 今日已打卡';
        btn.className = 'btn secondary';
        btn.title = '取消今天的打卡';
        setHandler(form, 'Undo');
      } else {
        btn.textContent = '打卡';
        btn.className = 'btn';
        btn.title = '';
        setHandler(form, 'Checkin');
      }
      if (!reduced && btn.animate) {
        btn.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }

    if (d.total != null) {
      // 打卡页：服务端算好的统计，就地更新（不刷新）
      var row = form.closest('.habit-card, .row-item');
      var stats = row && row.querySelector('.habit-stats');
      if (stats) {
        var t = stats.querySelector('.hs-total');
        if (t) t.textContent = d.total;
        var n = stats.querySelector('.hs-n'), n2 = stats.querySelector('.hs-n2');
        if (n) n.textContent = d.streak;
        if (n2) n2.textContent = d.streak;
        var flame = stats.querySelector('.hs-flame'), plain = stats.querySelector('.hs-plain');
        if (flame && plain) {
          flame.hidden = d.streak < 2;
          plain.hidden = d.streak >= 2;
        }
      }
      var dots = row && row.querySelectorAll('.week-dot');
      if (dots && d.week) {
        Array.prototype.forEach.call(dots, function (dot, i) {
          dot.classList.toggle('on', !!d.week[i]);
        });
      }
    } else if (d.checked && btn) {
      // 工作台快捷打卡：按钮原地换成「已打卡」小徽章（和渲染态一致）
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.background = 'var(--accent-soft)';
      chip.style.color = 'var(--accent-strong)';
      chip.textContent = '已打卡';
      form.replaceWith(chip);
    }
    if (window.toast) window.toast(d.checked ? '打卡成功，继续加油' : '已取消今天的打卡', 'ok');
  }
})();

// ===== 无刷新页面切换（fetch 主区替换 + pushState；方案3 SPA 的轻量替代）=====
// 点站内链接不再整页刷新：只换 main.content，顶栏/侧栏同步高亮，页面脚本重放；
// 弹窗链接（/New /Edit /Reset）仍归 modal.js；fetch 失败自动回落整页跳转。
(function () {
  'use strict';
  if (!window.fetch || !window.history || !history.pushState) return;   // 老浏览器整页跳转
  var LAYOUT_JS = /(theme|site|modal)\.js/i;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function normPath(p) {
    p = (p || '').toLowerCase();
    if (p.length > 1 && p.slice(-1) === '/') p = p.slice(0, -1);
    if (p.endsWith('/index')) p = p.slice(0, -6) || '/';
    return p;
  }

  function isPjaxable(a) {
    if (!a || a.dataset.pjax === 'off') return false;
    if (a.hasAttribute('download')) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.closest('#appModal')) return false;                  // 弹窗里的链接归 modal.js
    if (a.dataset.modal === 'open' || a.dataset.modal === 'off') return false;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return false;
    if (/\/(New|Edit|Reset)([/?#]|$)/i.test(href)) return false;   // 表单页归 modal.js 弹窗
    var u;
    try { u = new URL(a.href, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin) return false;
    if (u.pathname === location.pathname && u.search === location.search) return false;   // 同页锚点不算
    return true;
  }

  // 顶栏返回按钮 / 侧栏高亮：主区换血后同步（它们在 main.content 外面）
  function syncChrome(url) {
    var target = new URL(url, location.origin);
    var path = normPath(target.pathname);
    var curSearch = (target.search || '').toLowerCase();

    var links = Array.prototype.slice.call(document.querySelectorAll('.sidebar .nav-item'));

    // 同一路径下是否存在「带查询串」的入口？
    // 有的话必须连 search 一起比，否则无参数那个会一直亮、把子项盖住。
    // 没有这种入口的普通页面仍按「只看路径」走，避免 ?pageNo=2 之类把高亮打掉。
    // （曾经 PyLab 单机版把四个视图拆成 /PyLab、/PyLab?view=... 四个入口，
    //   模块 2026-10-22 已删；这套判定留着，是「同路径多入口」场景的通用兜底。）
    var strict = links.some(function (a) {
      var h = a.getAttribute('href') || '';
      if (!h || h.charAt(0) === '#') return false;
      try {
        var u0 = new URL(h, location.origin);
        return normPath(u0.pathname) === path && !!u0.search;
      } catch (e) { return false; }
    });

    links.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      var on = false;
      try {
        var u = new URL(href, location.origin);
        on = normPath(u.pathname) === path
          && (!strict || (u.search || '').toLowerCase() === curSearch);
      } catch (e) { }
      a.classList.toggle('active', on);
      // 清焦点残留：焦点留在旧栏目上时 :focus-visible 下划线会一直亮着
      if (!on && document.activeElement === a && a.blur) a.blur();
    });
    // 首页/登录/强制改密页隐藏「返回」（和 _Layout 的 hideBack 同规则）
    var hide = path === '/' || path === '/login' || path === '/changepassword';
    var back = document.querySelector('.back-top');
    if (back) back.hidden = hide;
  }

  // 重放新页面自己的脚本（布局壳的三个全局脚本除外；含 @section Scripts 里的）
  function runScripts(scope, scripts) {
    scripts.forEach(function (old) {
      var s = document.createElement('script');
      Array.prototype.forEach.call(old.attributes, function (a) { s.setAttribute(a.name, a.value); });
      s.textContent = old.textContent;
      if (s.src) s.async = false;      // 动态插入的外链脚本默认 async，置 false 保执行顺序
      scope.appendChild(s);            // 挂在主区里，下次换血自动清理
    });
  }

  function swap(html, url, mode) {     // mode: 'push' | 'replace' | ''
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var newMain = doc.querySelector('main.content');
    var cur = document.querySelector('main.content');
    if (!newMain || !cur) { location.href = url; return; }

    var scripts = [];
    Array.prototype.forEach.call(doc.querySelectorAll('body script'), function (s) {
      if (LAYOUT_JS.test(s.getAttribute('src') || '')) return;
      if (s.type && !/javascript|module/i.test(s.type)) return;   // application/json 之类数据块随 innerHTML 已就位，不重放
      scripts.push(s);
    });

    document.title = doc.title || document.title;
    syncChrome(url);
    var samePath = normPath(new URL(url, location.origin).pathname) === normPath(location.pathname);
    var keepY = samePath ? cur.scrollTop : 0;

    cur.innerHTML = newMain.innerHTML;
    // 先推历史再跑脚本/广播 page:load：initViewSwitch 等会读 location，
    // 早于 pushState 触发会拿到「上一页」的 URL（曾造成 /Memo?view=calendar 串页 + 自动恢复顶掉用户点击的导航）
    if (mode === 'push') history.pushState({ pjax: 1 }, '', url);
    else if (mode === 'replace') history.replaceState({ pjax: 1 }, '', url);
    runScripts(cur, scripts);
    if (window.enhanceForms) window.enhanceForms(cur);
    try { document.dispatchEvent(new CustomEvent('page:load', { detail: cur })); } catch (e) { }

    cur.scrollTop = samePath ? keepY : 0;   // 切视图原地保位；换页面回顶部

    if (!reduced && cur.animate) {
      cur.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  var navSeq = 0;   // 导航序号：只认最后一次请求——连点两个栏目时旧响应后到会把新页面/高亮盖掉（下划线残留的元凶）
  function go(url, mode) {
    var seq = ++navSeq;
    fetch(url, { headers: { 'X-Requested-With': 'pjax' } }).then(function (r) {
      if (seq !== navSeq) return null;                       // 途中又有更新的导航，丢弃这份过期响应
      if (r.redirected && /login/i.test(r.url || '')) { location.href = url; return null; }
      if (!r.ok) { location.href = url; return null; }
      return r.text();
    }).then(function (html) {
      if (html != null && seq === navSeq) swap(html, url, mode);
    }).catch(function () { if (seq === navSeq) location.href = url; });
  }

  window.pjaxGo = function (url) { go(url, 'push'); };
  window.pjaxReplace = function (url) { go(url, 'replace'); };

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!isPjaxable(a)) return;
    e.preventDefault();
    document.body.classList.remove('drawer-open');   // 手机抽屉里点导航后收起
    go(a.href, 'push');
  });

  // 前进/后退：换内容但不动历史栈
  window.addEventListener('popstate', function () {
    if (document.getElementById('appModal') && document.getElementById('appModal').open) return;
    go(location.href, '');
  });
})();

// =========================================================
// 侧栏：分组折叠 + 自定义（隐藏模块）
//   折叠状态存 localStorage（换设备各自为政，属于「这台机器的显示习惯」）；
//   隐藏了哪些模块存数据库（Users.NavHidden，跟着账号走，换设备也一样）。
// =========================================================
(function () {
  var FOLD_PREFIX = 'nav.fold.';

  function foldKey(group) { return FOLD_PREFIX + group; }

  // 恢复折叠状态：每次换主区后都跑一遍（侧栏不重渲染，但首次加载必须恢复）
  function restoreNavFold() {
    document.querySelectorAll('.sidebar .nav-group').forEach(function (head) {
      var v = null;
      try { v = localStorage.getItem(foldKey(head.dataset.group)); } catch (e) { }
      var list = head.nextElementSibling;
      if (!list || !list.classList.contains('nav-list')) return;
      var folded = v === '1';
      list.classList.toggle('folded', folded);
      head.setAttribute('aria-expanded', folded ? 'false' : 'true');
    });
  }

  // 点分组标题折叠/展开（委托到 document，pjax 换页也不用重绑）
  document.addEventListener('click', function (e) {
    var head = e.target.closest ? e.target.closest('.sidebar .nav-group') : null;
    if (!head) return;
    var list = head.nextElementSibling;
    if (!list || !list.classList.contains('nav-list')) return;
    var folded = list.classList.toggle('folded');
    head.setAttribute('aria-expanded', folded ? 'false' : 'true');
    try { localStorage.setItem(foldKey(head.dataset.group), folded ? '1' : '0'); } catch (err) { }
  });

  window.openNavCustomize = function () {
    var d = document.getElementById('navCustomizeModal');
    if (!d) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  };

  document.addEventListener('DOMContentLoaded', restoreNavFold);
  document.addEventListener('page:load', restoreNavFold);
})();
