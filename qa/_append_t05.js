const fs = require('fs');
const p = 'D:/checkin-work/docs/qa/2026-10-29-games-suite-qa-report.md';
let s = fs.readFileSync(p, 'utf8');
s += `
---

### 二期 T05+T06 移动端复验

> 环境：dll \`17:40:41\` > 全部编译源（最新 cs 为 17:40 前）；\`games.css\` 17:52 为静态文件不走 dll，以 HTTP 实际内容核对（含 4 条新规则）。Playwright 360×640 / 844×390。截图已送回收站。
> 脚本：\`site/qa/_verify_t05.js\`（32/38 断言）+ \`_verify_precision.js\`（15/19 路对比）。

**6 点结果：4 点 PASS，2 点 FAIL（均 P2，见下）。**

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 网页窄屏 360×640 | ✅ PASS | 6 款大厅 \`scrollWidth-innerWidth=0\`（无横向溢出）；**ludo 人数/AI 表单 7 个子项纵向堆叠、两两无重叠、宽度 316px 全在视口内**（工程师那个 223px 重叠 bug 未复现）；5 款对局页棋盘宽 300 全在视口内、操作按钮可见可点、无横向溢出 |
| 2 | 落子精度 | ⚠️ **部分 FAIL** | **15 路盘：4/4 点全准**（(0,0)/(7,7)/(14,14)/(3,11)）。**19 路盘：边角偏 1 格**——点 (0,0)→服务端收到 (1,1)、点 (18,18)→(17,17)；中心 (9,9)、(3,15) 准。**非 T05 引入**（games.js mtime 13:34，早于本轮 CSS 17:52；T05 只改 CSS，换算逻辑未被缩放破坏——15 路全准即证明 CSS 未破坏精度） |
| 3 | 网页横屏 844×390 | ⚠️ **分栏 ✅ / 裁切 FAIL** | 象棋/斗兽棋/军旗/飞行棋四款 \`display:grid\` 左右分栏（棋盘左 430px 列 / 信息右 231px 列）✓；但**四款棋盘首屏底部溢出视口**：xiangqi svgBottom=493、jungle=541、armychess=875、ludo=455（视口 390）——需滚动才能看全，与验收「棋盘完整不裁切」不符。白名单外 gomoku/reversi 不分栏、竖排可用 ✓；竖屏 DOM 顺序（页头→状态→棋盘）未被横屏样式影响 ✓ |
| 4 | App 建房布局（代码级） | ✅ PASS | 页头 3 个动作（规则/设置/回大厅）；「新建对局」卡内分组 人数/盘面/规则/限时（ludo 2/3/4 人 + 2/3/4 号 AI 同屏可见）；「加入房间」独立卡；主按钮 \`fillMaxWidth()\`；**0.2 三句源码检索全部为 false**（「限时按你的默认设置」「五子棋按…」「黑先/白后」均已删，无新增解释性文字）；标题 \`gameTitle(dto.gameKey)\` 按 key 取名不再硬编码 |
| 5 | App 横屏分栏（代码级） | ✅ PASS | \`orientation==LANDSCAPE && 四款白名单\` → \`Row\`；棋盘 \`fillMaxHeight().aspectRatio(1f)\`；右栏 \`widthIn(220..320).fillMaxHeight().verticalScroll\`；竖屏走原 LazyColumn 不变；Manifest 无 \`requestedOrientation\`（未锁屏） |
| 6 | 回归 + 构建 | ✅ PASS | \`qa_suite_280_api.js all\` → **113/113**；网页 \`dotnet build\` **0 error 0 warning**；安卓 \`compileDebugKotlin\` **BUILD SUCCESSFUL** |

**FAIL 详述（均 P2，归属 Engineer，建议同批修）：**

- **T05-1 横屏高棋盘首屏不完整**：CSS 只给 \`.gm-board max-width: min(520px, 88vh)\`，对高窄纵横比棋盘（xiangqi 9:10、jungle 7:9、armychess 5:12、ludo 640×640）高度=∑宽度×纵横比，再加页头约 155px，首屏必然溢出（需滚动）。修复方向：横屏把页头压成单行 + 棋盘改为**按可用高度反算宽度**（如 \`height: calc(88vh); width: auto;\` 配 aspect-ratio，或 \`max-height: calc(100dvh - 页头高)\`）。若「可滚动看全」可接受，请裁定降级为已知限制。
- **T05-2 19 路落子边缘偏 1 格**：\`games.js\` 点击换算 \`pad = state.showCoord ? 20 : 20\`（恒 20）、\`step=(640-40)/size\`，与渲染层 \`gomoku.js\` 的 \`pad=showCoord?40:20\`、\`step=(640-80)/size\` 不一致；15/13 路巧合对齐，19 路在边缘（i=0,1 偏 +1；i=17,18 偏 -1）暴露。修复方向：换算与渲染同源（pad 用 showCoord?40:20），交叉点盘用 \`Math.round((x-pad-step/2)/step)\` 取最近交叉点。

**结论：需修复（两项 P2）后再发版**；其余 4 点（窄屏、ludo 表单修复、App 建房/横屏代码、回归构建）全部 PASS。
`;
fs.writeFileSync(p, s, 'utf8');
console.log('report appended:', s.includes('二期 T05+T06 移动端复验'));
