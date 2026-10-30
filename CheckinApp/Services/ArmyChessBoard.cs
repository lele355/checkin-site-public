using System.Text.Json;

namespace CheckinApp.Services;

/// <summary>
/// 军旗棋盘图模型（设计 §2.1 / §9.1）—— 5 列 × 12 行 = 60 节点，node = y*5+x。
/// 邻接表静态构建一次；三种行棋查询（公路一步 / 铁路直线滑行 / 工兵 BFS）全部是纯函数，
/// ValidateMove / HasAnyMove / AI 着法生成三处共用同一实现（不许各写一套）。
///
/// 常量表与网页 armychess.js / App ArmyChessBoard.kt 三端同源（§9.1）。
/// </summary>
public static class ArmyChessBoard
{
    public const int W = ArmyChessRules.BoardW;   // 5
    public const int H = ArmyChessRules.BoardH;   // 12
    public const int N = W * H;                   // 60

    /// <summary>边类型：铁路（粗线，可滑行）/ 公路（细线，一步）</summary>
    public const int Rail = 1, Road = 2;

    public static int Node(int x, int y) => y * W + x;
    public static (int x, int y) Coord(int node) => (node % W, node / W);

    // ---------------- 静态拓扑（§9.1 常量表） ----------------

    /// <summary>铁路横线所在行</summary>
    private static readonly int[] RailRows = [1, 5, 6, 10];
    /// <summary>铁路纵线所在列</summary>
    private static readonly int[] RailCols = [0, 4];
    /// <summary>中央铁路通道：(2,5)-(2,6)</summary>
    private static readonly ((int x, int y) a, (int x, int y) b) CentralRail = ((2, 5), (2, 6));
    /// <summary>山界缺口：公路铁路皆断（无任何边）</summary>
    private static readonly ((int x, int y) a, (int x, int y) b)[] Gaps =
    [((1, 5), (1, 6)), ((3, 5), (3, 6))];

    /// <summary>行营斜边（公路），完整表（§9.1）：每个行营与其 4 个对角邻格</summary>
    private static readonly ((int x, int y) camp, (int x, int y) diag)[] CampDiagonals =
    [
        ((1, 2), (0, 1)), ((1, 2), (2, 1)), ((1, 2), (0, 3)), ((1, 2), (2, 3)),
        ((3, 2), (2, 1)), ((3, 2), (4, 1)), ((3, 2), (2, 3)), ((3, 2), (4, 3)),
        ((2, 3), (1, 2)), ((2, 3), (3, 2)), ((2, 3), (1, 4)), ((2, 3), (3, 4)),
        ((1, 4), (0, 3)), ((1, 4), (2, 3)), ((1, 4), (0, 5)), ((1, 4), (2, 5)),
        ((3, 4), (2, 3)), ((3, 4), (4, 3)), ((3, 4), (2, 5)), ((3, 4), (4, 5)),
        // 下半场镜像 y → 11−y
        ((1, 9), (0, 10)), ((1, 9), (2, 10)), ((1, 9), (0, 8)), ((1, 9), (2, 8)),
        ((3, 9), (2, 10)), ((3, 9), (4, 10)), ((3, 9), (2, 8)), ((3, 9), (4, 8)),
        ((2, 8), (1, 9)), ((2, 8), (3, 9)), ((2, 8), (1, 7)), ((2, 8), (3, 7)),
        ((1, 7), (0, 8)), ((1, 7), (2, 8)), ((1, 7), (0, 6)), ((1, 7), (2, 6)),
        ((3, 7), (2, 8)), ((3, 7), (4, 8)), ((3, 7), (2, 6)), ((3, 7), (4, 6)),
    ];

    /// <summary>邻接表：Adj[node] = [(对端, 边类型)]，每对只出现一次</summary>
    public static readonly List<(int to, int kind)>[] Adj = BuildAdj();

    private static List<(int to, int kind)>[] BuildAdj()
    {
        var adj = new List<(int to, int kind)>[N];
        for (var i = 0; i < N; i++) adj[i] = [];
        var kind = new int[N, N];   // 0 无边 / Rail / Road

        void Link((int x, int y) a, (int x, int y) b, int k)
        {
            if (a.x < 0 || a.x >= W || a.y < 0 || a.y >= H) return;
            if (b.x < 0 || b.x >= W || b.y < 0 || b.y >= H) return;
            var na = Node(a.x, a.y);
            var nb = Node(b.x, b.y);
            if (kind[na, nb] == k) return;                  // 已按同类型连过
            if (kind[na, nb] != 0 && kind[na, nb] != k) return; // 重复对（理论不达）
            kind[na, nb] = k;
            kind[nb, na] = k;
            adj[na].Add((nb, k));
            adj[nb].Add((na, k));
        }

        bool IsGap((int x, int y) a, (int x, int y) b) =>
            Gaps.Any(g => (g.a == a && g.b == b) || (g.a == b && g.b == a));

        // 1) 铁路：横（整行）
        foreach (var y in RailRows)
            for (var x = 0; x < W - 1; x++)
                Link((x, y), (x + 1, y), Rail);
        // 2) 铁路：纵（整列）
        foreach (var x in RailCols)
            for (var y = 0; y < H - 1; y++)
                Link((x, y), (x, y + 1), Rail);
        // 3) 中央铁路通道
        Link(CentralRail.a, CentralRail.b, Rail);

        // 4) 公路：全部正交相邻 − 铁路 − 山界缺口
        for (var y = 0; y < H; y++)
        for (var x = 0; x < W; x++)
        {
            foreach (var (dx, dy) in new[] { (1, 0), (0, 1) })
            {
                var nx = x + dx;
                var ny = y + dy;
                if (nx >= W || ny >= H) continue;
                if (IsGap((x, y), (nx, ny))) continue;      // 山界缺口：无任何边
                if (kind[Node(x, y), Node(nx, ny)] == Rail) continue;   // 铁路边不再当公路
                Link((x, y), (nx, ny), Road);
            }
        }

        // 5) 行营斜边（公路）
        foreach (var (camp, diag) in CampDiagonals)
            Link(camp, diag, Road);

        return adj;
    }

    // ---------------- 行棋查询（三处共用） ----------------

    private static int Occ(int[,] board, int node)
    {
        var (x, y) = Coord(node);
        return board[x, y];
    }

    /// <summary>该节点上的棋子是否可以移动（军旗/地雷不可动；大本营内冻结）</summary>
    private static bool Movable(int[,] board, int node)
    {
        var piece = Occ(board, node);
        if (piece == 0) return false;
        var rank = ArmyChessRules.PieceRank(piece);
        if (rank is ArmyChessRules.RANK_FLAG or ArmyChessRules.RANK_MINE) return false;
        var (x, y) = Coord(node);
        if (ArmyChessRules.CellType(x, y) == ArmyChessRules.Den) return false;  // 大本营冻结（§2.1 A5）
        return true;
    }

    /// <summary>落点是否合法：空 / 敌子但不在行营（行营敌子不可被吃）。己子不可落。</summary>
    private static bool CanLand(int[,] board, int node, int side)
    {
        var piece = Occ(board, node);
        if (piece == 0) return true;
        if (ArmyChessRules.PieceSide(piece) == side) return false;
        var (x, y) = Coord(node);
        if (ArmyChessRules.CellType(x, y) == ArmyChessRules.Camp) return false;
        return true;
    }

    /// <summary>
    /// 全部合法落点（ValidateMove / HasAnyMove / AI 共用）。
    /// 返回 node id 列表；起点无子/不可动时返回空表。
    /// </summary>
    public static List<int> Reachable(int[,] board, int from, int side)
    {
        var result = new List<int>();
        if (from < 0 || from >= N) return result;
        var piece = Occ(board, from);
        if (piece == 0 || ArmyChessRules.PieceSide(piece) != side) return result;
        if (!Movable(board, from)) return result;

        var engineer = ArmyChessRules.PieceRank(piece) == ArmyChessRules.RANK_ENGINEER;
        return ReachableCore(board, from, engineer, node => CanLand(board, node, side));
    }

    /// <summary>
    /// 行棋核心（拓扑唯一实现）：公路一步 + 铁路直线滑行 + 工兵铁路 BFS，途经有子则阻。
    /// 落点规则由 canLand 决定（明棋/翻棋各一套，共用同一张图），入口合法性由调用方保证。
    /// </summary>
    public static List<int> ReachableCore(int[,] board, int from, bool engineer, Func<int, bool> canLand)
    {
        var result = new List<int>();
        if (from < 0 || from >= N) return result;

        // 公路：沿一条 road 边走 1 格
        foreach (var (to, kind) in Adj[from])
        {
            if (kind != Road) continue;
            if (canLand(to)) result.Add(to);
        }

        // 铁路
        foreach (var (next, kind) in Adj[from])
        {
            if (kind != Rail) continue;
            if (engineer)
            {
                // 工兵：铁路 BFS，途经节点必须空，可停任意连通点
                var seen = new bool[N];
                var queue = new Queue<int>();
                seen[from] = true;
                queue.Enqueue(from);
                while (queue.Count > 0)
                {
                    var cur = queue.Dequeue();
                    foreach (var (nxt, k2) in Adj[cur])
                    {
                        if (k2 != Rail || seen[nxt]) continue;
                        seen[nxt] = true;
                        if (Occ(board, nxt) != 0)
                        {
                            // 有子：可停（若合法）但不可穿越
                            if (canLand(nxt)) result.Add(nxt);
                            continue;
                        }
                        // 空节点：可停 + 可继续穿越
                        if (canLand(nxt)) result.Add(nxt);
                        queue.Enqueue(nxt);
                    }
                }
            }
            else
            {
                // 非工兵：沿该方向连续 rail 边直线滑行（不拐弯），途经必须空
                var (fx, fy) = Coord(from);
                var (tx, ty) = Coord(next);
                var dx = Math.Sign(tx - fx);
                var dy = Math.Sign(ty - fy);
                var cx = fx + dx;
                var cy = fy + dy;
                while (cx >= 0 && cx < W && cy >= 0 && cy < H)
                {
                    var cur = Node(cx, cy);
                    // 该方向上一条边必须是铁路（保证「直线滑行」贴合铁路拓扑）
                    if (!Adj[Node(cx - dx, cy - dy)].Any(e => e.to == cur && e.kind == Rail)) break;
                    if (Occ(board, cur) != 0)
                    {
                        if (canLand(cur)) result.Add(cur);
                        break;   // 有子：可停吃但不可穿越
                    }
                    result.Add(cur);
                    cx += dx;
                    cy += dy;
                }
            }
        }
        return result.Distinct().ToList();
    }

    /// <summary>CanReach：与 Reachable 同一实现（单源），ValidateMove 用</summary>
    public static bool CanReach(int[,] board, int from, int to, int side)
        => Reachable(board, from, side).Contains(to);

    /// <summary>该方是否有任何合法走法（困毙判定用，与 Reachable 同源）</summary>
    public static bool HasAnyMove(int[,] board, int side)
    {
        for (var node = 0; node < N; node++)
        {
            var piece = Occ(board, node);
            if (piece == 0 || ArmyChessRules.PieceSide(piece) != side) continue;
            if (Reachable(board, node, side).Count > 0) return true;
        }
        return false;
    }

    /// <summary>某子全部合法落点（AI 着法生成用）：from 必须是 side 的可动子</summary>
    public static List<(int from, int to)> AllMoves(int[,] board, int side)
    {
        var moves = new List<(int from, int to)>();
        for (var node = 0; node < N; node++)
        {
            var piece = Occ(board, node);
            if (piece == 0 || ArmyChessRules.PieceSide(piece) != side) continue;
            foreach (var to in Reachable(board, node, side))
                moves.Add((node, to));
        }
        return moves;
    }

    // ---------------- 布阵约束（§2.2 deploy 校验 / 随机生成共用） ----------------

    public const int PiecesPerSide = 25;

    /// <summary>己方半场 y 范围</summary>
    public static bool InOwnHalf(int side, int y) => side == 1 ? y >= 6 : y <= 5;
    /// <summary>前线排（炸弹禁放）：side2: y=5 / side1: y=6</summary>
    public static bool IsFrontRow(int side, int y) => side == 1 ? y == 6 : y == 5;
    /// <summary>最后两排（地雷限此）：side2: y=0,1 / side1: y=10,11</summary>
    public static bool IsBackTwoRows(int side, int y) => side == 1 ? y >= 10 : y <= 1;
    /// <summary>己方大本营（军旗任选其一）</summary>
    public static bool IsOwnDen(int side, int x, int y) =>
        (side == 1 && y == 11 && (x == 1 || x == 3)) || (side == 2 && y == 0 && (x == 1 || x == 3));
}
