// 日历视图渲染 —— 仅在 /Schedule?view=calendar 时加载
// 数据来源：<script type="application/json" id="calData">[{id,title,start,end,allDay},...]
// 交互（照片式，2026-10-18 二稿）：
//   点日期 → 选中高亮，并在日历「下方」直接显示当日日程列表（不再是弹出气泡）
//   点日程行 / 格子上的事件条 → 弹编辑表单（modal.js）；点「+ 新建」→ 预填日期新建
//   翻月：‹ › 大按钮 / 左右滑动手势 / 点年月回今天；右下角浮动「今」随时回今天
//   再点已选中的日期 → 下方列表滚入视野
(function () {
    'use strict';

    var dataEl = document.getElementById('calData');
    var gridEl = document.getElementById('calGrid');
    var ymEl = document.getElementById('calYm');
    var agendaEl = document.getElementById('calAgenda');
    if (!dataEl || !gridEl || !ymEl || !agendaEl) return;

    var events = [];
    try { events = JSON.parse(dataEl.textContent || '[]'); } catch (e) { events = []; }

    // 按日期（yyyy-MM-dd）归组事件
    var byDate = {};
    events.forEach(function (ev) {
        var d = (ev.start || '').slice(0, 10);
        if (!d) return;
        (byDate[d] = byDate[d] || []).push(ev);
    });

    function byStart(a, b) {
        return String(a.start || '').localeCompare(String(b.start || ''));
    }

    var today = new Date();
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function keyOf(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
    var todayKey = keyOf(today.getFullYear(), today.getMonth(), today.getDate());

    var shown = new Date(today.getFullYear(), today.getMonth(), 1);   // 当前展示的月份（月初）
    var sel = todayKey;                                               // 当前选中日期（默认今天）

    function reduced() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    function dateLabel(k) {
        var p = k.split('-');
        var dt = new Date(+p[0], +p[1] - 1, +p[2]);
        return (+p[1]) + ' 月 ' + (+p[2]) + ' 日<span class="wd"> · ' + WEEK[dt.getDay()] + '</span>';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ---- 月历网格 ----
    function render(dir) {
        var y = shown.getFullYear(), m = shown.getMonth();
        ymEl.textContent = y + ' 年 ' + (m + 1) + ' 月';

        // 周一开头：JS getDay() 周日=0，转换为 周一=0 … 周日=6
        var first = new Date(y, m, 1);
        var offset = (first.getDay() + 6) % 7;
        var daysInMonth = new Date(y, m + 1, 0).getDate();
        var prevDays = new Date(y, m, 0).getDate();

        var html = '';
        var cellNum = 0;
        var i, d, k;

        // 上月补位
        for (i = 0; i < offset; i++) {
            html += '<div class="cal-cell other"><div class="cal-day">' + (prevDays - offset + 1 + i) + '</div></div>';
            cellNum++;
        }
        // 本月
        for (d = 1; d <= daysInMonth; d++) {
            k = keyOf(y, m, d);
            var cls = 'cal-cell';
            if (k === todayKey) cls += ' today';
            if (k === sel) cls += ' sel';
            html += '<div class="' + cls + '" data-date="' + k + '">';
            html += '<div class="cal-day">' + d + '</div>';
            var evs = byDate[k] || [];
            for (var e = 0; e < evs.length && e < 2; e++) {
                var ev = evs[e];
                var label = ev.allDay ? '全天' : (ev.start || '').slice(11, 16);
                html += '<a class="cal-ev' + (ev.allDay ? ' allday' : '') + '" href="/Schedule/Edit/' + ev.id + '" title="' + escapeHtml(ev.title) + '">' +
                    '<span class="cal-ev-time">' + label + '</span>' + escapeHtml(ev.title) + '</a>';
            }
            if (evs.length > 2) html += '<div class="cal-more">还有 ' + (evs.length - 2) + ' 项</div>';
            html += '<button type="button" class="cal-plus" title="在这天新建日程">+</button>';
            html += '</div>';
            cellNum++;
        }
        // 下月补位（补满整周）
        var rest = (7 - cellNum % 7) % 7;
        for (var j = 1; j <= rest; j++) {
            html += '<div class="cal-cell other"><div class="cal-day">' + j + '</div></div>';
        }

        gridEl.innerHTML = html;

        // 翻月滑动方向动画（dir: 1=下月 / -1=上月；尊重「减少动态」）
        if (dir && !reduced() && gridEl.animate) {
            gridEl.animate([
                { opacity: 0, transform: 'translateX(' + (dir > 0 ? 28 : -28) + 'px)' },
                { opacity: 1, transform: 'none' }
            ], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
    }

    // ---- 日历下方：当日日程（照片式）----
    function renderAgenda() {
        var evs = (byDate[sel] || []).slice().sort(byStart);
        var html = '<div class="agenda-head">' +
            '<div class="agenda-date">' + dateLabel(sel) + '</div>' +
            '<a class="btn" href="/Schedule/New?date=' + sel + '">+ 新建</a></div>';
        html += '<div class="agenda-list">';
        if (evs.length) {
            evs.forEach(function (ev) {
                var label = ev.allDay ? '全天' : (ev.start || '').slice(11, 16);
                html += '<div class="agenda-item' + (ev.allDay ? ' allday' : '') + '" data-href="/Schedule/Edit/' + ev.id + '" role="button" tabindex="0">' +
                    '<span class="agenda-time">' + label + '</span>' +
                    '<span class="agenda-title">' + escapeHtml(ev.title) + '</span></div>';
            });
        } else {
            html += '<div class="agenda-empty">这天没安排，点右上角「+ 新建」添加日程。</div>';
        }
        html += '</div>';
        agendaEl.innerHTML = html;

        if (!reduced() && agendaEl.animate) {
            agendaEl.animate([
                { opacity: 0, transform: 'translateY(6px)' },
                { opacity: 1, transform: 'none' }
            ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
    }

    function select(k, scrollList) {
        sel = k;
        // 就地更新选中态（不重画整格，保住 hover / 动画）
        Array.prototype.forEach.call(gridEl.querySelectorAll('.cal-cell.sel'), function (c) { c.classList.remove('sel'); });
        var cell = gridEl.querySelector('.cal-cell[data-date="' + k + '"]');
        if (cell) cell.classList.add('sel');
        renderAgenda();
        if (scrollList && agendaEl.scrollIntoView) {
            agendaEl.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
        }
    }

    // 编辑入口：modal.js 弹窗优先，旧浏览器回落跳页
    function openEdit(url) {
        if (window.appModalOpen) window.appModalOpen(url);
        else location.href = url;
    }

    // ---- 点击：格子选日期 / 事件条与「+」进编辑 ----
    gridEl.addEventListener('click', function (e) {
        var plus = e.target.closest('.cal-plus');
        if (plus) {
            e.preventDefault();
            var cell0 = plus.closest('.cal-cell');
            if (cell0 && cell0.dataset.date) openEdit('/Schedule/New?date=' + cell0.dataset.date);
            return;
        }
        var evLink = e.target.closest('.cal-ev');
        if (evLink) {
            e.preventDefault();
            openEdit(evLink.getAttribute('href'));
            return;
        }
        var cell = e.target.closest('.cal-cell');
        if (!cell || !cell.dataset.date) return;
        var k = cell.dataset.date;
        select(k, k === sel);   // 再点同一日期 → 下方列表滚入视野
    });

    // ---- 点击/键盘：下方日程行进编辑 ----
    agendaEl.addEventListener('click', function (e) {
        var item = e.target.closest('.agenda-item');
        if (item && item.dataset.href) openEdit(item.dataset.href);
    });
    agendaEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var item = e.target.closest ? e.target.closest('.agenda-item') : null;
        if (item && item.dataset.href) {
            e.preventDefault();
            openEdit(item.dataset.href);
        }
    });

    // ---- 月份导航：‹ › 按钮 / 年月文字 / 浮动「今」----
    function goMonth(delta) {
        shown = new Date(shown.getFullYear(), shown.getMonth() + delta, 1);
        render(delta);
    }
    var prevBtn = document.getElementById('calPrev');
    var nextBtn = document.getElementById('calNext');
    if (prevBtn) prevBtn.addEventListener('click', function () { goMonth(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goMonth(1); });

    function backToToday() {
        shown = new Date(today.getFullYear(), today.getMonth(), 1);
        render(0);
        select(todayKey, false);
    }
    ymEl.addEventListener('click', backToToday);   // 点年月文字回今天
    var fab = document.getElementById('calToday');
    if (fab) fab.addEventListener('click', backToToday);

    // ---- 左右滑动翻月（横向位移明显大于纵向才触发，不抢页面滚动）----
    var wrap = document.getElementById('calBody') || gridEl;
    var tx = 0, ty = 0, tracking = false;
    wrap.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { tracking = false; return; }
        tx = e.touches[0].clientX;
        ty = e.touches[0].clientY;
        tracking = true;
    }, { passive: true });
    wrap.addEventListener('touchend', function (e) {
        if (!tracking) return;
        tracking = false;
        var t = e.changedTouches[0];
        var dx = t.clientX - tx, dy = t.clientY - ty;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) goMonth(dx < 0 ? 1 : -1);
    }, { passive: true });

    render(0);
    renderAgenda();
})();
