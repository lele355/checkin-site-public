using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 象棋规则 —— 9×10 交叉点棋盘、楚河汉界、7 种棋子。
/// 判定：将死 / 困毙 / 认输 / 超时 / 老将对脸 / 应将校验。
/// 已裁定砍掉：长将/长捉判负。三次重复判和（P1 兜底）。
/// </summary>
public static class XiangqiRules
{
    public const int BoardW = 9;
    public const int BoardH = 10;

    // 棋子类型
    public const int General = 1, Advisor = 2, Elephant = 3, Horse = 4, Rook = 5, Cannon = 6, Pawn = 7;

    /// <summary>初始布阵（side=1 下方 rows 5-9，side=2 上方 rows 0-4）</summary>
    private static readonly (int x, int y, int type)[] InitPieces =
    [
        // side 2 (top, black)
        (0, 0, Rook), (1, 0, Horse), (2, 0, Elephant), (3, 0, Advisor), (4, 0, General),
        (5, 0, Advisor), (6, 0, Elephant), (7, 0, Horse), (8, 0, Rook),
        (1, 2, Cannon), (7, 2, Cannon),
        (0, 3, Pawn), (2, 3, Pawn), (4, 3, Pawn), (6, 3, Pawn), (8, 3, Pawn),
        // side 1 (bottom, red)
        (0, 9, Rook), (1, 9, Horse), (2, 9, Elephant), (3, 9, Advisor), (4, 9, General),
        (5, 9, Advisor), (6, 9, Elephant), (7, 9, Horse), (8, 9, Rook),
        (1, 7, Cannon), (7, 7, Cannon),
        (0, 6, Pawn), (2, 6, Pawn), (4, 6, Pawn), (6, 6, Pawn), (8, 6, Pawn),
    ];

    /// <summary>初始化事件</summary>
    public static List<GameEvent> InitialEvents(GameRoom r)
    {
        var evs = new List<GameEvent>();
        foreach (var (x, y, type) in InitPieces)
        {
            var side = y >= 5 ? 1 : 2;
            evs.Add(new GameEvent { t = "setup", s = side, x = x, y = y, v = type });
        }
        return evs;
    }

    /// <summary>校验走子（含应将校验：走完不能让己方将帅处于被攻击）</summary>
    public static GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req)
    {
        if (side is not (1 or 2)) throw new ApiBadRequest("你不在这一局里");

        var fromX = req.TryGetProperty("fx", out var fx) ? fx.GetInt32() : -1;
        var fromY = req.TryGetProperty("fy", out var fy) ? fy.GetInt32() : -1;
        var toX = req.TryGetProperty("tx", out var tx) ? tx.GetInt32() : -1;
        var toY = req.TryGetProperty("ty", out var ty) ? ty.GetInt32() : -1;

        if (fromX < 0 || fromX >= BoardW || fromY < 0 || fromY >= BoardH) throw new ApiBadRequest("起点不合法");
        if (toX < 0 || toX >= BoardW || toY < 0 || toY >= BoardH) throw new ApiBadRequest("终点不合法");

        var board = Replay(evs);
        var piece = board[fromX, fromY];
        if (piece == 0) throw new ApiBadRequest("起点没有棋子");
        if (PieceSide(piece) != side) throw new ApiBadRequest("这不是你的棋子");
        if (fromX == toX && fromY == toY) throw new ApiBadRequest("不能原地不动");

        var target = board[toX, toY];
        if (target != 0 && PieceSide(target) == side) throw new ApiBadRequest("不能吃自己的棋子");

        if (!IsValidMove(board, fromX, fromY, toX, toY, side, PieceType(piece)))
            throw new ApiBadRequest("走法不合法");

        // 应将校验：走完后己方将帅不能被攻击
        var next = CloneBoard(board);
        next[fromX, fromY] = 0;
        next[toX, toY] = piece;
        if (IsGeneralAttacked(next, side))
            throw new ApiBadRequest("走完会被将军");

        // 老将对脸：走完后两将不能对面
        if (IsGeneralFacing(next))
            throw new ApiBadRequest("将帅不能对脸");

        return new GameEvent { t = "move", s = side, fx = fromX, fy = fromY, tx = toX, ty = toY, v = PieceType(piece) };
    }

    /// <summary>判定终局</summary>
    public static (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r)
    {
        var board = Replay(evs);

        // 检查双方是否被将死/困毙
        for (var s = 1; s <= 2; s++)
        {
            var opp = s == 1 ? 2 : 1;
            if (IsGeneralAttacked(board, s))
            {
                // 被将军：看有没有解着
                if (!HasLegalMove(board, s))
                    return (opp, "checkmate", true);
            }
            else
            {
                // 没被将军：困毙 = 没有合法走法
                if (!HasLegalMove(board, s))
                    return (opp, "stalemate", true);
            }
        }

        // 三次重复判和：检测最后 N 步是否形成重复局面
        if (CheckThreefoldRepetition(evs))
            return (3, "repetition", true);

        return (0, "", false);
    }

    /// <summary>构建 per-game 快照</summary>
    public static object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished)
    {
        var board = Replay(evs);
        var lastMove = evs.LastOrDefault(e => e.t == "move");

        var pieces = new List<object>();
        for (var x = 0; x < BoardW; x++)
            for (var y = 0; y < BoardH; y++)
                if (board[x, y] != 0)
                    pieces.Add(new { x, y, side = PieceSide(board[x, y]), type = PieceType(board[x, y]) });

        // 将军检测
        var inCheck1 = IsGeneralAttacked(board, 1);
        var inCheck2 = IsGeneralAttacked(board, 2);

        // 可走提示按需化（QA §3-P1）：不再随快照全量 Build（曾 1424 次 ValidateMove/轮询）；
        // 单子提示走 GET /rooms/{id}/hints，数据仍由正式校验器生成。

        return new
        {
            boardW = BoardW,
            boardH = BoardH,
            pieces,
            // fx/fy 兼容哨兵（BUG-3）：缺失时序列化 fx=tx, fy=ty，旧 App 非空 Int 反序列化不炸
            lastMove = lastMove is null ? null : new { fx = lastMove.fx ?? lastMove.tx, fy = lastMove.fy ?? lastMove.ty, tx = lastMove.tx, ty = lastMove.ty },
            inCheck = mySide == 1 ? inCheck1 : inCheck2,
        };
    }

    /// <summary>重建盘面。[x,y] = side*10+type</summary>
    public static int[,] Replay(IReadOnlyList<GameEvent> evs)
    {
        var board = new int[BoardW, BoardH];
        foreach (var e in evs)
        {
            if (e.t == "setup" && e.x is int sx && e.y is int sy && e.v is int type)
                board[sx, sy] = e.s * 10 + type;
            else if (e.t == "move" && e.fx is int fx && e.fy is int fy && e.tx is int tx && e.ty is int ty)
            {
                var piece = board[fx, fy];
                if (piece == 0) continue;
                board[fx, fy] = 0;
                board[tx, ty] = piece;
            }
        }
        return board;
    }

    /// <summary>检查走法是否符合棋子规则</summary>
    private static bool IsValidMove(int[,] board, int fx, int fy, int tx, int ty, int side, int type)
    {
        return type switch
        {
            General => IsValidGeneral(board, fx, fy, tx, ty, side),
            Advisor => IsValidAdvisor(fx, fy, tx, ty, side),
            Elephant => IsValidElephant(board, fx, fy, tx, ty, side),
            Horse => IsValidHorse(board, fx, fy, tx, ty, side),
            Rook => IsValidRook(board, fx, fy, tx, ty),
            Cannon => IsValidCannon(board, fx, fy, tx, ty),
            Pawn => IsValidPawn(fx, fy, tx, ty, side),
            _ => false,
        };
    }

    private static bool IsValidGeneral(int[,] board, int fx, int fy, int tx, int ty, int side)
    {
        // 将/帅：九宫内一步
        var dx = Math.Abs(tx - fx);
        var dy = Math.Abs(ty - fy);
        if (dx + dy != 1) return false;
        return IsInPalace(tx, ty, side);
    }

    private static bool IsValidAdvisor(int fx, int fy, int tx, int ty, int side)
    {
        var dx = Math.Abs(tx - fx);
        var dy = Math.Abs(ty - fy);
        return dx == 1 && dy == 1 && IsInPalace(tx, ty, side);
    }

    private static bool IsValidElephant(int[,] board, int fx, int fy, int tx, int ty, int side)
    {
        var dx = Math.Abs(tx - fx);
        var dy = Math.Abs(ty - fy);
        if (dx != 2 || dy != 2) return false;
        // 不能过河
        if (side == 1 && ty < 5) return false;
        if (side == 2 && ty > 4) return false;
        // 象眼不能被塞
        var mx = (fx + tx) / 2;
        var my = (fy + ty) / 2;
        return board[mx, my] == 0;
    }

    private static bool IsValidHorse(int[,] board, int fx, int fy, int tx, int ty, int side)
    {
        var dx = Math.Abs(tx - fx);
        var dy = Math.Abs(ty - fy);
        if (!((dx == 1 && dy == 2) || (dx == 2 && dy == 1))) return false;
        // 马腿检查
        int legX = dx == 2 ? (fx + tx) / 2 : fx;
        int legY = dy == 2 ? (fy + ty) / 2 : fy;
        return board[legX, legY] == 0;
    }

    private static bool IsValidRook(int[,] board, int fx, int fy, int tx, int ty)
    {
        if (fx != tx && fy != ty) return false;
        // 路上不能有子
        var dx = Math.Sign(tx - fx);
        var dy = Math.Sign(ty - fy);
        var cx = fx + dx;
        var cy = fy + dy;
        while (cx != tx || cy != ty)
        {
            if (board[cx, cy] != 0) return false;
            cx += dx;
            cy += dy;
        }
        return true;
    }

    private static bool IsValidCannon(int[,] board, int fx, int fy, int tx, int ty)
    {
        if (fx != tx && fy != ty) return false;
        var dx = Math.Sign(tx - fx);
        var dy = Math.Sign(ty - fy);
        var cx = fx + dx;
        var cy = fy + dy;
        var count = 0;
        while (cx != tx || cy != ty)
        {
            if (board[cx, cy] != 0) count++;
            cx += dx;
            cy += dy;
        }
        // 吃子必须隔一子（炮架），不吃子必须路上无子
        var target = board[tx, ty];
        return target != 0 ? count == 1 : count == 0;
    }

    private static bool IsValidPawn(int fx, int fy, int tx, int ty, int side)
    {
        var dx = Math.Abs(tx - fx);
        var dy = Math.Abs(ty - fy);
        if (dx + dy != 1) return false;
        // 兵/卒：过河前只能向前，过河后可左右，不能后退
        // 红（side1）从下往上走，过河 = 已到 y<=4；黑（side2）从上往下走，过河 = 已到 y>=5
        if (side == 1)
        {
            if (ty > fy) return false; // 不能后退
            if (fy >= 5 && dx > 0) return false; // 未过河不能横走
        }
        else
        {
            if (ty < fy) return false;
            if (fy <= 4 && dx > 0) return false;
        }
        return true;
    }

    private static bool IsInPalace(int x, int y, int side) =>
        x >= 3 && x <= 5 && (side == 1 ? y >= 7 && y <= 9 : y >= 0 && y <= 2);

    /// <summary>检查将帅是否被攻击</summary>
    public static bool IsGeneralAttacked(int[,] board, int side)
    {
        // 找将/帅位置
        var gx = -1;
        var gy = -1;
        for (var x = 3; x <= 5; x++)
        {
            for (var y = (side == 1 ? 7 : 0); y <= (side == 1 ? 9 : 2); y++)
            {
                if (board[x, y] == side * 10 + General) { gx = x; gy = y; break; }
            }
        }
        if (gx < 0) return true; // 将被吃了 = 输

        // 检查对方所有棋子能否攻击到将/帅
        var opp = side == 1 ? 2 : 1;
        for (var x = 0; x < BoardW; x++)
        {
            for (var y = 0; y < BoardH; y++)
            {
                if (board[x, y] == 0 || PieceSide(board[x, y]) != opp) continue;
                if (IsValidMove(board, x, y, gx, gy, opp, PieceType(board[x, y])))
                    return true;
            }
        }
        return false;
    }

    /// <summary>老将对脸</summary>
    public static bool IsGeneralFacing(int[,] board)
    {
        var g1x = -1; var g1y = -1;
        var g2x = -1; var g2y = -1;
        for (var x = 3; x <= 5; x++)
        {
            for (var y = 0; y < BoardH; y++)
            {
                if (board[x, y] == 1 * 10 + General) { g1x = x; g1y = y; }
                if (board[x, y] == 2 * 10 + General) { g2x = x; g2y = y; }
            }
        }
        if (g1x < 0 || g2x < 0) return false;
        if (g1x != g2x) return false;
        // 中间不能有子
        var minY = Math.Min(g1y, g2y);
        var maxY = Math.Max(g1y, g2y);
        for (var y = minY + 1; y < maxY; y++)
            if (board[g1x, y] != 0) return false;
        return true;
    }

    /// <summary>该方是否有任何合法走法</summary>
    private static bool HasLegalMove(int[,] board, int side)
    {
        for (var fx = 0; fx < BoardW; fx++)
        {
            for (var fy = 0; fy < BoardH; fy++)
            {
                if (board[fx, fy] == 0 || PieceSide(board[fx, fy]) != side) continue;
                var type = PieceType(board[fx, fy]);
                for (var tx = 0; tx < BoardW; tx++)
                {
                    for (var ty = 0; ty < BoardH; ty++)
                    {
                        if (fx == tx && fy == ty) continue;
                        if (board[tx, ty] != 0 && PieceSide(board[tx, ty]) == side) continue;
                        if (!IsValidMove(board, fx, fy, tx, ty, side, type)) continue;
                        // 应将校验
                        var next = CloneBoard(board);
                        next[fx, fy] = 0;
                        next[tx, ty] = board[fx, fy];
                        if (IsGeneralAttacked(next, side)) continue;
                        if (IsGeneralFacing(next)) continue;
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /// <summary>该 side 的全部合法着（含应将/照面过滤）—— AI 兜底用：空列表 = 困毙</summary>
    public static List<(int fx, int fy, int tx, int ty)> AllMoves(IReadOnlyList<GameEvent> evs, int side)
    {
        var board = Replay(evs);
        var moves = new List<(int, int, int, int)>();
        for (var fx = 0; fx < BoardW; fx++)
        for (var fy = 0; fy < BoardH; fy++)
        {
            if (board[fx, fy] == 0 || PieceSide(board[fx, fy]) != side) continue;
            var type = PieceType(board[fx, fy]);
            for (var tx = 0; tx < BoardW; tx++)
            for (var ty = 0; ty < BoardH; ty++)
            {
                if (fx == tx && fy == ty) continue;
                if (board[tx, ty] != 0 && PieceSide(board[tx, ty]) == side) continue;
                if (!IsValidMove(board, fx, fy, tx, ty, side, type)) continue;
                var next = CloneBoard(board);
                next[fx, fy] = 0;
                next[tx, ty] = board[fx, fy];
                if (IsGeneralAttacked(next, side)) continue;
                if (IsGeneralFacing(next)) continue;
                moves.Add((fx, fy, tx, ty));
            }
        }
        return moves;
    }

    /// <summary>检查是否出现三次重复局面</summary>
    private static bool CheckThreefoldRepetition(IReadOnlyList<GameEvent> evs)
    {
        // 全局扫描：对「布阵完成后」及每个「move 后」的局面做哈希（含行棋方），
        // 任一局面出现 ≥3 次判和。初始局面也计入（来回拉车三次回到起点 = 三次重复）。
        var counts = new Dictionary<string, int>();
        var board = new int[BoardW, BoardH];
        var nextSide = 1;            // 红先
        var setupDone = false;

        bool Hash()
        {
            var sb = new System.Text.StringBuilder();
            for (var x = 0; x < BoardW; x++)
                for (var y = 0; y < BoardH; y++)
                    if (board[x, y] != 0)
                        sb.Append(x).Append(',').Append(y).Append('=').Append(board[x, y]).Append(';');
            sb.Append("|t=").Append(nextSide);
            counts.TryGetValue(sb.ToString(), out var c);
            counts[sb.ToString()] = c + 1;
            return c + 1 >= 3;
        }

        foreach (var e in evs)
        {
            if (e.t == "setup" && e.x is int sx && e.y is int sy && e.v is int v)
            {
                board[sx, sy] = e.s * 10 + v;
                continue;
            }
            if (!setupDone)
            {
                setupDone = true;
                if (Hash()) return true;   // 初始局面
            }
            if (e.t != "move" || e.fx is not int fx || e.fy is not int fy
                || e.tx is not int tx || e.ty is not int ty) continue;

            var piece = board[fx, fy];
            if (piece == 0) continue;
            board[fx, fy] = 0;
            board[tx, ty] = piece;
            nextSide = Other(PieceSide(piece));
            if (Hash()) return true;
        }
        return false;
    }

    private static int[,] CloneBoard(int[,] board)
    {
        var clone = new int[BoardW, BoardH];
        Array.Copy(board, clone, board.Length);
        return clone;
    }

    /// <summary>棋子编码：side*10+type</summary>
    public static int Encode(int side, int type) => side * 10 + type;
    public static int PieceSide(int piece) => piece / 10;
    public static int PieceType(int piece) => piece % 10;

    public static string SideName(int side) => side == 1 ? "红方" : "黑方";

    public static int Other(int side) => side == 1 ? 2 : 1;
    public static string TypeName(int type) => type switch
    {
        General => "将", Advisor => "士", Elephant => "象", Horse => "马",
        Rook => "车", Cannon => "炮", Pawn => "兵", _ => "?",
    };
}
