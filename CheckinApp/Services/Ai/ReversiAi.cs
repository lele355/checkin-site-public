using System.Text.Json;
using CheckinApp.Models;

namespace CheckinApp.Services.Ai;

/// <summary>
/// 黑白棋 AI —— 极小极大 + α-β 剪枝 + 走法排序（角优先），深度 4 层。
///
/// 可变盘面（6/8/10/12）：位置权重由 4×4 象限镜像生成（8×8 权重表本身就是
/// 象限对称，min(x,n-1-x) 镜像推广到任意偶数 n）。
/// 纯函数：Think(events, side, level, room) → move 请求体或 null（无着可走）。
/// 节点预算保护：超预算就用当前最佳着，保证单次生成 < 1s。
/// </summary>
public static class ReversiAi
{
    private const int DefaultDepth = 4;
    private const int NodeBudget = 200_000;
    private static int _nodes;

    /// <summary>位置权重左上象限（4×4；镜像成任意 n×n —— 8×8 权重表即其镜像扩展）</summary>
    private static readonly int[,] QuadWeights =
    {
        { 120, -20, 20, 5 },
        { -20, -40, -5, -5 },
        { 20, -5, 15, 3 },
        { 5, -5, 3, 3 },
    };

    /// <summary>位置权重（镜像到任意盘面）：越靠角/边越重</summary>
    private static int PosWeight(int x, int y, int n)
    {
        var qx = Math.Min(Math.Min(x, n - 1 - x), 3);
        var qy = Math.Min(Math.Min(y, n - 1 - y), 3);
        return QuadWeights[qx, qy];
    }

    /// <summary>
    /// 思考一步棋。返回 move 请求体 {x, y} 或 null（无着可走 → 需要 pass）。
    /// </summary>
    public static JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r)
    {
        var n = ReversiRules.BoardSizeOf(r);
        var board = ReversiRules.Replay(evs, n);
        var moves = ReversiRules.LegalMoves(board, side);
        if (moves.Count == 0) return null;

        var depth = level switch
        {
            1 => 2,
            2 => 3,
            3 => 5,
            _ => DefaultDepth,
        };
        // 大盘分支多，深度收一档（NodeBudget 兜底不超时）
        if (n >= 10 && depth > 3) depth -= 1;

        _nodes = 0;
        var best = moves[0];
        var bestScore = int.MinValue;

        // 走法排序：角优先
        moves.Sort((a, b) => PosWeight(b.x, b.y, n).CompareTo(PosWeight(a.x, a.y, n)));

        foreach (var (mx, my) in moves)
        {
            var next = CloneBoard(board);
            next[mx, my] = side;
            foreach (var (fx, fy) in ReversiRules.GetFlips(next, mx, my, side, before: true))
                next[fx, fy] = side;

            var score = -Search(next, ReversiRules.Other(side), depth - 1, int.MinValue + 1, int.MaxValue - 1, 1, n);
            if (score > bestScore)
            {
                bestScore = score;
                best = (mx, my);
            }
            if (_nodes >= NodeBudget) break;
        }

        return JsonSerializer.SerializeToElement(new { x = best.x, y = best.y });
    }

    private static int Search(int[,] board, int side, int depth, int alpha, int beta, int sign, int n)
    {
        _nodes++;
        if (_nodes >= NodeBudget || depth <= 0) return Evaluate(board, sign, n) * sign;

        var moves = ReversiRules.LegalMoves(board, side);
        if (moves.Count == 0)
        {
            // pass：换对方走
            var opp = ReversiRules.Other(side);
            if (ReversiRules.LegalMoves(board, opp).Count == 0)
            {
                // 双方都无着 → 终局
                var myCount = ReversiRules.CountStones(board, sign);
                var oppCount = ReversiRules.CountStones(board, -sign == 1 ? 2 : 1);
                return myCount > oppCount ? 10000 : myCount < oppCount ? -10000 : 0;
            }
            return -Search(board, opp, depth - 1, -beta, -alpha, -sign, n);
        }

        moves.Sort((a, b) => PosWeight(b.x, b.y, n).CompareTo(PosWeight(a.x, a.y, n)));

        var bestScore = int.MinValue;
        foreach (var (mx, my) in moves)
        {
            var next = CloneBoard(board);
            next[mx, my] = side;
            foreach (var (fx, fy) in ReversiRules.GetFlips(next, mx, my, side, before: true))
                next[fx, fy] = side;

            var score = -Search(next, ReversiRules.Other(side), depth - 1, -beta, -alpha, -sign, n);
            if (score > bestScore) bestScore = score;
            if (bestScore > alpha) alpha = bestScore;
            if (alpha >= beta) break;
            if (_nodes >= NodeBudget) break;
        }
        return bestScore;
    }

    private static int Evaluate(int[,] board, int side, int n)
    {
        var score = 0;
        var opp = side == 1 ? 2 : 1;
        for (var x = 0; x < n; x++)
        {
            for (var y = 0; y < n; y++)
            {
                if (board[x, y] == side) score += PosWeight(x, y, n);
                else if (board[x, y] == opp) score -= PosWeight(x, y, n);
            }
        }

        // 行动力加成
        var myMoves = ReversiRules.LegalMoves(board, side).Count;
        var oppMoves = ReversiRules.LegalMoves(board, opp).Count;
        score += (myMoves - oppMoves) * 8;

        return score;
    }

    private static int[,] CloneBoard(int[,] board)
    {
        var n = board.GetLength(0);
        var clone = new int[n, n];
        Array.Copy(board, clone, board.Length);
        return clone;
    }
}
