const fs = require('fs');
const p = 'D:/checkin-work/docs/qa/2026-10-29-games-suite-qa-report.md';
let s = fs.readFileSync(p, 'utf8');
s += `
---

### 二期 T03 代码预审（飞行棋 4 人服务端，纯读代码）

**结论：总体结构正确（座位唯一真相/懒回填/快照/轮转/出局/计时骨架都对），发现 1 条设计明写未实现（P1）+ 5 条 P2 + 3 条 P3。可控，建议先确认口径再补。**

#### 焦点问题逐条核对（对上）

| 焦点 | 结论 |
|---|---|
| ① 2 人零漂移 | ✅ \`Backfill2\` 红0/黄26 与旧 \`StartPos=[0,26]\` 完全等价；\`Replay\` 改 \`int[5,4]\` 后 1..2 行为不变（含 HostSide=2 的房：seat0=side2=黄26/seat1=side1=红0，按 side 取起点，与旧一致）；2 人房 SeatsJson 恒 null 不写 |
| ② NextTurn 默认 | ✅ 接口默认方法 \`=> Other(side)\`，其余五款均未覆盖（grep 确认只 LudoEngine 覆盖）；其他游戏轮转零变化 |
| ③ 出局轮转死循环 | ✅ \`NextActive\` 有界扫描（step 1..Count），全 inactive 返回当前座（不可达）；「只剩 1 active」由 resign/leave/超时处理先判 finished，不会进入自我轮转 |
| ④ GameClock N==2 | ✅ N==2 分支代码与旧版逐字一致（仅 used 取数改 \`LudoSeats.UsedMsOf\`，2 人下等价于读 Host/Guest 列）；N>2 才走 \`EnforceLudoMultiTimeout\` |
| ⑤ Snap mySide | ✅ ludo 按 \`LudoSeats.ByUid\` 座位映射；旁观者 0；players[] 仅 seat/side/color/name/isAi/isMe/active/usedMs/online（无敏感数据）；多人 \`oppRemainMs\` 显式 null |
| ⑥ 大厅 seat2/3 | ✅ 活跃房：额外拉 \`SeatsJson!=null && Status!=finished\`（Take 200）内存过滤 \`Any(uid)\` 补进；SQL 兜 seat0/1 投影。⚠️ finished 房对 seat2/3 不显示（P3） |
| ⑦ rematch 重置 | ✅ active=true、usedMs=0、Turn=1、HostSide=1、MovesJson=InitialEvents（飞机回机库）、Winner/ResultReason/FinishedAt 清；⚠️ SeenAt 未重置（P3） |

#### 疑点清单

| # | 位置 | 风险描述 | 严重度 | 建议 |
|---|---|---|---|---|
| F1 | GamesApi move 端点（NextTurn 处）/ GameAi phase2 / roll auto-pass | **「掷 6 额外回合不换座」未实现**：设计 §2.1 明写 + QA 落点列「掷 6 额外回合只归本人」；三条路径（真人 move、AI phase2、roll 自动换手）都直接 \`NextTurn\` 轮转，无 roll==6 保持 Turn 的分支 | **P1** | 确认口径后补：move/phase2 落库时 \`nextTurn = 本手 roll==6 ? 保持 mySide : NextActive\`。注意：若补会改变 2 人行为（现 2 人版也没有），需按 0.1 双端口径一并确认 |
| F2 | GamesApi leave 端点 | **等待中非房主退出不释放座位**：leave 只有「waiting&host 删房 / playing 认输 / finished&host 删房」三分支，waiting&非 host 落到 \`removed=false\` → seat 保留 uid、房间卡 waiting，别人无法入座（5 分钟后 Sweeper 才清） | P2 | waiting&非 host：把该座 uid/name 清空、SeenAt 清空、写回 SeatsJson（若因此无人 → 房主房保持 waiting 等新人） |
| F3 | GamesApi roll 端点「自动换手」分支 | **换手未重置 TurnStartedAt**：ExecuteUpdate 只写 MovesJson/Turn/Status/Winner/Reason/Revision/UpdatedAt/FinishedAt，缺 \`TurnStartedAt=now\` → 下家的单步限时被上家已耗时挤占（MoveTimeoutSec>0 时会提前超时）。2 人同样存在（历史遗留，非本轮引入） | P2 | 补 \`SetProperty(TurnStartedAt, o2 ? room.TurnStartedAt : (DateTime?)now)\` |
| F4 | GamesApi Touch / GameSweeper | **seat2/3 的在线与保活未接**：Touch 只认 host/guest（early return），seat2/3 轮询不刷新任何 Seen；后果①players[].online 20s 后恒 false（实际在线）②若 host+seat1 都不在看，seat2/3 进行中的房间会被 Sweeper 5 分钟误删。设计 ⑨ 明写「Sweeper 飞行棋判定读 SeatsJson」未落地 | P2 | Touch：ludo 非 null 时按 uid 找座写 seat.SeenAt（5s 节流）；Sweeper：ludo 房以「任一 active 座 SeenAt 新鲜」保活 |
| F5 | LudoSeats.UsedMsOf | **计时双源**：side1/2 读 Host/Guest 列、side3/4 读 SeatsJson（设计「Host/Guest 列飞行棋不读」）。当前 move 两处同写不漂移，但 AI phase2 不写 usedMs、任何单侧改动都会漂 | P2 | 非 null 时统一读 SeatsJson（UsedMsOf 内加 SeatsJson!=null 分支） |
| F6 | resign/leave/timeout 多分支 | **出局飞机未回机库**：仅 active=false，棋子留盘冻结且 BuildState 仍渲染（设计「飞机全部回机库」） | P2 | BuildState 对 inactive 座输出 pos=-1（只改渲染投影，不动事件流，零迁移） |
| F7 | rematch / LudoSeats / move 文案 | rematch 未重置 SeenAt（在线状态短暂误显）；\`LudoSeats.HomeEntryOf\`/\`SoleActive\` 无调用（dead code，无害）；waiting 房 move 提示「对手还没进来」为 2 人措辞 | P3 | 顺手：SeenAt 重置/删 dead code/文案改「其他玩家还没进来」 |
| F8 | 大厅 extra | finished 房对 seat2/3 不显示（extra 只拉 Status!=finished，SQL 兜不住 seat2/3）——「我的房间」里看不到自己打完的多人的局；列表 isAi/guestName/opponentOnline 对多人房仍用旧列（显示不准） | P3 | extra 过滤去掉 finished 限制或单独拉一批 finished 近期房 |
| F9 | LudoRules/Judge | 设计「撞子/安全格判定泛化」未实现——与已上线 2 人版一致（2 人版本就无撞子），不算回归，但设计文档与实现有出入 | P3 | 在设计/DEVLOG 注明「撞子未实现，2 人与多人一致」 |

#### T04 完成后起站实测重点清单（按优先级）

1. **全量回归先跑**：\`qa_suite_280_api.js all\` 应仍 113/113（2 人 ludo 零漂移的硬指标）。
2. **存量 2 人 ludo 房**（SeatsJson=null）继续走子/超时/rematch，快照与旧版一致（重点看 players[] 新增后 UI 不炸）。
3. **3 人 / 4 人建房**：seat→color→起点（红0/黄26/蓝13/绿39）；Turn 轮转 1→2→3→4→1；mySide/myTurn/needRoll 每座正确；skip 出局座。
4. **1 人 + 3 AI 整局跑完**（AI 两阶段 roll→move/pass 不卡死、pass 消费、guard 上限）。
5. **掷 6 行为**（F1 口径确认后验：额外回合 or 直接轮转）。
6. **出局**：4 人局中途认输/超时 → 该座出局其余继续；剩 1 active 终局 winner 正确；N==2 认输/超时行为与旧一致（对手胜整体终局）。
7. **F2**：等待中 seat1/2 退出 → 座位释放、可再入座。
8. **F3**：MoveTimeoutSec=15 的房，roll 自动换手后下家不被提前判超时（TurnStartedAt 断言）。
9. **F4**：seat2/3 轮询 20s+ 后 players[].online 仍 true；host+seat1 静默 5min 后 seat2/3 房间不被 Sweep 误删。
10. **F5**：多人局 players[].usedMs 与 myRemainMs 一致（不漂）。
11. **F6**：出局后盘面该座 4 机不显示（或显示在机库）。
12. **并发**：同座双击 roll/两请求抢同一空位（CAS 拒绝文案）。
13. **大厅**：seat2/3 能看到"我的房间"；满座不可加入；4 人房座位数/入座情况（T04 UI 部分）。
`;
fs.writeFileSync(p, s, 'utf8');
console.log('report appended:', s.includes('二期 T03 代码预审'));
