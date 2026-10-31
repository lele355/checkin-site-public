using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 军旗规则 —— 6 行×5 列×2 方（共 12 行）、随机布阵、暗子对战。
///
/// 【硬要求 1】参战即公开：棋子一旦参与 battle 事件，无论胜负（含幸存子），永久 hidden:false。
/// 【硬要求 2】camp 是棋盘格属性（行营/大本营是格子的性质），不是棋子属性。
/// 【硬要求 3】值级扫描断言排除合法公开的 rank。
///
/// 棋子等级（大吃小）：司令(10)>军长(9)>师长(8)>旅长(7)>团长(6)>营长(5)>连长(4)>排长(3)>工兵(2)
/// 地雷(11)炸死除工兵(2)外任何子；军旗(12)不能动（被夺即输）。
/// 行营是安全区（子在行营内不可被吃）。
/// </summary>
public static class ArmyChessRules
{
    public const int BoardW = 5;
    public const int BoardH = 12; // 每方 6 行，side 2 在 rows 0-5，side 1 在 rows 6-11

    // 棋子等级 rank token（硬要求 3：不与常见文本碰撞）
    public const string RANK_COMMANDER = "rank_commander";     // 司令 10
    public const string RANK_ARMY = "rank_army";               // 军长 9
    public const string RANK_DIVISION = "rank_division";       // 师长 8
    public const string RANK_BRIGADE = "rank_brigade";         // 旅长 7
    public const string RANK_REGIMENT = "rank_regiment";       // 团长 6
    public const string RANK_BATTALION = "rank_battalion";     // 营长 5
    public const string RANK_COMPANY = "rank_company";         // 连长 4
    public const string RANK_PLATOON = "rank_platoon";         // 排长 3
    public const string RANK_ENGINEER = "rank_engineer";       // 工兵 2
    public const string RANK_MINE = "rank_mine";               // 地雷 11
    public const string RANK_FLAG = "rank_flag";               // 军旗 12
    public const string RANK_BOMB = "rank_bomb";               // 炸弹 13

    /// <summary>每种棋子的数量（每方 25 枚）</summary>
    private static readonly (string rank, int value, int count)[] PieceSpec =
    [
        (RANK_COMMANDER, 10, 1), (RANK_ARMY, 9, 1), (RANK_DIVISION, 8, 2),
        (RANK_BRIGADE, 7, 2), (RANK_REGIMENT, 6, 2), (RANK_BATTALION, 5, 2),
        (RANK_COMPANY, 4, 3), (RANK_PLATOON, 3, 3), (RANK_ENGINEER, 2, 3),
        (RANK_MINE, 11, 3), (RANK_BOMB, 13, 2), (RANK_FLAG, 12, 1),
    ];

    /// <summary>配比表（deploy 校验 / 随机生成共用）：rank → 数量</summary>
    public static List<(string rank, int count)> SpecCounts() =>
        PieceSpec.Select(p => (p.rank, p.count)).ToList();

    /// <summary>棋盘格类型（硬要求 2：camp 是格子属性）</summary>
    public const int Normal = 0, Camp = 1, Den = 2;

    /// <summary>行营位置（每方 5 个，共 10 个）</summary>
    private static readonly (int x, int y)[] CampPositions =
    [
        (1, 2), (3, 2), (2, 3), (1, 4), (3, 4), // side 2 半场
        (1, 7), (3, 7), (2, 8), (1, 9), (3, 9), // side 1 半场
    ];

    /// <summary>大本营位置（每方 2 个，军旗必须在其中之一）</summary>
    private static readonly (int x, int y)[] DenPositions =
    [
        (1, 0), (3, 0), // side 2 大本营
        (1, 11), (3, 11), // side 1 大本营
    ];

    /// <summary>获取棋盘格类型</summary>
    public static int CellType(int x, int y)
    {
        if (DenPositions.Any(d => d.x == x && d.y == y)) return Den;
        if (CampPositions.Any(c => c.x == x && c.y == y)) return Camp;
        return Normal;
    }

    /// <summary>随机秘密布阵（暗棋用）。明棋（Mode=open）返回空 —— 棋子由 deploy 动作落库。
    /// dealMode 枚举位预留："flip"（翻棋）由 FanqiRules.InitialEvents 实现（armychess mode=fanqi 分流）。</summary>
    public static List<GameEvent> InitialEvents(GameRoom r, string? dealMode = null)
    {
        if (dealMode == "flip") throw new NotImplementedException("翻棋请走 FanqiRules.InitialEvents（armychess mode=fanqi）");
        if (r.Mode == "open") return [];   // 明棋：布阵阶段另行落库
        // 双方棋子 ID 错开（0..24 / 25..49）：GetRevealedIds 按 ID 追踪，重号会跨方误亮（反泄露）
        return RandomSideSetup(1, 0).Concat(RandomSideSetup(2, 25)).ToList();
    }

    /// <summary>单方随机秘密布阵（满足全部布阵约束；deploy 随机兑底共用）</summary>
    public static List<GameEvent> RandomSideSetup(int side, int baseId = 0)
    {
        var evs = new List<GameEvent>();
        var pieceId = baseId;
        var rng = Random.Shared;

        var pieces = new List<string>();
        foreach (var (rank, _, count) in PieceSpec)
            for (var i = 0; i < count; i++) pieces.Add(rank);

        var used = new HashSet<(int x, int y)>();
        void Place(string rank)
        {
            var candidates = new List<(int x, int y)>();
            for (var y = 0; y < BoardH; y++)
            for (var x = 0; x < BoardW; x++)
            {
                if (used.Contains((x, y))) continue;
                if (!ArmyChessBoard.InOwnHalf(side, y)) continue;
                if (CellType(x, y) == Camp) continue;
                if (rank == RANK_FLAG && !ArmyChessBoard.IsOwnDen(side, x, y)) continue;
                if (rank == RANK_BOMB && ArmyChessBoard.IsFrontRow(side, y)) continue;
                if (rank == RANK_MINE && !ArmyChessBoard.IsBackTwoRows(side, y)) continue;
                candidates.Add((x, y));
            }
            var spot = candidates[rng.Next(candidates.Count)];
            used.Add(spot);
            evs.Add(new GameEvent { t = "setup", s = side, x = spot.x, y = spot.y, v = RankValue(rank), p = pieceId++ });
        }

        Place(RANK_FLAG);
        var mines = pieces.Count(p => p == RANK_MINE);
        var bombs = pieces.Count(p => p == RANK_BOMB);
        for (var i = 0; i < mines; i++) Place(RANK_MINE);
        for (var i = 0; i < bombs; i++) Place(RANK_BOMB);
        foreach (var rank in pieces)
        {
            if (rank is RANK_MINE or RANK_BOMB or RANK_FLAG) continue;
            Place(rank);
        }
        return evs;
    }

    /// <summary>校验走子</summary>
    public static GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req)
    {
        if (side is not (1 or 2)) throw new ApiBadRequest("你不在这一局里");

        var fromX = req.TryGetProperty("fx", out var fx) ? fx.GetInt32() : -1;
        var fromY = req.TryGetProperty("fy", out var fy) ? fy.GetInt32() : -1;
        var toX = req.TryGetProperty("tx", out var tx) ? tx.GetInt32() : -1;
        var toY = req.TryGetProperty("ty", out var ty) ? ty.GetInt32() : -1;

        if (fromX < 0 || fromX >= BoardW || fromY < 0 || fromY >= BoardH) throw new ApiBadRequest("起点不合法");
        if (toX < 0 || toX >= BoardW || toY < 0 || toY >= BoardH) throw new ApiBadRequest("终点不合法");
        if (fromX == toX && fromY == toY) throw new ApiBadRequest("不能原地不动");

        var board = Replay(evs);
        var piece = board[fromX, fromY];
        if (piece == 0) throw new ApiBadRequest("起点没有棋子");
        if (PieceSide(piece) != side) throw new ApiBadRequest("这不是你的棋子");
        if (PieceRank(piece) == RANK_FLAG) throw new ApiBadRequest("军旗不能动");
        if (PieceRank(piece) == RANK_MINE) throw new ApiBadRequest("地雷不能动");

        var target = board[toX, toY];
        if (target != 0 && PieceSide(target) == side) throw new ApiBadRequest("不能吃自己的棋子");

        // 行营安全区：子在行营内不可被吃
        if (target != 0 && CellType(toX, toY) == Camp)
            throw new ApiBadRequest("行营里的棋子不能被吃");

        // 大本营冻结（§2.1 A5）：进入后该子不可再动 —— 冻结子无落点，CanReach 自然拒绝。
        // 行棋 = 图上三种查询（公路一步 / 铁路直线滑行 / 工兵 BFS），与 HasAnyMove/AI 同源。
        if (!ArmyChessBoard.CanReach(board, ArmyChessBoard.Node(fromX, fromY), ArmyChessBoard.Node(toX, toY), side))
            throw new ApiBadRequest("走法不合法");

        return new GameEvent { t = "move", s = side, fx = fromX, fy = fromY, tx = toX, ty = toY };
    }

    /// <summary>判定战斗结果（生成 battle 事件，含参战双方 ID）</summary>
    public static (GameEvent? battle, int winner, string reason, bool over) ResolveBattle(
        IReadOnlyList<GameEvent> evs, GameRoom r, int side, int fromX, int fromY, int toX, int toY)
    {
        var (board, idMap) = ReplayWithIds(evs);
        var attacker = board[fromX, fromY];
        var defender = board[toX, toY];

        if (defender == 0) return (null, 0, "", false);

        var attRank = PieceRank(attacker);
        var defRank = PieceRank(defender);
        idMap.TryGetValue((fromX, fromY), out var attId);
        idMap.TryGetValue((toX, toY), out var defId);

        // 军旗特例：走到军旗位 = 夺旗
        if (defRank == RANK_FLAG)
            return (new GameEvent { t = "battle", s = side, att = attRank, def = defRank, result = "flag_captured", fx = fromX, fy = fromY, tx = toX, ty = toY, p = attId, v = defId }, 0, "", false);

        var attValue = RankValue(attRank);
        var defValue = RankValue(defRank);

        // 炸弹规则：与任何子同归于尽（含司令），工兵踩炸弹也被炸死
        if (attRank == RANK_BOMB || defRank == RANK_BOMB)
            return (new GameEvent { t = "battle", s = side, att = attRank, def = defRank, result = "both_die", fx = fromX, fy = fromY, tx = toX, ty = toY, p = attId, v = defId }, 0, "", false);

        // 地雷规则
        if (defRank == RANK_MINE)
        {
            if (attRank == RANK_ENGINEER)
                return (new GameEvent { t = "battle", s = side, att = attRank, def = defRank, result = "attacker_wins", fx = fromX, fy = fromY, tx = toX, ty = toY, p = attId, v = defId }, 0, "", false);
            return (new GameEvent { t = "battle", s = side, att = attRank, def = defRank, result = "defender_wins", fx = fromX, fy = fromY, tx = toX, ty = toY, p = attId, v = defId }, 0, "", false);
        }
        if (attRank == RANK_MINE)
            return (new GameEvent { t = "battle", s = side, att = attRank, def = defRank, result = "defender_wins", fx = fromX, fy = fromY, tx = toX, ty = toY, p = attId, v = defId }, 0, "", false);

        // 普通战斗
        if (attValue == defValue)
            return (new GameEvent { t = "battle", s = side, att = attRank, def = defRank, result = "both_die", fx = fromX, fy = fromY, tx = toX, ty = toY, p = attId, v = defId }, 0, "", false);
        if (attValue > defValue)
            return (new GameEvent { t = "battle", s = side, att = attRank, def = defRank, result = "attacker_wins", fx = fromX, fy = fromY, tx = toX, ty = toY, p = attId, v = defId }, 0, "", false);
        return (new GameEvent { t = "battle", s = side, att = attRank, def = defRank, result = "defender_wins", fx = fromX, fy = fromY, tx = toX, ty = toY, p = attId, v = defId }, 0, "", false);
    }

    /// <summary>判定终局</summary>
    public static (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r)
    {
        var board = Replay(evs);

        // 夺军旗：军旗被吃
        for (var side = 1; side <= 2; side++)
        {
            var flagFound = false;
            for (var x = 0; x < BoardW; x++)
                for (var y = 0; y < BoardH; y++)
                    if (board[x, y] != 0 && PieceSide(board[x, y]) == side && PieceRank(board[x, y]) == RANK_FLAG)
                        flagFound = true;
            if (!flagFound)
                return (side == 1 ? 2 : 1, "flag_captured", true);
        }

        // 无子可动 = 判负
        for (var side = 1; side <= 2; side++)
        {
            if (!HasAnyMove(board, side))
                return (side == 1 ? 2 : 1, "blocked", true);
        }

        return (0, "", false);
    }

    /// <summary>构建 per-game 快照（硬要求 2：camp 在 squares 里；硬要求 4：己方始终可见；硬要求 6：按 ID 追踪）</summary>
    public static object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished)
    {
        var (board, idMap) = ReplayWithIds(evs);
        var lastMove = evs.LastOrDefault(e => e.t == "move" || e.t == "battle");

        // 棋盘格属性（硬要求 2）
        var squares = new List<object>();
        for (var x = 0; x < BoardW; x++)
            for (var y = 0; y < BoardH; y++)
            {
                var ct = CellType(x, y);
                if (ct != Normal)
                    squares.Add(new { x, y, kind = ct == Camp ? "camp" : "den" });
            }

        // 棋子（硬要求 6：按棋子身份追踪 revealed；健壮性：缺 ID 一律 hidden）
        var revealedIds = GetRevealedIds(evs);
        var flagRevealed = GetFlagRevealedSides(evs);   // 新：司令阵亡亮旗（CAAI）
        var openAllVisible = r.Mode == "open" && r.Status == "playing";   // 明棋 playing 全亮
        var setupHide = r.Status == "setup";                             // 布阵期对方 rank 不下发
        var pieces = new List<object>();
        for (var x = 0; x < BoardW; x++)
        {
            for (var y = 0; y < BoardH; y++)
            {
                var piece = board[x, y];
                if (piece == 0) continue;
                var side = PieceSide(piece);
                var rank = PieceRank(piece);
                // 健壮性：idMap 缺失时 pid 不存在 → 不加入 revealed（安全侧）
                var hasId = idMap.TryGetValue((x, y), out var pid);
                // 己方始终可见；对方参战后可见；明棋 playing 全亮；司令阵亡后该方军旗亮；终局全亮
                var isRevealed = side == mySide
                    || (hasId && revealedIds.Contains(pid))
                    || openAllVisible
                    || (side != mySide && rank == RANK_FLAG && flagRevealed.Contains(side))
                    || finished;
                // 布阵期对方子不下发 rank（否则摆阵无策略意义）
                if (setupHide && side != mySide)
                    isRevealed = false;

                if (isRevealed)
                    pieces.Add(new { x, y, side, rank, hidden = false });
                else
                    pieces.Add(new { x, y, side, hidden = true });
            }
        }

        // battle log（硬要求 8；非 finished 时不带 att/def rank，防泄露）
        var battleLog = finished
            ? evs.Where(e => e.t == "battle")
                .Select(e => new { att = e.att, def = e.def, result = e.result ?? "", fx = e.fx, fy = e.fy, tx = e.tx, ty = e.ty }).ToList()
            : evs.Where(e => e.t == "battle")
                .Select(e => new { att = (string?)null, def = (string?)null, result = e.result ?? "", fx = e.fx, fy = e.fy, tx = e.tx, ty = e.ty }).ToList();

        // events（设计 §3.3：always present；finished 时全量，否则只含公开事件不含 rank）
        var eventsOut = finished
            ? evs.Select(e => new { t = e.t, s = e.s, x = e.x, y = e.y, fx = e.fx, fy = e.fy, tx = e.tx, ty = e.ty, att = e.att, def = e.def, result = e.result ?? "" }).ToList()
            : evs.Where(e => e.t == "move")
                .Select(e => new { t = e.t, s = e.s, x = e.x, y = e.y, fx = e.fx, fy = e.fy, tx = e.tx, ty = e.ty, att = (string?)null, def = (string?)null, result = "" }).ToList();

        return new
        {
            boardW = BoardW,
            boardH = BoardH,
            mode = r.Mode ?? "dark",
            deployDone = new[]
            {
                evs.Any(e => e.t == "setup" && e.s == 1),
                evs.Any(e => e.t == "setup" && e.s == 2),
            },
            squares,
            pieces,
            // 可走提示按需化（QA §3-P1）：不再随快照全量 Build（曾 1475 次 ValidateMove/轮询）；
            // 单子提示走 GET /rooms/{id}/hints，数据仍由正式校验器生成。
            battleLog,
            events = eventsOut,
            // fx/fy 兼容哨兵（BUG-3）：缺失时序列化 fx=tx, fy=ty，旧 App 非空 Int 反序列化不炸
            lastMove = lastMove is null ? null : new { fx = lastMove.fx ?? lastMove.tx, fy = lastMove.fy ?? lastMove.ty, tx = lastMove.tx, ty = lastMove.ty },
        };
    }

    /// <summary>
    /// 司令阵亡亮旗（CAAI）：从 battle 事件流推导 —— 某方 RANK_COMMANDER 阵亡，
    /// 该方 RANK_FLAG 对对手永久可见。纯函数、可单测。
    /// </summary>
    public static HashSet<int> GetFlagRevealedSides(IReadOnlyList<GameEvent> evs)
    {
        var dead = new HashSet<int>();
        foreach (var e in evs)
        {
            if (e.t != "battle") continue;
            if (e.att == RANK_COMMANDER && (e.result == "defender_wins" || e.result == "both_die"))
                dead.Add(e.s);                          // 攻方司令阵亡
            if (e.def == RANK_COMMANDER && (e.result == "attacker_wins" || e.result == "both_die"))
                dead.Add(e.s == 1 ? 2 : 1);             // 守方司令阵亡
        }
        return dead;
    }

    /// <summary>
    /// 【硬要求 1】参战即公开：battle 事件里的棋子永久 hidden:false。
    /// 【硬要求 6】按棋子身份（ID）追踪，不是坐标。
    /// 【健壮性】setup 缺 p 时 idMap 为空 → 所有棋子无 ID → GetRevealedIds 匹配不到 → 全部 hidden（安全侧）。
    /// （public：明棋/暗棋 AI 判断「这枚子是不是已公开」用，AI 不得读未公开 rank）
    /// </summary>
    public static HashSet<int> GetRevealedIds(IReadOnlyList<GameEvent> evs)
    {
        var revealed = new HashSet<int>();
        foreach (var e in evs)
        {
            if (e.t != "battle") continue;
            // battle 事件记录 attId/defId（内部概念，不下发给客户端）
            // 缺 p/v 时跳过（不加入 revealed）→ 该棋子保持 hidden（安全侧）
            if (e.p is int attId && attId >= 0) revealed.Add(attId);
            if (e.v is int defId && defId >= 0) revealed.Add(defId);
        }
        return revealed;
    }

    /// <summary>重建盘面（含棋子 ID 追踪）。返回 [x,y] = side*100+rankValue</summary>
    public static int[,] Replay(IReadOnlyList<GameEvent> evs) => ReplayWithIds(evs).board;

    /// <summary>重建盘面并返回 ID 映射（硬要求 6：按棋子身份追踪）</summary>
    public static (int[,] board, Dictionary<(int x, int y), int> idMap) ReplayWithIds(IReadOnlyList<GameEvent> evs)
    {
        var board = new int[BoardW, BoardH];
        var idMap = new Dictionary<(int, int), int>();

        foreach (var e in evs)
        {
            if (e.t == "setup" && e.x is int sx && e.y is int sy && e.v is int sv)
            {
                board[sx, sy] = e.s * 100 + sv;
                if (e.p is int pid) idMap[(sx, sy)] = pid;
            }
            else if (e.t == "move" && e.fx is int fx && e.fy is int fy && e.tx is int tx && e.ty is int ty)
            {
                var piece = board[fx, fy];
                if (piece == 0) continue;
                board[fx, fy] = 0;
                board[tx, ty] = piece;
                if (idMap.TryGetValue((fx, fy), out var pid))
                {
                    idMap.Remove((fx, fy));
                    idMap[(tx, ty)] = pid;
                }
            }
            else if (e.t == "battle" && e.fx is int bfx && e.fy is int bfy && e.tx is int btx && e.ty is int bty)
            {
                var attacker = board[bfx, bfy];
                if (attacker == 0) continue;

                switch (e.result)
                {
                    case "attacker_wins":
                    case "flag_captured":
                        board[bfx, bfy] = 0;
                        board[btx, bty] = attacker;
                        if (idMap.TryGetValue((bfx, bfy), out var aid))
                        {
                            idMap.Remove((bfx, bfy));
                            idMap[(btx, bty)] = aid;
                        }
                        break;
                    case "defender_wins":
                        board[bfx, bfy] = 0;
                        idMap.Remove((bfx, bfy));
                        break;
                    case "both_die":
                        board[bfx, bfy] = 0;
                        board[btx, bty] = 0;
                        idMap.Remove((bfx, bfy));
                        idMap.Remove((btx, bty));
                        break;
                }
            }
        }
        return (board, idMap);
    }

    /// <summary>该方是否有任何合法走法（与 Reachable 同源，三处共用）</summary>
    private static bool HasAnyMove(int[,] board, int side) => ArmyChessBoard.HasAnyMove(board, side);

    /// <summary>rank value 换算（翻棋/明棋 AI 共用）</summary>
    public static int RankValue(string rank) => rank switch
    {
        RANK_COMMANDER => 10, RANK_ARMY => 9, RANK_DIVISION => 8, RANK_BRIGADE => 7,
        RANK_REGIMENT => 6, RANK_BATTALION => 5, RANK_COMPANY => 4, RANK_PLATOON => 3,
        RANK_ENGINEER => 2, RANK_MINE => 11, RANK_FLAG => 12, RANK_BOMB => 13, _ => 0,
    };

    public static int PieceSide(int piece) => piece / 100;
    public static string PieceRank(int piece) => (piece % 100) switch
    {
        10 => RANK_COMMANDER, 9 => RANK_ARMY, 8 => RANK_DIVISION, 7 => RANK_BRIGADE,
        6 => RANK_REGIMENT, 5 => RANK_BATTALION, 4 => RANK_COMPANY, 3 => RANK_PLATOON,
        2 => RANK_ENGINEER, 11 => RANK_MINE, 12 => RANK_FLAG, 13 => RANK_BOMB, _ => "rank_unknown",
    };

    public static int Encode(int side, int value) => side * 100 + value;
    public static string SideName(int side) => side == 1 ? "红方" : "蓝方";
    public static string RankName(string rank) => rank switch
    {
        RANK_COMMANDER => "司令", RANK_ARMY => "军长", RANK_DIVISION => "师长", RANK_BRIGADE => "旅长",
        RANK_REGIMENT => "团长", RANK_BATTALION => "营长", RANK_COMPANY => "连长", RANK_PLATOON => "排长",
        RANK_ENGINEER => "工兵", RANK_MINE => "地雷", RANK_FLAG => "军旗", _ => "?",
    };
}
