/* 工作台卡片自定义：排序 / 显隐 / 快捷置顶（dashboard.js）
 * 状态 = { pinned:[], order:[], hidden:[] }（卡片 id 三组互斥）
 * - 卡片右上角图钉：一键置顶/取消置顶，即点即存（走 /Preferences?handler=Dashboard）
 * - 「自定义」面板：勾选显隐 + ↑↓ 排序 + 面板内图钉，改动先实时预览，点「保存」才落库；
 *   关面板不保存 = 丢弃草稿回到上次保存的布局。
 * 卡片 id 白名单在服务端 Preferences.cshtml.cs 二次校验，这里只管 UI。 */
(function () {
  'use strict';

  var grid = document.getElementById('dashGrid');
  if (!grid) return;

  // 找不到 DOM 标题时的兜底名（权限未开 / 条件卡片不渲染时，面板里也要认得出）
  var NAME = {
    hello: '问候', reminders: '提醒', habits: '今日打卡', courses: '今日课程',
    schedule: '未来 7 天日程', memo: '置顶便签', anniversary: '最近的纪念日',
    email: '邮件', board: '留言板', expense: '本月记账', couples: '情侣空间',
    period: '经期助手', build: '建设进展', admin: '管理后台'
  };

  // ---- 工具 ----
  function arr(a) {
    return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x; }) : [];
  }
  function clone(st) { return { pinned: st.pinned.slice(), order: st.order.slice(), hidden: st.hidden.slice() }; }
  function domIds() {
    return Array.prototype.map.call(grid.querySelectorAll('[data-card]'), function (c) { return c.dataset.card; });
  }
  function cardEl(id) { return grid.querySelector('[data-card="' + id + '"]'); }
  // 页面初始 DOM 顺序 = 默认布局基准。不能用 domIds() 当默认：
  // apply() 会把 DOM 重排成自定义顺序，之后再拿 domIds() 当“默认”就等于“现状”，恢复默认变无操作。
  var defaultOrder = domIds().slice();
  function removeEverywhere(st, id) {
    ['pinned', 'order', 'hidden'].forEach(function (k) {
      var i = st[k].indexOf(id);
      while (i >= 0) { st[k].splice(i, 1); i = st[k].indexOf(id); }
    });
  }
  // 三组互斥 + 现有 DOM 卡片必归组（新卡片自动进普通区末尾）
  // 注意：必须原地修改数组（不能 st[k] = filter(...) 换新数组）——
  // 自定义面板的行按钮闭包抓的是数组引用，换掉引用后 ↑↓ 的交换就写进没人读的旧数组。
  function normalize(st) {
    var seen = {};
    ['pinned', 'order', 'hidden'].forEach(function (k) {
      var a = st[k], w = 0;
      for (var r = 0; r < a.length; r++) {
        if (!seen[a[r]]) { seen[a[r]] = true; a[w++] = a[r]; }
      }
      a.length = w;
    });
    defaultOrder.forEach(function (id) {
      if (!seen[id]) { st.order.push(id); seen[id] = true; }
    });
    return st;
  }
  function displayName(id) {
    var el = cardEl(id);
    var h = el && el.querySelector('h2');
    return (h && h.textContent.trim()) || NAME[id] || id;
  }

  // ---- 状态 ----
  function readData() {
    var raw = {};
    try {
      var el = document.getElementById('dashData');
      if (el && el.textContent.trim()) raw = JSON.parse(el.textContent) || {};
    } catch (e) { /* 坏数据 = 回默认布局 */ }
    return normalize({ pinned: arr(raw.pinned), order: arr(raw.order), hidden: arr(raw.hidden) });
  }
  var state = readData();
  var draft = null;   // 面板里的草稿；null = 没开面板

  // ---- 把布局应用到 DOM（重排 + 显隐 + 图钉高亮）----
  function apply(st) {
    normalize(st);
    st.pinned.concat(st.order).forEach(function (id) {
      var el = cardEl(id);
      if (el) { el.style.display = ''; grid.appendChild(el); }
    });
    st.hidden.forEach(function (id) {
      var el = cardEl(id);
      if (el) { el.style.display = 'none'; grid.appendChild(el); }
    });
    domIds().forEach(function (id) {
      var btn = cardEl(id).querySelector('.card-pin');
      if (!btn) return;
      var on = st.pinned.indexOf(id) >= 0;
      btn.classList.toggle('on', on);
      btn.title = on ? '取消置顶' : '置顶到最上面';
    });
  }

  // ---- 持久化（失败不影响本机使用，下次进页面以前次为准）----
  function save() {
    var tokenEl = document.querySelector('input[name="__RequestVerificationToken"]');
    if (!tokenEl) return;
    var body = 'layout=' + encodeURIComponent(JSON.stringify({
      pinned: state.pinned, order: state.order, hidden: state.hidden
    })) + '&__RequestVerificationToken=' + encodeURIComponent(tokenEl.value);
    try {
      fetch('/Preferences?handler=Dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      }).then(function (r) {
        if (window.toast) window.toast(r.ok ? '工作台布局已保存' : '布局保存失败', r.ok ? 'ok' : 'err');
      }).catch(function () {
        if (window.toast) window.toast('布局保存失败', 'err');
      });
    } catch (e) { }
  }

  // ---- 置顶/取消置顶（面板内草稿与卡片快捷按钮共用）----
  function togglePin(st, id) {
    var wasPinned = st.pinned.indexOf(id) >= 0;
    removeEverywhere(st, id);
    if (wasPinned) st.order.unshift(id);   // 取消置顶 → 普通区最前
    else st.pinned.unshift(id);            // 置顶 → 置顶区最前
  }

  // ---- 卡片右上角快捷置顶（即点即存）----
  grid.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    var btn = t.closest('.card-pin');
    if (!btn) return;
    var id = btn.getAttribute('data-pin');
    var st = draft || state;
    togglePin(st, id);
    // FLIP 平滑重排：卡片滑到新位置，避免整格瞬移像「整页刷新」
    if (window.flipMove) window.flipMove(grid, function () { apply(st); });
    else apply(st);
    if (draft) renderPanel();
    else save();
  });

  // ---- 自定义面板 ----
  var customBtn = document.getElementById('dashCustomBtn');
  var panel = document.getElementById('dashCustom');
  var listEl = document.getElementById('dashCustomList');
  if (!customBtn || !panel || !listEl) return;

  function pinIcon() {
    var svg = grid.querySelector('.card-pin svg');
    return svg ? svg.cloneNode(true) : document.createTextNode('📌');
  }

  function smallBtn(text, title, disabled, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'dash-move';
    b.title = title;
    b.textContent = text;
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function row(id, ids, i, isPinned, isHidden) {
    var el = document.createElement('div');
    el.className = 'dash-row';

    var pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin-btn' + (isPinned ? ' on' : '');
    pin.title = isPinned ? '取消置顶' : '置顶到最上面';
    pin.disabled = isHidden;
    pin.appendChild(pinIcon());
    pin.addEventListener('click', function () {
      togglePin(draft, id);
      renderPanel();
      apply(draft);
    });
    el.appendChild(pin);

    var label = document.createElement('label');
    label.className = 'dash-vis';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !isHidden;
    cb.addEventListener('change', function () {
      removeEverywhere(draft, id);
      if (cb.checked) draft.order.push(id);     // 恢复显示 → 普通区末尾
      else draft.hidden.push(id);               // 隐藏
      renderPanel();
      apply(draft);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode('显示'));
    el.appendChild(label);

    var name = document.createElement('div');
    name.className = 'dash-name';
    name.textContent = displayName(id);
    el.appendChild(name);

    if (!isHidden) {
      el.appendChild(smallBtn('↑', '上移', i === 0, function () {
        var t = ids[i]; ids[i] = ids[i - 1]; ids[i - 1] = t;
        renderPanel(); apply(draft);
      }));
      el.appendChild(smallBtn('↓', '下移', i === ids.length - 1, function () {
        var t = ids[i]; ids[i] = ids[i + 1]; ids[i + 1] = t;
        renderPanel(); apply(draft);
      }));
    }
    return el;
  }

  function section(title, ids, isPinned, isHidden) {
    var wrap = document.createElement('div');
    wrap.className = 'dash-sec';
    var h = document.createElement('div');
    h.className = 'dash-sec-title';
    h.textContent = title + '（' + ids.length + '）';
    wrap.appendChild(h);
    if (ids.length === 0) {
      var em = document.createElement('p');
      em.className = 'hint dash-empty';
      em.textContent = isPinned ? '还没有置顶的卡片，点卡片右上角图钉试试' : '（空）';
      wrap.appendChild(em);
    }
    ids.forEach(function (id, i) { wrap.appendChild(row(id, ids, i, isPinned, isHidden)); });
    return wrap;
  }

  function renderPanel() {
    listEl.textContent = '';
    listEl.appendChild(section('置顶区', draft.pinned, true, false));
    listEl.appendChild(section('普通区', draft.order, false, false));
    listEl.appendChild(section('已隐藏', draft.hidden, false, true));
  }

  customBtn.addEventListener('click', function () {
    var opening = panel.hidden;
    if (opening) {
      draft = clone(state);
      renderPanel();
      apply(draft);          // 实时预览
    } else {
      draft = null;
      apply(state);          // 不保存 = 丢弃草稿
    }
    panel.hidden = !opening;
    customBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });

  var saveBtn = document.getElementById('dashSave');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    if (!draft) return;
    state = clone(draft);
    if (window.flipMove) window.flipMove(grid, function () { apply(state); });
    else apply(state);
    save();
  });

  var resetBtn = document.getElementById('dashReset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    draft = normalize({ pinned: [], order: [], hidden: [] });
    renderPanel();
    if (window.flipMove) window.flipMove(grid, function () { apply(draft); });
    else apply(draft);
    if (window.toast) window.toast('已恢复默认布局，记得点保存', 'info');
  });

  // ---- 启动：应用保存的布局 ----
  apply(state);
})();
