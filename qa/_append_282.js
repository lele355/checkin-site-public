const fs = require('fs');
const p = 'D:/checkin-work/docs/qa/2026-10-29-games-suite-qa-report.md';
let s = fs.readFileSync(p, 'utf8');
s += `
---

### 2.8.2 P0 复验（#25 棋盘分发 + Size 多态）

> 环境说明（红线 22）：复验期间工程师 B4 在途（FanqiRules.cs 持续编辑、当前源编译断在 FanqiRules.cs:132 \`GameEvent.by\`），无法全量重建。采用**最后成功构建（dll 10:17:59，0/0）**——#25 全部相关源（GamesScreen.kt 10:03 / Models.kt 09:50 / Repo.kt 09:26 / ui/games/* ≤10:03 / GomokuRules 04:15 / GameViews 10-29）均在该构建之内，B4 增量仅涉翻棋新文件；安卓侧用 gradle 现场编译直接覆盖修复代码。网页全量重建待 B4 编译恢复后补。
> 脚本：\`site/qa/_verify_282.js\`（10 断言）+ \`_probe_legacy.js\`（旧格式隔离探针）。

#### Bug#1 棋盘分发（六款各是各的）—— PASS

| 项 | 结果 | 证据 |
|---|---|---|
| App 分发代码 | ✅ | GamesScreen.kt:1327-1370 \`RoomBoard\` when 块：gomoku→Board / reversi→ReversiBoard / jungle→JungleBoard / xiangqi→XiangqiBoard / ludo→LudoBoard / armychess→ArmyChessBoard，六款齐全 + else 兜底（未知游戏明示不支持，不落错盘） |
| 网页分发 | ✅ | games.js \`RENDERERS[gameKey]\` 映射六款 + 未知 gameKey console.error 守卫 |
| 渲染几何逐款核对（不串盘的几何证据） | ✅ | gomoku：GridBoard(size=n) n×n（BoardGeom size 参数化）；reversi：8×8（ReversiBoard.kt:25 \`val size = 8\`）；jungle：GridBoardRect cols=7 rows=9（JungleBoard.kt:32-33）；xiangqi：9 列×10 行（XiangqiBoard.kt:50 \`/9f\`）；ludo：15 格十字盘 + 起点 0/13/26/39（LudoBoard.kt:60-61）；armychess：GridBoardRect cols=5 rows=12（ArmyChessBoard.kt:76-77）——六款几何常量两两不同、各自闭合 |

#### Bug#2 Size 13/19 多态序列化 —— ❌ FAIL（源码 bug，路由：Engineer）

**现象**：App 端 13/19 路房间渲染为 15×15——size 数据链在快照层断了。

**证据（API 读写往返 \`_verify_282.js\`）**：
- state.size 往返 ✅：13/15/19 各档 \`state.size\` 精确返回（JSON number）；13 路 (12,12) 受理/(13,13) 拒「落子位置不合法」、19 路 (18,18) 受理——**服务端规则侧 size 完全正确**；
- 大厅行 size ✅：\`items[].size=13\`（GameLobbyItemDto 消费面正常）；
- **快照顶层 size ❌**：\`GET /rooms/{id}\` 的 data 顶层键 = id,code,gameKey,status,hostSide,…,state,createdAt,updatedAt——**无 \`size\`、无 \`forbidden\`**（原始 JSON 键列表实录）。

**根因（文件:行号）**：
- \`Services/GameViews.cs:54-88\`（Snap 匿名对象）——**缺 \`size = r.Size, forbidden = r.Forbidden\`**（全文零 size/forbidden 引用）；
- \`data/Models.kt:875\` \`GameRoomDto.size: Int = 15\`（缺字段 → 恒默认 15）+ \`GamesScreen.kt:1074\` \`val n = if (dto.size > 0) dto.size else 15\` → 恒 15；GameStateDto 亦无 size 字段（state.size 被忽略）。

**复现**：\`POST /api/v1/games/gomoku/rooms {"side":1,"size":13}\` → \`GET /api/v1/games/gomoku/rooms/{id}\` → \`data.size == undefined\`（期望 13）→ App 棋盘 15×15。

**最小修复建议**：Snap envelope 补回 \`size = r.Size, forbidden = r.Forbidden\`（App 的 GameRoomDto 已备好两个字段，**零 App 改动**）。注：疑似 #24 的修复被 batch-B（B1/B2）GameViews 重写（10-29 16:54）顺手丢掉（回归）——请工程师确认修复原貌后补回并加一条快照顶层断言防再丢。

#### 旧格式兼容 —— PASS

legacy \`[{x,y,s}]\`（无 t 键）房间：读回 moves=[{x:7,y:7,s:1},{x:0,y:0,s:2}] / moveCount=2 / lastMove 正确；续走子受理（写侧升级新格式）✓。（过程注：QA 测试脚本曾双 stringify 误报，已修——测试侧 bug 自修。）

#### 回归 + 构建

- \`qa_suite_280_api.js all\` → **127 pass / 0 fail**（真实执行，尾部含布阵/教程/超时懒结算）；
- 安卓 \`compileDebugKotlin\` **BUILD SUCCESSFUL**（修复代码（GamesScreen/Models）现场编译通过）；
- 网页 \`dotnet build\`：**暂不可建**——工程师 B4 在途代码 FanqiRules.cs:132 \`GameEvent.by\` 编译错误（与 #25 无关，B4 自身在写）；#25 相关服务端源已含在 10:17:59 构建中验证。

#### IS_PASS 判定

**IS_PASS: NO** —— Bug#1 PASS / **Bug#2 FAIL（快照顶层缺 size/forbidden，App 13/19 恒渲染 15 路）**。路由：源码 bug → Engineer（GameViews.cs:54-88 补两字段即可，App 零改动）。
`;
fs.writeFileSync(p, s, 'utf8');
console.log('report appended:', s.includes('2.8.2 P0 复验（#25'));
