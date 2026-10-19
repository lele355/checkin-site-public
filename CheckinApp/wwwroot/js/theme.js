// ============================================================
// 主题系统：5 套风格 × 强调色变体
// 优先级：localStorage（本机即时） > 服务端 Users 表（跨设备兜底）
// 明暗不再单独切 —— 暗色档就是「macOS 毛玻璃」这套主题
// ============================================================
(function () {
  const root = document.documentElement;

  const THEMES = {
    editorial:   { name: '编辑杂志风',   accents: [],                          def: '' },
    neumorphism: { name: '新拟物派',     accents: ['violet', 'coral', 'mint', 'lemon'], def: 'violet' },
    natural:     { name: '自然有机风',   accents: [],                          def: '' },
    macos:       { name: 'macOS 毛玻璃', accents: ['blue', 'violet', 'rose', 'green'], def: 'blue' },
    clay:        { name: '粘土拟态',     accents: ['pink', 'mint', 'lilac', 'lemon'], def: 'pink' }
  };
  // 底色系：每套主题的背景/卡片色系（slug: [名称, 色卡预览]）
  // 每套 6 档（默认 + 5 备选），刻意拉开色相/明度，别让选项看起来都一个颜色。
  const TONES = {
    editorial: [
      ['', '暖米', '#FBF9F4'], ['mist', '雾蓝', '#EDF1F5'], ['rose', '藕粉', '#F9EFF0'],
      ['wheat', '麦茶', '#F4EDDB'], ['sage', '鼠尾草', '#ECF1E7'], ['lilac', '淡紫', '#F1EDF6']
    ],
    neumorphism: [
      ['', '石灰', '#e0e5ec'], ['blue', '雾蓝', '#dde6f2'], ['rose', '藕粉', '#efe1e8'],
      ['mint', '薄荷', '#ddebe4'], ['sand', '沙金', '#eae3d6'], ['lilac', '淡紫', '#e5e1f1']
    ],
    natural: [
      ['', '沙米', '#faf6f1'], ['clay', '陶土', '#f7eee6'], ['leaf', '叶绿', '#f0f3ea'],
      ['mist', '晨雾', '#eef2f4'], ['sand', '麦浪', '#f6f0df'], ['stone', '青石', '#eef0ee']
    ],
    macos: [
      ['', '石墨', '#1c1c1e'], ['midnight', '午夜蓝', '#16181f'], ['plum', '深梅', '#1c1722'],
      ['forest', '墨绿', '#141a17'], ['coffee', '咖褐', '#1d1815'], ['slate', '青灰', '#14181c']
    ],
    clay: [
      ['', '蜜桃', 'linear-gradient(135deg,#fce7f3,#fbcfe8)'],
      ['mint', '薄荷', 'linear-gradient(135deg,#d1fae5,#ccfbf1)'],
      ['lilac', '薰衣草', 'linear-gradient(135deg,#ede9fe,#e9d5ff)'],
      ['lemon', '柠檬', 'linear-gradient(135deg,#fef9c3,#fde68a)'],
      ['sky', '天空', 'linear-gradient(135deg,#dbeafe,#e0f2fe)'],
      ['blush', '樱粉', 'linear-gradient(135deg,#ffe4e6,#fecdd3)']
    ]
  };
  const ACCENT_NAMES = {
    violet: '紫罗兰', coral: '珊瑚', mint: '薄荷', lemon: '柠檬',
    blue: '系统蓝', rose: '玫红', green: '青绿',
    pink: '蜜桃粉', lilac: '淡紫'
  };

  function currentTheme() { return root.dataset.theme || 'editorial'; }
  function currentAccent() { return root.dataset.accent || ''; }
  function currentTone() { return root.dataset.tone || ''; }

  // ---- 液态水波：换主题时从点击点圆形扩散新底色再淡出（减少动态时不做） ----
  function wash(x, y) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var el = document.createElement('div');
    el.className = 'theme-wash';
    el.style.setProperty('--wx', (x || innerWidth / 2) + 'px');
    el.style.setProperty('--wy', (y || innerHeight / 3) + 'px');
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('go'); });   // 双 rAF 等初始态落位
    });
    setTimeout(function () { el.remove(); }, 1000);
  }

  // ---- 应用外观 ----
  function apply(theme, accent, tone, persist) {
    const t = THEMES[theme] ? theme : 'editorial';
    const list = THEMES[t].accents;
    // 该主题不支持换色，或传入色号不在列表里 → 回到默认
    const a = list.indexOf(accent) >= 0 ? accent : THEMES[t].def;
    // 底色同理：不在该主题底色清单里 → 默认底色（空）
    const tones = (TONES[t] || []).map(x => x[0]);
    const tn = tones.indexOf(tone) >= 0 ? tone : '';

    root.dataset.theme = t;
    root.dataset.accent = a;
    if (tn) root.dataset.tone = tn; else delete root.dataset.tone;

    // 主题卡选中态
    document.querySelectorAll('.theme-card').forEach(c =>
      c.classList.toggle('active', c.dataset.themeSlug === t));

    // 底色行 + 强调色行
    renderTones(t, tn);
    renderAccents(t, a);

    if (persist !== false) {
      try {
        localStorage.setItem('theme.slug', t);
        localStorage.setItem('theme.accent', a);
        localStorage.setItem('theme.tone', tn);
      } catch (e) { }
      syncToServer(t, a, tn);
    }
  }

  // ---- 底色小圆点（每套主题都显示） ----
  // 注意：只有「主题换了」才重绘 DOM。以前每次点选都重绘，被点的节点在 click 冒泡到 document 前
  // 就被 innerHTML 摘掉了，面板的「点外面关闭」逻辑会误判成点了面板外 —— 于是选一个底色面板就没了，
  // 想连着对比几种底色得反复打开。这里改成只切 .active。
  function renderTones(theme, active) {
    const row = document.getElementById('toneRow');
    const box = document.getElementById('toneDots');
    if (!row || !box) return;
    const list = TONES[theme] || [];
    if (!list.length) { row.hidden = true; box.innerHTML = ''; box.dataset.theme = ''; return; }

    row.hidden = false;
    if (box.dataset.theme !== theme) {
      box.innerHTML = list.map(x =>
        '<span class="swatch' + (x[0] === active ? ' active' : '') + '" data-tone="' + x[0] + '" title="' + x[1] + '" role="button" tabindex="0" style="background:' + x[2] + ';"></span>'
      ).join('');
      box.dataset.theme = theme;
      box.querySelectorAll('.swatch').forEach(s => {
        const pick = e => { apply(theme, currentAccent(), s.dataset.tone, true); wash(e && e.clientX, e && e.clientY); };
        s.addEventListener('click', pick);
        s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
      });
    }
    box.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.tone === active));
  }

  // ---- 强调色小圆点（仅支持换色的主题显示） ----
  function renderAccents(theme, active) {
    const row = document.getElementById('accentRow');
    const box = document.getElementById('accentDots');
    if (!row || !box) return;
    const list = THEMES[theme].accents;
    if (!list.length) { row.hidden = true; box.innerHTML = ''; box.dataset.theme = ''; return; }

    row.hidden = false;
    if (box.dataset.theme !== theme) {   // 同底色：主题没换就不重绘，避免点一下就关面板（同上）
      box.innerHTML = list.map(a =>
        `<span class="swatch${a === active ? ' active' : ''}" data-accent="${a}" title="${ACCENT_NAMES[a] || a}" role="button" tabindex="0"></span>`
      ).join('');
      box.dataset.theme = theme;
      box.querySelectorAll('.swatch').forEach(s => {
        const pick = e => { apply(theme, s.dataset.accent, currentTone(), true); wash(e && e.clientX, e && e.clientY); };
        s.addEventListener('click', pick);
        s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
      });
    }
    box.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.accent === active));
  }

  // ---- 跨设备同步（失败不影响本机使用） ----
  function syncToServer(theme, accent, tone) {
    const tokenEl = document.querySelector('input[name="__RequestVerificationToken"]');
    if (!tokenEl) return;
    try {
      fetch('/Preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'theme=' + encodeURIComponent(theme) +
              '&accent=' + encodeURIComponent(accent) +
              '&tone=' + encodeURIComponent(tone || '') +
              '&__RequestVerificationToken=' + encodeURIComponent(tokenEl.value)
      }).catch(() => { });
    } catch (e) { }
  }

  // ---- 主题面板开关（与手机抽屉互斥：面板开着就不该有抽屉遮罩压着它） ----
  function togglePanel(show) {
    const p = document.getElementById('appearancePanel');
    if (!p) return;
    const open = (typeof show === 'boolean') ? show : p.hidden;
    p.hidden = !open;
    if (open) document.body.classList.remove('drawer-open');
  }

  // ---- 启动 ----
  document.addEventListener('DOMContentLoaded', function () {
    let t = currentTheme(), a = currentAccent(), tn = currentTone();
    try {
      t = localStorage.getItem('theme.slug') || t;
      a = localStorage.getItem('theme.accent') || a;
      tn = localStorage.getItem('theme.tone') || tn;
    } catch (e) { }
    apply(t, a, tn, false);   // 只应用不回写，避免启动就打 API

    document.querySelectorAll('.theme-card').forEach(c => {
      // 换风格保留底色（新主题支持同名底色就接着用，否则回默认）；点击点起液态水波
      c.addEventListener('click', e => {
        apply(c.dataset.themeSlug, THEMES[c.dataset.themeSlug].def, currentTone(), true);
        wash(e && e.clientX, e && e.clientY);
      });
    });

    const btn = document.getElementById('appearanceBtn');
    if (btn) btn.addEventListener('click', e => { e.stopPropagation(); togglePanel(); });
    document.addEventListener('click', e => {
      const wrap = document.querySelector('.appearance-wrap');
      if (wrap && !wrap.contains(e.target)) togglePanel(false);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') togglePanel(false); });
  });

  // 对外暴露（底部快捷栏等处会调用）
  window.applyTheme = function (slug) {
    apply(slug, THEMES[slug] ? THEMES[slug].def : '', currentTone(), true);
    wash(innerWidth / 2, innerHeight / 3);   // 无点击坐标时从屏幕中上部起波
  };
  window.toggleAppearancePanel = togglePanel;
})();
