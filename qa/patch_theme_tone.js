// 一次性补丁：theme.js 加底色系支持
const fs = require('fs');
const p = 'D:/projects/checkin/CheckinApp/wwwroot/js/theme.js';
let t = fs.readFileSync(p, 'utf8');
let ok = 0;

function rep(oldS, newS, tag) {
  if (!t.includes(oldS)) { console.log('!! 未匹配:', tag); process.exit(1); }
  t = t.replace(oldS, newS); ok++;
}

rep(`  const ACCENT_NAMES = {`,
`  // 底色系：每套主题的背景/卡片色系（slug: [名称, 色卡预览]）
  const TONES = {
    editorial: [
      ['', '暖米', '#F9F8F6'], ['mist', '雾灰', '#F2F4F7'], ['rose', '藕粉', '#F8F3F2'], ['wheat', '麦茶', '#F5F0E4']
    ],
    neumorphism: [
      ['', '石灰', '#e0e5ec'], ['blue', '雾蓝', '#e0e7f0'], ['rose', '藕粉', '#f0e3e9'], ['mint', '薄荷', '#e0ece7']
    ],
    natural: [
      ['', '沙米', '#faf6f1'], ['clay', '陶土', '#f7eee6'], ['leaf', '叶绿', '#f0f3ea'], ['mist', '晨雾', '#eef2f4']
    ],
    macos: [
      ['', '石墨', '#1c1c1e'], ['midnight', '午夜蓝', '#16181f'], ['plum', '深梅', '#1c1722'], ['forest', '墨绿', '#141a17']
    ],
    clay: [
      ['', '蜜桃', '#fce7f3'], ['mint', '薄荷', '#ccfbf1'], ['lilac', '薰衣草', '#e9d5ff'], ['lemon', '柠檬', '#fef3c7']
    ]
  };
  const ACCENT_NAMES = {`, 'TONES 配置');

rep(`  function currentAccent() { return root.dataset.accent || ''; }`,
`  function currentAccent() { return root.dataset.accent || ''; }
  function currentTone() { return root.dataset.tone || ''; }`, 'currentTone');

rep(`  function apply(theme, accent, persist) {
    const t = THEMES[theme] ? theme : 'editorial';
    const list = THEMES[t].accents;
    // 该主题不支持换色，或传入色号不在列表里 → 回到默认
    const a = list.indexOf(accent) >= 0 ? accent : THEMES[t].def;

    root.dataset.theme = t;
    root.dataset.accent = a;

    // 主题卡选中态
    document.querySelectorAll('.theme-card').forEach(c =>
      c.classList.toggle('active', c.dataset.themeSlug === t));

    // 强调色行：不支持换色的主题直接隐藏
    renderAccents(t, a);

    if (persist !== false) {
      try {
        localStorage.setItem('theme.slug', t);
        localStorage.setItem('theme.accent', a);
      } catch (e) { }
      syncToServer(t, a);
    }
  }`,
`  function apply(theme, accent, tone, persist) {
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
  }`, 'apply 三参');

rep(`  // ---- 强调色小圆点（仅支持换色的主题显示） ----`,
`  // ---- 底色小圆点（每套主题都显示） ----
  function renderTones(theme, active) {
    const row = document.getElementById('toneRow');
    const box = document.getElementById('toneDots');
    if (!row || !box) return;
    const list = TONES[theme] || [];
    if (!list.length) { row.hidden = true; box.innerHTML = ''; return; }

    row.hidden = false;
    box.innerHTML = list.map(x =>
      '<span class="swatch' + (x[0] === active ? ' active' : '') + '" data-tone="' + x[0] + '" title="' + x[1] + '" role="button" tabindex="0" style="background:' + x[2] + ';"></span>'
    ).join('');
    box.querySelectorAll('.swatch').forEach(s => {
      const pick = () => apply(theme, currentAccent(), s.dataset.tone, true);
      s.addEventListener('click', pick);
      s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }

  // ---- 强调色小圆点（仅支持换色的主题显示） ----`, 'renderTones');

rep(`      s.addEventListener('click', () => apply(theme, s.dataset.accent, true));
      s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(theme, s.dataset.accent, true); } });`,
`      s.addEventListener('click', () => apply(theme, s.dataset.accent, currentTone(), true));
      s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(theme, s.dataset.accent, currentTone(), true); } });`, 'renderAccents 点击');

rep(`  function syncToServer(theme, accent) {`, `  function syncToServer(theme, accent, tone) {`, 'sync 签名');

rep(`        body: 'theme=' + encodeURIComponent(theme) +
              '&accent=' + encodeURIComponent(accent) +
              '&__RequestVerificationToken=' + encodeURIComponent(tokenEl.value)`,
`        body: 'theme=' + encodeURIComponent(theme) +
              '&accent=' + encodeURIComponent(accent) +
              '&tone=' + encodeURIComponent(tone || '') +
              '&__RequestVerificationToken=' + encodeURIComponent(tokenEl.value)`, 'sync body');

rep(`    let t = currentTheme(), a = currentAccent();
    try {
      t = localStorage.getItem('theme.slug') || t;
      a = localStorage.getItem('theme.accent') || a;
    } catch (e) { }
    apply(t, a, false);   // 只应用不回写，避免启动就打 API

    document.querySelectorAll('.theme-card').forEach(c => {
      c.addEventListener('click', () => apply(c.dataset.themeSlug, THEMES[c.dataset.themeSlug].def, true));
    });`,
`    let t = currentTheme(), a = currentAccent(), tn = currentTone();
    try {
      t = localStorage.getItem('theme.slug') || t;
      a = localStorage.getItem('theme.accent') || a;
      tn = localStorage.getItem('theme.tone') || tn;
    } catch (e) { }
    apply(t, a, tn, false);   // 只应用不回写，避免启动就打 API

    document.querySelectorAll('.theme-card').forEach(c => {
      // 换风格保留底色（新主题支持同名底色就接着用，否则回默认）
      c.addEventListener('click', () => apply(c.dataset.themeSlug, THEMES[c.dataset.themeSlug].def, currentTone(), true));
    });`, '启动段');

rep(`  window.applyTheme = function (slug) { apply(slug, THEMES[slug] ? THEMES[slug].def : '', true); };`,
`  window.applyTheme = function (slug) { apply(slug, THEMES[slug] ? THEMES[slug].def : '', currentTone(), true); };`, 'applyTheme');

fs.writeFileSync(p, t);
console.log('theme.js 补丁完成:', ok, '处');
