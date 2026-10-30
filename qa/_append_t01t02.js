const fs = require('fs');
const p = 'D:/checkin-work/docs/qa/2026-10-29-games-suite-qa-report.md';
let s = fs.readFileSync(p, 'utf8');
s += `
---

### 二期第一批复验（T01 修设置 + T02 单机游戏/排行榜）

> 环境：dll \`16:37:39\` > 全部源 \`16:32:31\`（新构建）；起站前清 dotnet；curl 全程 \`--noproxy '*'\`；401 用无 CHECKIN_LOCAL 对照实例（5189）验。

**1｜T01 设置语义 —— PASS**

| 项 | 结果 | 证据 |
|---|---|---|
| 大厅页头「设置」入口（孤儿页修复） | PASS | Lobby 页头「设置」链接 → 点击进 \`/Games/gomoku/Settings\` 200 |
| 设置页可改 size/forbidden/限时 | PASS | 三控件在场；改 19路/标准规则/30秒 → 保存 → DB \`Size:19, Forbidden:true, MoveTimeoutSec:30\` 落库 |
| **AI 限时不再冲设置（防复燃）** | PASS | gomoku AI 房：size=19/forbidden=true/moveTimeoutSec=30（未冲回 15/自由/0）；reversi AI 房：moveTimeoutSec=60 照设非 0；网页 reversi 大厅「人机对战」按钮建房同样照设 |
| 语义命名 + 0.2 | PASS | 标题「五子棋 · 默认规则」；正文无解释性文字 |

**2｜T02 防作弊三件套 —— PASS（边界见注）**

| 项 | 结果 | 证据 |
|---|---|---|
| 未登录 401 | PASS | 对照实例：POST /score → 401；GET /leaderboard → 401 |
| 幂等 max | PASS | 报 1000 → 再报 500 → bestScore 仍 1000（只增不减） |
| 上限 | PASS | 报 2000000 → 400「分数超限（0～1000000）」 |
| 限速（5次/10s） | PASS | 窗口内第 6 次 → 400「提交太频繁，稍后再试」 |
| 绕过前端直报高分 | 说明 | 直接报 999999 → 200 接受存储（cap 内）。**这是设计明示的弱防**（强防=事件流重算 P2）；三件套本身工作正常，分数来源无校验属已知取舍 |
| 非单机游戏报分 | PASS | gomoku 报分 → 400「这不是单机游戏」 |

**3｜排行榜正确性 —— PASS**：GET leaderboard 返回 top10 + mine{bestScore,rank}；多用户实测 1000→#1、300→#2、300→#2（并列）、100→#4 —— **并列同名次（竞赛名次，跳号）**，mine.rank=2 与之一致。PRD §4.3 未明文规定并列语义，实现合理；N=10（PRD 待确认项建议 20，属裁定项，按本轮验收口径 PASS）。

**4｜单机可玩 + Solo 分流 —— PASS**：fish/melon \`solo:true\`，卡片直达 \`/Games/{key}/Solo\`（不进大厅/不建房）；两页均有 canvas + 外链玩法 JS（fish.js 6.5KB 游戏循环/吃鱼；melon.js 6.9KB 合成逻辑）且含 \`/score\` 上报；五款联机入口回大厅正常。安卓侧亦有 FishGame.kt/MelonGame.kt + leaderboard + solo 分流（0.1 双端一致，代码级）。

**5｜回归 + 构建 —— PASS**：\`qa_suite_280_api.js all\` → **113/113**（独立复跑）；网页 build **0 error 0 warning**；安卓 **BUILD SUCCESSFUL**。

**残留（均不阻塞，建议记 DEVLOG/API.md）**：① 限速实现返回 400 而注释写 429（行为一致，文档笔误）；② 客户端自报分数无来源校验（弱防已知取舍，建议 API.md 注明）；③ 排行榜 N=10 vs PRD 待确认项建议 20（可配）。

**结论：可进入飞行棋 4 人。**
`;
fs.writeFileSync(p, s, 'utf8');
console.log('report appended:', s.includes('二期第一批复验'));
