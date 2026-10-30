// fanqi_unit —— 翻棋（T04b）规则单测 + AI 红线测试（B4 验收证据）。
// 规则唯一依据 docs/research/2026-10-30-fanqi-rules.md。
// 直接驱动 CheckinApp.Services.FanqiRules / ArmyChessEngine 纯函数：
// 布阵 / 阵营状态机 / 翻子校验 / 走子校验（含反泄露文案顺序）/ 战斗表全分支 /
// 三雷前置扛旗 / 胜负三判定 / 60 手和棋 / 快照反泄露 / AI 红线（Think 非空且合法）。
// 用法：dotnet run（退出码 = 失败数，0 = 全绿）
using System.Text.Json;
using CheckinApp.Models;
using CheckinApp.Services;

int pass = 0, fail = 0;

void T(string name, bool cond, string detail = "")
{
    if (cond) { pass++; Console.WriteLine($"  PASS  {name}"); }
    else { fail++; Console.WriteLine($"  FAIL  {name}  {detail}"); }
}

GameRoom Room(int turn = 1, string mode = "fanqi") =>
    new() { Code = "FQ001", GameKey = "armychess", Mode = mode, Turn = turn, Status = "playing", HostUserId = 1, AiLevel = 0 };

GameEvent Setup(int color, int x, int y, int value, int id) =>
    new() { t = "setup", s = color, x = x, y = y, v = value, p = id };

GameEvent Flip(int s, int x, int y) => new() { t = "flip", s = s, x = x, y = y };
GameEvent Move(int s, int fx, int fy, int tx, int ty) => new() { t = "move", s = s, fx = fx, fy = fy, tx = tx, ty = ty };
GameEvent Battle(int s, string att, string def, string result, int fx, int fy, int tx, int ty) =>
    new() { t = "battle", s = s, att = att, def = def, result = result, fx = fx, fy = fy, tx = tx, ty = ty };

int V(string rank) => ArmyChessRules.RankValue(rank);
const string R = ArmyChessRules.RANK_ENGINEER;
const string MINE = ArmyChessRules.RANK_MINE;
const string FLAG = ArmyChessRules.RANK_FLAG;
const string BOMB = ArmyChessRules.RANK_BOMB;
const string CMD = ArmyChessRules.RANK_COMMANDER;
const string ARMY = ArmyChessRules.RANK_ARMY;
const string DIV = ArmyChessRules.RANK_DIVISION;
const string PLT = ArmyChessRules.RANK_PLATOON;

JsonElement MoveReq(int fx, int fy, int tx, int ty) => JsonSerializer.SerializeToElement(new { fx, fy, tx, ty });
JsonElement FlipReq(int x, int y) => JsonSerializer.SerializeToElement(new { x, y });

// 已定阵营基础局：P1 连翻两枚红子 → P1=红(1)、P2=蓝(2)
List<GameEvent> SettledBase()
{
    return
    [
        Setup(1, 2, 0, V(R), 0),
        Setup(1, 2, 1, V(PLT), 1),
        Flip(1, 2, 0),
        Flip(1, 2, 1),
    ];
}

string Err(Func<object> act)
{
    try { act(); return ""; }
    catch (CheckinApp.Api.ApiBadRequest e) { return e.Message; }
    catch (Exception e) { return "非 ApiBadRequest: " + e.GetType().Name; }
}

Console.WriteLine("== T04b 翻棋规则单测（FanqiRules）==");

// ---------------- 1. 布阵 ----------------
Console.WriteLine("[1] 初始布阵（50 枚混洗暗放）");
{
    var r = Room();
    var evs = FanqiRules.InitialEvents(r);
    T("50 枚 setup 事件", evs.Count == 50 && evs.All(e => e.t == "setup"), $"n={evs.Count}");
    T("每色 25 枚", evs.Count(e => e.s == 1) == 25 && evs.Count(e => e.s == 2) == 25);
    T("全部落在非行营格", evs.All(e => ArmyChessRules.CellType(e.x!.Value, e.y!.Value) != ArmyChessRules.Camp));
    T("无重合格", evs.Select(e => (e.x!.Value, e.y!.Value)).Distinct().Count() == 50);
    T("piece id 0..49 唯一", evs.Select(e => e.p!.Value).OrderBy(x => x).SequenceEqual(Enumerable.Range(0, 50)));
    var specOk = true;
    foreach (var (rank, count) in ArmyChessRules.SpecCounts())
    {
        if (evs.Count(e => e.s == 1 && e.v == V(rank)) != count) specOk = false;
        if (evs.Count(e => e.s == 2 && e.v == V(rank)) != count) specOk = false;
    }
    T("每色配比 = 明棋 PieceSpec", specOk);
}

// ---------------- 2. 阵营状态机 ----------------
Console.WriteLine("[2] 阵营状态机（连续两翻同色）");
{
    // 连续两翻同色 → 定阵营
    var evs = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 2, 1, V(PLT), 1),
        Flip(1, 2, 0), Flip(1, 2, 1),
    };
    var st = FanqiRules.Replay(evs);
    T("P1 连翻两红 → P1=红、P2=蓝", st.ColorOf1 == 1 && st.ColorOf2 == 2 && st.Settled, $"{st.ColorOf1},{st.ColorOf2}");

    // 交替翻不同色 → 未定
    var alt = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(2, 2, 1, V(PLT), 1),
        Setup(1, 2, 2, V(R), 2), Setup(2, 2, 3, V(PLT), 3),
        Flip(1, 2, 0), Flip(1, 2, 1), Flip(1, 2, 2), Flip(1, 2, 3),
    };
    var st2 = FanqiRules.Replay(alt);
    T("红蓝红蓝四翻 → 阵营未定", !st2.Settled && st2.ColorOf1 == 0, $"{st2.ColorOf1},{st2.ColorOf2}");

    // 交替后再连翻同色 → 定
    var alt2 = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(2, 2, 1, V(PLT), 1),
        Setup(1, 2, 2, V(R), 2), Setup(1, 3, 0, V(PLT), 3),
        Flip(1, 2, 0), Flip(1, 2, 1), Flip(1, 2, 2), Flip(1, 3, 0),
    };
    var st3 = FanqiRules.Replay(alt2);
    T("红蓝红红 → P1=红", st3.ColorOf1 == 1 && st3.ColorOf2 == 2, $"{st3.ColorOf1},{st3.ColorOf2}");

    // 双方各自计数：P1 红红定红后，P2 的翻子不改阵营
    var p2 = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 2, 1, V(PLT), 1),
        Setup(2, 3, 0, V(R), 2), Setup(2, 3, 1, V(PLT), 3),
        Flip(1, 2, 0), Flip(1, 2, 1), Flip(2, 3, 0), Flip(2, 3, 1),
    };
    var st4 = FanqiRules.Replay(p2);
    T("已定后对方连翻同色不改判", st4.ColorOf1 == 1 && st4.ColorOf2 == 2, $"{st4.ColorOf1},{st4.ColorOf2}");

    // 跨玩家同色相邻两翻不算连续
    var cross = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 3, 0, V(PLT), 1),
        Flip(1, 2, 0), Flip(2, 3, 0),
    };
    var st5 = FanqiRules.Replay(cross);
    T("跨玩家同色不算连续", !st5.Settled, $"{st5.ColorOf1},{st5.ColorOf2}");
}

// ---------------- 3. 翻子校验 ----------------
Console.WriteLine("[3] 翻子校验");
{
    var evs = SettledBase();   // (2,0)(2,1) 已翻
    evs.Add(Setup(2, 3, 1, V(CMD), 2));   // 暗子
    var r = Room(1);
    T("越界被拒", Err(() => FanqiRules.ValidateMove(evs, r, 1, FlipReq(-1, 0))) == "位置不合法");
    T("空格被拒", Err(() => FanqiRules.ValidateMove(evs, r, 1, FlipReq(4, 4))) == "这里没有棋子", Err(() => FanqiRules.ValidateMove(evs, r, 1, FlipReq(4, 4))));
    T("已翻开再翻被拒", Err(() => FanqiRules.ValidateMove(evs, r, 1, FlipReq(2, 0))) == "这枚棋子已经翻开了");
    var ok = FanqiRules.ValidateMove(evs, r, 1, FlipReq(3, 1));
    T("合法翻子出 flip 事件", ok.t == "flip" && ok.x == 3 && ok.y == 1, ok.t);
}

// ---------------- 4. 走子校验分支 ----------------
Console.WriteLine("[4] 走子校验（与 ValidateMove 同级严格 + 反泄露文案）");
{
    // 4a 阵营未定只能翻
    var unset = new List<GameEvent> { Setup(1, 2, 0, V(R), 0), Flip(1, 2, 0) };
    T("阵营未定走子被拒", Err(() => FanqiRules.ValidateMove(unset, Room(1), 1, MoveReq(2, 0, 3, 0))) == "阵营还没确定，只能翻子");

    // 4b 暗子不能移动（暗子己色也不给颜色差异文案）
    var darkFrom = SettledBase();
    darkFrom.Add(Setup(1, 3, 1, V(CMD), 2));   // 己色暗子
    T("暗子不能移动（不泄露颜色）", Err(() => FanqiRules.ValidateMove(darkFrom, Room(1), 1, MoveReq(3, 1, 3, 0))) == "暗子不能移动");
    var darkEnemy = SettledBase();
    darkEnemy.Add(Setup(2, 3, 1, V(CMD), 2));   // 敌色暗子
    T("敌色暗子同样只报暗子", Err(() => FanqiRules.ValidateMove(darkEnemy, Room(1), 1, MoveReq(3, 1, 3, 0))) == "暗子不能移动");

    // 4c 非己色（已翻开敌子）
    var enemyFrom = SettledBase();
    enemyFrom.AddRange(
    [
        Setup(2, 3, 1, V(CMD), 2), Flip(2, 3, 1),
    ]);
    T("动敌子被拒", Err(() => FanqiRules.ValidateMove(enemyFrom, Room(1), 1, MoveReq(3, 1, 3, 0))) == "这不是你的棋子");

    // 4d 军旗/地雷不能动
    var flagMine = SettledBase();
    flagMine.AddRange(
    [
        Setup(1, 4, 0, V(FLAG), 2), Setup(1, 4, 1, V(MINE), 3),
        Flip(1, 4, 0), Flip(1, 4, 1),
    ]);
    T("军旗不能动", Err(() => FanqiRules.ValidateMove(flagMine, Room(1), 1, MoveReq(4, 0, 3, 0))) == "军旗不能动");
    T("地雷不能动", Err(() => FanqiRules.ValidateMove(flagMine, Room(1), 1, MoveReq(4, 1, 3, 1))) == "地雷不能动");

    // 4e 不能攻击暗子（不泄露暗子颜色）
    var darkTarget = SettledBase();
    darkTarget.Add(Setup(2, 3, 0, V(CMD), 2));
    T("攻击暗子被拒", Err(() => FanqiRules.ValidateMove(darkTarget, Room(1), 1, MoveReq(2, 0, 3, 0))) == "不能攻击暗子");

    // 4f 不能吃自己的子
    T("吃自己被拒", Err(() => FanqiRules.ValidateMove(SettledBase(), Room(1), 1, MoveReq(2, 0, 2, 1))) == "不能吃自己的棋子");

    // 4g 行营里的棋子不能被吃：P2 司令在行营 (1,2)，P1 (0,2) 攻击
    var campTarget = new List<GameEvent>
    {
        Setup(1, 0, 2, V(PLT), 0), Setup(1, 2, 0, V(R), 1),
        Setup(2, 1, 2, V(CMD), 2),
        Flip(1, 0, 2), Flip(1, 2, 0), Flip(2, 1, 2),
    };
    // (0,2)→(1,2)：公路一步，(1,2) 是行营
    T("行营子不可吃", Err(() => FanqiRules.ValidateMove(campTarget, Room(1), 1, MoveReq(0, 2, 1, 2))) == "行营里的棋子不能被吃");

    // 4h 三雷前置：雷存活时扛旗被拒
    var guardFlag = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 2, 1, V(PLT), 1),
        Setup(2, 3, 0, V(FLAG), 2),
        Setup(2, 0, 0, V(MINE), 3), Setup(2, 0, 1, V(MINE), 4), Setup(2, 0, 2, V(MINE), 5),
        Flip(1, 2, 0), Flip(1, 2, 1), Flip(2, 3, 0),
    };
    T("三雷未清扛旗被拒", Err(() => FanqiRules.ValidateMove(guardFlag, Room(1), 1, MoveReq(2, 0, 3, 0))) == "对方地雷未清，不能扛军旗");

    // 4i 走法不合法（隔空跳）
    T("走法不合法被拒", Err(() => FanqiRules.ValidateMove(SettledBase(), Room(1), 1, MoveReq(2, 0, 4, 0))) == "走法不合法");
    T("原地不动被拒", Err(() => FanqiRules.ValidateMove(SettledBase(), Room(1), 1, MoveReq(2, 0, 2, 0))) == "不能原地不动");

    // 4j 合法走子出 move 事件
    var mv = FanqiRules.ValidateMove(SettledBase(), Room(1), 1, MoveReq(2, 0, 3, 0));
    T("合法走子出 move 事件", mv.t == "move" && mv.fx == 2 && mv.tx == 3, mv.t);
}

// ---------------- 5. 战斗表（全分支） ----------------
Console.WriteLine("[5] 战斗结算表");
{
    List<GameEvent> Duel(string att, string def, int attColor = 1, int defColor = 2) =>
    [
        Setup(attColor, 2, 0, V(att), 0), Setup(defColor, 3, 0, V(def), 1),
    ];
    var r = Room(1);

    GameEvent Resolve(string att, string def) =>
        ArmyChessRules.ResolveBattle(Duel(att, def), r, 1, 2, 0, 3, 0).battle!;

    T("大吃小：司令吃军长", Resolve(CMD, ARMY).result == "attacker_wins");
    T("小吃大：军长攻司令攻方亡", Resolve(ARMY, CMD).result == "defender_wins");
    T("同级双亡", Resolve(DIV, DIV).result == "both_die");
    T("炸弹撞司令双亡", Resolve(BOMB, CMD).result == "both_die");
    T("工兵排雷", Resolve(R, MINE).result == "attacker_wins");
    T("炸弹炸雷双亡", Resolve(BOMB, MINE).result == "both_die");
    T("其他撞雷攻方亡", Resolve(PLT, MINE).result == "defender_wins");
    T("任何子碰军旗 = 夺旗", Resolve(CMD, FLAG).result == "flag_captured");
    T("炸弹碰军旗也是夺旗（雷清后）", Resolve(BOMB, FLAG).result == "flag_captured");

    // 小攻大是合法走法（攻方亡，不是拒走）：(2,0) 排长 → (3,0) 师长
    var small = new List<GameEvent>
    {
        Setup(1, 2, 0, V(PLT), 0), Setup(1, 2, 1, V(R), 1),
        Setup(2, 3, 0, V(DIV), 2),
        Flip(1, 2, 0), Flip(1, 2, 1), Flip(2, 3, 0),
    };
    var smallEv = FanqiRules.ValidateMove(small, Room(1), 1, MoveReq(2, 0, 3, 0));
    T("小攻大合法走法（出 battle、攻方亡）", smallEv.t == "battle" && smallEv.result == "defender_wins", smallEv.t + "/" + smallEv.result);
}

// ---------------- 6. 三雷前置 + 夺旗 ----------------
Console.WriteLine("[6] 三雷前置扛旗");
{
    // 排雷后（3 枚被工兵 battle 清掉）→ 可扛旗
    var cleared = new List<GameEvent>
    {
        Setup(1, 2, 0, V(PLT), 0), Setup(1, 2, 2, V(R), 1),
        Setup(2, 3, 0, V(FLAG), 2),
        Setup(2, 0, 0, V(MINE), 3), Setup(2, 0, 1, V(MINE), 4), Setup(2, 1, 0, V(MINE), 5),
        Flip(1, 2, 0), Flip(1, 2, 2), Flip(2, 3, 0),
        // 工兵连排三雷（battle 事件落盘：从工兵实际位置推进）
        Battle(1, R, MINE, "attacker_wins", 2, 2, 1, 0),
        Battle(1, R, MINE, "attacker_wins", 1, 0, 0, 0),
        Battle(1, R, MINE, "attacker_wins", 0, 0, 0, 1),
    };
    T("三雷清完 MinesAlive=false", !FanqiRules.MinesAlive(FanqiRules.Replay(cleared), 2));
    var cap = FanqiRules.ValidateMove(cleared, Room(1), 1, MoveReq(2, 0, 3, 0));
    T("雷清后扛旗合法（flag_captured）", cap.t == "battle" && cap.result == "flag_captured", cap.t + "/" + cap.result);
}

// ---------------- 7. 胜负判定 ----------------
Console.WriteLine("[7] 胜负判定");
{
    // 夺旗：P1 扛走 P2 军旗 → P1 胜（双方各有旗，判定先查旗）
    var capped = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 4, 4, V(FLAG), 1),
        Setup(2, 3, 0, V(FLAG), 2),
        Flip(1, 2, 0), Flip(1, 4, 4), Flip(2, 3, 0),
        Battle(1, R, FLAG, "flag_captured", 2, 0, 3, 0),
    };
    var j1 = FanqiRules.Judge(capped, Room(1));
    T("扛旗即胜", j1.over && j1.winner == 1 && j1.reason == "flag_captured", $"{j1.winner},{j1.reason}");

    // 歼灭可动子：P2 只剩地雷+军旗 → P1 胜
    var wiped = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 4, 4, V(FLAG), 1),
        Setup(2, 3, 0, V(FLAG), 2), Setup(2, 3, 1, V(MINE), 3),
        Flip(1, 2, 0), Flip(1, 4, 4), Flip(2, 3, 0), Flip(2, 3, 1),
    };
    var j2 = FanqiRules.Judge(wiped, Room(1));
    T("歼灭可动子即胜", j2.over && j2.winner == 1 && j2.reason == "annihilate", $"{j2.winner},{j2.reason}");

    // 无合法着法：无暗子 + 下一家司令被己方旗/雷困死 → 下一家负
    var stuck = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 2, 1, V(PLT), 1), Setup(1, 4, 4, V(FLAG), 2),
        Setup(2, 0, 0, V(CMD), 3), Setup(2, 1, 0, V(FLAG), 4), Setup(2, 0, 1, V(MINE), 5),
        Flip(1, 2, 0), Flip(1, 2, 1), Flip(1, 4, 4), Flip(2, 0, 0), Flip(2, 1, 0), Flip(2, 0, 1),
    };
    // (0,0) 司令：邻 (1,0)=己旗、(0,1)=己雷 → 被困；旗雷不可动；无暗子 → 无任何合法着
    var j3 = FanqiRules.Judge(stuck, Room(1));
    T("无合法着法判负（blocked）", j3.over && j3.winner == 1 && j3.reason == "blocked", $"{j3.winner},{j3.reason}");

    // 和棋：连续 60 手无吃子无翻子（双方各有旗+可动子，暗子仍在（有翻子）→ 无交战计数走到 60）
    var quiet = new List<GameEvent>
    {
        Setup(1, 0, 2, V(R), 0), Setup(1, 4, 4, V(FLAG), 1),
        Setup(2, 3, 0, V(PLT), 2), Setup(2, 4, 5, V(FLAG), 3),
    };
    for (var i = 0; i < 60; i++)
        quiet.Add(i % 2 == 0 ? Move(1, 0, 2, 0, 3) : Move(1, 0, 3, 0, 2));
    var j4 = FanqiRules.Judge(quiet, Room(1));
    T("60 手无交战判和", j4.over && j4.winner == 3 && j4.reason == "draw", $"{j4.winner},{j4.reason}");

    // 未满 60 手不判
    var quiet59 = quiet.Take(quiet.Count - 1).ToList();
    var j5 = FanqiRules.Judge(quiet59, Room(1));
    T("59 手不判和", !j5.over, $"{j5.winner},{j5.reason}");
}

// ---------------- 8. 快照反泄露 ----------------
Console.WriteLine("[8] 快照反泄露（暗子无 side/rank）");
{
    var evs = new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 2, 1, V(PLT), 1),
        Setup(2, 3, 1, V(CMD), 2), Setup(2, 3, 0, V(FLAG), 3),
        Flip(1, 2, 0), Flip(1, 2, 1),
    };
    var json = JsonSerializer.SerializeToElement(FanqiRules.BuildState(evs, Room(1), 1, false));
    var pieces = json.GetProperty("pieces").EnumerateArray().ToList();
    T("4 枚子在盘", pieces.Count == 4, $"n={pieces.Count}");
    var dark = pieces.Where(p => p.GetProperty("hidden").GetBoolean()).ToList();
    var shown = pieces.Where(p => !p.GetProperty("hidden").GetBoolean()).ToList();
    T("暗子 2 枚", dark.Count == 2, $"dark={dark.Count}");
    T("暗子无 side/rank 键（值级反泄露）",
        dark.All(p => !p.TryGetProperty("side", out _) && !p.TryGetProperty("rank", out _)),
        string.Join(";", dark.Select(p => p.GetRawText())));
    T("翻开子带 side+rank", shown.Count == 2 && shown.All(p => p.TryGetProperty("side", out _) && p.TryGetProperty("rank", out _)));
    T("events 无 setup（暗子身份不下发）", !json.GetProperty("events").EnumerateArray().Any(e => e.GetProperty("t").GetString() == "setup"));
    T("myColor/settled 透出", json.GetProperty("myColor").GetInt32() == 1 && json.GetProperty("settled").GetBoolean());
    // 终局全亮
    var jsonF = JsonSerializer.SerializeToElement(FanqiRules.BuildState(evs, Room(1), 1, true));
    T("终局全量公开", jsonF.GetProperty("pieces").EnumerateArray().All(p => p.TryGetProperty("rank", out _)));
    // 值级扫描：暗子 JSON 文本不含任何 rank token
    var darkText = string.Join("", dark.Select(p => p.GetRawText()));
    var leak = new[] { "rank_commander", "rank_army", "rank_division", "rank_brigade", "rank_regiment", "rank_battalion", "rank_company", "rank_platoon", "rank_engineer", "rank_mine", "rank_flag", "rank_bomb" }
        .Any(tok => darkText.Contains(tok));
    T("暗子值级扫描 0 命中", !leak, darkText);
}

// ---------------- 9. AI 红线（Think 非空且合法） ----------------
Console.WriteLine("[9] AI 红线：有合法着必出着（枚举局面）");
{
    int redlineOk = 0, redlineTotal = 0;
    void Redline(string name, List<GameEvent> evs, GameRoom r, int side)
    {
        redlineTotal++;
        var actions = FanqiRules.AllActions(evs, r, side);
        if (actions.Count == 0) { redlineOk++; Console.WriteLine($"  PASS  {name}（无合法着，null 合理）"); return; }
        var think = FanqiRules.Think(evs, r, side, 1);
        if (think is null) { Console.WriteLine($"  FAIL  {name}：有着却返回 null"); return; }
        try
        {
            FanqiRules.ValidateMove(evs, r, side, think.Value);
            redlineOk++;
            Console.WriteLine($"  PASS  {name}");
        }
        catch (Exception e) { Console.WriteLine($"  FAIL  {name}：Think 出着被拒 {e.Message}"); }
    }

    // 未定阵营：只能翻
    Redline("翻棋·未定阵营必翻子", new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 2, 1, V(PLT), 1), Flip(1, 2, 0),
    }, Room(2), 2);

    // 已定阵营：有吃子
    Redline("翻棋·有吃子必出着", new List<GameEvent>
    {
        Setup(1, 2, 0, V(CMD), 0), Setup(1, 2, 1, V(PLT), 1),
        Setup(2, 3, 0, V(ARMY), 2),
        Flip(1, 2, 0), Flip(1, 2, 1), Flip(2, 3, 0),
    }, Room(1), 1);

    // 已定阵营：纯走子 + 暗子可翻
    Redline("翻棋·走子/翻子择一必出着", new List<GameEvent>
    {
        Setup(1, 2, 0, V(R), 0), Setup(1, 2, 1, V(PLT), 1),
        Setup(2, 4, 2, V(CMD), 2),
        Flip(1, 2, 0), Flip(1, 2, 1),
    }, Room(1), 1);

    // 翻棋：雷清可扛旗 → 必选夺旗
    {
        var evs = new List<GameEvent>
        {
            Setup(1, 2, 0, V(R), 0), Setup(1, 2, 1, V(PLT), 1),
            Setup(2, 3, 0, V(FLAG), 2),
            Flip(1, 2, 0), Flip(1, 2, 1), Flip(2, 3, 0),
        };
        var think = FanqiRules.Think(evs, Room(1), 1, 1);
        var isFlag = think is not null && think.Value.TryGetProperty("tx", out var txEl) && txEl.GetInt32() == 3;
        T("翻棋 AI 能夺旗必夺旗", isFlag, think?.GetRawText());
    }

    // 明棋军旗（open）：随机布阵后 AI 必出着（open 的 InitialEvents 为空，布阵走 RandomSideSetup）
    for (var t = 0; t < 20; t++)
    {
        var evs = ArmyChessRules.RandomSideSetup(1, 0).Concat(ArmyChessRules.RandomSideSetup(2, 25)).ToList();
        Redline($"明棋军旗·随机局 #{t + 1}", evs, Room(1, "open"), 1);
    }

    // 暗棋军旗（dark）：同红线
    for (var t = 0; t < 20; t++)
    {
        var evs = ArmyChessRules.InitialEvents(new GameRoom { Code = "FQ003", GameKey = "armychess", Mode = "dark", Turn = 1, Status = "playing", HostUserId = 1, AiLevel = 2 });
        Redline($"暗棋军旗·随机局 #{t + 1}", evs, Room(1, "dark"), 1);
    }

    // 翻棋随机局：双方各 10 局
    for (var t = 0; t < 10; t++)
    {
        var evs = FanqiRules.InitialEvents(Room());
        Redline($"翻棋·随机开局 #{t + 1}", evs, Room(1), 1);
        Redline($"翻棋·随机开局（后手）#{t + 1}", evs, Room(2), 2);
    }

    T("AI 红线全过", redlineOk == redlineTotal, $"{redlineOk}/{redlineTotal}");
}

// ---------------- 10. 飞行棋 AI 红线抽测（Think 非空且合法） ----------------
Console.WriteLine("[10] 飞行棋 AI 红线抽测");
{
    int ok = 0, total = 0;
    for (var roll = 1; roll <= 6; roll++)
    {
        total++;
        // p0 起飞后走到 pos3；p1..p3 在机场；末尾一条本座 roll = 骰点
        var evs = new List<GameEvent>
        {
            new() { t = "move", s = 1, p = 0, v = 6 },
            new() { t = "move", s = 1, p = 0, v = 3 },
            new() { t = "roll", s = 1, v = roll },
        };
        var r = new GameRoom { Code = "TEST01", GameKey = "ludo", Turn = 1, Status = "playing", HostUserId = 1, AiLevel = 0 };
        if (!LudoRules.HasAnyValidMove(evs, 1, roll)) { ok++; continue; }
        var think = LudoRules.Think(evs, 1, 1, r);
        if (think is null) { Console.WriteLine($"  FAIL  ludo roll={roll} 有着却 null"); continue; }
        try
        {
            LudoRules.ValidateMove(evs, r, 1, think.Value);
            ok++;
            Console.WriteLine($"  PASS  ludo roll={roll} Think 合法 {think.Value.GetRawText()}");
        }
        catch (Exception e) { Console.WriteLine($"  FAIL  ludo roll={roll} Think 被拒 {e.Message}"); }
    }
    T("飞行棋 Think 红线（roll 1-6）", ok == total, $"{ok}/{total}");
}

Console.WriteLine($"\n== 结果：{pass} 通过 / {fail} 失败 ==");
Environment.Exit(fail);
