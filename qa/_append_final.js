const fs = require('fs');
const p = 'D:/checkin-work/docs/qa/2026-10-29-games-suite-qa-report.md';
let s = fs.readFileSync(p, 'utf8');
s += `
---

## 附四：发版闸最终独立复验（工程师 113/113 自报后）

**构建判定（红线 22）**：起站前 taskkill 清净 dotnet；dll \`14:18:33\` > 全部 cshtml/cs 源 \`14:18:14\`（LudoRules.cs）—— 新构建确认。curl 全程 \`--noproxy '*'\`。

**① 四条修复逐条结论**：

| 项 | 结论 | 证据 |
|---|---|---|
| J1 斗兽棋盘 NaN | **PASS** | 源码 \`var pad = geom.pad\`（padPx 无残留）；浏览器控制台 NaN 警告 **0**、svg.innerHTML 无 NaN；截图见 ② |
| R1 飞行棋 pass 消耗骰点 | **PASS** | 确定性探针 \`[{roll s1 v2},{pass s1},{roll s2 v2},{pass s2}]\` 轮 s1 掷 **200 ok**；完整对局 guard=161 走到终局（winner=2, reason=finish）；ludo 全节 15/15 |
| R2 斗兽棋仅限跳河 | **PASS** | 旱地 (0,3)→(0,5) **拒**（只能跳过河面）；跳河（全水面无鼠）**允**；有鼠挡 **拒**；jungle 全节 17/17 |
| P3 军棋 rank_bomb | **PASS** | 源码 \`rank_bomb: '炸'\`；截图红阵中「炸」子可见，非「?」 |

**5 条 URL 复测**：cookie 登录实测全部 **200**（/Games、/Games/Gomoku、Rules、Settings、当轮新建房 Play/**600**）——上轮 302 系旧构建/测试环境，不复现。

**② 四款棋盘截图 4/4**：jungle（7×9 格线+双水域+陷阱「陷」/兽穴「穴」+16 兽子）、xiangqi（交叉点+楚河汉界+九宫斜线+红黑圆子）、ludo（环形跑道+四角机库+终点道+中央骰子区）、armychess（5×12 竖格+行营绿+大本营粉+「炸」子+敌方暗子?）。四款形状各异，无一是五子棋盘。截图已送回收站。

**③ 军旗视角化**：\`qa_suite_280_api.js armychess\` **36/36**（含结构性剔除值级扫描 0 命中）。C12 专项：未参战工兵走进旧战场格 → \`{"x":0,"y":0,"side":2,"hidden":true}\` 无 rank 键，泄露不复现；C7b 幸存子走开仍 \`hidden:false+rank\`。

**④ 全量独立复跑**：\`qa_suite_280_api.js all\` → **113 pass / 0 fail / 113 total**（settings/URL/gomoku/legacy/reversi/jungle/xiangqi/ludo/armychess/tutorials/timeout 全绿）。

**⑤ 最终结论：可发版 2.8.0**。
`;
fs.writeFileSync(p, s, 'utf8');
console.log('report appended:', s.includes('附四'));
