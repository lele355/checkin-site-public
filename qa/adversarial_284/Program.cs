// adversarial_284 —— 2.8.4 发版前 AI 红线攻击性测试 + 翻棋边界推演（QA 严过关）。
// 覆盖：
//   A1 连续翻同色中间被对方翻断不重置（per-player 上次翻色记忆）——对照 2026-10-30-fanqi-rules.md 二
//   A2 暗子文案攻防两侧一致、不泄露（先「暗子不能移动/不能攻击暗子」再判颜色）+ 快照反泄露
//   A3 三雷前置扛旗（清 2 枚仍拒、炸弹也不例外）；雷清后炸弹碰旗 = 夺旗（不是双亡）
//   B1 军旗仅剩军旗+地雷（无子可动）→ Think 不崩不非法；纯困子并入 blocked 判负
//   B2 军棋 Think 红线差分：AllMoves 非空必出合法着、唯一着必选中、随机行走复验
//   B3 翻棋阵营未定只能翻 → Think 必给翻子着；走子被拒文案
//   B4 翻棋阵营未定且无可翻 → Think=null 不崩；Judge blocked 判负
//   B5 翻棋已定阵营一方只剩军旗+地雷 → annihilate 判负；劣势方 Think 不崩
//   B6 飞行棋四机全在场但骰点全不合法 → Think=null 不崩（合法空过）
//   B7 飞行棋唯一可动机 → Think 必返回该机
//   B8 飞行棋「归巢」优先（偏差③行为固化：归巢 > 起飞 > 撞子）
//   B9 翻棋/飞行棋 随机对局红线压测：有合法操作必出着且被 ValidateMove 接受
// 用法：dotnet run（退出码 = 失败数，0 = 全绿）
using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;
using CheckinApp.Services;

int pass = 0, fail = 0;

void T(string name, bool cond, string detail = "")
{
    if (cond) { pass++; Console.WriteLine($"  PASS  {name}"); }
    else { fail++; Console.WriteLine($"  FAIL  {name}  {detail}"); }
}

string Err(Func<object> act)
{
    try { act(); return ""; }
    catch (ApiBadRequest e) { return e.Message; }
    catch (Exception e) { return "非 ApiBadRequest: " + e.GetType().Name + ": " + e.Message; }
}

// ---------------- 通用构造 ----------------
GameRoom Room(int turn = 1, string mode = "fanqi") =>
    new() { Code = "ADV001", GameKey = "armychess", Mode = mode, Turn = turn, Status = "playing", HostUserId = 1, AiLevel = 0 };

GameEvent Setup(int color, int x, int y, int value, int id) =>
    new() { t = "setup", s = color, x = x, y = y, v = value, p = id };
GameEvent Flip(int s, int x, int y) => new() { t = "flip", s = s, x = x, y = y };

int V(string rank) => ArmyChessRules.RankValue(rank);
const string MINE = ArmyChessRules.RANK_MINE;
const string FLAG = ArmyChessRules.RANK_FLAG;
const string BOMB = ArmyChessRules.RANK_BOMB;
const string CMD = ArmyChessRules.RANK_COMMANDER;
const string PLT = ArmyChessRules.RANK_PLATOON;
const string DIV = ArmyChessRules.RANK_DIVISION;

JsonElement MoveReq(int fx, int fy, int tx, int ty) => JsonSerializer.SerializeToElement(new { fx, fy, tx, ty });

// ---------------- 飞行棋摆位工具：BFS 求掷骰序列（跳4/飞12 由 ApplyMove 确定性消化；不许误撞已摆棋子） ----------------
List<GameEvent> LudoMarch(List<GameEvent> prior, int side, int piece, int targetPos)
{
    var baseBoard = LudoRules.Replay(prior);
    var start = baseBoard[side, piece];
    var prev = new Dictionary<int, (int from, int roll)>();
    var q = new Queue<int>();
    q.Enqueue(start);
    var seen = new HashSet<int> { start };
    while (q.Count > 0)
    {
        var cur = q.Dequeue();
        if (cur == targetPos) break;
        for (var roll = 1; roll <= 6; roll++)
        {
            var b = (int[,])baseBoard.Clone();
            b[side, piece] = cur;
            var before = (int[,])b.Clone();
            LudoRules.ApplyMove(b, side, piece, roll);
            var hitOther = false;
            for (var s = 0; s < 5 && !hitOther; s++)
                for (var p = 0; p < LudoRules.PiecesPerSide; p++)
                    if (!(s == side && p == piece) && b[s, p] != before[s, p]) { hitOther = true; break; }
            if (hitOther) continue;   // 摆位不允许误撞先摆的棋子
            var nxt = b[side, piece];
            if (seen.Add(nxt)) { prev[nxt] = (cur, roll); q.Enqueue(nxt); }
        }
    }
    if (targetPos != start && !prev.ContainsKey(targetPos))
        throw new InvalidOperationException($"到不了 pos={targetPos}（side={side} piece={piece} start={start}）");
    var rolls = new List<int>();
    var c = targetPos;
    while (c != start) { var (f, r) = prev[c]; rolls.Add(r); c = f; }
    rolls.Reverse();
    return rolls.Select(r => new GameEvent { t = "move", s = side, p = piece, v = r }).ToList();
}

// ============================================================
// A1 连续翻同色被对方翻断不重置（文档二：本玩家上一次翻出的颜色）
// ============================================================
Console.WriteLine("[A1] 阵营状态机：对方翻断不重置我方同色记忆");
{
    // P1 红、P2 蓝（插队）、P1 再红 → P1 执红（对方那次翻子不该重置）
    var evs = new List<GameEvent>
    {
        Setup(1, 2, 0, V(CMD), 0),   // 红
        Setup(2, 0, 1, V(PLT), 1),   // 蓝
        Setup(1, 0, 0, V(DIV), 2),   // 红
    };
    var seq = new List<GameEvent> { Flip(1, 2, 0), Flip(2, 0, 1), Flip(1, 0, 0) };
    var st = FanqiRules.Replay(evs.Concat(seq).ToList());
    T("P1 翻红→(P2 插队翻蓝)→P1 翻红 → P1 执红", st.ColorOf1 == 1 && st.ColorOf2 == 2 && st.Settled,
        $"c1={st.ColorOf1} c2={st.ColorOf2}");

    // 对照：P1 红后翻蓝、P2 蓝后翻红 → 双方未定
    var evs2 = new List<GameEvent>
    {
        Setup(1, 2, 0, V(CMD), 0), Setup(2, 0, 1, V(PLT), 1), Setup(2, 4, 0, V(DIV), 2), Setup(1, 0, 0, V(PLT), 3),
    };
    var st2 = FanqiRules.Replay(evs2.Concat(new List<GameEvent> { Flip(1, 2, 0), Flip(2, 0, 1), Flip(1, 4, 0), Flip(2, 0, 0) }).ToList());
    T("P1 红后翻蓝、P2 蓝后翻红 → 双方未定", !st2.Settled, $"c1={st2.ColorOf1} c2={st2.ColorOf2}");
}

// ============================================================
// A2 暗子文案攻防一致 + 不泄露
// ============================================================
Console.WriteLine("[A2] 暗子文案反泄露（攻防两侧一致）");
{
    var evs = new List<GameEvent>
    {
        Setup(1, 0, 0, V(PLT), 0),   // 红暗子
        Setup(2, 0, 1, V(PLT), 1),   // 蓝暗子
        Setup(1, 2, 0, V(CMD), 2),   // 红已翻
        Setup(1, 4, 0, V(DIV), 3),   // 红已翻
        Setup(2, 4, 1, V(CMD), 4),   // 蓝已翻
        Flip(1, 2, 0), Flip(1, 4, 0), Flip(2, 4, 1),
    };
    var r = Room(1, "fanqi");
    var st = FanqiRules.Replay(evs);
    T("前提：P1=红 P2=蓝 已定", st.Settled && st.ColorOf1 == 1 && st.ColorOf2 == 2, $"c1={st.ColorOf1} c2={st.ColorOf2}");

    // 走暗子：攻方（P1 走自己色的暗子）、防守视角（P2 走对方色的暗子）文案必须一致
    r.Turn = 1;
    var m1 = Err(() => FanqiRules.ValidateMove(evs, r, 1, MoveReq(0, 0, 1, 0)));   // P1 走红暗子（自己色）
    r.Turn = 2;
    var m2 = Err(() => FanqiRules.ValidateMove(evs, r, 2, MoveReq(0, 0, 1, 0)));   // P2 走红暗子（对方色）
    var m3 = Err(() => FanqiRules.ValidateMove(evs, r, 2, MoveReq(0, 1, 1, 1)));   // P2 走蓝暗子（自己色）
    T("走暗子文案恒为「暗子不能移动」", m1 == "暗子不能移动" && m2 == "暗子不能移动" && m3 == "暗子不能移动",
        $"m1={m1} m2={m2} m3={m3}");
    T("文案不落颜色判定（无「这不是你的棋子」泄露）", m1 != "这不是你的棋子" && m2 != "这不是你的棋子", "");

    // 攻暗子（做落点）：目标是自己色暗子/对方色暗子都只说「不能攻击暗子」
    r.Turn = 1;
    var a1 = Err(() => FanqiRules.ValidateMove(evs, r, 1, MoveReq(2, 0, 0, 0)));   // 攻己方色暗子
    var a2 = Err(() => FanqiRules.ValidateMove(evs, r, 1, MoveReq(2, 0, 0, 1)));   // 攻对方色暗子
    r.Turn = 2;
    var a3 = Err(() => FanqiRules.ValidateMove(evs, r, 2, MoveReq(4, 1, 0, 0)));
    T("攻暗子文案恒为「不能攻击暗子」", a1 == "不能攻击暗子" && a2 == "不能攻击暗子" && a3 == "不能攻击暗子",
        $"a1={a1} a2={a2} a3={a3}");

    // 对照：走已翻对方子才说颜色（证明上面不是永远同一文案）
    r.Turn = 1;
    var c1 = Err(() => FanqiRules.ValidateMove(evs, r, 1, MoveReq(4, 1, 3, 1)));
    T("已翻对方子文案走颜色判定（对照）", c1 == "这不是你的棋子", $"c1={c1}");

    // 快照反泄露：暗子对象无 side/rank；events 不下发 setup
    var snapObj = FanqiRules.BuildState(evs, r, 1, false);
    var root = JsonSerializer.SerializeToElement(snapObj);
    var leak = false; var leakDetail = "";
    foreach (var p in root.GetProperty("pieces").EnumerateArray())
    {
        if (p.TryGetProperty("hidden", out var h) && h.GetBoolean()
            && (p.TryGetProperty("side", out _) || p.TryGetProperty("rank", out _)))
        { leak = true; leakDetail = p.GetRawText(); }
    }
    T("快照暗子无 side/rank 字段", !leak, leakDetail);
    var hasSetup = false;
    foreach (var e in root.GetProperty("events").EnumerateArray())
        if (e.GetProperty("t").GetString() == "setup") hasSetup = true;
    T("快照 events 不下发 setup", !hasSetup);
}

// ============================================================
// A3 三雷前置扛旗：清 2 枚仍拒、炸弹也不例外；雷清后炸弹碰旗=夺旗
// ============================================================
Console.WriteLine("[A3] 三雷前置扛旗（炸弹不豁免 / 雷清后炸弹碰旗=夺旗）");
{
    // 蓝方 3 雷只清 2 枚（盘上还剩 1 雷）
    var guarded = new List<GameEvent>
    {
        Setup(1, 2, 0, V(CMD), 0), Setup(1, 2, 1, V(BOMB), 1),
        Setup(2, 3, 0, V(FLAG), 2), Setup(2, 3, 1, V(MINE), 3),
        Flip(1, 2, 0), Flip(1, 2, 1), Flip(2, 3, 0), Flip(2, 3, 1),
    };
    var r = Room(1, "fanqi");
    var st = FanqiRules.Replay(guarded);
    T("前提：1 雷存活扛旗受保护", st.Settled && FanqiRules.MinesAlive(st, 2), $"c1={st.ColorOf1} c2={st.ColorOf2}");
    r.Turn = 1;
    var e1 = Err(() => FanqiRules.ValidateMove(guarded, r, 1, MoveReq(2, 0, 3, 0)));   // 普通子碰旗
    var e2 = Err(() => FanqiRules.ValidateMove(guarded, r, 1, MoveReq(2, 1, 3, 0)));   // 炸弹碰旗
    T("清 2 枚（剩 1 雷）普通子碰旗被拒", e1 == "对方地雷未清，不能扛军旗", $"e1={e1}");
    T("清 2 枚（剩 1 雷）炸弹碰旗同样被拒（不夺旗）", e2 == "对方地雷未清，不能扛军旗", $"e2={e2}");
}
{
    // 三雷全清：炸弹碰旗 = 夺旗（战斗表「任何棋子→军旗（三雷已清）夺旗」，含炸弹）
    // (2,0) 红炸弹、(2,1) 红司令、(1,0) 红军旗；(3,0) 蓝军旗。P1 连翻两红（司令+炸弹）定阵营。
    var cleared = new List<GameEvent>
    {
        Setup(1, 2, 0, V(BOMB), 0), Setup(1, 2, 1, V(CMD), 1), Setup(1, 1, 0, V(FLAG), 3),
        Setup(2, 3, 0, V(FLAG), 2),
        Flip(1, 2, 1), Flip(2, 3, 0), Flip(1, 2, 0),
    };
    var r = Room(1, "fanqi");
    var st = FanqiRules.Replay(cleared);
    T("前提：三雷已清、阵营已定", st.Settled && !FanqiRules.MinesAlive(st, 2), $"c1={st.ColorOf1} c2={st.ColorOf2}");
    r.Turn = 1;
    var battle = FanqiRules.ValidateMove(cleared, r, 1, MoveReq(2, 0, 3, 0));
    T("炸弹碰旗结算=flag_captured（不是 both_die）", battle.t == "battle" && battle.result == "flag_captured",
        $"t={battle.t} result={battle.result}");
    var after = cleared.Concat(new List<GameEvent> { battle }).ToList();
    var j = FanqiRules.Judge(after, Room(1, "fanqi"));
    T("夺旗后 Judge 判 P1 胜", j.over && j.winner == 1 && j.reason == "flag_captured", $"w={j.winner} r={j.reason}");
}

// ============================================================
// B1 军旗仅剩军旗+地雷（无子可动 / 纯困子）——暗棋 AI 不崩不非法
// ============================================================
Console.WriteLine("[B1] 军棋仅剩军旗+地雷被封 → Think null 不崩；blocked 判负");
{
    var r = Room(1, "dark");
    var evs = new List<GameEvent>
    {
        Setup(2, 1, 0, V(FLAG), 25), Setup(2, 2, 0, V(MINE), 26),   // side2 只剩军旗+地雷（均不可动）
        Setup(1, 1, 11, V(FLAG), 0), Setup(1, 2, 9, V(CMD), 1),     // side1 正常子力
    };
    var engine = GameEngines.Get("armychess");
    var think2 = engine.Think(evs, 2, 2, r);
    T("side2（军旗+地雷）Think 返回 null 不崩", think2 is null, $"think={think2?.GetRawText()}");
    var think1 = engine.Think(evs, 1, 2, r);
    var moves1 = engine.AllMoves(evs, r, 1);
    T("side1 Think 必出合法着", think1 is not null && moves1 is not null && moves1.Any(m =>
        m.GetProperty("fx").GetInt32() == think1.Value.GetProperty("fx").GetInt32()
        && m.GetProperty("fy").GetInt32() == think1.Value.GetProperty("fy").GetInt32()
        && m.GetProperty("tx").GetInt32() == think1.Value.GetProperty("tx").GetInt32()
        && m.GetProperty("ty").GetInt32() == think1.Value.GetProperty("ty").GetInt32()),
        $"think={think1?.GetRawText()} moves={moves1?.Count}");
    var j = ArmyChessRules.Judge(evs, r);
    T("Judge：side2 无子可动判负（blocked）", j.over && j.winner == 1 && j.reason == "blocked", $"w={j.winner} r={j.reason}");
}
{
    // 纯困子：side2 = 军旗 + 一枚被己方地雷完全封死的排长
    var r = Room(1, "dark");
    var evs = new List<GameEvent> { Setup(2, 1, 0, V(FLAG), 25), Setup(2, 0, 0, V(PLT), 26), Setup(1, 1, 11, V(FLAG), 0), Setup(1, 2, 9, V(CMD), 1) };
    var board = ArmyChessRules.Replay(evs);
    var targets = ArmyChessBoard.Reachable(board, ArmyChessBoard.Node(0, 0), 2);
    var id = 27;
    foreach (var node in targets)
    {
        var (x, y) = ArmyChessBoard.Coord(node);
        if (board[x, y] != 0) continue;
        evs.Add(Setup(2, x, y, V(MINE), id++));   // 用己方地雷把排长的所有落点堵死
    }
    var board2 = ArmyChessRules.Replay(evs);
    T("前提：排长落点全被己方封死", !ArmyChessBoard.HasAnyMove(board2, 2), $"targets={targets.Count}");
    var engine = GameEngines.Get("armychess");
    var think2 = engine.Think(evs, 2, 2, r);
    T("纯困子 Think 返回 null 不崩", think2 is null, $"think={think2?.GetRawText()}");
    var j = ArmyChessRules.Judge(evs, r);
    T("纯困子并入无合法着法判负（blocked）", j.over && j.winner == 1 && j.reason == "blocked", $"w={j.winner} r={j.reason}");
}

// ============================================================
// B2 军棋 Think 红线差分（随机布阵 + 随机行走）
// ============================================================
Console.WriteLine("[B2] 军棋 Think 红线差分（AllMoves 非空必出合法着）");
{
    var r = Room(1, "dark");
    var engine = GameEngines.Get("armychess");
    var bad = 0; var checkedCount = 0; var singleSeen = 0;
    for (var g = 0; g < 25; g++)
    {
        var evs = ArmyChessRules.RandomSideSetup(1, 0).Concat(ArmyChessRules.RandomSideSetup(2, 25)).ToList();
        for (var leg = 0; leg < 4; leg++)
        {
            foreach (var side in new[] { 1, 2 })
            {
                var moves = engine.AllMoves(evs, r, side);
                var think = engine.Think(evs, side, 2, r);
                checkedCount++;
                if (moves is null || moves.Count == 0)
                {
                    if (think is not null) bad++;
                    continue;
                }
                if (think is null) { bad++; continue; }
                var inSet = moves.Any(m =>
                    m.GetProperty("fx").GetInt32() == think.Value.GetProperty("fx").GetInt32()
                    && m.GetProperty("fy").GetInt32() == think.Value.GetProperty("fy").GetInt32()
                    && m.GetProperty("tx").GetInt32() == think.Value.GetProperty("tx").GetInt32()
                    && m.GetProperty("ty").GetInt32() == think.Value.GetProperty("ty").GetInt32());
                if (!inSet) bad++;
                if (moves.Count == 1)
                {
                    singleSeen++;
                    var m0 = moves[0];
                    if (m0.GetProperty("fx").GetInt32() != think.Value.GetProperty("fx").GetInt32()
                        || m0.GetProperty("tx").GetInt32() != think.Value.GetProperty("tx").GetInt32()) bad++;
                }
                // Think 着必须被 ValidateMove 接受（红线：绝不非法着）
                r.Turn = side;
                try
                {
                    var ev = engine.ValidateMove(evs, r, side, think.Value);
                    evs.Add(ev);
                }
                catch (Exception e) { bad++; Console.WriteLine($"    ValidateMove 拒绝 Think 着：{e.Message}"); }
            }
        }
    }
    T($"军棋 Think 红线 25 局×4 腿×双方（{checkedCount} 次）零违规", bad == 0, $"bad={bad}（唯一着出现 {singleSeen} 次）");
}

// ============================================================
// B3 翻棋阵营未定只能翻 → Think 必给翻子着
// ============================================================
Console.WriteLine("[B3] 翻棋阵营未定：Think 必给翻子着、走子被拒");
{
    var evs = new List<GameEvent>
    {
        Setup(1, 2, 0, V(CMD), 0), Setup(2, 0, 1, V(PLT), 1), Setup(2, 4, 0, V(DIV), 2),
        Setup(1, 0, 0, V(PLT), 3),   // 留一枚暗子
        Flip(1, 2, 0), Flip(2, 0, 1), Flip(1, 4, 0),   // P1 红、P2 蓝、P1 蓝 → 未定
    };
    var r = Room(1, "fanqi");
    var st = FanqiRules.Replay(evs);
    T("前提：阵营未定且有暗子", !st.Settled, $"c1={st.ColorOf1} c2={st.ColorOf2}");
    var acts = FanqiRules.AllActions(evs, r, 1);
    T("AllActions 只含翻子", acts.Count > 0 && acts.All(a => !a.TryGetProperty("fx", out _)), $"n={acts.Count}");
    var think = FanqiRules.Think(evs, r, 1, 2);
    T("Think 必返回翻子着", think is not null && !think.Value.TryGetProperty("fx", out _), $"think={think?.GetRawText()}");
    if (think is not null)
    {
        r.Turn = 1;
        var e = Err(() => FanqiRules.ValidateMove(evs, r, 1, think.Value));
        T("Think 翻子着被 ValidateMove 接受", e == "", $"err={e}");
    }
    r.Turn = 1;
    var e2 = Err(() => FanqiRules.ValidateMove(evs, r, 1, MoveReq(2, 0, 3, 0)));
    T("未定阵营走子被拒（文案对）", e2 == "阵营还没确定，只能翻子", $"e2={e2}");
}

// ============================================================
// B4 翻棋阵营未定且无可翻 → Think null 不崩；blocked 判负
// ============================================================
Console.WriteLine("[B4] 翻棋阵营未定且无可翻 → Think=null 不崩");
{
    var evs = new List<GameEvent>
    {
        Setup(1, 1, 0, V(FLAG), 0), Setup(2, 3, 0, V(FLAG), 1), Setup(2, 2, 0, V(PLT), 2), Setup(1, 0, 0, V(PLT), 3),
        Flip(1, 1, 0),   // P1 翻红
        Flip(2, 3, 0),   // P2 翻蓝
        Flip(1, 2, 0),   // P1 翻蓝 → 未定
        Flip(2, 0, 0),   // P2 翻红 → 未定
    };
    var r = Room(1, "fanqi");
    var st = FanqiRules.Replay(evs);
    T("前提：未定且无暗子", !st.Settled && FanqiRules.AllActions(evs, r, 1).Count == 0, $"settled={st.Settled}");
    JsonElement? t1 = null, t2 = null; var crash = "";
    try { t1 = FanqiRules.Think(evs, r, 1, 2); t2 = FanqiRules.Think(evs, r, 2, 2); }
    catch (Exception e) { crash = e.Message; }
    T("双方 Think=null 不崩不出非法着", crash == "" && t1 is null && t2 is null, $"crash={crash} t1={t1?.GetRawText()} t2={t2?.GetRawText()}");
    var j = FanqiRules.Judge(evs, r);   // r.Turn=1 → 下一家 P2 无任何操作 → P2 负
    T("Judge：无可翻无可走 → blocked 判负", j.over && j.winner == 1 && j.reason == "blocked", $"w={j.winner} r={j.reason}");
}

// ============================================================
// B5 翻棋已定阵营，一方只剩军旗+地雷 → annihilate；劣势方 Think 不崩
// ============================================================
Console.WriteLine("[B5] 翻棋歼灭可动子判定 + 劣势方 Think 不崩");
{
    // 红方存活子只有 军旗+地雷（P1 连翻的两枚就是它们）；蓝方有可动司令+军旗；全翻揭示
    var evs = new List<GameEvent>
    {
        Setup(1, 1, 0, V(FLAG), 0), Setup(1, 0, 0, V(MINE), 1),      // 红只剩军旗+地雷
        Setup(2, 3, 0, V(CMD), 2), Setup(2, 3, 1, V(FLAG), 3),       // 蓝有可动子 + 军旗
        Flip(1, 1, 0), Flip(1, 0, 0),                                 // P1 连翻两红（旗+雷）→ 执红
        Flip(2, 3, 0), Flip(2, 3, 1),                                 // 全部揭示
    };
    var r = Room(1, "fanqi");
    var st = FanqiRules.Replay(evs);
    var redMobile = 0;
    for (var x = 0; x < ArmyChessRules.BoardW; x++)
        for (var y = 0; y < ArmyChessRules.BoardH; y++)
        {
            var p = st.Board[x, y];
            if (p != 0 && ArmyChessRules.PieceSide(p) == 1
                && ArmyChessRules.PieceRank(p) is not (ArmyChessRules.RANK_MINE or ArmyChessRules.RANK_FLAG)) redMobile++;
        }
    T("前提：已定阵营、红只剩军旗+地雷", st.Settled && redMobile == 0, $"c1={st.ColorOf1} c2={st.ColorOf2} redMobile={redMobile}");
    var j = FanqiRules.Judge(evs, r);
    T("Judge：歼灭可动子 → 蓝方（P2）胜 annihilate", j.over && j.winner == 2 && j.reason == "annihilate", $"w={j.winner} r={j.reason}");
    JsonElement? t1 = null; var crash = "";
    try { t1 = FanqiRules.Think(evs, r, 1, 2); } catch (Exception e) { crash = e.Message; }
    T("劣势方（红）Think=null 不崩", crash == "" && t1 is null, $"crash={crash} t1={t1?.GetRawText()}");
    var t2 = FanqiRules.Think(evs, r, 2, 2);
    T("优势方（蓝）Think 必出着", t2 is not null, $"t2={t2?.GetRawText()}");
    if (t2 is not null)
    {
        r.Turn = 2;
        var e = Err(() => FanqiRules.ValidateMove(evs, r, 2, t2.Value));
        T("蓝方 Think 着合法", e == "", $"err={e}");
    }
}

// ============================================================
// B6 飞行棋四机全在场但骰点全不合法 → Think=null 不崩
// ============================================================
Console.WriteLine("[B6] 飞行棋四机全在场但骰点全不合法 → Think=null 不崩");
{
    var r = Room(1, "ludo");
    // a) 四机全在机库、骰点≠6
    var evs = new List<GameEvent> { new() { t = "roll", s = 1, v = 3 } };
    JsonElement? think = null; var crash = "";
    try { think = LudoRules.Think(evs, 1, 2, r); } catch (Exception e) { crash = e.Message; }
    T("四机在机库 骰点3 → Think=null 不崩", crash == "" && think is null, $"crash={crash} t={think?.GetRawText()}");
    T("HasAnyValidMove=false（合法空过）", !LudoRules.HasAnyValidMove(evs, 1, 3), "");

    // b) 三机已归巢、一机在机库、骰点≠6 → 依然无着
    var evsB = new List<GameEvent>();
    evsB.AddRange(LudoMarch(evsB, 1, 0, LudoRules.CenterPos));
    evsB.AddRange(LudoMarch(evsB, 1, 1, LudoRules.CenterPos));
    evsB.AddRange(LudoMarch(evsB, 1, 2, LudoRules.CenterPos));
    var b = LudoRules.Replay(evsB);
    T("前提：0/1/2 号已归巢、3 号在机库", b[1, 0] == LudoRules.CenterPos && b[1, 3] == -1, $"p0={b[1, 0]} p3={b[1, 3]}");
    evsB.Add(new GameEvent { t = "roll", s = 1, v = 4 });
    JsonElement? thinkB = null; crash = "";
    try { thinkB = LudoRules.Think(evsB, 1, 2, r); } catch (Exception e) { crash = e.Message; }
    T("三机归巢+机库机 骰点4 → Think=null 不崩（骰点全不合法）", crash == "" && thinkB is null, $"crash={crash} t={thinkB?.GetRawText()}");
    T("HasAnyValidMove=false", !LudoRules.HasAnyValidMove(evsB, 1, 4), "");

    // c) 对照：同样局面骰点 6 → Think 必给起飞着且合法
    evsB.RemoveAt(evsB.Count - 1);
    evsB.Add(new GameEvent { t = "roll", s = 1, v = 6 });
    var t6 = LudoRules.Think(evsB, 1, 2, r);
    T("对照 骰点6 → Think 必给起飞着", t6 is not null && t6.Value.GetProperty("p").GetInt32() == 3, $"t={t6?.GetRawText()}");
    if (t6 is not null)
    {
        var mv = LudoRules.ValidateMove(evsB, r, 1, t6.Value);
        T("起飞着被 ValidateMove 接受", mv.t == "move" && mv.p == 3, $"t={mv.t} p={mv.p}");
    }
}

// ============================================================
// B7 飞行棋唯一可动机 → Think 必返回该机
// ============================================================
Console.WriteLine("[B7] 飞行棋唯一可动机 → Think 必返回该机");
{
    var r = Room(1, "ludo");
    var evs = LudoMarch(new List<GameEvent>(), 1, 0, 10);   // 0 号推进到主环 10（其余三机在机库）
    var b = LudoRules.Replay(evs);
    T("前提：0 号在主环、其余在机库", b[1, 0] == 10 && b[1, 1] == -1 && b[1, 2] == -1 && b[1, 3] == -1, $"p0={b[1, 0]}");
    evs.Add(new GameEvent { t = "roll", s = 1, v = 2 });   // 骰点≠6：机库机不可动
    var mov = LudoRules.MovablePieces(evs, r, 1);
    T("唯一可动机=0 号", mov.Count == 1 && mov[0] == 0, $"mov=[{string.Join(",", mov)}]");
    var think = LudoRules.Think(evs, 1, 2, r);
    T("Think 必返回 0 号", think is not null && think.Value.GetProperty("p").GetInt32() == 0, $"t={think?.GetRawText()}");
    if (think is not null)
    {
        var mv = LudoRules.ValidateMove(evs, r, 1, think.Value);
        T("唯一着合法", mv.t == "move" && mv.p == 0, $"t={mv.t} p={mv.p}");
    }
}

// ============================================================
// B8 飞行棋「归巢」优先（偏差③行为固化：归巢 > 起飞 > 撞子）
// ============================================================
Console.WriteLine("[B8] 飞行棋「归巢」优先（偏差③行为固化）");
{
    var r = Room(1, "ludo");
    // 0 号在航道 52（骰 6 归巢）；1 号在主环 8（骰 6 途经落 14 撞敌机）；
    // 敌机（side2 0 号）在 14；2/3 号在机库（骰 6 可起飞）
    var evs = new List<GameEvent>();
    evs.AddRange(LudoMarch(evs, 1, 0, 52));
    evs.AddRange(LudoMarch(evs, 1, 1, 8));
    evs.AddRange(LudoMarch(evs, 2, 0, 14));
    var b = LudoRules.Replay(evs);
    T("前提摆位：p0=52(航道) p1=8 敌机=14", b[1, 0] == 52 && b[1, 1] == 8 && b[2, 0] == 14,
        $"p0={b[1, 0]} p1={b[1, 1]} e0={b[2, 0]}");
    evs.Add(new GameEvent { t = "roll", s = 1, v = 6 });
    var mov = LudoRules.MovablePieces(evs, r, 1);
    T("候选含 归巢/撞子/起飞 三类", mov.Contains(0) && mov.Contains(1) && mov.Contains(2) && mov.Contains(3), $"mov=[{string.Join(",", mov)}]");
    var think = LudoRules.Think(evs, 1, 2, r);
    T("Think 选 0 号（归巢 > 起飞 > 撞子）", think is not null && think.Value.GetProperty("p").GetInt32() == 0, $"t={think?.GetRawText()}");
    if (think is not null)
    {
        var mv = LudoRules.ValidateMove(evs, r, 1, think.Value);
        T("归巢着合法", mv.t == "move" && mv.p == 0, $"t={mv.t} p={mv.p}");
    }
}

// ============================================================
// B9 随机对局红线压测（翻棋 + 飞行棋）
// ============================================================
Console.WriteLine("[B9] 随机对局红线压测（有合法操作必出着且合法）");
{
    // 翻棋 30 局
    var badF = 0; var stepsF = 0;
    for (var g = 0; g < 30; g++)
    {
        var r = Room(1, "fanqi");
        var evs = FanqiRules.InitialEvents(r);
        var actor = 1;
        for (var step = 0; step < 120; step++)
        {
            r.Turn = actor;
            var acts = FanqiRules.AllActions(evs, r, actor);
            if (acts.Count == 0) break;
            var think = FanqiRules.Think(evs, r, actor, 2);
            if (think is null) { badF++; break; }
            try
            {
                var ev = FanqiRules.ValidateMove(evs, r, actor, think.Value);
                evs.Add(ev);
                stepsF++;
            }
            catch (Exception e) { badF++; Console.WriteLine($"    局{g} 步{step} Think 着被拒：{e.Message}"); break; }
            var j = FanqiRules.Judge(evs, r);
            if (j.over) break;
            actor = actor == 1 ? 2 : 1;
        }
    }
    T($"翻棋 30 局红线压测零违规（推进 {stepsF} 步）", badF == 0, $"bad={badF}");

    // 飞行棋 10 局 × 双方随机骰点
    var badL = 0; var stepsL = 0;
    for (var g = 0; g < 10; g++)
    {
        var r = Room(1, "ludo");
        var evs = new List<GameEvent>();
        for (var step = 0; step < 60; step++)
        {
            var side = step % 2 == 0 ? 1 : 2;
            var roll = Random.Shared.Next(1, 7);
            r.Turn = side;
            evs.Add(new GameEvent { t = "roll", s = side, v = roll });
            var can = LudoRules.HasAnyValidMove(evs, side, roll);
            var think = LudoRules.Think(evs, side, 2, r);
            if (!can)
            {
                if (think is not null) { badL++; Console.WriteLine($"    局{g} 步{step} 无合法着却出着 {think?.GetRawText()}"); }
                evs.Add(new GameEvent { t = "pass", s = side });
                continue;
            }
            if (think is null) { badL++; Console.WriteLine($"    局{g} 步{step} 有合法着却 null（roll={roll}）"); continue; }
            try
            {
                var ev = LudoRules.ValidateMove(evs, r, side, think.Value);
                evs.Add(ev);
                stepsL++;
            }
            catch (Exception e) { badL++; Console.WriteLine($"    局{g} 步{step} Think 着被拒：{e.Message}"); }
        }
    }
    T($"飞行棋 10 局红线压测零违规（推进 {stepsL} 步）", badL == 0, $"bad={badL}");
}

Console.WriteLine();
Console.WriteLine($"== 结果：{pass} 通过 / {fail} 失败 ==");
return fail;
