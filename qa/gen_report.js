// 三轮测试报告生成器：读 report-r1/r2/r3.json → 输出测试报告.html
const fs = require('fs');
const path = require('path');

const QA_DIR = __dirname;
const rounds = [1, 2, 3].map(n => {
  const p = path.join(QA_DIR, `report-r${n}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}).filter(Boolean);

if (!rounds.length) { console.error('没有找到任何 report-rN.json'); process.exit(1); }

// 按 section 归组（以第一轮的顺序为准）
const secOrder = [];
const secMap = {}; // sec -> [names]
for (const r of rounds) for (const it of r.results) {
  if (!secMap[it.sec]) { secMap[it.sec] = []; secOrder.push(it.sec); }
  if (!secMap[it.sec].some(x => x.name === it.name)) secMap[it.sec].push({ name: it.name });
}

// 查每轮结果：sec+name -> {ok, extra}
function find(r, sec, name) {
  return r.results.find(x => x.sec === sec && x.name === name);
}

const totalChecks = secOrder.reduce((s, sec) => s + secMap[sec].length, 0);
const totalPass = rounds.reduce((s, r) => s + r.pass, 0);
const totalFail = rounds.reduce((s, r) => s + r.fail, 0);
const allGreen = rounds.every(r => r.fail === 0);

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const secDesc = {
  'S1 认证与会话': '登录/登出/错误密码/未登录 302 跳转/会话保持',
  'S2 管理后台': '弹窗建号（QA_A 普通用户 / QA_B 情侣角色）+ 用户列表落库',
  'S3 首登强制改密': 'MustChangePassword 拦截 → 改密后放行，库字段清零',
  'S4 RBAC 权限': '普通用户/情侣角色对 /Admin/*、/Couples、/Period 的访问边界',
  'S5 日程': '日程 CRUD + 列表/日历双视图 + 落库字段验证',
  'S6 备忘': '备忘 CRUD + 置顶/搜索 + 落库验证',
  'S7 习惯打卡': '习惯创建/打卡/漏卡 + HabitCheckins 落库（日期 like 匹配）',
  'S8 记账': '记账 CRUD + 分类 select + 合计与落库金额验证',
  'S9 纪念日': '纪念日 CRUD + 倒计时 + 落库验证',
  'S10 越权与数据隔离': '跨用户 GET 404 / POST 4xx（antiforgery）+ 库数据未被篡改 + 列表不见他人数据',
  'S11 课程表': '课程 CRUD + 周视图渲染 + 落库验证',
  'S12 留言板': '留言发布/删除（主键定位）+ 落库验证',
  'S13 情侣空间': 'CoupleSettings 设置/还原 + LoveNotes 互发 + 落库验证',
  'S14 经期': '经期记录 CRUD（本人隔离）+ Edit 弹窗删除 + 落库验证',
  'S15 工作台': '聚合卡片（未来日程/置顶便签/待办）渲染',
  'S16 提醒中心': '站内提醒聚合（日程/纪念日/经期）',
  'S16.5 视图数据准备': 'dbq 直插习惯打卡/纪念日/记账数据供视图与统计断言',
  'S17 统计': '热力图/月度柱状/分类占比/汇总卡片渲染',
  'S18 数据导出': '/Export?handler=Mine JSON 导出 8 键 + 数据完整性',
  'S19 AI 助手': '对话回复 + 建议卡确认执行 + UserId 围栏落库 + 清理',
  'S20 主题偏好': '主题/强调色切换落库 + 白名单外 400 拒绝',
  'S21 多视图渲染': '十个视图（列表/日历/网格/看板等）全部渲染无错',
  'S22 表单校验': '弹窗空标题前端拦截 + 必填校验',
  'S23 手机端': '390px 六页面移动端渲染',
  'S24 性能与缓存': '响应头 / 页面加载耗时 / PWA manifest',
  'S25 稳定性': '全程零 pageerror 脚本异常',
};

let rows = '';
for (const sec of secOrder) {
  const items = secMap[sec];
  rows += `<tr class="sec-row"><td colspan="${rounds.length + 2}">${esc(sec)}<span class="sec-desc">${esc(secDesc[sec] || '')}</span></td></tr>`;
  for (const it of items) {
    let cells = '';
    for (const r of rounds) {
      const f = find(r, sec, it.name);
      if (!f) cells += '<td class="miss">—</td>';
      else cells += `<td class="${f.ok ? 'ok' : 'bad'}">${f.ok ? '✓' : '✗'}${f.extra ? `<span class="extra">${esc(f.extra)}</span>` : ''}</td>`;
    }
    rows += `<tr><td class="name">${esc(it.name)}</td>${cells}<td class="desc">${esc((find(rounds[0], sec, it.name) || {}).extra || '')}</td></tr>`;
  }
}

const roundHead = rounds.map(r => `<th>第 ${r.round} 轮</th>`).join('');
const roundStat = rounds.map(r =>
  `<div class="stat"><div class="num ${r.fail ? 'bad' : 'ok'}">${r.pass}/${r.pass + r.fail}</div><div class="lbl">第 ${r.round} 轮 通过/总数</div><div class="sub">${esc(new Date(r.time).toLocaleString('zh-CN'))}</div></div>`
).join('');

const failList = [];
for (const r of rounds) for (const it of r.results) if (!it.ok) failList.push(`第${r.round}轮 · ${it.sec} · ${it.name}：${it.extra || ''}`);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>生活管家 · 全功能全流程测试报告</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:"Microsoft YaHei",system-ui,sans-serif; background:#f4f6f9; color:#1a2332; line-height:1.7; padding:32px 16px 64px; }
  .wrap { max-width:1100px; margin:0 auto; }
  h1 { font-size:26px; text-align:center; margin-bottom:6px; }
  .sub-title { text-align:center; color:#64748b; font-size:13px; margin-bottom:28px; }
  .badge { display:inline-block; padding:3px 12px; border-radius:20px; font-size:12px; font-weight:700; margin:0 3px; }
  .badge.green { background:#d1fae5; color:#065f46; }
  .badge.red { background:#fee2e2; color:#991b1b; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px; margin-bottom:26px; }
  .stat { background:#fff; border-radius:12px; padding:18px 16px; text-align:center; box-shadow:0 1px 4px rgba(15,23,42,.07); }
  .stat .num { font-size:26px; font-weight:800; }
  .stat .num.ok { color:#059669; } .stat .num.bad { color:#dc2626; }
  .stat .lbl { font-size:12px; color:#64748b; margin-top:4px; }
  .stat .sub { font-size:11px; color:#94a3b8; margin-top:2px; }
  .panel { background:#fff; border-radius:14px; padding:26px 28px; box-shadow:0 1px 4px rgba(15,23,42,.07); margin-bottom:22px; }
  .panel h2 { font-size:17px; margin-bottom:14px; padding-left:11px; border-left:4px solid #2563eb; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { background:#f1f5f9; text-align:left; padding:9px 10px; font-size:12px; color:#475569; border-bottom:2px solid #e2e8f0; white-space:nowrap; }
  td { padding:7px 10px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
  tr.sec-row td { background:#eef2ff; font-weight:700; color:#3730a3; font-size:13px; padding:8px 10px; }
  .sec-desc { font-weight:400; color:#6366f1; font-size:11px; margin-left:10px; }
  td.name { width:26%; }
  td.desc { color:#94a3b8; font-size:11px; }
  td.ok { color:#059669; text-align:center; font-weight:700; white-space:nowrap; }
  td.bad { color:#dc2626; text-align:center; font-weight:700; }
  td.miss { color:#cbd5e1; text-align:center; }
  .extra { display:block; font-weight:400; font-size:10px; color:#94a3b8; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:0 auto; }
  ul.clean { padding-left:20px; }
  ul.clean li { margin:6px 0; font-size:13px; }
  .kv { display:grid; grid-template-columns:150px 1fr; gap:6px 14px; font-size:13px; }
  .kv .k { color:#64748b; }
  .ok-text { color:#059669; font-weight:700; }
  .footnote { text-align:center; color:#94a3b8; font-size:11px; margin-top:30px; }
  .fix { border-left:3px solid #f59e0b; padding:8px 12px; background:#fffbeb; border-radius:0 8px 8px 0; margin:8px 0; font-size:13px; }
  .fix b { color:#b45309; }
</style>
</head>
<body>
<div class="wrap">
  <h1>「生活管家」全功能全流程测试报告</h1>
  <div class="sub-title">三轮独立测试 · 真实 UI 流程 + SQLite 落库字段级验证 · ${esc(new Date().toLocaleString('zh-CN'))} 生成</div>

  <div class="cards">
    <div class="stat"><div class="num ${allGreen ? 'ok' : 'bad'}">${allGreen ? '全部通过' : '存在失败'}</div><div class="lbl">总体结论</div></div>
    <div class="stat"><div class="num">${rounds.length}</div><div class="lbl">测试轮次（每轮独立清场重建）</div></div>
    <div class="stat"><div class="num">${totalChecks}</div><div class="lbl">检查项 × 轮次</div></div>
    <div class="stat"><div class="num ${totalFail ? 'bad' : 'ok'}">${totalPass} / ${totalPass + totalFail}</div><div class="lbl">累计 通过 / 总断言</div></div>
  </div>

  <div class="cards">${roundStat}</div>

  <div class="panel">
    <h2>一、测试方法</h2>
    <div class="kv">
      <div class="k">测试方式</div><div>Playwright 真实浏览器（Edge 内核）模拟三个用户会话：admin（管理员）、QA_A（普通用户）、QA_B（情侣角色），走完整 UI 流程（弹窗表单、视图切换、删除确认等）</div>
      <div class="k">数据验证</div><div>每一步写操作后用 <b>dbq.py 直查 SQLite 库文件</b>，做<b>字段级落库验证</b>（标题/日期/金额/UserId 归属/置顶位等），不只看页面提示</div>
      <div class="k">三轮独立性</div><div>每轮跑前用 wipe_qa.py 清空全部 QA_% 测试账号及其 11 张表数据并重建账号，保证三轮互不污染、结果可复现</div>
      <div class="k">测试标记</div><div>测试数据统一 QATAG/AIPROBE 前缀，与演示数据隔离，测后清理</div>
      <div class="k">安全验证</div><div>RBAC 角色边界、跨用户越权（GET 404 / POST 4xx）、antiforgery 防伪、主题白名单、AI UserId 围栏、首登强制改密，全部实际攻击式验证</div>
    </div>
  </div>

  <div class="panel">
    <h2>二、逐项结果矩阵（✓ 通过 / ✗ 失败 / — 该项不存在）</h2>
    <table>
      <thead><tr><th>检查项</th>${roundHead}<th>说明</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="panel">
    <h2>三、发现并修复的问题</h2>
    <p style="font-size:13px;color:#64748b;margin-bottom:10px;">测试过程中暴露的问题与修复情况（含测试脚本自身的踩坑，供后续维护参考）：</p>
    <div class="fix"><b>产品侧安全机制按设计工作（非 bug）：</b>越权 GET 返回 404 不泄露存在性、越权 POST 被 antiforgery 拦 400/404 且库数据未被篡改、主题白名单外值 400 拒绝、AI 写操作严格落在当前 UserId、首登未改密前被强制跳转改密页。</div>
    <div class="fix"><b>测试脚本踩坑（已修，不影响产品）：</b>① GET /Logout 不登出（防 CSRF 设计）→ 改点退出按钮走 POST；② 提交按钮选择器命中侧栏退出表单 → 限定所属 form；③ 直接 goto /Edit 不弹窗 → 改列表页点链接触发弹窗；④ 删除表单原生 confirm() → 自动 accept；⑤ SQLite 日期含时间后缀 → 用 like 匹配；⑥ 视图记忆干扰列表定位 → 显式 ?view=list；⑦ 统计/导出空态断言 → 先造数据再断言。</div>
    <div class="fix"><b>遗留风险（已知、可接受）：</b>AI 依赖外部 API，断网时对话页会提示失败但不影响其他功能；SQLite 单文件库在极端并发写入下可能短暂锁表（10 人内自用场景无影响）；导出为明文 JSON 含个人数据，存放需自行注意。</div>
  </div>

  <div class="panel">
    <h2>四、覆盖的功能清单</h2>
    <ul class="clean">
      <li><b>账号体系</b>：登录/登出/错误提示/未登录拦截/首登强制改密/主题偏好落库</li>
      <li><b>管理后台</b>：用户列表/弹窗建号/角色分配/启停（admin）</li>
      <li><b>五大核心模块</b>：日程（列表+日历双视图）/ 备忘（列表+网格）/ 习惯打卡 / 记账 / 纪念日 —— 全部 CRUD + 落库字段验证</li>
      <li><b>扩展模块</b>：课程表、留言板、情侣空间（CoupleSettings + LoveNotes）、经期记录</li>
      <li><b>聚合页</b>：工作台、提醒中心、统计（热力图/月度柱状/分类占比）</li>
      <li><b>数据能力</b>：JSON 导出（8 键完整性）、AI 助手（建议卡确认执行 + UserId 围栏）</li>
      <li><b>体验</b>：十个视图渲染、弹窗表单校验、手机端 390px 六页、响应头/加载耗时/PWA manifest、全程零脚本异常</li>
    </ul>
  </div>

  ${failList.length ? `<div class="panel"><h2>失败明细</h2><ul class="clean">${failList.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}

  <div class="panel">
    <h2>五、结论</h2>
    <p style="font-size:14px;">
      ${allGreen
        ? `三轮独立测试共 <b>${totalPass + totalFail}</b> 项断言<b class="ok-text">全部通过（${totalPass}/${totalPass + totalFail}）</b>，每轮均从干净环境完整重跑、结果稳定可复现。功能层面：全部功能可用、数据落库字段级正确；安全层面：越权隔离、防伪令牌、角色权限、AI 数据围栏全部按设计生效；体验层面：多视图、弹窗、手机端、性能缓存均正常。<b>未发现产品漏洞，项目可交付使用。</b>`
        : `存在 ${totalFail} 项失败，详见失败明细，需修复后重测。`}
    </p>
  </div>

  <div class="footnote">测试套件：qa/qa_full.js（25 个 section） · 数据验证：qa/dbq.py · 环境：Windows 本地 IIS Express 兼容宿主（端口 5188）+ SQLite</div>
</div>
</body>
</html>`;

const out = path.join(QA_DIR, '测试报告-生活管家-三轮全功能测试.html');
fs.writeFileSync(out, html);
console.log('报告已生成:', out, `(${(html.length / 1024).toFixed(1)} KB)`);
