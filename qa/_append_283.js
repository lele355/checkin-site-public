const fs = require('fs');
const p = 'D:/checkin-work/docs/qa/2026-10-29-games-suite-qa-report.md';
let s = fs.readFileSync(p, 'utf8');
s += `
---

### 2.8.3 发版前点验

> 环境：dll \`2026-10-30T05:33\` > 全部编译源（JungleAi.cs 05:32，新构建）；清 dotnet 起站 5188；截图已送回收站。
> 脚本：\`site/qa/_verify_283.js\`（9/9 全过）。

**P1 斗兽棋 AI 兽穴 —— PASS（3/3）**

| 场景 | 结果 | 证据 |
|---|---|---|
| 工程师场景：蓝狮(3,7) 邻红兽穴(3,8)，红鼠(3,6) 挡路（狮可吃鼠）、红象(0,2) 远处，轮到 AI | ✅ | **AI 弃吃鼠直取兽穴** → finished winner=2 reason=den（走进 tx,ty=(3,8)） |
| 反向：红狮(3,1) 邻蓝兽穴(3,0)，红方行棋进穴 | ✅ | finished winner=1 reason=den |
| 困毙分支：红方零子，AI 行棋后红方无着 | ✅ | finished winner=2 reason=blocked（无子方判负，非反逻辑；双方都无着=draw 的分支也在） |

**P2 两段式改选起点 —— PASS（三款全过 + App 代码级）**

| 项 | 结果 | 证据 |
|---|---|---|
| 象棋 | ✅ | 点马(1,9)选中 → 点己方相(2,9) → **0 网络请求**（改选）→ 点 (0,7) → POST \`{fx:2,fy:9,tx:0,ty:7}\` 服务端接受 |
| 斗兽棋 | ✅ | 点象(6,6) → 点狼(2,6) → 0 请求 → 点 (3,6) → POST \`{fx:2,fy:6,tx:3,ty:6}\` 接受 |
| 军棋 | ✅ | 动态选 A(0,6) → 点 B(0,8) → 0 请求 → 点 B 的空邻 (0,9) → POST 起点=B 接受 |
| App boardTap | ✅ | \`!isOwnPiece(x, y)\` 守卫在提交之前（GamesScreen.kt boardTap：点己方子=选/改选起点，点非己方格才 onFromTo 提交） |

**回归**：\`qa_suite_280_api.js all\` → **113/113**（独立复跑）。

**最终结论：可发版 2.8.3。**
`;
fs.writeFileSync(p, s, 'utf8');
console.log('report appended:', s.includes('2.8.3 发版前点验'));
