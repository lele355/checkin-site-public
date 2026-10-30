const fs = require('fs');
const p = 'D:/checkin-work/docs/qa/2026-10-29-games-suite-qa-report.md';
let s = fs.readFileSync(p, 'utf8');
s += `
---

### 批次B B1+B2 复验

> 环境：dll \`2026-10-30T07:06\` > 全部编译源（Play.cshtml 07:06，批次 B 新构建）；清 dotnet 起站 5188；截图已送回收站。
> 脚本：\`site/qa/_verify_b_api.js\`（30/30）+ \`_verify_b_ui.js\`（8/8）+ \`_verify_a5.js\` 部分用例。

#### 1｜铁路图 API 实测 —— PASS（11/11，全 crafted 走子）

| 用例 | 结果 |
|---|---|
| 铁路直线滑行 (0,1)→(0,5) | ✅ 受理 |
| 非工兵铁路不拐弯 (0,1)→(4,5) | ✅ 拒「走法不合法」 |
| 工兵铁路 BFS 转弯 (2,5)→(0,1) | ✅ 受理 |
| 工兵绕行 (0,5)→(0,1) | ✅ 受理 |
| 非工兵不可达 (0,1)→(2,5) | ✅ 拒 |
| 山界缺口 (1,5)→(1,6) | ✅ 拒（公路铁路皆断） |
| 进敌方空大本营 (1,1)→(1,0) | ✅ 受理 |
| 大本营内子永久冻结（移出） | ✅ 拒 |
| 铁路中途有子 (0,1)→(0,5)（(0,3) 有子） | ✅ 拒 |
| 行营敌子不可吃 (0,1)→(1,2) | ✅ 拒「行营里的棋子不能被吃」 |
| 附加：公路步上铁路节点 (1,4)→(2,5) | ✅ 受理（行营斜边公路接入中央铁路节点） |

#### 2｜布阵状态机 —— PASS（12/12）

明棋建房 → \`status=setup\`（mode=open，state.mode）✓；AI 对手即时随机布（deployDone=[false,true]）✓；己方未布时对方 25 枚全 hidden 无 rank ✓；随机布阵 → playing turn=1 ✓；单方 deploy 仍 setup（[true,false]）✓；重复 deploy 拒（「你已经布阵了」）✓；布阵约束四条各一用例全拒：军旗不在大本营 / 地雷出最后两排 / 炸弹放前线排 / 行营有子 ✓；合法自摆阵（beta side2 镜像 25 枚）受理 → 双方齐 → playing turn=1 ✓；120s 超时按约定代码级确认（懒结算挂 GET 轮询，ArmyChessSetup.SetupSeconds=120）。

#### 3｜UI 级冒烟 —— 1 FAIL（App 布阵 UI 缺失）

| 项 | 结果 | 证据 |
|---|---|---|
| 布阵全链（网页） | ✅ | 明棋房 Play 页出现布阵按钮条（随机布阵/确认布阵）；违反约束的交换（旗↔前线子）**布局不动、0 deploy 请求**；合法交换生效；admin 确认 + beta 随机 → playing；两步走子 POST \`{fx,fy,tx,ty}\` 服务端接受 |
| 拓扑渲染（网页） | ✅ | 山界「山」标注 ✓、铁路粗线 stroke-width=7 ✓、行营「营」/大本营文字 ✓、己方军衔名可见（旅长/排长/工兵/团长/司令/军长…）✓ |
| **App 布阵 UI** | ❌ **FAIL** | 全 App 源码 \`deploy/布阵/明棋/setup\` **0 命中**——App 端无明棋布阵入口，明棋房 App 不可玩（0.1 双端一致缺口）。其余三项过：ArmyChessBoard.kt 同一张常量表（railRows 1,5,6,10 / railCols 0,4 / gaps (1,5)-(1,6),(3,5)-(3,6) 与服务端逐值一致）✓、GridBoardRect 5×12 ✓、暗子背面「军」样式 ✓。**P2 Engineer**（App 明棋布阵 UI 缺失，可随 B3 补） |
| 安卓编译 | ✅ | compileDebugKotlin BUILD SUCCESSFUL |

#### 4｜暗棋立棋 —— PASS（7/7 + 视角化）

暗棋房直接 playing（无 setup 事件）、mode=dark ✓；**视角化核心**：admin 己方 25 枚全亮有 rank、对方 25 枚 hidden 无 rank 键；**换 beta 会话再拉快照 → mySide=2、alpha 侧 25 枚 hidden 无 rank（双视角正确）** ✓；军旗在大本营 ✓；无行营子 ✓；**司令阵亡亮旗** ✅：红司令吃蓝司令（同归）→ 蓝旗对红方永久可见（hidden=false + rank，GetFlagRevealedSides 生效）。

#### 5｜回归 + 构建 —— PASS

\`qa_suite_280_api.js all\` → **113/113**；网页 \`dotnet build\` **0 error 0 warning**；安卓 compileDebugKotlin **BUILD SUCCESSFUL**。

**最终结论：需补 1 项 P2（App 明棋布阵 UI 缺失，双端一致 0.1 缺口）后进 B3**；B1 铁路图/布阵状态机/网页布阵全链/暗棋视角化全部 PASS，不阻塞 B3 开发（App 布阵 UI 可随 B3 一并做）。
`;
fs.writeFileSync(p, s, 'utf8');
console.log('report appended:', s.includes('批次B B1+B2 复验'));
