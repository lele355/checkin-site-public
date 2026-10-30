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

    /// <summary>随机布阵（硬要求：军旗在大本营、地雷在最后两排、其余随机）</summary>
    public static List<GameEvent> InitialEvents(GameRoom r)
    {
        var evs = new List<GameEvent>();
        var pieceId = 0;

        foreach (var side in new[] { 1, 2 })
        {
            // 生成该方 25 枚棋子
            var pieces = new List<(string rank, int value)>();
            foreach (var (rank, value, count) in PieceSpec)
                for (int i = 0; i < count; i++)
                    pieces.Add((rank, value));

            // 随机打乱
            var rng = Random.Shared;
            for (int i = pieces.Count - 1; i > 0; i--)
            {
                int j = rng.Next(i + 1);
                (pieces[i], pieces[j]) = (pieces[j], pieces[i]);
            }

            // 该方可放置的位置
            var rows = side == 1 ? Enumerable.Range(6, 6).ToList() : Enumerable.Range(0, 6).ToList();
            var positions = new List<(int x, int y)>();
            foreach (var y in rows)
                for (int x = 0; x < BoardW; x++)
                    positions.Add((x, y));

            // 约束放置：军旗必须在大本营
            var flagIdx = pieces.FindIndex(p => p.rank == RANK_FLAG);
            var flagPos = DenPositions.First(d => (side == 1 && d.y >= 6) || (side == 2 && d.y <= 5));
            positions.Remove(flagPos);
            evs.Add(new GameEvent { t = "setup", s = side, x = flagPos.x, y = flagPos.y, v = 12, p = pieceId++ });
            pieces.RemoveAt(flagIdx);

            // 地雷只在最后两排
            var lastTwoRows = side == 1 ? new[] { 10, 11 } : new[] { 0, 1 };
            var mineSpots = positions.Where(p => lastTwoRows.Contains(p.y)).ToList();
            var mineCount = pieces.Count(p => p.rank == RANK_MINE);
            for (int i = 0; i < mineCount && mineSpots.Count > 0; i++)
            {
                var spot = mineSpots[rng.Next(mineSpots.Count)];
                mineSpots.Remove(spot);
                positions.Remove(spot);
                evs.Add(new GameEvent { t = "setup", s = side, x = spot.x, y = spot.y, v = 11, p = pieceId++ });
                pieces.RemoveAll(p => p.rank == RANK_MINE);
            }

            // 其余棋子随机放
            foreach (var (rank, value) in pieces)
            {
                if (positions.Count == 0) break;
                var spot = positions[rng.Next(positions.Count)];
                positions.Remove(spot);
                evs.Add(new GameEvent { t = "setup", s = side, x = spot.x, y = spot.y, v = value, p = pieceId++ });
            }
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

        // 步长：只能走一格（横/竖）
        var dx = Math.Abs(toX - fromX);
        var dy = Math.Abs(toY - fromY);
        if (dx + dy != 1) throw new ApiBadRequest("只能走一格");
        if (dx > 1 || dy > 1) throw new ApiBadRequest("只能走一格");

        // 不能走进自己大本营
        if (CellType(toX, toY) == Den && ((side == 1 && toY >= 6) || (side == 2 && toY <= 5)))
            throw new ApiBadRequest("不能进自己的大本营");

        // 目标格检查
        var target = board[toX, toY];
        if (target != 0 && PieceSide(target) == side) throw new ApiBadRequest("不能吃自己的棋子");

        // 行营安全区：子在行营内不可被吃
        if (target != 0 && CellType(toX, toY) == Camp)
            throw new ApiBadRequest("行营里的棋子不能被吃");

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
                // 己方棋子始终可见；对方棋子只有参战后才可见
                var isRevealed = side == mySide || (hasId && revealedIds.Contains(pid)) || finished;

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
            squares,
            pieces,
            battleLog,
            events = eventsOut,
            lastMove = lastMove is null ? null : new { fx = lastMove.fx, fy = lastMove.fy, tx = lastMove.tx, ty = lastMove.ty },
        };
    }

    /// <summary>
    /// 【硬要求 1】参战即公开：battle 事件里的棋子永久 hidden:false。
    /// 【硬要求 6】按棋子身份（ID）追踪，不是坐标。
    /// 【健壮性】setup 缺 p 时 idMap 为空 → 所有棋子无 ID → GetRevealedIds 匹配不到 → 全部 hidden（安全侧）。
    /// </summary>
    private static HashSet<int> GetRevealedIds(IReadOnlyList<GameEvent> evs)
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

    /// <summary>该方是否有任何合法走法</summary>
    private static bool HasAnyMove(int[,] board, int side)
    {
        for (var x = 0; x < BoardW; x++)
        {
            for (var y = 0; y < BoardH; y++)
            {
                var piece = board[x, y];
                if (piece == 0 || PieceSide(piece) != side) continue;
                var rank = PieceRank(piece);
                if (rank == RANK_FLAG || rank == RANK_MINE) continue;

                foreach (var (dx, dy) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
                {
                    var tx = x + dx;
                    var ty = y + dy;
                    if (tx < 0 || tx >= BoardW || ty < 0 || ty >= BoardH) continue;
                    if (CellType(tx, ty) == Den && ((side == 1 && ty >= 6) || (side == 2 && ty <= 5))) continue;
                    var target = board[tx, ty];
                    if (target != 0 && PieceSide(target) == side) continue;
                    if (target != 0 && CellType(tx, ty) == Camp) continue;
                    return true;
                }
            }
        }
        return false;
    }

    /// <summary>rank value 换算</summary>
    private static int RankValue(string rank) => rank switch
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
