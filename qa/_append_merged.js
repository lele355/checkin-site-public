const fs = require('fs');
const p = 'D:/checkin-work/docs/qa/2026-10-29-games-suite-qa-report.md';
let s = fs.readFileSync(p, 'utf8');
s += `
---

### T05+批次A 合并复验

> 环境：dll \`2026-10-30T04:27\` > 全部编译源（XiangqiRules.cs 04:26，批次 A 新构建）；清 dotnet 起站；curl \`--noproxy '*'\`；截图已送回收站。
> 脚本：\`site/qa/_verify_t05fix.js\`（T05 复验）+ \`_verify_batchA.js\`（A1/A2/A3/A4）+ \`_verify_a5.js\`（A5）。

#### 第一部分｜T05 挂起项 —— 全部 PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 落点精度 | ✅ | 合并构建上：gomoku 19 路六点 (0,0)(18,18)(9,9)(3,15)(0,18)(18,0) 全对（修前 (0,0)→(1,1) 已修）；15/13 路各 3 点；reversi 角点 2 点（craft 合法翻子局面）——**showCoord 开 29 点 + 关 13 点 + 1280 抽查 8 点 = 50/50 全准**（360 窄屏缩放后同样全准）。象棋/斗兽棋/军旗在新两段式协议下单击=选子不发请求（A1 覆盖其落点验证） |
| 横屏裁切 | ✅ | 合并构建上四款 svgBottom=**387** ≤390、scrollHeight=390 无纵向滚动（修复前 493/541/875/455） |
| 竖屏 360 回归 | ✅ | 棋盘 300px 完整在视口、无横向溢出 |
| 显示名 | ✅ | /api/v1/me → displayName=**安家乐** |

#### 第二部分｜批次 A

**A1 两段式走子 —— 1 FAIL（象棋改选）**

| 项 | 结果 | 证据 |
|---|---|---|
| 象棋 选子高亮（无 POST） | ✅ | 点马(1,9) → 无请求 + SVG 高亮变化 |
| **象棋 点己方另一子=改选起点** | ❌ **FAIL** | 选中马(1,9)后点象(2,9)（己方子）→ 实际 POST \`{fx:1,fy:9,tx:2,ty:9}\` 被服务端拒「不能吃自己的棋子」——根因：games.js 两段式分支 \`if (sel && 点别处) sendMove\` **未先判断目标是否己方子**，「改选起点」分支（ownPieceAt）不可达。修法：sendMove 前加 \`if (ownPieceAt(g.x,g.y)) { sel={x,y}; render(); return; }\`。**P2 Engineer** |
| 象棋 对方回手后选中清除 | ✅ | AI 回手重渲染后无残留标记 |
| 斗兽棋 两步走子 | ✅ | 选象(6,6)无 POST → 落(6,5) POST \`{fx:6,fy:6,tx:6,ty:5}\` 服务端接受 |
| 军棋 两步走子 | ✅ | 动态找己方子+相邻空位 → POST \`(0,8)→(0,9)\` 接受 |
| 五子棋 单点落子不受影响 | ✅ | 单击即 POST \`{x:7,y:7}\` |

**A2 AI 兜底 —— PASS（1 项代码级）**：gomoku/jungle/xiangqi/reversi 人走→AI 回手全过（revision 0→2，≤6s）；黑白棋无着自动 pass：**机制代码级确认**（\`EnsureAutoPass\` 已接入快照 GET GamesApi:382 与 Play.cshtml.cs:221，\`AllMoves\` 空 → AppendPass；GameAi 亦含 AI 分支同判定）——E2E craft 受限（Replay 硬编码初始 4 子，构造「黑无合法着」局面需复杂布阵），建议工程师补单测（NoOne）。**A4** 黑白棋全程比分 ✅（状态行「轮到你 · 黑 6 白 2」实测）。

**A3 五子棋 —— 全 PASS**：AI 挡活三 ✅（黑(6,6)(7,6)(8,6) 活三 → AI 走 (5,6) 阻挡）；AI 四连成五取胜 ✅（winner=2 reason=five）；**双三禁手判黑负** ✅（黑下 (9,9) 成双三 → finished winner=2 reason=double-three）；**成五+长连同手 → 黑胜** ✅（winner=1 reason=five，五优先于禁手，非白胜）；自由规则六连 → 黑胜 ✅。

**A5 规则硬伤 —— 1 FAIL（AI 兽穴）**

| 项 | 结果 | 证据 |
|---|---|---|
| 兵过河后横走 | ✅ | 红兵 (2,4)（已过河）横走 (3,4) → 接受 |
| 兵未过河横走 | ✅ | 红兵 (0,6) 横走 (1,6) → 400 拒绝 |
| 己方陷阱保护 | ✅ | 红象入己方陷阱 (3,7)，蓝虎攻 → 400「不能吃这个棋子」 |
| 敌入我方陷阱削弱 | ✅ | 蓝象入红陷阱 (3,7)，红鼠攻 → 接受 |
| 水陆互不吃 | ✅ | 水中鼠吃陆上象拒（不能吃这个棋子）；陆上象吃水中鼠拒（只有鼠能下水） |
| **AI 兽穴冲刺** | ❌ **FAIL** | 蓝狮 (3,7) 紧邻红兽穴 (3,8)，轮到 AI → **AI 走 (3,7)→(3,6) 远离兽穴**，房间不终局。根因：\`JungleAi.Search\` 的 denWin 用固定 mySide 判定 \`+1e6\` 后被根节点 \`-Search(...)\` **再取反成 -1e6** → 一步进穴反成最差着。**P1 Engineer**（negamax 符号：denWin 应按当前节点行棋方 side 判定，或去掉根节点取反） |
| 三次重复判和 | ✅ | 车拉车 8 手 → finished winner=3 reason=repetition（全局扫描含初始局面） |

**A6 安卓渲染（代码级）—— PASS**：JungleBoard 7 列 9 行 + 兽名（鼠猫狗狼豹虎狮象）+ 穴/陷 ✓；ArmyChessBoard 5×12 + 军衔文字 ✓；XiangqiBoard 红黑命名体系（帅仕相 / 将士象车马炮兵卒）✓。**A7 fish（代码级走查）—— PASS**：吃鱼条件 \`fi.level <= level\`、升级 \`eatenCount % 3 === 0 → level = min(10, level+1)\`、更大的鱼（fi.level > level）碰玩家=被吃结束 ✓。**A8 掷骰 —— PASS**：\`myRoll\` 全 App **0 命中**；roll 按钮走 \`dto.state?.needRoll\`（GamesScreen.kt:1291）✓。

**回归 + 构建**：\`qa_suite_280_api.js all\` → **113/113**；安卓 \`compileDebugKotlin\` **BUILD SUCCESSFUL**。

**最终结论：需修复（2 项）后再发版 2.8.3**
1. **P1 A5d**：JungleAi negamax 符号错误 → AI 回避兽穴必胜着（斗兽棋人机 AI 永远不会走进穴取胜，还会主动远离）。
2. **P2 A1**：两段式点己方另一子未改选起点、被当落子提交被拒（三款选子类游戏共用此 UX 硬伤）。

其余（T05 全部挂起项、A1 其余、A2、A3、A5 其余、A6、A7、A8、回归构建）全部 PASS。修完这两项我复验即放行。
`;
fs.writeFileSync(p, s, 'utf8');
console.log('report appended:', s.includes('T05+批次A 合并复验'));
