using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 斗兽棋规则 —— 7×9 棋盘、8 种兽、河/陷阱/兽穴特殊格。
///
/// 吃子按大小：鼠(1)→猫(2)→狗(3)→狼(4)→豹(5)→虎(6)→狮(7)→象(8)。
/// 特例：鼠吃象，象不能吃鼠。河里的鼠可以吃河里的鼠；陆上的鼠不能吃水里的鼠。
/// 狮/虎可跳河（横/竖方向，中间不能有鼠挡路）。
/// 陷阱：兽入对方陷阱可被任意吃。兽穴：己方兽入己方兽穴判负，入对方兽穴胜。
/// </summary>
public static class JungleRules
{
    public const int BoardW = 7;
    public const int BoardH = 9;

    /// <summary>兽的数值大小（1=鼠 … 8=象）</summary>
    public const int Rat = 1, Cat = 2, Dog = 3, Wolf = 4, Leopard = 5, Tiger = 6, Lion = 7, Elephant = 8;

    /// <summary>特殊格类型</summary>
    public const int Normal = 0, Water = 1, Trap = 2, Den = 3;

    /// <summary>初始布阵（side=1 在下方 rows 6-8，side=2 在上方 rows 0-2）</summary>
    private static readonly (int x, int y, int rank)[] InitPieces =
    [
        // side 2 (top, opponent)
        (0, 0, Lion), (6, 0, Tiger),
        (1, 1, Dog), (5, 1, Cat),
        (0, 2, Rat), (2, 2, Leopard), (4, 2, Wolf), (6, 2, Elephant),
        // side 1 (bottom, home)
        (6, 8, Lion), (0, 8, Tiger),
        (5, 7, Dog), (1, 7, Cat),
        (6, 6, Rat), (4, 6, Leopard), (2, 6, Wolf), (0, 6, Elephant),
    ];

    /// <summary>棋盘特殊格布局</summary>
    public static int CellType(int x, int y)
    {
        // 兽穴
        if ((x == 3 && y == 0) || (x == 3 && y == 8)) return Den;
        // 陷阱（每方 3 个，在兽穴周围）
        if ((x == 2 && y == 0) || (x == 4 && y == 0) || (x == 3 && y == 1)) return Trap;
        if ((x == 2 && y == 8) || (x == 4 && y == 8) || (x == 3 && y == 7)) return Trap;
        // 河（两块 2×3）
        if (x is 1 or 2 or 4 or 5 && y is 3 or 4 or 5) return Water;
        return Normal;
    }

    /// <summary>初始化事件</summary>
    public static List<GameEvent> InitialEvents(GameRoom r)
    {
        var evs = new List<GameEvent>();
        foreach (var (x, y, rank) in InitPieces)
        {
            var side = y < 3 ? 2 : 1; // 上方 = side 2，下方 = side 1
            evs.Add(new GameEvent { t = "setup", s = side, x = x, y = y, v = rank });
        }
        return evs;
    }

    /// <summary>校验走子并返回事件</summary>
    public static GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req)
    {
        if (side is not (1 or 2)) throw new ApiBadRequest("你不在这一局里");

        var fromX = req.TryGetProperty("fx", out var fx) ? fx.GetInt32() : -1;
        var fromY = req.TryGetProperty("fy", out var fy) ? fy.GetInt32() : -1;
        var toX = req.TryGetProperty("tx", out var tx) ? tx.GetInt32() : -1;
        var toY = req.TryGetProperty("ty", out var ty) ? ty.GetInt32() : -1;

        if (fromX < 0 || fromX >= BoardW || fromY < 0 || fromY >= BoardH)
            throw new ApiBadRequest("起点不合法");
        if (toX < 0 || toX >= BoardW || toY < 0 || toY >= BoardH)
            throw new ApiBadRequest("终点不合法");

        var board = Replay(evs);
        var myPiece = board[fromX, fromY];
        if (myPiece == 0) throw new ApiBadRequest("起点没有棋子");
        if (PieceSide(myPiece) != side) throw new ApiBadRequest("这不是你的棋子");

        var target = board[toX, toY];
        if (target != 0 && PieceSide(target) == side) throw new ApiBadRequest("不能吃自己的棋子");

        // 步长检查：只能走一格（狮/虎跳河除外）
        var dx = Math.Abs(toX - fromX);
        var dy = Math.Abs(toY - fromY);
        if (dx + dy == 0) throw new ApiBadRequest("不能原地不动");
        if (dx + dy > 1)
        {
            // 只有狮/虎可以跳河（必须跳过水面）
            var rank = PieceRank(myPiece);
            if (rank is not (Lion or Tiger)) throw new ApiBadRequest("只能走一格");
            if (dx > 1 && dy > 1) throw new ApiBadRequest("只能直线跳");
            if (dx > 1 || dy > 1)
            {
                // 必须跳过水面（中间有河）
                if (!CanJumpOverRiver(board, fromX, fromY, toX, toY, side))
                    throw new ApiBadRequest("只能跳过河面");
            }
        }

        // 水陆规则：只有鼠能进水
        var targetCell = CellType(toX, toY);
        if (targetCell == Water && PieceRank(myPiece) != Rat)
            throw new ApiBadRequest("只有鼠能下水");

        // 不能跳进自己的兽穴
        if (targetCell == Den && ((side == 1 && toY == 8) || (side == 2 && toY == 0)))
            throw new ApiBadRequest("不能进自己的兽穴");

        // 吃子规则
        if (target != 0 && !CanCapture(myPiece, target, fromX, fromY, toX, toY))
            throw new ApiBadRequest("不能吃这个棋子");

        return new GameEvent { t = "move", s = side, fx = fromX, fy = fromY, tx = toX, ty = toY, v = PieceRank(myPiece) };
    }

    /// <summary>走法是否合法（不抛错版）—— AI 合法着枚举共用，与 ValidateMove 同一套判定</summary>
    public static bool IsMovable(int[,] board, int fx, int fy, int tx, int ty, int side)
    {
        if (fx < 0 || fx >= BoardW || fy < 0 || fy >= BoardH) return false;
        if (tx < 0 || tx >= BoardW || ty < 0 || ty >= BoardH) return false;
        var myPiece = board[fx, fy];
        if (myPiece == 0 || PieceSide(myPiece) != side) return false;
        if (fx == tx && fy == ty) return false;

        var target = board[tx, ty];
        if (target != 0 && PieceSide(target) == side) return false;

        var dx = Math.Abs(tx - fx);
        var dy = Math.Abs(ty - fy);
        if (dx + dy > 1)
        {
            if (PieceRank(myPiece) is not (Lion or Tiger)) return false;
            if (dx > 1 && dy > 1) return false;
            if (!CanJumpOverRiver(board, fx, fy, tx, ty, side)) return false;
        }

        var targetCell = CellType(tx, ty);
        if (targetCell == Water && PieceRank(myPiece) != Rat) return false;
        if (targetCell == Den && ((side == 1 && ty == 8) || (side == 2 && ty == 0))) return false;
        if (target != 0 && !CanCapture(myPiece, target, fx, fy, tx, ty)) return false;
        return true;
    }

    /// <summary>该 side 的全部合法着 —— AI 兜底用：空列表 = 真无合法着</summary>
    public static List<(int fx, int fy, int tx, int ty)> AllMoves(int[,] board, int side)
    {
        var moves = new List<(int, int, int, int)>();
        for (var fx = 0; fx < BoardW; fx++)
        for (var fy = 0; fy < BoardH; fy++)
        {
            if (board[fx, fy] == 0 || PieceSide(board[fx, fy]) != side) continue;
            for (var tx = 0; tx < BoardW; tx++)
            for (var ty = 0; ty < BoardH; ty++)
            {
                if (IsMovable(board, fx, fy, tx, ty, side)) moves.Add((fx, fy, tx, ty));
            }
        }
        return moves;
    }

    public static List<(int fx, int fy, int tx, int ty)> AllMoves(IReadOnlyList<GameEvent> evs, int side) =>
        AllMoves(Replay(evs), side);

    /// <summary>判定终局</summary>
    public static (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r)
    {
        var board = Replay(evs);

        // 兽穴判定：己方兽入对方兽穴 → 胜
        for (var x = 0; x < BoardW; x++)
        {
            for (var y = 0; y < BoardH; y++)
            {
                if (CellType(x, y) != Den) continue;
                var piece = board[x, y];
                if (piece == 0) continue;
                var side = PieceSide(piece);
                // 入对方兽穴：side 1 入 y=0 的穴，side 2 入 y=8 的穴
                if ((side == 1 && y == 0) || (side == 2 && y == 8))
                    return (side, "den", true);
                // 入自己兽穴判负（被规则阻止了，但双保险）
                if ((side == 1 && y == 8) || (side == 2 && y == 0))
                    return (side == 1 ? 2 : 1, "ownden", true);
            }
        }

        // 无子可走 = 判负（困毙）
        var side1HasMoves = HasAnyMove(board, 1);
        var side2HasMoves = HasAnyMove(board, 2);
        if (!side1HasMoves && !side2HasMoves) return (3, "draw", true);
        if (!side1HasMoves) return (2, "blocked", true);
        if (!side2HasMoves) return (1, "blocked", true);

        return (0, "", false);
    }

    /// <summary>构建 per-game 快照</summary>
    public static object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished)
    {
        var board = Replay(evs);
        var lastMove = evs.LastOrDefault(e => e.t == "move");

        var pieces = new List<object>();
        for (var x = 0; x < BoardW; x++)
        {
            for (var y = 0; y < BoardH; y++)
            {
                if (board[x, y] != 0)
                    pieces.Add(new { x, y, side = PieceSide(board[x, y]), rank = PieceRank(board[x, y]) });
            }
        }

        return new
        {
            boardW = BoardW,
            boardH = BoardH,
            pieces,
            lastMove = lastMove is null ? null : new { fx = lastMove.fx, fy = lastMove.fy, tx = lastMove.tx, ty = lastMove.ty },
        };
    }

    /// <summary>重建盘面状态。返回 [x,y] = 0(空) 或 side*10+rank</summary>
    public static int[,] Replay(IReadOnlyList<GameEvent> evs)
    {
        var board = new int[BoardW, BoardH];

        // setup 事件初始化棋子
        foreach (var e in evs)
        {
            if (e.t != "setup" || e.x is not int sx || e.y is not int sy || e.v is not int rank) continue;
            board[sx, sy] = e.s * 10 + rank;
        }

        // move 事件移动棋子
        foreach (var e in evs)
        {
            if (e.t != "move") continue;
            if (e.fx is not int fx || e.fy is not int fy || e.tx is not int tx || e.ty is not int ty) continue;
            var piece = board[fx, fy];
            if (piece == 0) continue;
            board[fx, fy] = 0;
            board[tx, ty] = piece;
        }
        return board;
    }

    /// <summary>判断吃子是否合法</summary>
    private static bool CanCapture(int attacker, int defender, int fromX, int fromY, int toX, int toY)
    {
        var attRank = PieceRank(attacker);
        var defRank = PieceRank(defender);
        var attInWater = CellType(fromX, fromY) == Water;
        var defInWater = CellType(toX, toY) == Water;
        var defOnTrap = CellType(toX, toY) == Trap;

        // 水陆互不吃：水里的不能吃陆上的，陆上的也不能吃水里的
        //（水鼠吃水鼠双方都在水里，不受影响；狮虎跳河落点是陆，也不受影响）
        if (attInWater != defInWater) return false;

        // 陷阱只削弱「闯入敌方陷阱」的兽：己方陷阱里的己方兽不受削弱
        // 陷阱归属：上排（y<=1）属 side2，下排（y>=7）属 side1
        var trapOwner = toY <= 1 ? 2 : 1;
        if (defOnTrap && trapOwner != PieceSide(defender)) return true;

        // 鼠吃象特例
        if (attRank == Rat && defRank == Elephant) return true;
        // 象不能吃鼠
        if (attRank == Elephant && defRank == Rat) return false;

        // 普通吃子：大吃小
        return attRank >= defRank;
    }

    /// <summary>狮/虎跳河检查：必须跨越水面（中间全是水），起点终点在陆地</summary>
    private static bool CanJumpOverRiver(int[,] board, int fromX, int fromY, int toX, int toY, int side)
    {
        // 起点和终点不能是水（鼠才在水里）
        if (CellType(fromX, fromY) == Water || CellType(toX, toY) == Water) return false;

        var dx = Math.Sign(toX - fromX);
        var dy = Math.Sign(toY - fromY);
        var cx = fromX + dx;
        var cy = fromY + dy;
        var waterCount = 0;

        while (cx != toX || cy != toY)
        {
            // 中间格必须全是水（跳河）
            if (CellType(cx, cy) != Water) return false;
            waterCount++;
            // 水里不能有鼠挡路
            if (board[cx, cy] != 0 && PieceRank(board[cx, cy]) == Rat) return false;
            cx += dx;
            cy += dy;
        }

        // 必须至少跨越一块水面（否则是旱地两格跳，不允许）
        return waterCount > 0;
    }

    /// <summary>该方是否有任何合法走法</summary>
    private static bool HasAnyMove(int[,] board, int side)
    {
        for (var x = 0; x < BoardW; x++)
        for (var y = 0; y < BoardH; y++)
        {
            if (board[x, y] == 0 || PieceSide(board[x, y]) != side) continue;
            for (var tx = 0; tx < BoardW; tx++)
            for (var ty = 0; ty < BoardH; ty++)
            {
                try
                {
                    // 简单检查：步长 1 或跳河
                    var dx = Math.Abs(tx - x);
                    var dy = Math.Abs(ty - y);
                    if (dx + dy == 0 || dx + dy > 1 && dx > 0 && dy > 0) continue;
                    if (dx + dy > 1 && PieceRank(board[x, y]) is not (Lion or Tiger)) continue;
                    if (CellType(tx, ty) == Water && PieceRank(board[x, y]) != Rat) continue;
                    if (CellType(tx, ty) == Den && ((side == 1 && ty == 8) || (side == 2 && ty == 0))) continue;
                    var target = board[tx, ty];
                    if (target != 0 && PieceSide(target) == side) continue;
                    if (target != 0 && !CanCapture(board[x, y], target, x, y, tx, ty)) continue;
                    return true;
                }
                catch { /* ignore */ }
            }
        }
        return false;
    }

    /// <summary>棋子编码：side*10+rank</summary>
    public static int Encode(int side, int rank) => side * 10 + rank;
    public static int PieceSide(int piece) => piece / 10;
    public static int PieceRank(int piece) => piece % 10;

    /// <summary>方名</summary>
    public static string SideName(int side) => side == 1 ? "红方" : "蓝方";

    /// <summary>另一方</summary>
    public static int Other(int side) => side == 1 ? 2 : 1;

    /// <summary>兽名</summary>
    public static string RankName(int rank) => rank switch
    {
        Rat => "鼠", Cat => "猫", Dog => "狗", Wolf => "狼",
        Leopard => "豹", Tiger => "虎", Lion => "狮", Elephant => "象",
        _ => "?",
    };
}
