const fs = require('fs');
const p = 'D:/checkin-work/docs/qa/2026-10-29-games-suite-qa-report.md';
let s = fs.readFileSync(p, 'utf8');
s += `
---

### 二期 T03+T04 飞行棋4人完整实测

> 环境：dll \`17:24:43\` > 全部源 \`17:24:17\`（新构建，起站前后各核对一次）；清 dotnet 起站；curl \`--noproxy '*'\`。测试期间站点被外部进程更迭两次，均重启并复核构建后继续，结果不受影响。
> 脚本：\`site/qa/_verify_ludo4.js\`（12 段 39 断言全 PASS）+ \`qa_suite_280_api.js all\`（113/113）。

**13 条闸门逐条结果：全部 PASS。**

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 全量回归 | ✅ | \`qa_suite_280_api.js all\` → **113/113**；ludo 段 **15/15**（含 2 人完整对局 guard=99 终局）；五子棋旧格式垫片 4/4 不破 |
| 2 | 存量 2 人兼容（零漂移） | ✅ | L1 SeatsJson 保持 null；L2 players[] 回填红黄 2 座；L3 连续走子；L4 认输即时终局 winner=1；L5 rematch 复位（playing/turn=1/全回机库/SeatsJson 仍 null）；2 人完整对局（suite ludo L6）guard=99 winner=2 finish |
| 3 | 3/4 人建房/起点/轮转 | ✅ | A2 座位红1/黄2/蓝3/绿4；A3 四座 mySide=1/2/3/4；A4 起点 0/26/13/39；A5 轮转 1→2→3→4→1 |
| 4 | 1人+3AI 整局 | ✅ | K2 推进到终局（winner=4 reason=finish，guard=888 轮询）；K3 AI 座 usedMs 恒 0；无卡死（revision 持续增长） |
| 5 | F1 掷 6 行为 | ✅ | **B1 掷6起飞→Turn 保持（额外回合）**；B2 连 2~3 次 6 保持 Turn=1；**B3 第 4 次 6 强制换座（Turn→2）**；B4 非 6 正常换座；**B5 掷6无合法着→auto-pass 直接换手（Turn→2）** —— 工程师取舍确认：有明确代码注释与理由（避免同座反复空掷），属合理行为非漏判 |
| 6 | 出局轮转 | ✅ | C1 认输座 active=false 其余继续；C2 轮转跳过出局座（1→3）；C3 剩 1 active 该座胜（winner=1 resign）；**C4 N==2 认输即时终局（与旧一致）** |
| 7 | F2 等待中退座 | ✅ | D1 3 人房等待；D2 beta 入 seat1；D3 退出后 seat 释放（name='' 可再入座）；D4 delta 成功补位 |
| 8 | F3 换手限时从头算 | ✅ | E1 4 人 auto-pass 后 turn=2 且 moveRemain≈14984ms（15s）；E2 2 人同（14989ms）—— 双双修复 |
| 9 | F4 online + Sweeper 保活 | ✅ | F1 seat2 轮询后 online=true；F2 host+seat1 静默 5min、仅 seat2 在场 → 房间不被误删；F3 全员静默 → 正常回收（不误留） |
| 10 | F5 usedMs 单源 | ✅ | G1 四座 usedMs 全走 SeatsJson（1111/2222/3333/4444 无列漂移）；G2 myRemainMs 与座位 usedMs 一致；K3 AI 座恒 0 |
| 11 | F6 出局渲染 | ✅ | H1 出局座 4 机投影全 -1（不画残局棋子）；H2 MovesJson 事件流不因认输改变（仍含该座 move，复盘可见） |
| 12 | 并发 CAS | ✅ | I1 同座并发两手：1 成功 + 1 优雅 400，无 500，revision 只 +1 |
| 13 | 大厅可见性 | ✅ | J1 seat2 在「我的房间」看到自己参与的房；J2 seatCount=4/seatedCount=4；J3 finished 房对 seat2/3 仍可见（3 天内） |

**附：安卓 \`compileDebugKotlin\` BUILD SUCCESSFUL。**

**P3 备注（不阻塞）**：① API 大厅房间列表项未暴露 \`isAi\` 字段（web/App 均未用该字段，若后续 UI 需要可补）；② ludo 的 \`moveCount\`/legacy moves 兼容投影恒 0（走子事件不含 x/y，属既有设计，作进度依据会误读，仅提示）。

**结论：可发版（二期飞行棋 4 人闸门通过）。**
`;
fs.writeFileSync(p, s, 'utf8');
console.log('report appended:', s.includes('二期 T03+T04 飞行棋4人完整实测'));
