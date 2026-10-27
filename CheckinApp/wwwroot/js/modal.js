// ============================================================
// 弹出卡片编辑窗 + 轻提示 Toast
// ① 点「新建/编辑/重置」不再跳页——把目标页表单抓进 <dialog> 弹窗
// ② 弹窗内提交走 fetch（成功关窗刷新，失败原地回显错误），全程无整页跳转
// ③ Toast 堆叠提示（动效值取自 lucianlabs UX/UI Prompt 070，MIT）
// 旧浏览器 / JS 关闭时自动退回原页面跳转，功能不受影响。
// ============================================================
(function () {
  'use strict';

  // ---- Toast ----------------------------------------------------
  var wrap = document.getElementById('toastWrap');

  window.toast = function (text, kind, ms) {
    if (!wrap || !text) return;
    var t = document.createElement('div');
    t.className = 'toast toast-' + (kind || 'info');
    t.setAttribute('role', 'status');
    t.textContent = text;
    wrap.appendChild(t);
    // 双 rAF 等样式落位后再加 is-in，保证过渡动画真的跑起来
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { t.classList.add('is-in'); });
    });
    var timer = setTimeout(dismiss, ms || 3800);
    function dismiss() {
      clearTimeout(timer);
      t.classList.add('is-out');
      setTimeout(function () { t.remove(); }, 420);
    }
    t.addEventListener('click', dismiss);
  };

  // 页面上的 .msg 横幅 → 转成 Toast（无 JS 时保留横幅，可访问性不变）
  // .msg.sticky 例外：登录页「还可尝试 N 次」这类提示需要常驻可见，不转
  // 无刷新换主区（pjax）后新内容里的 .msg 也走 page:load 重跑一遍
  var hadMsg = false;
  function convertMsgs(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.msg:not(.sticky)'), function (el) {
      hadMsg = true;
      var kind = el.classList.contains('error') ? 'err'
        : el.classList.contains('ok') ? 'ok' : 'info';
      window.toast(el.textContent.trim(), kind);
      el.remove();
    });
  }
  convertMsgs(document);
  document.addEventListener('page:load', function (e) { convertMsgs(e.detail || document); });

  // 弹窗保存成功 → 刷新后补一句「已保存」（页面自带 TempData 提示时不重复）
  try {
    if (!hadMsg && sessionStorage.getItem('modal.saved') === '1') {
      window.toast('已保存', 'ok');
    }
    sessionStorage.removeItem('modal.saved');
  } catch (e) { /* 隐私模式禁 storage 就算了 */ }

  // ---- 弹窗 ------------------------------------------------------
  var dlg = document.getElementById('appModal');
  if (!dlg || typeof dlg.showModal !== 'function') return;   // 旧浏览器：链接照常跳页
  var body = dlg.querySelector('.modal-body');
  var titleEl = dlg.querySelector('.modal-title');
  var busy = false;

  // 哪些链接走弹窗：/New、/Edit、/Reset 这类表单页（也可 data-modal="open" 手动指定）
  function isModalLink(a) {
    if (a.dataset.modal === 'off' || a.hasAttribute('download')) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.dataset.modal === 'open') return true;
    return /\/(New|Edit|Reset)([/?#]|$)/i.test(a.getAttribute('href') || '');
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;

    // 弹窗里的「取消」类链接 = 关窗，不是导航
    if (dlg.contains(a) && a.classList.contains('secondary')) {
      e.preventDefault();
      close();
      return;
    }
    if (!isModalLink(a)) return;
    e.preventDefault();
    openModal(a.href);
  });

  function close() { if (dlg.open) dlg.close(); }
  window.appModalClose = close;

  dlg.addEventListener('close', function () {
    body.innerHTML = '';          // 释放表单，避免旧状态残留
    titleEl.textContent = '';
    busy = false;
  });

  // 点遮罩关闭（原生 dialog 上的点击 = 点在背景上）
  dlg.addEventListener('click', function (e) {
    if (e.target === dlg) close();
  });

  function openModal(url) {
    if (busy) return;
    busy = true;
    titleEl.textContent = '加载中…';
    body.innerHTML = '<div class="modal-loading">正在加载表单…</div>';
    if (!dlg.open) dlg.showModal();

    fetch(url, { headers: { 'X-Requested-With': 'modal' } })
      .then(function (r) {
        if (r.redirected) { location.href = r.url; return null; }  // 登录过期之类
        if (r.status === 404) {
          window.toast('这条记录不存在或已删除', 'err');
          close();
          if (window.keepScroll) window.keepScroll();
          location.reload();
          return null;
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (html) {
        if (html == null) return;
        if (!fillModal(html, url)) { close(); location.href = url; return; }  // 结构不对直接跳
      })
      .catch(function () {
        body.innerHTML = '<div class="msg error">加载失败，请关闭后重试。</div>';
      })
      .then(function () { busy = false; });
  }
  window.appModalOpen = openModal;

  // 把抓来的页面里的表单区搬进弹窗；返回 false 表示没找到表单（调用方兜底跳页）
  function fillModal(html, url) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var card = doc.querySelector('main.content .card') || doc.querySelector('.card');
    if (!card || !card.querySelector('form')) return false;

    var h2 = card.querySelector('h2');
    titleEl.textContent = h2 ? h2.textContent.trim() : '';
    if (h2) h2.remove();

    body.innerHTML = '';
    while (card.firstChild) body.appendChild(card.firstChild);
    // 内容换血用短模糊淡入（连续两次填充要重排一次动画才重放）
    body.classList.remove('is-swap');
    void body.offsetWidth;
    body.classList.add('is-swap');

    // 表单的 action 是相对路径，必须按“表单原页面”补全，
    // 否则会提交到当前列表页（比如把 /Schedule/New 的表单 POST 回 /Schedule）
    // 调用方（如 calendar.js 的 openEdit）可能传相对 url，new URL(rel, rel) 会抛
    // TypeError「Invalid base URL」，先把 url 落到绝对再当 base。
    var pageBase = new URL(url, location.href);
    Array.prototype.forEach.call(body.querySelectorAll('form'), function (f) {
      var act = f.getAttribute('action');
      f.setAttribute('action', new URL(act || pageBase.href, pageBase).href);
    });

    // 短字段并排 / 动作条标准化（和整页渲染同一套增强，见 site.js）
    if (window.enhanceForms) window.enhanceForms(body);

    // 只有桌面端才自动聚焦第一个输入框方便直接打字；
    // 手机端聚焦会把小键盘和弹窗一起顶出来，观感很差，留给用户自己点。
    if (window.matchMedia && window.matchMedia('(min-width: 641px) and (pointer: fine)').matches) {
      var first = body.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select');
      if (first) first.focus();
    }
    return true;
  }

  // ---- 弹窗内提交：fetch 免跳页 --------------------------------
  dlg.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.matches || !form.matches('form')) return;
    e.preventDefault();                       // 拦住整页跳转
    if (form.dataset.modalBusy === '1') return;

    form.dataset.modalBusy = '1';
    var submitBtn = form.querySelector('[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('is-loading'); }   // 进入加载态（转圈）

    fetch(form.getAttribute('action') || location.href, {
      method: (form.getAttribute('method') || 'post').toUpperCase(),
      body: new FormData(form),
      redirect: 'manual',                     // 成功是 302（PRG），别跟走，否则提示会被消费掉
      headers: { 'X-Requested-With': 'modal' }
    }).then(function (r) {
      // 302 = 保存成功（服务端 RedirectToPage 回列表）
      if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) {
        try { sessionStorage.setItem('modal.saved', '1'); } catch (err) { }
        // 加载态形变成对勾 + 高光闪，演完 0.5s 再关窗刷新
        if (submitBtn) { submitBtn.classList.remove('is-loading'); submitBtn.classList.add('is-done'); }
        setTimeout(function () {
          close();
          if (window.keepScroll) window.keepScroll();   // 刷新后回到原位置，别把人扔回页顶
          location.reload();                    // 列表刷新出新数据；提示经 Toast 呈现
        }, 520);
        return null;
      }
      if (r.redirected || /\/login/i.test(r.url || '')) { location.href = '/Login'; return null; }
      return r.text().then(function (html) {
        return { status: r.status, html: html };
      });
    }).then(function (res) {
      if (!res) return;
      if (res.status === 200 && fillModal(res.html, form.getAttribute('action'))) {
        // 校验失败：换成带错误提示、保留已填内容的表单，并弹提示
        var err = body.querySelector('.msg.error, .msg');
        if (err) window.toast(err.textContent.trim(), 'err');
        var again = body.querySelector('[type=submit]');
        if (again) again.disabled = false;
      } else {
        window.toast('操作失败（' + res.status + '），请重试', 'err');
        form.dataset.modalBusy = '';
        if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('is-loading'); }
      }
    }).catch(function () {
      window.toast('网络异常，请重试', 'err');
      form.dataset.modalBusy = '';
      if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('is-loading'); }
      form.dataset.submitted = '';            // 放行 site.js 的防重复提交锁
    });
  });
})();
