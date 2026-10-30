// ludo_unit —— 飞行棋引擎 v2（中国飞行棋）规则单测（B3/T05 验收证据）。
// 直接驱动 CheckinApp.Services.LudoRules 纯函数，覆盖全部规则分支：
// 常量映射 / 起飞 / 主环撞子 / 跳4不连跳 / 捷径飞 / 20 格极值链 / 入航道 /
// 终点反弹 / 三连六罚单（第一手·顺延·空转·链界）/ movable / Think 红线 / Judge 终局。
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

int[,] NewBoard()
{
    var b = new int[5, LudoRules.PiecesPerSide];
    for (var s = 0; s < 5; s++)
        for (var p = 0; p < LudoRules.PiecesPerSide; p++)
            b[s, p] = -1;
    return b;
}

GameRoom Room(int turn = 1) => new() { Code = "TEST01", GameKey = "ludo", Turn = turn, Status = "playing", HostUserId = 1, AiLevel = 0 };

GameEvent Ev(string t, int s, int? p = null, int? v = null) => new() { t = t, s = s, p = p, v = v };

JsonElement Req(int p) => JsonSerializer.SerializeToElement(new { p });

Console.WriteLine("== T05 飞行棋规则单测（LudoRules v2）==");

// ---------------- 1. 常量映射（§9.2 三端同源） ----------------
Console.WriteLine("[1] 常量映射");
T("起点 0/13/26/39",
    LudoRules.StartOf(1) == 0 && LudoRules.StartOf(2) == 13 && LudoRules.StartOf(3) == 26 && LudoRules.StartOf(4) == 39,
    $"{LudoRules.StartOf(1)},{LudoRules.StartOf(2)},{LudoRules.StartOf(3)},{LudoRules.StartOf(4)}");
T("HomeEntry 50/11/24/37",
    LudoRules.HomeEntryOf(1) == 50 && LudoRules.HomeEntryOf(2) == 11 && LudoRules.HomeEntryOf(3) == 24 && LudoRules.HomeEntryOf(4) == 37);
T("捷径入口/落点 +12",
    LudoRules.ShortcutEntryOf(1) == 16 && LudoRules.ShortcutLandOf(1) == 28
    && LudoRules.ShortcutEntryOf(3) == 42 && LudoRules.ShortcutLandOf(3) == 2);
T("起点格恰为本色格", LudoRules.ColorOfCell(LudoRules.StartOf(2)) == 1 && LudoRules.ColorOfCell(LudoRules.StartOf(3)) == 2);

// ---------------- 2. 起飞（F5） ----------------
Console.WriteLine("[2] 起飞");
{
    var b = NewBoard();
    b[2, 0] = 0;                       // 敌机停在红起点
    LudoRules.ApplyMove(b, 1, 0, 6);   // 掷 6 起飞
    T("掷 6 起飞落起点", b[1, 0] == 0, $"pos={b[1, 0]}");
    T("起飞落点撞子", b[2, 0] == -1, $"enemy={b[2, 0]}");

    var b2 = NewBoard();
    LudoRules.ApplyMove(b2, 1, 0, 3);  // 非 6
    T("非 6 不起飞", b2[1, 0] == -1, $"pos={b2[1, 0]}");
}

// ---------------- 3. 主环推进 + 途经/落点撞子（F2） ----------------
Console.WriteLine("[3] 主环推进与撞子");
{
    var b = NewBoard();
    b[1, 0] = 5;
    b[2, 0] = 6; b[2, 1] = 7;          // 途经格 + 落点格各一敌机
    LudoRules.ApplyMove(b, 1, 0, 2);
    T("推进到落点", b[1, 0] == 7, $"pos={b[1, 0]}");
    T("途经格撞子", b[2, 0] == -1);
    T("落点格撞子", b[2, 1] == -1);

    var b2 = NewBoard();
    b2[1, 0] = 5;
    b2[2, 0] = 5;                      // 同格敌机（起始格）不撞，只撞途经+落点
    LudoRules.ApplyMove(b2, 1, 0, 2);
    T("出发格不撞", b2[2, 0] == 5);
}

// ---------------- 4. 同色跳 4 不连跳（F3） ----------------
Console.WriteLine("[4] 同色跳 4");
{
    var b = NewBoard();
    b[1, 0] = 4;                       // 本色格出发
    LudoRules.ApplyMove(b, 1, 0, 4);   // 走到 8（本色）→ 跳到 12（本色）→ 不再连跳
    T("落本色跳 4 且不连跳", b[1, 0] == 12, $"pos={b[1, 0]}");

    var b2 = NewBoard();
    b2[1, 0] = 3;
    LudoRules.ApplyMove(b2, 1, 0, 3);  // 落 6（非本色）不跳
    T("落非本色不跳", b2[1, 0] == 6);
}

// ---------------- 5. 虚线捷径飞 +12（F4） ----------------
Console.WriteLine("[5] 虚线捷径");
{
    var b = NewBoard();
    b[1, 0] = 10;
    b[2, 0] = 16;                      // 入口格敌机 → 撞
    b[2, 1] = 20;                      // 虚线路径敌机 → 不撞（只撞入口+落点）
    b[2, 2] = 28;                      // 落点格敌机 → 撞
    b[2, 3] = 31;                      // 落地后跳 4 途经敌机 → 撞
    LudoRules.ApplyMove(b, 1, 0, 6);   // 走到 16（入口）→ 飞 28 → 跳 32
    T("飞 +12 后再跳 4", b[1, 0] == 32, $"pos={b[1, 0]}");
    T("入口格撞子", b[2, 0] == -1);
    T("虚线路径不撞", b[2, 1] == 20);
    T("落点格撞子", b[2, 2] == -1);
    T("落地跳 4 途经撞子", b[2, 3] == -1);
}

// ---------------- 6. 连动极值链 20 格（跳4→飞12→跳4） ----------------
Console.WriteLine("[6] 20 格极值链");
{
    var b = NewBoard();
    b[1, 0] = 8;
    LudoRules.ApplyMove(b, 1, 0, 4);   // 走到 12 → 跳 16 → 飞 28 → 跳 32
    T("跳4→飞12→跳4 = +20", b[1, 0] == 32, $"pos={b[1, 0]}");

    var b2 = NewBoard();
    b2[1, 0] = 12;                     // 起点即本色：跳 16 → 飞 28 → 跳 32（roll=0 不可达，用 roll=4 走回 12 的对称链）
    b2[1, 1] = 11;
    LudoRules.ApplyMove(b2, 1, 1, 1);  // 走到 12 → 跳16 → 飞28 → 跳32
    T("落 12 触发整条链", b2[1, 1] == 32, $"pos={b2[1, 1]}");
    T("链内同侧多机共存", b2[1, 0] == 12);
}

// ---------------- 7. 入终点航道 ----------------
Console.WriteLine("[7] 入终点航道");
{
    var b = NewBoard();
    b[1, 0] = 49;
    LudoRules.ApplyMove(b, 1, 0, 2);   // 49 → 50(HomeEntry) → 航道 h0
    T("从主环转入航道 h0", b[1, 0] == 52, $"pos={b[1, 0]}");

    var b2 = NewBoard();
    b2[1, 0] = 50;
    LudoRules.ApplyMove(b2, 1, 0, 6);  // 从 HomeEntry 走满 6 → h5
    T("HomeEntry 走满入 h5", b2[1, 0] == 57, $"pos={b2[1, 0]}");

    var b3 = NewBoard();
    b3[1, 0] = 48;
    LudoRules.ApplyMove(b3, 1, 0, 3);  // 48 → 49 → 50 → h0（3 步含转入）
    T("剩余步数入航道计数正确", b3[1, 0] == 52);
}

// ---------------- 8. 终点反弹（F6） ----------------
Console.WriteLine("[8] 终点反弹");
{
    var b = NewBoard();
    b[1, 0] = 55;                      // h3
    LudoRules.ApplyMove(b, 1, 0, 3);   // t=6 精确进中心
    T("精确点数进中心", b[1, 0] == 58, $"pos={b[1, 0]}");

    var b2 = NewBoard();
    b2[1, 0] = 55;                     // h3
    LudoRules.ApplyMove(b2, 1, 0, 4);  // t=7 → 反弹 h'=12−7=5
    T("超出反弹往回走", b2[1, 0] == 57, $"pos={b2[1, 0]}");

    var b3 = NewBoard();
    b3[1, 0] = 57;                     // h5
    LudoRules.ApplyMove(b3, 1, 0, 6);  // t=11 → h'=1
    T("大点数反弹到 h1", b3[1, 0] == 53, $"pos={b3[1, 0]}");
}

// ---------------- 9. 三连六罚单（F7） ----------------
Console.WriteLine("[9] 三连六");
{
    // a. 第一手 move 的机号被罚
    var evsA = new List<GameEvent> {
        Ev("roll", 1, v: 6), Ev("move", 1, p: 0, v: 6),
        Ev("roll", 1, v: 6), Ev("move", 1, p: 0, v: 6),
        Ev("roll", 1, v: 6),
    };
    var pen = LudoRules.PendingPenalty(evsA, 1);
    T("三连六触发罚单", pen != null);
    T("罚第一手机（p=0）", pen is { p: 0 }, $"p={pen?.p}");
    T("两连六不罚", LudoRules.PendingPenalty(evsA.Take(4).ToList(), 1) == null);

    // b. 第一手未走动 → 顺延第二手
    var evsB = new List<GameEvent> {
        Ev("roll", 1, v: 6), Ev("pass", 1),
        Ev("roll", 1, v: 6), Ev("move", 1, p: 1, v: 6),
        Ev("roll", 1, v: 6),
    };
    var penB = LudoRules.PendingPenalty(evsB, 1);
    T("第一手未走顺延第二手（p=1）", penB is { p: 1 }, $"p={penB?.p}");

    // c. 两手都没走 → 罚空转 p=-1
    var evsC = new List<GameEvent> {
        Ev("roll", 1, v: 6), Ev("pass", 1),
        Ev("roll", 1, v: 6), Ev("pass", 1),
        Ev("roll", 1, v: 6),
    };
    var penC = LudoRules.PendingPenalty(evsC, 1);
    T("两手没走罚空转（p=-1）", penC is { p: -1 }, $"p={penC?.p}");

    // d. Replay：罚单把该机送回机场
    var evsD = new List<GameEvent>(evsA) { pen! };
    var boardD = LudoRules.Replay(evsD);
    T("Replay 罚回机场", boardD[1, 0] == -1, $"pos={boardD[1, 0]}");

    // e. penalty 是链界：罚后重新计数
    var evsE = new List<GameEvent>(evsD) { Ev("roll", 1, v: 6) };
    T("罚单后新链不连罚", LudoRules.PendingPenalty(evsE, 1) == null
        && LudoRules.ConsecutiveSixes(evsE, 1) == 1);

    // f. 中间夹非 6 打断连六
    var evsF = new List<GameEvent> {
        Ev("roll", 1, v: 6), Ev("move", 1, p: 0, v: 6),
        Ev("roll", 1, v: 6), Ev("move", 1, p: 0, v: 6),
        Ev("roll", 1, v: 3), Ev("move", 1, p: 0, v: 3),
        Ev("roll", 1, v: 6), Ev("move", 1, p: 0, v: 6),
        Ev("roll", 1, v: 6),
    };
    T("非 6 打断连六（计 2）", LudoRules.ConsecutiveSixes(evsF, 1) == 2
        && LudoRules.PendingPenalty(evsF, 1) == null);
}

// ---------------- 10. movable / needRoll / 额外回合 ----------------
Console.WriteLine("[10] movable 与回合");
{
    var r = Room();
    var evs6 = new List<GameEvent> { Ev("roll", 1, v: 6) };
    var mv = LudoRules.MovablePieces(evs6, r, 1);
    T("全机场 + 掷 6 → 4 机可走", mv.Count == 4, string.Join(",", mv));

    var evs3 = new List<GameEvent> { Ev("roll", 1, v: 3) };
    T("全机场 + 非 6 → 无机可走", LudoRules.MovablePieces(evs3, r, 1).Count == 0);
    T("非 6 无合法着", !LudoRules.HasAnyValidMove(evs3, 1, 3));
    T("掷 6 有合法着", LudoRules.HasAnyValidMove(evs6, 1, 6));

    // 已归巢的机不可走；在主环的机任何骰点都可走
    var toCenter = new List<GameEvent> {
        Ev("move", 1, p: 0, v: 6), Ev("move", 1, p: 0, v: 49),
        Ev("move", 1, p: 0, v: 1), Ev("move", 1, p: 0, v: 6), Ev("move", 1, p: 0, v: 1),
        Ev("move", 1, p: 1, v: 6),                     // p1 起飞在主环
        Ev("roll", 1, v: 2),
    };
    var mv2 = LudoRules.MovablePieces(toCenter, r, 1);
    T("归巢机不进 movable", !mv2.Contains(0) && mv2.Count == 1 && mv2[0] == 1, string.Join(",", mv2));

    T("掷 6 额外回合", LudoRules.GrantsExtraTurn(evs6, 1));
    T("非 6 不额外回合", !LudoRules.GrantsExtraTurn(evs3, 1));
}

// ---------------- 11. 校验分支（ValidateMove / ValidateRoll） ----------------
Console.WriteLine("[11] 校验分支");
{
    var r = Room();
    string Err(Action a) { try { a(); return ""; } catch (ApiBadRequest e) { return e.Message; } }

    T("未掷骰先走被拒", Err(() => LudoRules.ValidateMove(new List<GameEvent>(), r, 1, Req(0))).Contains("先掷骰子"));
    T("非 6 起飞被拒", Err(() => LudoRules.ValidateMove(
        new List<GameEvent> { Ev("roll", 1, v: 3) }, r, 1, Req(0))).Contains("必须掷 6"));
    T("没轮到被拒", Err(() => LudoRules.ValidateMove(
        new List<GameEvent> { Ev("roll", 2, v: 6) }, r, 2, Req(0))).Contains("还没轮到你"));
    T("已走过再走被拒", Err(() => LudoRules.ValidateMove(
        new List<GameEvent> { Ev("roll", 1, v: 6), Ev("move", 1, p: 0, v: 6) }, r, 1, Req(1))).Contains("已经走过"));
    T("归巢机被拒", Err(() => LudoRules.ValidateMove(
        new List<GameEvent> {
            Ev("move", 1, p: 0, v: 6), Ev("move", 1, p: 0, v: 49),
            Ev("move", 1, p: 0, v: 1), Ev("move", 1, p: 0, v: 6), Ev("move", 1, p: 0, v: 1),
            Ev("roll", 1, v: 2),
        }, r, 1, Req(0))).Contains("终点"));
    T("已掷未走重掷被拒", Err(() => LudoRules.ValidateRoll(
        new List<GameEvent> { Ev("roll", 1, v: 3) }, r, 1)).Contains("已经掷过了"));

    var ok = LudoRules.ValidateMove(new List<GameEvent> { Ev("roll", 1, v: 6) }, r, 1, Req(2));
    T("合法走子出事件（v=服务端骰点）", ok.t == "move" && ok.p == 2 && ok.v == 6);
}

// ---------------- 12. Think 红线（有合法着必出着） ----------------
Console.WriteLine("[12] Think 红线");
{
    var r = Room();
    for (var roll = 1; roll <= 6; roll++)
    {
        // 每个骰点下都不许 null-pass：四机全在主环 → 恒有 candidates
        var evs = new List<GameEvent> {
            Ev("move", 1, p: 0, v: 6), Ev("move", 1, p: 1, v: 6),
            Ev("move", 1, p: 2, v: 6), Ev("move", 1, p: 3, v: 6),
            Ev("roll", 1, v: roll),
        };
        var think = LudoRules.Think(evs, 1, 2, r);
        T($"roll={roll} 有合法着必出着", think is not null);
        if (think is not null)
        {
            var pi = think.Value.GetProperty("p").GetInt32();
            T($"roll={roll} 着法机号合法", pi is >= 0 and <= 3, $"p={pi}");
        }
    }
    // 起飞优先：机场有机 + 掷 6 → 选机场机
    var evs2 = new List<GameEvent> { Ev("move", 1, p: 0, v: 6), Ev("roll", 1, v: 6) };
    var t2 = LudoRules.Think(evs2, 1, 2, r);
    T("起飞优先选机场机", t2 is not null && t2.Value.GetProperty("p").GetInt32() == 1,
        t2 is null ? "null" : t2.Value.GetProperty("p").GetInt32().ToString());
}

// ---------------- 13. Judge 终局 + BuildState ----------------
Console.WriteLine("[13] 终局与快照");
{
    var r = Room();
    var winEvs = new List<GameEvent>();
    for (var p = 0; p < 4; p++)
    {
        winEvs.Add(Ev("move", 1, p: p, v: 6));
        winEvs.Add(Ev("move", 1, p: p, v: 49));
        winEvs.Add(Ev("move", 1, p: p, v: 1));
        winEvs.Add(Ev("move", 1, p: p, v: 6));
        winEvs.Add(Ev("move", 1, p: p, v: 1));
    }
    var b = LudoRules.Replay(winEvs);
    T("四机归巢", b[1, 0] == 58 && b[1, 1] == 58 && b[1, 2] == 58 && b[1, 3] == 58);
    var (w, _, over) = LudoRules.Judge(winEvs, r);
    T("Judge 判胜", over && w == 1, $"winner={w} over={over}");
    var (w0, _, o0) = LudoRules.Judge(winEvs.Take(10).ToList(), r);
    T("未终局不判", !o0 && w0 == 0);

    var st = JsonSerializer.SerializeToElement(LudoRules.BuildState(
        new List<GameEvent> { Ev("roll", 1, v: 6) }, r, 1, false));
    T("快照 movable 透出", st.GetProperty("movable").GetArrayLength() == 4);
    T("快照 needRoll=false（已掷未走）", !st.GetProperty("needRoll").GetBoolean());
    var st2 = JsonSerializer.SerializeToElement(LudoRules.BuildState(new List<GameEvent>(), r, 1, false));
    T("快照 needRoll=true（未掷）", st2.GetProperty("needRoll").GetBoolean());
}

Console.WriteLine($"\n== 结果：{pass} 通过 / {fail} 失败 ==");
return fail;
